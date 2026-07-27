/**
 * Experiment setup and initialization utilities
 * Handles dynamic script loading and experiment launch coordination
 */

// Import communication utility for sending messages to parent window
import { postToParent } from './data-handling.js';
import { preventParticipantTermination } from './participation-validation.js';
import { formatDateString } from './calculations.js';

/**
 * Dynamically loads a JavaScript file with Promise-based interface
 * More robust than fetch() for loading sequence files
 * @param {string} scriptSrc - Path to the JavaScript file to load
 * @returns {Promise} Resolves when script is loaded successfully
 */
function loadSequence(scriptSrc) {
    return new Promise((resolve, reject) => {

        // Resolve any path aliases using the import map
        const resolvedPath = resolvePath(scriptSrc);

        // Check if script is already loaded
        const existingScript = document.querySelector(`script[src="${resolvedPath}"]`);
        if (existingScript) {
            console.log(`Script already loaded: ${resolvedPath}`);
            resolve();
            return;
        }

        // Create a new script element for dynamic loading
        const script = document.createElement("script");
        
        // Set the src attribute to the provided script path
        script.src = resolvedPath;
        script.type = "text/javascript";
        
        // Success handler
        script.onload = () => {
            console.log("Script loaded successfully:", resolvedPath);
            resolve();
        };
        
        // Error handler
        script.onerror = () => {
            console.error("Failed to load script:", resolvedPath);
            reject(new Error(`Failed to load sequence script: ${resolvedPath}`));
        };
        
        // Append the script to the document's head to trigger loading
        document.head.appendChild(script);
    });
}

/**
 * Resolves path aliases using the import map defined in the HTML file
 * @param {string} path - The path that may contain aliases
 * @returns {string} The resolved path
 */
function resolvePath(path) {
    // Get the import map from the document
    const importMapScript = document.querySelector('script[type="importmap"]');
    
    if (importMapScript) {
        try {
            const importMap = JSON.parse(importMapScript.textContent);
            const imports = importMap.imports || {};
            
            // Check if path starts with any alias from the import map
            for (const [alias, actualPath] of Object.entries(imports)) {
                if (path.startsWith(alias)) {
                    return path.replace(alias, actualPath);
                }
            }
        } catch (error) {
            console.warn('Failed to parse import map:', error);
        }
    }
    
    // Return original path if no mapping found
    return path;
}

/**
 * Asynchronously loads a CSS stylesheet into the document head.
 * Checks if the CSS is already loaded to prevent duplicates.
 * 
 * @async
 * @function loadCSS
 * @param {string} cssPath - The path or URL to the CSS file to load
 * @returns {Promise<void>} A promise that resolves when the CSS is successfully loaded
 * @throws {Error} Throws an error if the CSS file fails to load
 * 
 * @example
 * // Load a CSS file
 * await loadCSS('/styles/main.css');
 * 
 * @example
 * // Handle loading errors
 * try {
 *   await loadCSS('/styles/theme.css');
 * } catch (error) {
 *   console.error('CSS loading failed:', error);
 * }
 */
async function loadCSS(cssPath) {
    return new Promise((resolve, reject) => {
        // Resolve any path aliases using the import map
        const resolvedPath = resolvePath(cssPath);

        // Check if CSS is already loaded
        const existingLink = document.querySelector(`link[href="${resolvedPath}"]`);
        if (existingLink) {
            console.log(`CSS already loaded: ${resolvedPath}`);
            resolve();
            return;
        }

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.type = 'text/css';
        link.href = resolvedPath;
        
        link.onload = () => {
            console.log(`Successfully loaded CSS: ${resolvedPath}`);
            resolve();
        };
        
        link.onerror = () => {
            console.warn(`Failed to load CSS: ${resolvedPath}`);
            reject(new Error(`Failed to load CSS: ${resolvedPath}`));
        };
        
        document.head.appendChild(link);
    });
}

/**
 * Creates a jsPsych preload trial for loading images before task execution
 * @param {string[]} images - Array of image file paths to preload
 * @param {string} task_name - Name of the task for trial identification
 * @returns {Object} jsPsych preload trial configuration object
 */
function createPreloadTrial(images, task_name, audio = []) {
    return {
        type: jsPsychPreload,
        images: images,
        audio: audio,
        post_trial_gap: 800,
        data: {
            trialphase: `${task_name}_preload`,
        },
        on_start: () => {
            console.log("load_successful");
            postToParent({ message: "load_successful" });
        },
        continue_after_error: true
    };
}

// Save all URL parameters to jsPsych data
function saveUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const params = {};
    for (const [key, value] of urlParams.entries()) {
        params[key] = value;
    }
    jsPsych.data.addProperties(params);
    console.log("URL parameters saved to data:", params);
}

/**
 * Captures device, input, and viewport covariates once at experiment entry.
 * Everything here is a single entry-time snapshot, stored on window.deviceInfo
 * and sent as its own field in the REDCap payload (see saveDataREDCap) rather
 * than repeated on every trial. Most of it never changes during a session
 * (user agent, pixel ratio, screen size, touch capability, fullscreen
 * support/state - the latter also covered continuously by interaction_data's
 * fullscreenenter/exit events).
 *
 * Viewport size and orientation DO change mid-session (rotation, browser
 * chrome, dvh), so they are prefixed entry_* to mark them as the value at
 * entry only. They must not go through jsPsych.data.addProperties: those
 * values are merged over each trial's own result at write time
 * (core/jspsych/jspsych.js write() -> Object.assign(result, dataProperties)),
 * so an addProperties key silently overwrites any per-trial column of the
 * same name. Tasks that measure the live viewport per trial (reversal,
 * vigour) own the unprefixed viewport_width / viewport_height names.
 */
function logDeviceInfo() {
    const orientation = (window.screen && window.screen.orientation && window.screen.orientation.type) || null;

    window.deviceInfo = {
        device_user_agent: navigator.userAgent,
        device_pixel_ratio: window.devicePixelRatio || 1,
        screen_width: window.screen ? window.screen.width : null,
        screen_height: window.screen ? window.screen.height : null,
        max_touch_points: navigator.maxTouchPoints || 0,
        touch_capable: ('ontouchstart' in window) || ((navigator.maxTouchPoints || 0) > 0),
        fullscreen_enabled: !!(document.fullscreenEnabled || document.webkitFullscreenEnabled),
        fullscreen_active: !!(document.fullscreenElement || document.webkitFullscreenElement),
        entry_viewport_width: window.innerWidth,
        entry_viewport_height: window.innerHeight,
        entry_device_orientation: orientation
    };

    console.log("Device info logged.");
}

/**
 * Creates a jsPsych fullscreen trial that initiates the experiment
 * Handles URL parameter saving and participant termination prevention
 * @type {Object} jsPsych trial configuration for entering fullscreen mode
 */
const enterExperiment = {
    type: jsPsychCallFunction,
    func: function() {
        // Record the sitting start time now that jsPsych has actually begun running -
        // getStartTime() is unset until jsPsych.run()/simulate() starts the timeline,
        // so this can't be read any earlier (e.g. in the entry HTML before jsPsych.run()).
        window.module_start_time = formatDateString(jsPsych.getStartTime());

        // Save all URL parameters to jsPsych data for experiment tracking
        saveUrlParameters();

        jsPsych.data.addProperties({
            n_warnings: 0
        })

        // Prevent participant from terminating experiment unless in debug mode
        if (!(window.participantID && window.participantID.includes("debug"))) {
            preventParticipantTermination();
        }

        // Capture device/viewport covariates
        logDeviceInfo();
    }
};


// Export functions for use in other modules
export {
    loadSequence,
    createPreloadTrial,
    saveUrlParameters,
    enterExperiment,
    loadCSS
};


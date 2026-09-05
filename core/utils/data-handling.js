import { preventRefresh} from "./participation-validation.js"
import { submitRecord } from "./data-queue.js"
import { createREDCapRecordId } from "./participant-id.js"

let finalSaveGeneration = 0;

/**
 * Data handling and communication utilities
 * Manages data saving, state updates, and communication with parent windows/servers
 */

/**
 * Sends messages to parent window with security validation
 * Used for communication between iframe and parent window in web experiments
 * @param {Object} message - Message object to send to parent
 * @param {Function} fallback - Callback function to execute if messaging fails
 */
function postToParent(message, fallback = () => {}) {
    try {
        if (window.parent && window.parent.postMessage) {
            const allowedOrigins = [
                'http://localhost:3000',
                'https://relmed.ac.uk',
                'https://www.relmed.ac.uk',
                'https://mymeds.study'
            ];

            // Normalize a URL by removing trailing slashes
            const normalizeUrl = (url) => url.replace(/\/+$/, '');

            // Get the parent URL and normalize it
            const parentUrl = normalizeUrl(document.referrer || window.parent.location.origin);

            // Check if the normalized parent URL matches any of the allowed origins
            const isAllowed = allowedOrigins.some(origin => normalizeUrl(origin) === parentUrl);

            if (isAllowed) {
                window.parent.postMessage(message, parentUrl);
            } else {
                // console.warn("Parent URL does not match any allowed origins:", parentUrl);
                fallback();
            }
        } else {
            console.warn("Parent window or postMessage is unavailable.");
            fallback();
        }
    } catch (error) {
        console.warn("Failed to send message to parent window:", error);

        // Implement a fallback or handle the error
        fallback();
    }
}

/**
 * Updates experiment state and optionally saves data
 * Coordinates state management between client and server
 * @param {string} state - Current experiment state identifier
 * @param {boolean} save_data - Whether to save data to REDCap (default: true)
 */
function updateState(state, save_data = true) {

    // Save data to REDCap
    if (!state.includes("no_resume") && save_data){
        saveDataREDCap();
    }

    // Update bonus state
    // updateBonusState();

    console.log(state);
    postToParent({
        state: state
    });
}

/**
 * Saves experimental data to REDCap via the AWS Lambda endpoint by writing a cumulative
 * snapshot to the local outbox (see data-queue.js). Delivery is the outbox's job and is
 * retried until REDCap confirms receipt, so a dropped connection - or a device that is not
 * currently authorized - never costs data.
 *
 * Async so a malformed participant ID surfaces as a rejected promise rather than a
 * synchronous throw at the call site.
 * @returns {Promise<{version: number}>} Resolves once the snapshot is durably stored.
 */
async function saveDataREDCap() {

    // Get data, remove stimulus string to reduce payload size
    const jspsych_data = jsPsych.data.get().ignore('stimulus').json();

    // Get interaction data (mouse movements, focus changes, etc.)
    const interaction_data = jsPsych.data.getInteractionData().json();

    // Combine interaction data with jsPsych data. Device info (set once by logDeviceInfo)
    // is sent as its own field rather than repeated on every trial via addProperties.
    const combined_data = JSON.stringify([
        {
            interaction_data: interaction_data,
            jspsych_data: jspsych_data,
            device_info: window.deviceInfo || null
        }
    ]);

    const record_id = createREDCapRecordId(window.participantID, window.module_start_time);

    const redcap_record = JSON.stringify([{
        record_id: record_id,
        participant_id: window.participantID,
        sitting_start_time: window.module_start_time,
        module: window.module,
        data: combined_data
    }]);

    console.log("Data to be sent:", redcap_record);

    return submitRecord(record_id, redcap_record);
}

/**
 * Handles experiment completion and final data submission
 * Removes page refresh prevention and redirects participants appropriately
 */
function endExperiment() {

    // Print end experiment message
    console.log("Experiment finished. Saving final data...");

    // Some module timelines invoke endExperiment more than once near completion (for
    // example, on bonus finish and again on the final message). Re-arm the guard and only
    // let the newest final snapshot release it.
    const saveGeneration = ++finalSaveGeneration;
    window.addEventListener('beforeunload', preventRefresh);

    const persistence = saveDataREDCap();

    // The outbox is what makes leaving safe: once the final snapshot is durably stored it
    // will be delivered, so do not make the participant wait for the network. The guard
    // stays armed only if the snapshot could not be stored at all.
    persistence.then(() => {
        if (saveGeneration === finalSaveGeneration) {
            window.removeEventListener('beforeunload', preventRefresh);
        }
    }).catch((error) => {
        console.error('Failed to store final data before completion:', error);
    });

    return persistence;
}

// Export functions for use in other modules
export {
    postToParent,
    updateState,
    saveDataREDCap,
    endExperiment
};

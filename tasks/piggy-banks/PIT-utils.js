// Import functions 
import { saveDataREDCap, updateBonusState, updateState, showTemporaryWarning, kickOut, fullscreen_prompt, setupTapListener, cleanupTapListener, simulateTap } from '@utils/index.js';
import { updatePiggyTails, shakePiggy } from './utils.js';
import { setForceCallback, createPressDetector, disconnectDynamometer } from '@utils/dynamometer.js';
import { generateDebugForceGraph, createDebugForceGraphUpdater } from '@tasks/piggy-banks-dynamometer/vigour-utils.js';

// Define trial sequence - each trial specifies piggy properties and background stimulus
const PIT_TRIAL_LIST = [{ "magnitude": 5, "ratio": 8, "coin": 0, "trialDuration": 4110 }, { "magnitude": 5, "ratio": 8, "coin": -0.01, "trialDuration": 6666 }, { "magnitude": 5, "ratio": 8, "coin": 0.01, "trialDuration": 7261 }, { "magnitude": 2, "ratio": 8, "coin": 0, "trialDuration": 4188 }, { "magnitude": 2, "ratio": 8, "coin": -1, "trialDuration": 7490 }, { "magnitude": 2, "ratio": 8, "coin": 1, "trialDuration": 6825 }, { "magnitude": 1, "ratio": 1, "coin": 0, "trialDuration": 4130 }, { "magnitude": 1, "ratio": 1, "coin": 0.01, "trialDuration": 6891 }, { "magnitude": 1, "ratio": 1, "coin": -0.01, "trialDuration": 6902 }, { "magnitude": 2, "ratio": 8, "coin": 0, "trialDuration": 4193 }, { "magnitude": 2, "ratio": 8, "coin": -0.5, "trialDuration": 6535 }, { "magnitude": 2, "ratio": 8, "coin": -0.01, "trialDuration": 6652 }, { "magnitude": 1, "ratio": 1, "coin": 0, "trialDuration": 3978 }, { "magnitude": 1, "ratio": 1, "coin": -0.5, "trialDuration": 6888 }, { "magnitude": 1, "ratio": 1, "coin": -1, "trialDuration": 6962 }, { "magnitude": 2, "ratio": 16, "coin": 0, "trialDuration": 3833 }, { "magnitude": 2, "ratio": 16, "coin": 0.5, "trialDuration": 7452 }, { "magnitude": 2, "ratio": 16, "coin": 0.01, "trialDuration": 6954 }, { "magnitude": 5, "ratio": 8, "coin": 0, "trialDuration": 3913 }, { "magnitude": 5, "ratio": 8, "coin": -0.5, "trialDuration": 6956 }, { "magnitude": 5, "ratio": 8, "coin": 0.5, "trialDuration": 7376 }, { "magnitude": 2, "ratio": 8, "coin": 0, "trialDuration": 4005 }, { "magnitude": 2, "ratio": 8, "coin": 0.5, "trialDuration": 7009 }, { "magnitude": 2, "ratio": 8, "coin": 0.01, "trialDuration": 7228 }, { "magnitude": 5, "ratio": 8, "coin": 0, "trialDuration": 4114 }, { "magnitude": 5, "ratio": 8, "coin": -1, "trialDuration": 7386 }, { "magnitude": 5, "ratio": 8, "coin": 1, "trialDuration": 7221 }, { "magnitude": 2, "ratio": 16, "coin": 0, "trialDuration": 4245 }, { "magnitude": 2, "ratio": 16, "coin": 1, "trialDuration": 6679 }, { "magnitude": 2, "ratio": 16, "coin": -0.01, "trialDuration": 7207 }, { "magnitude": 1, "ratio": 1, "coin": 0, "trialDuration": 3767 }, { "magnitude": 1, "ratio": 1, "coin": 1, "trialDuration": 7236 }, { "magnitude": 1, "ratio": 1, "coin": 0.5, "trialDuration": 6501 }, { "magnitude": 2, "ratio": 16, "coin": 0, "trialDuration": 3826 }, { "magnitude": 2, "ratio": 16, "coin": -0.5, "trialDuration": 7465 }, { "magnitude": 2, "ratio": 16, "coin": -1, "trialDuration": 6827 }, { "magnitude": 2, "ratio": 8, "coin": 0, "trialDuration": 4118 }, { "magnitude": 2, "ratio": 8, "coin": -0.5, "trialDuration": 6535 }, { "magnitude": 2, "ratio": 8, "coin": 1, "trialDuration": 6825 }, { "magnitude": 1, "ratio": 1, "coin": 0, "trialDuration": 3751 }, { "magnitude": 1, "ratio": 1, "coin": 0.01, "trialDuration": 6891 }, { "magnitude": 1, "ratio": 1, "coin": -1, "trialDuration": 6962 }, { "magnitude": 2, "ratio": 16, "coin": 0, "trialDuration": 3946 }, { "magnitude": 2, "ratio": 16, "coin": -0.01, "trialDuration": 7207 }, { "magnitude": 2, "ratio": 16, "coin": -1, "trialDuration": 6827 }, { "magnitude": 1, "ratio": 1, "coin": 0, "trialDuration": 3981 }, { "magnitude": 1, "ratio": 1, "coin": 0.5, "trialDuration": 6501 }, { "magnitude": 1, "ratio": 1, "coin": 1, "trialDuration": 7236 }, { "magnitude": 2, "ratio": 16, "coin": 0, "trialDuration": 3944 }, { "magnitude": 2, "ratio": 16, "coin": 0.5, "trialDuration": 7452 }, { "magnitude": 2, "ratio": 16, "coin": 1, "trialDuration": 6679 }, { "magnitude": 5, "ratio": 8, "coin": 0, "trialDuration": 3951 }, { "magnitude": 5, "ratio": 8, "coin": -1, "trialDuration": 7386 }, { "magnitude": 5, "ratio": 8, "coin": -0.5, "trialDuration": 6956 }, { "magnitude": 5, "ratio": 8, "coin": 0, "trialDuration": 3839 }, { "magnitude": 5, "ratio": 8, "coin": -0.01, "trialDuration": 6666 }, { "magnitude": 5, "ratio": 8, "coin": 0.01, "trialDuration": 7261 }, { "magnitude": 2, "ratio": 8, "coin": 0, "trialDuration": 4226 }, { "magnitude": 2, "ratio": 8, "coin": 0.01, "trialDuration": 7228 }, { "magnitude": 2, "ratio": 8, "coin": -1, "trialDuration": 7490 }, { "magnitude": 1, "ratio": 1, "coin": 0, "trialDuration": 3977 }, { "magnitude": 1, "ratio": 1, "coin": -0.01, "trialDuration": 6902 }, { "magnitude": 1, "ratio": 1, "coin": -0.5, "trialDuration": 6888 }, { "magnitude": 2, "ratio": 16, "coin": 0, "trialDuration": 3913 }, { "magnitude": 2, "ratio": 16, "coin": 0.01, "trialDuration": 6954 }, { "magnitude": 2, "ratio": 16, "coin": -0.5, "trialDuration": 7465 }, { "magnitude": 5, "ratio": 8, "coin": 0, "trialDuration": 4233 }, { "magnitude": 5, "ratio": 8, "coin": 1, "trialDuration": 7221 }, { "magnitude": 5, "ratio": 8, "coin": 0.5, "trialDuration": 7376 }, { "magnitude": 2, "ratio": 8, "coin": 0, "trialDuration": 4104 }, { "magnitude": 2, "ratio": 8, "coin": -0.01, "trialDuration": 6652 }, { "magnitude": 2, "ratio": 8, "coin": 0.5, "trialDuration": 7009 }];

// Extract unique piggy bank parameters for UI configuration
const unique_magnitudes = [...new Set(PIT_TRIAL_LIST.map(item => item.magnitude))].sort((a, b) => a - b);
const unique_ratios = [...new Set(PIT_TRIAL_LIST.map(item => item.ratio))].sort((a, b) => b - a); // Sort ratios descending
const DYNAMOMETER_RATIO_MAP = { 1: 1, 8: 5, 16: 10 };

function usesDynamometer(settings) {
  return settings.inputMode === 'dynamometer';
}

function ratiosFor(settings) {
  return usesDynamometer(settings)
    ? unique_ratios.map(ratio => DYNAMOMETER_RATIO_MAP[ratio])
    : unique_ratios;
}

/**
 * Returns array of image paths to preload for the PIT task
 * @param {Object} settings - Configuration object containing session information
 * @returns {Array} Flattened array of image file paths
 */
export const PITPreloadImages = (settings) => {
  return [
      // Piggy bank background images
      [
        "piggy-cloud.png",
        "occluding_clouds.png"
      ].map(s => "./assets/images/piggy-banks/" + s),
      // Coin outcome images (positive and negative)
      [
        "1pound.png", "50pence.png", "1penny.png", "1pennybroken.png", "50pencebroken.png", "1poundbroken.png"
      ].map(s => "./assets/images/card-choosing/outcomes/" + s),
      // Pavlovian background stimuli (session-specific)
      [
        "PIT1.png", "PIT2.png", "PIT3.png", "PIT4.png", "PIT5.png", "PIT6.png"
      ].map(s => "./assets/images/pavlovian-stims/" + settings.session + "/" + s)
    ].flat(); // Assuming vigour stimulus were already preloaded
}

/**
 * Generates the HTML stimulus for a PIT trial with piggy bank and background
 * @param {number} coin - The coin value that determines background stimulus
 * @param {number} ratio - The response ratio required for reward
 * @param {Object} settings - Configuration object containing session information
 * @returns {string} HTML string for the trial stimulus
 */
function generatePITstimulus(coin, ratio, settings) {
  const trialRatios = ratiosFor(settings);
  const ratio_index = trialRatios.indexOf(ratio);
  // Calculate saturation based on ratio - higher ratios = more saturated colors
  const ratio_factor = ratio_index / (unique_ratios.length - 1);
  const piggy_style = `filter: saturate(${50 * (400 / 50) ** ratio_factor}%) brightness(${115 * (90/115) ** ratio_factor}%);`;
  const cloud_style = `filter: brightness(0.8) contrast(1.2);`;
  
  // Map coin values to background image filenames
  let PIT_imgs = {
    0.01: "PIT3.png",
    1.0: "PIT1.png",
    0.5: "PIT2.png",
    "-0.01": "PIT4.png",
    "-1": "PIT6.png",
    "-0.5": "PIT5.png"
  };
  // Convert to full paths with session-specific directory
  PIT_imgs = Object.fromEntries(Object.entries(PIT_imgs).map(([k, v]) => [k, "./assets/images/pavlovian-stims/" + settings.session + "/" + v]));
  PIT_imgs["0"] = ""; // No background for neutral trials
  
  const piggyBgImg = PIT_imgs[coin];
  return `
    <div class="experiment-wrapper" style="background-image: url(${piggyBgImg});background-repeat: repeat; background-size: 30vw;">
      <!-- Middle Row (Piggy Bank & Coins) -->
      <div id="experiment-container">
        <div id="bg-container">
          <img id="piggy-bg-1" src="./assets/images/piggy-banks/piggy-cloud.png" alt="Piggy background" style="transform: translate(0vw, -4vh); position: absolute; height: 120%; width: auto; ${cloud_style}">
          <img id="piggy-bg-2" src="./assets/images/piggy-banks/piggy-cloud.png" alt="Piggy background" style="transform: translate(0vw, -4vh); position: absolute; height: 120%; width: auto;">
        </div>
        <div id="piggy-container">
          <!-- Piggy Bank Image -->
          <img id="piggy-bank" src="./assets/images/piggy-banks/piggy-bank.png" alt="Piggy Bank" style="${piggy_style}">
        </div>
        <div id="obstructor-container">
          <img id="obstructor" src="./assets/images/piggy-banks/occluding_clouds.png" alt="Obstructor">
        </div>
        ${usesDynamometer(settings) ? generateDebugForceGraph(settings) : ''}
      </div>
    </div>
  `;
}

// Global task state tracking variables
let PITtrialCounter = 0;
let taskTotalPresses = 0;
let taskTotalReward = 0;
let fsChangeHandler = null;
let pitTapListener = null;
let pitDetector = null;

/**
 * Creates a single PIT trial with vigour task mechanics and Pavlovian background
 * @param {Object} settings - Configuration object containing session information
 * @returns {Object} jsPsych trial object
 */
function PITTrial(settings) {
  const dynamometer = usesDynamometer(settings);
  // Create trial state in closure scope so it's accessible to data functions
  const trialState = {
    trialPresses: 0,
    trialReward: 0,
    responseTime: [],
    pointerType: null,
    pointerTypeCounts: {}
  };

  return {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: function () {
      return generatePITstimulus(jsPsych.evaluateTimelineVariable('coin'), jsPsych.evaluateTimelineVariable('ratio'), settings);
    },
    choices: 'NO_KEYS',
    // response_ends_trial: false,
    trial_duration: jsPsych.timelineVariable('trialDuration'),
    save_timeline_variables: ["magnitude", "ratio"],
    data: {
      trialphase: dynamometer ? 'dynamometer_pit_trial' : 'pit_trial',
      pit_coin: jsPsych.timelineVariable('coin'),
      trial_duration: jsPsych.timelineVariable('trialDuration'),
      response_time: () => { return trialState.responseTime },
      // Matches the vigour trial's telemetry: the two tasks are compared press
      // for press, so they have to record input the same way.
      pointer_type: () => { return trialState.pointerType },
      pointer_type_counts: () => { return trialState.pointerTypeCounts },
      pointer_mixed: () => { return Object.keys(trialState.pointerTypeCounts).length > 1 },
      trial_presses: () => { return trialState.trialPresses },
      trial_reward: () => { return trialState.trialReward },
      // Record global data
      total_presses: () => { return taskTotalPresses },
      total_reward: () => { return taskTotalReward },
      input_type: dynamometer ? 'dynamometer' : 'pointer',
      ...(dynamometer ? {
        max_force_n: () => window.dynamometerMaxForce,
        threshold_fraction: settings.thresholdFraction,
        hold_duration_ms: settings.holdDurationMs
      } : {})
    },
    on_start: function (trial) {
      // Shorten trial duration for simulation mode
      if (window.simulating) {
        trial.trial_duration = 500;
      }

      // Reset trial state. Input is bound in on_load, once the piggy bank exists.
      trialState.trialPresses = 0;
      trialState.trialReward = 0;
      trialState.responseTime = [];
      trialState.pointerType = null;
      trialState.pointerTypeCounts = {};
    },
    on_load: function () {
      const currentMag = jsPsych.evaluateTimelineVariable('magnitude');
      const currentRatio = jsPsych.evaluateTimelineVariable('ratio');
      
      // Add magnitudes and ratios to settings for piggy tails
      settings.magnitudes = unique_magnitudes;
      settings.ratios = ratiosFor(settings);
      
      updatePiggyTails(currentMag, currentRatio, settings);

      // Add fullscreen change listener to re-update piggy tails
      fsChangeHandler = () => {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          updatePiggyTails(currentMag, currentRatio, settings);
        }
      };
      document.addEventListener('fullscreenchange', fsChangeHandler);
      document.addEventListener('webkitfullscreenchange', fsChangeHandler);

      let pressCount = 0;
      let lastPressTime = null;
      const trialStartTime = performance.now();
      const piggyContainer = document.getElementById('piggy-container');

      const handlePress = (event = null) => {
        const now = performance.now();

        if (event) {
          const ptype = event.pointerType || 'unknown';
          if (trialState.pointerType === null) {
            trialState.pointerType = ptype; // modality the trial was started with
          }
          trialState.pointerTypeCounts[ptype] = (trialState.pointerTypeCounts[ptype] || 0) + 1;
        }

        // First entry is RT from trial onset; the rest are inter-press intervals.
        trialState.responseTime.push(lastPressTime === null ? now - trialStartTime : now - lastPressTime);
        lastPressTime = now;

        shakePiggy();
        pressCount++;
        trialState.trialPresses++;
        taskTotalPresses++;

        // Coins are still earned on ratio, but stay hidden behind the clouds.
        if (pressCount === currentRatio) {
          trialState.trialReward += currentMag;
          taskTotalReward += currentMag;
          pressCount = 0;
        }
      };

      if (dynamometer && !window.simulating) {
        pitDetector = createPressDetector(window.dynamometerMaxForce, {
          thresholdFraction: settings.thresholdFraction,
          holdDurationMs: settings.holdDurationMs,
          onPress: handlePress
        });
        const updateDebugGraph = createDebugForceGraphUpdater(settings);
        setForceCallback(forceN => {
          pitDetector.update(forceN);
          updateDebugGraph(forceN);
        });
      } else if (!dynamometer) {
        // PIT uses the same input as its preceding vigour task: screen taps in the
        // standard battery, or threshold-crossing grip squeezes in the dynamometer battery.
        pitTapListener = setupTapListener(piggyContainer, handlePress);
      }

      if (window.simulating) {
        const trial_presses = jsPsych.randomization.randomInt(1, 8);
        const avg_rt = 500/trial_presses;
        for (let i = 0; i < trial_presses; i++) {
          if (dynamometer) {
            jsPsych.pluginAPI.setTimeout(handlePress, avg_rt * i + 1);
          } else {
            simulateTap(piggyContainer, avg_rt * i + 1);
          }
        }
      }
    },
    on_finish: function (data) {
      // Clean up listeners
      cleanupTapListener(pitTapListener);
      pitTapListener = null;
      pitDetector?.reset();
      pitDetector = null;
      if (dynamometer) setForceCallback(() => {});
      jsPsych.pluginAPI.cancelAllKeyboardResponses();
      PITtrialCounter += 1;
      data.pit_trial_number = PITtrialCounter;
      
      // Save data at regular intervals and end of task
      if (PITtrialCounter % (PIT_TRIAL_LIST.length / 3) == 0 || PITtrialCounter == PIT_TRIAL_LIST.length) {
        saveDataREDCap();
        updateBonusState(settings);
      }
      
      // Clean up fullscreen event listeners
      if (fsChangeHandler) {
        document.removeEventListener('fullscreenchange', fsChangeHandler);
        document.removeEventListener('webkitfullscreenchange', fsChangeHandler);
        fsChangeHandler = null;
      }

      // Show warning for no response on easy trials
      if (data.trial_presses === 0 && data.timeline_variables.ratio === 1) {
        var up_to_now = parseInt(jsPsych.data.get().last(1).select('n_warnings').values);
        jsPsych.data.addProperties({
          n_warnings: up_to_now + 1
        });
        // console.log(jsPsych.data.get().last(1).select('n_warnings').values[0]);
        showTemporaryWarning("Don't forget to participate!", 800); // Enable this line for non-stopping warning
      }
    }
  };
}

/**
 * Creates the complete timeline for the PIT task core trials
 * @param {Object} settings - Configuration object containing session information
 * @returns {Array} Array of jsPsych timeline objects for all PIT trials
 */
export function createPITCoreTimeline(settings) {
  const dynamometer = usesDynamometer(settings);
  const trialSequence = dynamometer
    ? PIT_TRIAL_LIST.map(trial => ({ ...trial, ratio: DYNAMOMETER_RATIO_MAP[trial.ratio] }))
    : PIT_TRIAL_LIST;
  let PITtrials = [];
  // Create a timeline for each trial with kick-out and fullscreen checks
  trialSequence.forEach(trial => {
    PITtrials.push({
      timeline: [kickOut(settings), fullscreen_prompt, PITTrial(settings)],
      timeline_variables: [trial]
    });
  });

  // Add initialization callback to first trial
  PITtrials[0]["on_timeline_start"] = () => {
    updateState(`no_resume_10_minutes`);
    updateState(dynamometer ? `dynamometer_pit_task_start` : `pit_task_start`);
    // Reset task counters
    PITtrialCounter = 0;
    taskTotalPresses = 0;
    taskTotalReward = 0;
  };

  PITtrials.at(-1)["on_timeline_finish"] = () => {
    if (dynamometer && settings.disconnectOnFinish !== false && window.dynamometerSensor) {
      disconnectDynamometer(window.dynamometerSensor).catch(() => {});
      window.dynamometerSensor = null;
    }
  };

  return PITtrials;
}

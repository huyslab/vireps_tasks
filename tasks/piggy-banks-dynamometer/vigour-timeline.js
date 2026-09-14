import { createDynVigourCoreTimeline, VIGOUR_PRELOAD_IMAGES } from './vigour-utils.js';
import { createDynamometerVigourInstructions } from './vigour-instructions.js';
import { connectDynamometer, startForceStream } from '@utils/dynamometer.js';
import { createPreloadTrial } from '@utils/index.js';

function calStorageKey() {
    return `dynamometerMaxForce_${window.participantID ?? 'anon'}`;
}

// Reconnect trial shown when vigour starts without a live device handle
// (e.g. the page was reloaded between calibration and vigour).
function makeReconnectTrial() {
    return {
        type: jsPsychHtmlKeyboardResponse,
        choices: 'NO_KEYS',
        stimulus: `
            <div id="instruction-container">
                <div id="instruction-text">
                    <h2>Reconnect the grip</h2>
                    <p>The grip sensor needs to be paired again. Make sure it is switched on and close by, then tap <strong>Connect</strong>.</p>
                    <p id="reconnect-status" style="color: var(--rlm-accent, #c0392b)"></p>
                    <button id="reconnect-btn" class="jspsych-btn">Connect</button>
                </div>
            </div>
        `,
        data: { trialphase: 'dynamometer_reconnect' },
        on_load: function () {
            const btn    = document.getElementById('reconnect-btn');
            const status = document.getElementById('reconnect-status');

            btn.addEventListener('click', async () => {
                btn.disabled = true;
                status.textContent = 'Connecting…';
                try {
                    window.dynamometerSensor = await connectDynamometer();
                    startForceStream(window.dynamometerSensor, () => {});
                    jsPsych.finishTrial({ reconnected: true });
                } catch (err) {
                    status.textContent = `Could not connect: ${err.message}. Please try again.`;
                    btn.disabled = false;
                }
            });
        }
    };
}

export function createDynamometerVigourTimeline(settings) {
    // Recover max force scoped to this participant so stale calibration from
    // another participant sharing the same tab cannot bleed through.
    if (!window.dynamometerMaxForce) {
        const stored = sessionStorage.getItem(calStorageKey());
        if (stored) window.dynamometerMaxForce = parseFloat(stored);
    }

    // Block the task if no valid calibration is available.  This can happen
    // when vigour is navigated to directly without completing calibration, or
    // when sessionStorage was cleared since the last run.
    const calibrationGate = {
        timeline: [{
            type: jsPsychHtmlKeyboardResponse,
            choices: 'NO_KEYS',
            trial_duration: null,
            stimulus: `
                <div id="instruction-container">
                    <div id="instruction-text">
                        <h2>Calibration required</h2>
                        <p>No valid calibration was found. Please complete the grip calibration task before starting this task.</p>
                    </div>
                </div>
            `,
            data: { trialphase: 'dynamometer_vigour_missing_calibration' }
        }],
        conditional_function: function () {
            return !(Number.isFinite(window.dynamometerMaxForce) && window.dynamometerMaxForce > 0);
        }
    };

    // Reconnect only when device handle is absent and not in simulation mode.
    const reconnectStep = {
        timeline: [makeReconnectTrial()],
        conditional_function: function () {
            return !window.dynamometerSensor && !window.simulating;
        }
    };

    // Main task — only reached when calibration is valid.
    const mainTask = {
        timeline: [
            reconnectStep,
            createDynamometerVigourInstructions(settings),
            ...createDynVigourCoreTimeline(settings)
        ],
        conditional_function: function () {
            return Number.isFinite(window.dynamometerMaxForce) && window.dynamometerMaxForce > 0;
        }
    };

    return [
        createPreloadTrial(VIGOUR_PRELOAD_IMAGES, settings.task_name),
        calibrationGate,
        mainTask
    ];
}

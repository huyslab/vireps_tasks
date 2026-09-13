import { createDynVigourCoreTimeline, VIGOUR_PRELOAD_IMAGES } from './vigour-utils.js';
import { createDynamometerVigourInstructions } from './vigour-instructions.js';
import { connectDynamometer, startForceStream } from '@utils/dynamometer.js';
import { createPreloadTrial } from '@utils/index.js';

function calStorageKey() {
    return `dynamometerMaxForce_${window.participantID ?? 'anon'}`;
}

// Reconnect trial shown when the vigour task starts without a live device
// (e.g. the page was reloaded between calibration and vigour).
function makeReconnectTrial() {
    return {
        type: jsPsychHtmlKeyboardResponse,
        choices: 'NO_KEYS',
        stimulus: `
            <div id="instruction-container">
                <div id="instruction-text">
                    <h2>Reconnect the grip</h2>
                    <p>The grip sensor needs to be paired again. Make sure it is switched on and close by.</p>
                    <p>Then tap <strong>Connect</strong>.</p>
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

            if (window.simulating) {
                jsPsych.pluginAPI.setTimeout(() => btn.click(), 100);
            }
        }
    };
}

export function createDynamometerVigourTimeline(settings) {
    // Recover max force, scoped to participant so different participants'
    // calibrations do not bleed across sessions in the same browser tab.
    if (!window.dynamometerMaxForce) {
        const stored = sessionStorage.getItem(calStorageKey());
        if (stored) window.dynamometerMaxForce = parseFloat(stored);
    }

    // Reconnect trial is shown only when no live device handle is available.
    const reconnectStep = {
        timeline: [makeReconnectTrial()],
        conditional_function: function () {
            return !window.dynamometerSensor && !window.simulating;
        }
    };

    return [
        createPreloadTrial(VIGOUR_PRELOAD_IMAGES, settings.task_name),
        reconnectStep,
        createDynamometerVigourInstructions(settings),
        ...createDynVigourCoreTimeline(settings)
    ];
}

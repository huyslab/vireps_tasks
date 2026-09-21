import { createPITCoreTimeline, PITPreloadImages } from '@tasks/piggy-banks/PIT-utils.js';
import { PITInstructions } from '@tasks/piggy-banks/PIT-instructions.js';
import { connectDynamometer, startForceStream } from '@utils/dynamometer.js';
import { createPreloadTrial } from '@utils/index.js';

function calibrationStorageKey() {
    return `dynamometerMaxForce_${window.participantID ?? 'anon'}`;
}

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
            const button = document.getElementById('reconnect-btn');
            const status = document.getElementById('reconnect-status');

            button.addEventListener('click', async () => {
                button.disabled = true;
                status.textContent = 'Connecting…';
                try {
                    window.dynamometerSensor = await connectDynamometer();
                    startForceStream(window.dynamometerSensor, () => {});
                    jsPsych.finishTrial({ reconnected: true });
                } catch (error) {
                    status.textContent = `Could not connect: ${error.message}. Please try again.`;
                    button.disabled = false;
                }
            });
        }
    };
}

export function createDynamometerPITTimeline(settings) {
    if (!window.dynamometerMaxForce) {
        const stored = sessionStorage.getItem(calibrationStorageKey());
        if (stored) window.dynamometerMaxForce = parseFloat(stored);
    }

    const dynamometerSettings = { ...settings, inputMode: 'dynamometer' };
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
            data: { trialphase: 'dynamometer_pit_missing_calibration' }
        }],
        conditional_function: function () {
            return !(Number.isFinite(window.dynamometerMaxForce) && window.dynamometerMaxForce > 0);
        }
    };

    const reconnectStep = {
        timeline: [makeReconnectTrial()],
        conditional_function: function () {
            return !window.dynamometerSensor && !window.simulating;
        }
    };

    const mainTask = {
        timeline: [
            reconnectStep,
            PITInstructions(dynamometerSettings),
            ...createPITCoreTimeline(dynamometerSettings)
        ],
        conditional_function: function () {
            return Number.isFinite(window.dynamometerMaxForce) && window.dynamometerMaxForce > 0;
        }
    };

    return [
        createPreloadTrial(PITPreloadImages(dynamometerSettings), settings.task_name),
        calibrationGate,
        mainTask
    ];
}

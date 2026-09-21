import { createPITCoreTimeline, PITPreloadImages } from '@tasks/piggy-banks/PIT-utils.js';
import { PITInstructions } from '@tasks/piggy-banks/PIT-instructions.js';
import {
    connectDynamometer,
    createPressDetector,
    disconnectDynamometer,
    isDynamometerConnected,
    setForceCallback,
    startForceStream
} from '@utils/dynamometer.js';
import { generateDebugForceGraph, createDebugForceGraphUpdater } from './vigour-utils.js';
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

function makeDynamometerInputAdapter(settings) {
    return {
        renderFeedback: () => generateDebugForceGraph(settings),
        bind(onPress) {
            const detector = createPressDetector(window.dynamometerMaxForce, {
                thresholdFraction: settings.thresholdFraction,
                holdDurationMs: settings.holdDurationMs,
                onPress
            });
            const updateDebugGraph = createDebugForceGraphUpdater(settings);
            setForceCallback(forceN => {
                detector.update(forceN);
                updateDebugGraph(forceN);
            });
            return () => {
                detector.reset();
                setForceCallback(() => {});
            };
        },
        finish() {
            if (settings.disconnectOnFinish !== false && window.dynamometerSensor) {
                disconnectDynamometer(window.dynamometerSensor).catch(() => {});
                window.dynamometerSensor = null;
            }
        }
    };
}

export function createDynamometerPITTimeline(settings) {
    if (!window.dynamometerMaxForce) {
        const stored = sessionStorage.getItem(calibrationStorageKey());
        if (stored) window.dynamometerMaxForce = parseFloat(stored);
    }

    const dynamometerSettings = { ...settings, inputMode: 'dynamometer' };
    dynamometerSettings.inputAdapter = makeDynamometerInputAdapter(dynamometerSettings);
    const calibrationGate = {
        timeline: [{
            type: jsPsychHtmlButtonResponse,
            choices: ['Return to setup'],
            stimulus: `
                <div id="instruction-container">
                    <div id="instruction-text">
                        <h2>Calibration required</h2>
                        <p>No valid grip calibration was found. Please return to setup and restart Module 2.</p>
                    </div>
                </div>
            `,
            data: { trialphase: 'dynamometer_pit_missing_calibration' },
            on_finish: () => { window.location.assign('./index.html'); }
        }],
        conditional_function: function () {
            return !(Number.isFinite(window.dynamometerMaxForce) && window.dynamometerMaxForce > 0);
        }
    };

    const reconnectStep = {
        timeline: [makeReconnectTrial()],
        conditional_function: function () {
            return !isDynamometerConnected(window.dynamometerSensor) && !window.simulating;
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

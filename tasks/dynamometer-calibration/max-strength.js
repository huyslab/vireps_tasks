import { cancelPendingDynamometerConnection, disconnectDynamometer, setForceCallback } from '@utils/dynamometer.js';
import { updateState } from '@utils/index.js';
import { createSqueezeTracker, makeConnectStep, median } from './task.js';

const N_SQUEEZES = 10;
const WAIT_TIMEOUT_MS = 30000;
let needsRetry = false;
let signalLost = false;

function makeStrengthTrial(index) {
    let peak = 0;
    let timedOut = false;
    let complete = false;
    return {
        timeline: [{
            type: jsPsychHtmlKeyboardResponse,
            choices: 'NO_KEYS',
            stimulus: `<div id="instruction-container"><div id="instruction-text" class="calibration-stage">
                <p>Squeeze as hard as you can, then fully let go.</p>
                <p id="cal-squeeze-counter">${index} / ${N_SQUEEZES}</p>
            </div></div>`,
            data: {
                trialphase: 'dynamometer_max_strength_trial',
                trial_number: index + 1,
                peak_force_n: () => peak,
                squeeze_wait_timed_out: () => timedOut
            },
            on_start: () => {
                peak = 0;
                timedOut = false;
                complete = false;
            },
            on_load: () => {
                let signalSeen = false;
                const finish = () => {
                    if (complete) return;
                    complete = true;
                    setForceCallback(() => {});
                    document.getElementById('cal-squeeze-counter').textContent = `${index + 1} / ${N_SQUEEZES}`;
                    jsPsych.pluginAPI.setTimeout(() => jsPsych.finishTrial(), index === N_SQUEEZES - 1 ? 300 : 50);
                };
                const tracker = createSqueezeTracker({
                    onRelease: squeezePeak => {
                        peak = squeezePeak;
                        finish();
                    }
                });
                setForceCallback(forceN => {
                    if (complete) return;
                    signalSeen = true;
                    tracker.update(forceN);
                });
                if (window.simulating) {
                    jsPsych.pluginAPI.setTimeout(() => {
                        peak = 70 + index;
                        finish();
                    }, 20);
                }
                jsPsych.pluginAPI.setTimeout(() => {
                    if (complete) return;
                    timedOut = true;
                    needsRetry = true;
                    signalLost = !signalSeen;
                    complete = true;
                    setForceCallback(() => {});
                    jsPsych.finishTrial();
                }, WAIT_TIMEOUT_MS);
            },
            on_finish: () => setForceCallback(() => {})
        }],
        conditional_function: () => !needsRetry
    };
}

function makeResults(settings) {
    return {
        timeline: [{
            type: jsPsychCallFunction,
            func: () => {
                const rows = jsPsych.data.get().filter({ trialphase: 'dynamometer_max_strength_trial' })
                    .last(N_SQUEEZES).values();
                const completeAttempt = rows.length === N_SQUEEZES && rows.every(
                    (row, index) => row.trial_number === index + 1 && row.peak_force_n > 0
                );
                needsRetry = !completeAttempt;
                if (!completeAttempt) return { calibration_retry: true };
                const peaks = rows.map(row => row.peak_force_n);
                return {
                    calibration_retry: false,
                    peak_forces_n: peaks,
                    maximum_peak_force_n: Math.max(...peaks),
                    median_peak_force_n: median(peaks)
                };
            },
            data: { trialphase: 'dynamometer_max_strength_results' },
            on_finish: data => {
                Object.assign(data, data.value);
                if (!needsRetry) {
                    if (settings.disconnectOnFinish !== false && window.dynamometerSensor) {
                        disconnectDynamometer(window.dynamometerSensor).catch(() => {});
                        window.dynamometerSensor = null;
                    }
                    updateState('dynamometer_max_strength_end');
                }
            }
        }],
        conditional_function: () => !needsRetry
    };
}

function makeRetryPrompt() {
    return {
        timeline: [{
            type: jsPsychHtmlButtonResponse,
            stimulus: () => signalLost
                ? `<div id="instruction-container"><div id="instruction-text">
                    <p>The grip stopped sending a signal. Please ask the experimenter to check the grip and connect it again.</p>
                </div></div>`
                : `<div id="instruction-container"><div id="instruction-text">
                    <p>We did not detect a full squeeze and release in time. Let's start the ${N_SQUEEZES} squeezes again.</p>
                    <p>Squeeze <strong>as hard as you can</strong>, then fully let go each time.</p>
                </div></div>`,
            choices: ['Continue'],
            data: { trialphase: 'dynamometer_max_strength_retry', signal_lost: () => signalLost }
        }],
        conditional_function: () => needsRetry
    };
}

export function createDynamometerMaxStrengthTimeline(settings = {}) {
    needsRetry = false;
    signalLost = false;
    return [{
        timeline: [
            makeConnectStep(() => signalLost),
            {
                type: jsPsychHtmlButtonResponse,
                stimulus: `<div id="instruction-container"><div id="instruction-text">
                    <p>We will now measure your maximum grip strength.</p>
                    <p>Squeeze the grip <strong>as hard as you can</strong>, then fully let go. Do this <strong>${N_SQUEEZES} times</strong>.</p>
                </div></div>`,
                choices: ['Start'],
                data: { trialphase: 'dynamometer_max_strength_instructions' },
                // The connect step has already read the previous attempt's flag.
                on_start: () => { signalLost = false; }
            },
            ...Array.from({ length: N_SQUEEZES }, (_, index) => makeStrengthTrial(index)),
            makeResults(settings),
            makeRetryPrompt()
        ],
        loop_function: () => {
            const retry = needsRetry;
            needsRetry = false;
            return retry;
        }
    }];
}

export function cleanUpDynamometerMaxStrengthDemo() {
    cancelPendingDynamometerConnection();
    setForceCallback(() => {});
    if (window.dynamometerSensor) {
        disconnectDynamometer(window.dynamometerSensor).catch(() => {});
        window.dynamometerSensor = null;
    }
}

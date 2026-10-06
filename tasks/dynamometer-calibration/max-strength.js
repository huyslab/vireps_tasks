import { cancelPendingDynamometerConnection, disconnectDynamometer, setForceCallback } from '@utils/dynamometer.js';
import { updateState } from '@utils/index.js';
import { makeConnectTrial } from './task.js';

const N_SQUEEZES = 10;
const START_FORCE_N = 1.0;
const RELEASE_FORCE_N = 0.5;
const WAIT_TIMEOUT_MS = 30000;
let needsRetry = false;

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
                let phase = 'awaiting-release';
                const finish = () => {
                    if (complete) return;
                    complete = true;
                    setForceCallback(() => {});
                    document.getElementById('cal-squeeze-counter').textContent = `${index + 1} / ${N_SQUEEZES}`;
                    jsPsych.pluginAPI.setTimeout(() => jsPsych.finishTrial(), index === N_SQUEEZES - 1 ? 300 : 50);
                };
                setForceCallback(forceN => {
                    if (complete) return;
                    const force = Math.max(0, Number(forceN) || 0);
                    if (phase === 'awaiting-release' && force <= RELEASE_FORCE_N) phase = 'ready';
                    else if (phase === 'ready' && force > START_FORCE_N) {
                        phase = 'squeezing';
                        peak = force;
                    } else if (phase === 'squeezing') {
                        peak = Math.max(peak, force);
                        if (force <= RELEASE_FORCE_N) finish();
                    }
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
                    (row, index) => row.trial_number === index + 1 && row.peak_force_n > START_FORCE_N
                );
                needsRetry = !completeAttempt;
                if (!completeAttempt) return { calibration_retry: true };
                const peaks = rows.map(row => row.peak_force_n);
                const ordered = [...peaks].sort((a, b) => a - b);
                return {
                    calibration_retry: false,
                    peak_forces_n: peaks,
                    maximum_peak_force_n: ordered.at(-1),
                    median_peak_force_n: (ordered[4] + ordered[5]) / 2
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

export function createDynamometerMaxStrengthTimeline(settings = {}) {
    needsRetry = false;
    return [{
        timeline: [
            makeConnectTrial(),
            {
                type: jsPsychHtmlButtonResponse,
                stimulus: `<div id="instruction-container"><div id="instruction-text">
                    <p>We will now measure your maximum grip strength.</p>
                    <p>Squeeze the grip <strong>as hard as you can</strong>, then fully let go. Do this <strong>${N_SQUEEZES} times</strong>.</p>
                </div></div>`,
                choices: ['Start'],
                data: { trialphase: 'dynamometer_max_strength_instructions' }
            },
            ...Array.from({ length: N_SQUEEZES }, (_, index) => makeStrengthTrial(index)),
            makeResults(settings),
            {
                timeline: [{
                    type: jsPsychHtmlButtonResponse,
                    stimulus: `<div id="instruction-container"><div id="instruction-text">
                        <p>The grip signal was interrupted. Please ask the experimenter to check the grip, then try again.</p>
                    </div></div>`,
                    choices: ['Continue'],
                    data: { trialphase: 'dynamometer_max_strength_retry' }
                }],
                conditional_function: () => needsRetry
            }
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

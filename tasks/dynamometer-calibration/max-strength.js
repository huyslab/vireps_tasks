import { cleanUpGripTask, createSqueezeTracker, releaseGrip, setForceCallback } from '@utils/dynamometer.js';
import { makeConnectStep } from '@utils/grip-session.js';
import { updateState } from '@utils/index.js';
import { median } from './task.js';

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
                <p>Squeeze as hard as you can. Then let go fully.</p>
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
                // Maximal squeezes must be fully let go, so a dip mid-squeeze is not a release.
                const tracker = createSqueezeTracker({
                    fullRelease: true,
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
                    releaseGrip(settings);
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
                    <p>The grip stopped sending a signal. Please ask the study team to check the grip and connect it again.</p>
                </div></div>`
                : `<div id="instruction-container"><div id="instruction-text">
                    <p><strong>Let's try once more.</strong></p>
                    <p>We will start the ${N_SQUEEZES} squeezes again.</p>
                    <p>Each time, squeeze <strong>as hard as you can</strong>. Then let go fully.</p>
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
                    <p>Now let's see how strong your grip is.</p>
                    <p><strong>This time, squeeze as hard as you can.</strong></p>
                </div></div>`,
                choices: ['Next'],
                data: { trialphase: 'dynamometer_max_strength_instructions' },
                // The connect step has already read the previous attempt's flag.
                on_start: () => { signalLost = false; }
            },
            {
                type: jsPsychHtmlButtonResponse,
                stimulus: `<div id="instruction-container"><div id="instruction-text">
                    <p>Squeeze, then let go fully.</p>
                    <p>Do this <strong>${N_SQUEEZES} times</strong>.</p>
                </div></div>`,
                choices: ['Start'],
                data: { trialphase: 'dynamometer_max_strength_instructions' }
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

export const cleanUpDynamometerMaxStrengthDemo = cleanUpGripTask;

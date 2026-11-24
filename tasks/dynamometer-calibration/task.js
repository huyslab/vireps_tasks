import { cleanUpGripTask, createSqueezeTracker, releaseGrip, setForceCallback } from '@utils/dynamometer.js';
import {
    clearGripCalibration,
    getGripCalibration,
    makeConnectStep,
    saveGripCalibration
} from '@utils/grip-session.js';
import { updateState } from '@utils/index.js';

const MIN_SQUEEZES = 3;
const DEFAULT_DURATION_MS = 7000;
const DEFAULT_WAIT_TIMEOUT_MS = 30000;
const DEFAULT_SPEED_BAR_MAX_HZ = 5;
const CALIBRATION_TIMELINE = 'dynamometer-calibration';

let needsRetry = false;
let signalLost = false;

function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}


// A skipped demo still needs a calibration so the grip games that follow run.
export function cleanUpDynamometerCalibrationDemo(settings = {}) {
    cleanUpGripTask(settings);
    if (getGripCalibration() === null) saveGripCalibration(80);
}

function makeSkipControl(onSkipGrip) {
    if (typeof onSkipGrip !== 'function') return null;

    // Skipping drops every grip task for the rest of the session and sits beside the
    // participant's own Next/Continue buttons, so it takes a second, deliberate tap.
    // The wrappers carry `hidden` because .jspsych-btn sets its own display.
    // An open question stays open when a screen moves on by itself (a timed-out or
    // finished squeeze), so staff need not start the skip again on the next screen.
    let confirming = false;
    return {
        button: `
            <p id="skip-grip-tasks"><button id="skip-grip-tasks-btn" type="button" class="jspsych-btn jspsych-btn-quiet">Skip grip tasks</button></p>
            <div id="skip-grip-tasks-confirm" hidden>
                <p role="alert">Skip all grip tasks for the rest of this session? This cannot be undone.</p>
                <p>
                    <button id="skip-grip-tasks-cancel-btn" type="button" class="jspsych-btn jspsych-btn-quiet">Keep grip tasks</button>
                    <button id="skip-grip-tasks-confirm-btn" type="button" class="jspsych-btn jspsych-btn-danger">Yes, skip grip tasks</button>
                </p>
            </div>`,
        onLoad: beforeSkip => {
            const ask = document.getElementById('skip-grip-tasks');
            const confirm = document.getElementById('skip-grip-tasks-confirm');
            const toggle = asking => {
                confirming = asking;
                ask.hidden = asking;
                confirm.hidden = !asking;
            };
            toggle(confirming);
            document.getElementById('skip-grip-tasks-btn').addEventListener('click', () => toggle(true));
            document.getElementById('skip-grip-tasks-cancel-btn').addEventListener('click', () => toggle(false));
            document.getElementById('skip-grip-tasks-confirm-btn').addEventListener('click', () => {
                beforeSkip?.();
                jsPsych.finishTrial({ grip_tasks_skipped: true });
            }, { once: true });
        },
        onFinish: data => {
            if (!data.grip_tasks_skipped) return;
            onSkipGrip();
            clearGripCalibration();
            cleanUpGripTask();
            jsPsych.abortTimelineByName(CALIBRATION_TIMELINE);
            updateState('dynamometer_calibration_skipped');
        }
    };
}

function makeInstructions(settings, skipControl) {
    const seconds = positiveNumber(settings.speedCalibrationDurationMs, DEFAULT_DURATION_MS) / 1000;
    const data = { trialphase: 'dynamometer_speed_calibration_instructions' };
    const skipHooks = { on_load: skipControl?.onLoad, on_finish: skipControl?.onFinish };
    return {
        timeline: [{
            type: jsPsychHtmlButtonResponse,
            stimulus: `
                <div id="instruction-container"><div id="instruction-text">
                    <p>First, a quick warm-up.</p>
                    <p>How fast can you squeeze the grip?</p>
                    ${skipControl?.button ?? ''}
                </div></div>`,
            choices: ['Next'],
            data,
            ...skipHooks
        }, {
            type: jsPsychHtmlButtonResponse,
            stimulus: `
                <div id="instruction-container"><div id="instruction-text">
                    <p>Squeeze and let go, again and again, as fast as you can.</p>
                    <p>Short, quick squeezes. You do not need to squeeze hard.</p>
                    <p>Keep going for <strong>${seconds} seconds</strong>.</p>
                    ${skipControl?.button ?? ''}
                </div></div>`,
            choices: ['Start'],
            data,
            ...skipHooks
        }]
    };
}

function makeRateTrial(settings, skipControl) {
    const durationMs = positiveNumber(settings.speedCalibrationDurationMs, DEFAULT_DURATION_MS);
    const waitTimeoutMs = positiveNumber(settings.squeezeWaitTimeoutMs, DEFAULT_WAIT_TIMEOUT_MS);
    const speedBarMaxHz = positiveNumber(settings.speedBarMaxHz, DEFAULT_SPEED_BAR_MAX_HZ);
    let cleanUp = () => {};

    return {
        type: jsPsychHtmlKeyboardResponse,
        choices: 'NO_KEYS',
        stimulus: `
            <div id="instruction-container"><div id="instruction-text" class="grip-speed-live">
                <h3 id="grip-speed-countdown">Squeeze once to start.<br>Then squeeze and let go, as fast as you can!</h3>
                <div id="grip-speed-counter" role="status" aria-live="polite">Squeezes: 0</div>
                <div id="grip-speed-rate">Speed: 0.00 squeezes/sec</div>
                <div id="grip-speed-indicator" aria-hidden="true"><div class="grip-speed-indicator-core"></div></div>
                <div id="grip-speed-track" role="progressbar" aria-label="Squeeze speed"
                     aria-valuemin="0" aria-valuemax="${speedBarMaxHz}" aria-valuenow="0">
                    <div id="grip-speed-bar"></div>
                </div>
                ${skipControl?.button ?? ''}
            </div></div>`,
        data: {
            trialphase: 'dynamometer_speed_calibration',
            speed_calibration_duration_ms: durationMs
        },
        on_load: () => {
            const countdown = document.getElementById('grip-speed-countdown');
            const counter = document.getElementById('grip-speed-counter');
            const rate = document.getElementById('grip-speed-rate');
            const track = document.getElementById('grip-speed-track');
            const bar = document.getElementById('grip-speed-bar');
            const indicator = document.getElementById('grip-speed-indicator');
            const effectiveDurationMs = window.simulating ? 200 : durationMs;
            const peaks = [];
            const responseTimes = [];
            let startedAt = null;
            let lastSqueezeAt = null;
            let signalSeen = false;
            let finished = false;
            let finishTimer = null;
            let waitTimer = null;
            let displayTimer = null;

            skipControl?.onLoad(() => { finished = true; });
            cleanUp = () => {
                setForceCallback(() => {});
                clearTimeout(finishTimer);
                clearTimeout(waitTimer);
                clearInterval(displayTimer);
            };

            const updateDisplay = () => {
                if (startedAt === null) return;
                const elapsed = Math.min((performance.now() - startedAt) / 1000, effectiveDurationMs / 1000);
                const speedHz = responseTimes.length / Math.max(elapsed, 0.1);
                rate.textContent = `Speed: ${speedHz.toFixed(2)} squeezes/sec`;
                bar.style.width = `${Math.min(speedHz / speedBarMaxHz * 100, 100)}%`;
                track.setAttribute('aria-valuenow', String(Math.min(speedHz, speedBarMaxHz).toFixed(1)));
                countdown.textContent = `${Math.max(0, (effectiveDurationMs / 1000) - elapsed).toFixed(1)} s left`;
            };

            const finish = (timedOut = false) => {
                if (finished) return;
                finished = true;
                cleanUp();
                const medianPeakN = peaks.length >= MIN_SQUEEZES ? median(peaks) : null;
                const speedHz = responseTimes.length / (effectiveDurationMs / 1000);
                needsRetry = timedOut || medianPeakN === null;
                signalLost = needsRetry && !signalSeen;
                if (!needsRetry) saveGripCalibration(medianPeakN);
                jsPsych.finishTrial({
                    peak_forces_n: peaks,
                    median_squeeze_force_n: medianPeakN,
                    trial_squeezes: responseTimes.length,
                    response_time: responseTimes,
                    avg_speed_hz: speedHz,
                    squeeze_wait_timed_out: timedOut,
                    signal_lost: signalLost,
                    calibration_retry: needsRetry
                });
            };

            const tracker = createSqueezeTracker({
                onRelease: peak => peaks.push(peak),
                onStart: () => {
                    const now = performance.now();
                    if (startedAt === null) {
                        startedAt = now;
                        lastSqueezeAt = now;
                        clearTimeout(waitTimer);
                        updateState('dynamometer_speed_calibration_start');
                        finishTimer = setTimeout(() => finish(), effectiveDurationMs);
                        displayTimer = setInterval(updateDisplay, 100);
                    } else {
                        responseTimes.push(Math.round(now - lastSqueezeAt));
                        lastSqueezeAt = now;
                        counter.textContent = `Squeezes: ${responseTimes.length}`;
                        indicator.classList.toggle('grip-speed-indicator-compressed');
                        updateDisplay();
                    }
                }
            });

            const onForce = forceN => {
                if (finished) return;
                signalSeen = true;
                tracker.update(forceN);
            };

            setForceCallback(onForce);
            waitTimer = setTimeout(() => finish(true), waitTimeoutMs);
            if (window.simulating) {
                jsPsych.pluginAPI.setTimeout(() => onForce(0), 5);
                for (let index = 0; index < 6; index += 1) {
                    jsPsych.pluginAPI.setTimeout(() => onForce(20 + index), 10 + index * 25);
                    jsPsych.pluginAPI.setTimeout(() => onForce(0), 20 + index * 25);
                }
            }
        },
        on_finish: data => {
            cleanUp();
            skipControl?.onFinish(data);
        }
    };
}

function makeRetryPrompt(skipControl) {
    return {
        timeline: [{
            type: jsPsychHtmlButtonResponse,
            stimulus: () => signalLost
                ? `<div id="instruction-container"><div id="instruction-text">
                    <h2>Grip not detected</h2>
                    <p>The grip stopped sending a signal. Please ask the study team to check the grip and connect it again.</p>
                    ${skipControl?.button ?? ''}
                </div></div>`
                : `<div id="instruction-container"><div id="instruction-text">
                    <h2>Let's try once more.</h2>
                    <p>Squeeze and let go, again and again.</p>
                    <p>Go as fast as you can.</p>
                    ${skipControl?.button ?? ''}
                </div></div>`,
            choices: ['Continue'],
            data: { trialphase: 'dynamometer_calibration_retry' },
            on_load: skipControl?.onLoad,
            on_finish: skipControl?.onFinish
        }],
        conditional_function: () => needsRetry
    };
}

function makeFeedback(settings, skipControl) {
    return {
        timeline: [{
            type: jsPsychHtmlButtonResponse,
            stimulus: () => {
                const row = jsPsych.data.get().filter({ trialphase: 'dynamometer_speed_calibration' }).last(1).values()[0];
                return `<div id="instruction-container"><div id="instruction-text">
                    <h2><span class="highlight-txt">Well done!</span></h2>
                    <p>You squeezed <strong>${Number(row.avg_speed_hz).toFixed(2)} times a second</strong>.</p>
                    <p>Tap <strong>Continue</strong> to go on.</p>
                    ${skipControl?.button ?? ''}
                </div></div>`;
            },
            choices: ['Continue'],
            post_trial_gap: 800,
            data: { trialphase: 'dynamometer_speed_calibration_feedback' },
            on_load: skipControl?.onLoad,
            on_finish: data => {
                if (data.grip_tasks_skipped) {
                    skipControl.onFinish(data);
                    return;
                }
                releaseGrip(settings);
                updateState('dynamometer_speed_calibration_end');
                updateState('dynamometer_calibration_end');
            }
        }],
        conditional_function: () => !needsRetry
    };
}

export function createDynamometerCalibrationTimeline(settings = {}) {
    clearGripCalibration();
    needsRetry = false;
    signalLost = false;

    const skipControl = makeSkipControl(settings.onSkipGrip);
    return [{
        name: CALIBRATION_TIMELINE,
        timeline: [
            makeConnectStep(() => signalLost, skipControl),
            makeInstructions(settings, skipControl),
            makeRateTrial(settings, skipControl),
            makeRetryPrompt(skipControl),
            makeFeedback(settings, skipControl)
        ],
        loop_function: () => needsRetry
    }];
}

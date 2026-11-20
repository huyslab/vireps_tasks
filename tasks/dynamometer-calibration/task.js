import {
    cancelPendingDynamometerConnection,
    connectDynamometer,
    disconnectDynamometer,
    setForceCallback,
    startForceStream
} from '@utils/dynamometer.js';
import { updateState } from '@utils/index.js';

const START_FORCE_N = 1.0;
const RELEASE_FORCE_N = 0.5;
const MIN_SQUEEZES = 3;
const DEFAULT_DURATION_MS = 7000;
const DEFAULT_WAIT_TIMEOUT_MS = 30000;
const DEFAULT_THRESHOLD_FRACTION = 0.5;
const DEFAULT_SPEED_BAR_MAX_HZ = 5;

let needsRetry = false;
let signalLost = false;

function storageKey(kind) {
    return `dynamometer${kind}_${window.participantID ?? 'anon'}`;
}

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

/**
 * Detects discrete squeezes relative to the lowest force seen so far, so a grip
 * that rests slightly above zero (sensor drift, a hand resting on it) still
 * registers squeezes and releases. A squeeze starts START_FORCE_N above that
 * baseline and ends once force falls back to within RELEASE_FORCE_N of it.
 * A squeeze already under way when tracking starts only raises the baseline,
 * so it is never counted.
 */
export function createSqueezeTracker({ onStart = () => {}, onRelease = () => {} } = {}) {
    let baseline = Infinity;
    let squeezing = false;
    let peak = 0;
    return {
        update(forceN) {
            const force = Math.max(0, Number(forceN) || 0);
            if (!squeezing) {
                baseline = Math.min(baseline, force);
                if (force > baseline + START_FORCE_N) {
                    squeezing = true;
                    peak = force;
                    onStart(force);
                }
                return;
            }
            peak = Math.max(peak, force);
            if (force <= baseline + RELEASE_FORCE_N) {
                squeezing = false;
                onRelease(peak);
            }
        },
        get peak() { return peak; }
    };
}

/**
 * Connect step for a calibration-style procedure that loops on retry. It is
 * shown on the first pass and again only when `shouldReconnect()` says the
 * signal was lost, or no grip is connected; otherwise a retry reuses the live
 * connection instead of asking the experimenter to pair the grip again.
 */
export function makeConnectStep(shouldReconnect) {
    let firstPass = true;
    return {
        timeline: [makeConnectTrial()],
        conditional_function: () => {
            const show = firstPass || shouldReconnect() || !window.dynamometerSensor;
            firstPass = false;
            return show;
        }
    };
}

export function cleanUpDynamometerCalibrationDemo(settings = {}) {
    cancelPendingDynamometerConnection();
    setForceCallback(() => {});
    if (!(Number.isFinite(window.dynamometerMaxForce) && window.dynamometerMaxForce > 0)) {
        window.dynamometerMaxForce = 80;
        sessionStorage.setItem(storageKey('MaxForce'), '80');
    }
    if (!(Number.isFinite(window.dynamometerMaxSpeed) && window.dynamometerMaxSpeed > 0)) {
        window.dynamometerMaxSpeed = 5;
        sessionStorage.setItem(storageKey('MaxSpeed'), '5');
    }
    if (settings.disconnectOnFinish !== false && window.dynamometerSensor) {
        const sensor = window.dynamometerSensor;
        window.dynamometerSensor = null;
        disconnectDynamometer(sensor).catch(() => {});
    }
}

export function makeConnectTrial() {
    return {
        type: jsPsychHtmlKeyboardResponse,
        choices: 'NO_KEYS',
        stimulus: () => `
            <div id="instruction-container"><div id="instruction-text">
                <h2>For the experimenter</h2>
                <p>Switch on the grip and select <strong>Connect grip</strong>.</p>
                <p id="connect-status" class="cal-connection-status" role="status" aria-live="polite"></p>
                <button id="connect-btn" class="jspsych-btn">Connect grip</button>
            </div></div>`,
        data: { trialphase: 'dynamometer_connect' },
        on_load: () => {
            const button = document.getElementById('connect-btn');
            const status = document.getElementById('connect-status');
            button.addEventListener('click', async () => {
                button.disabled = true;
                status.textContent = 'Connecting…';
                try {
                    if (window.dynamometerSensor) {
                        try { await disconnectDynamometer(window.dynamometerSensor); } catch (_) {}
                        window.dynamometerSensor = null;
                    }
                    window.dynamometerSensor = await connectDynamometer();
                    startForceStream(window.dynamometerSensor, () => {});
                    jsPsych.finishTrial({ connected: true });
                } catch (error) {
                    status.textContent = `Could not connect: ${error.message}. Please try again.`;
                    button.disabled = false;
                }
            });
            if (window.simulating) jsPsych.pluginAPI.setTimeout(() => button.click(), 100);
        }
    };
}

function makeInstructions(settings) {
    const seconds = positiveNumber(settings.speedCalibrationDurationMs, DEFAULT_DURATION_MS) / 1000;
    return {
        type: jsPsychHtmlButtonResponse,
        stimulus: `
            <div id="instruction-container"><div id="instruction-text">
                <p>We will check how fast you can squeeze and fully release the grip.</p>
                <p>Make <strong>quick squeezes</strong> rather than hard or sustained squeezes. Squeeze once to start, then squeeze and let go as quickly as you can for <strong>${seconds} seconds</strong>.</p>
            </div></div>`,
        choices: ['Start'],
        data: { trialphase: 'dynamometer_speed_calibration_instructions' }
    };
}

function makeRateTrial(settings) {
    const durationMs = positiveNumber(settings.speedCalibrationDurationMs, DEFAULT_DURATION_MS);
    const waitTimeoutMs = positiveNumber(settings.squeezeWaitTimeoutMs, DEFAULT_WAIT_TIMEOUT_MS);
    const thresholdFraction = positiveNumber(settings.thresholdFraction, DEFAULT_THRESHOLD_FRACTION);
    const speedBarMaxHz = positiveNumber(settings.speedBarMaxHz, DEFAULT_SPEED_BAR_MAX_HZ);
    let cleanUp = () => {};

    return {
        type: jsPsychHtmlKeyboardResponse,
        choices: 'NO_KEYS',
        stimulus: `
            <div id="instruction-container"><div id="instruction-text" class="grip-speed-live">
                <h3 id="grip-speed-countdown">Squeeze once to start.<br>Then squeeze and fully release as fast as you can!</h3>
                <div id="grip-speed-counter" role="status" aria-live="polite">Squeezes: 0</div>
                <div id="grip-speed-rate">Speed: 0.00 squeezes/sec</div>
                <div id="grip-speed-indicator" aria-hidden="true"><div class="grip-speed-indicator-core"></div></div>
                <div id="grip-speed-track" role="progressbar" aria-label="Squeeze speed"
                     aria-valuemin="0" aria-valuemax="${speedBarMaxHz}" aria-valuenow="0">
                    <div id="grip-speed-bar"></div>
                </div>
            </div></div>`,
        data: {
            trialphase: 'dynamometer_speed_calibration',
            speed_calibration_duration_ms: durationMs,
            threshold_fraction: thresholdFraction
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
                if (!needsRetry) {
                    window.dynamometerMaxForce = medianPeakN;
                    window.dynamometerMaxSpeed = speedHz;
                    sessionStorage.setItem(storageKey('MaxForce'), String(medianPeakN));
                    sessionStorage.setItem(storageKey('MaxSpeed'), String(window.dynamometerMaxSpeed));
                }
                jsPsych.finishTrial({
                    peak_forces_n: peaks,
                    median_squeeze_force_n: medianPeakN,
                    // Grip tasks scale their threshold from this value; it is the
                    // median quick-squeeze peak, not maximal strength.
                    calibration_force_n: medianPeakN,
                    threshold_force_n: medianPeakN === null ? null : medianPeakN * thresholdFraction,
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
        on_finish: () => cleanUp()
    };
}

function makeRetryPrompt() {
    return {
        timeline: [{
            type: jsPsychHtmlButtonResponse,
            stimulus: () => signalLost
                ? `<div id="instruction-container"><div id="instruction-text">
                    <h2>Grip not detected</h2>
                    <p>The grip stopped sending a signal. Please ask the experimenter to check the grip and connect it again.</p>
                </div></div>`
                : `<div id="instruction-container"><div id="instruction-text">
                    <h2>Let's try that again</h2>
                    <p>We need at least three quick squeezes to set up the game. Squeeze and fully let go as quickly as you can.</p>
                </div></div>`,
            choices: ['Continue'],
            data: { trialphase: 'dynamometer_calibration_retry' }
        }],
        conditional_function: () => needsRetry
    };
}

function makeFeedback(settings) {
    return {
        timeline: [{
            type: jsPsychHtmlButtonResponse,
            stimulus: () => {
                const row = jsPsych.data.get().filter({ trialphase: 'dynamometer_speed_calibration' }).last(1).values()[0];
                return `<div id="instruction-container"><div id="instruction-text">
                    <h2><span class="highlight-txt">Well done!</span></h2>
                    <p>Your speed was <strong>${Number(row.avg_speed_hz).toFixed(2)} squeezes per second</strong>.</p>
                    <p>Tap <strong>Continue</strong> to go on to the piggy-bank game.</p>
                </div></div>`;
            },
            choices: ['Continue'],
            post_trial_gap: 800,
            data: { trialphase: 'dynamometer_speed_calibration_feedback' },
            on_finish: () => {
                if (settings.disconnectOnFinish !== false && window.dynamometerSensor) {
                    disconnectDynamometer(window.dynamometerSensor).catch(() => {});
                    window.dynamometerSensor = null;
                }
                updateState('dynamometer_speed_calibration_end');
                updateState('dynamometer_calibration_end');
            }
        }],
        conditional_function: () => !needsRetry
    };
}

export function createDynamometerCalibrationTimeline(settings = {}) {
    sessionStorage.removeItem(storageKey('MaxForce'));
    sessionStorage.removeItem(storageKey('MaxSpeed'));
    window.dynamometerMaxForce = undefined;
    window.dynamometerMaxSpeed = undefined;
    window.dynamometerSensor = null;
    needsRetry = false;
    signalLost = false;

    return [{
        timeline: [
            makeConnectStep(() => signalLost),
            makeInstructions(settings),
            makeRateTrial(settings),
            makeRetryPrompt(),
            makeFeedback(settings)
        ],
        loop_function: () => needsRetry
    }];
}

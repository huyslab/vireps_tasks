import {
    connectDynamometer,
    createPressDetector,
    startForceStream,
    setForceCallback,
    disconnectDynamometer
} from '@utils/dynamometer.js';
import { updateState } from '@utils/index.js';

const N_SQUEEZES = 10;
const SQUEEZE_START_THRESHOLD_N = 1.0;
const SQUEEZE_RELEASE_THRESHOLD_N = 0.5;
const DEFAULT_SQUEEZE_WAIT_TIMEOUT_MS = 30000;
const FINAL_COUNT_DISPLAY_MS = 300;
const DEFAULT_SPEED_CALIBRATION_DURATION_MS = 7000;
const DEFAULT_THRESHOLD_FRACTION = 0.1;
const DEFAULT_SPEED_BAR_MAX_HZ = 5;

let _trialPeak = 0;
let _streamTimedOut = false;
let _showInstructions = true;
// Set by the invisible result-computation trial so the loop can decide whether
// the experimenter needs to reconnect the grip and repeat calibration.
let _needsRetry = false;

function computeMaxForce(peaks) {
    const sorted = [...peaks].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    const distances = peaks.map((p, i) => ({ i, dist: Math.abs(p - median) }));
    distances.sort((a, b) => b.dist - a.dist);
    const { i: outlierIdx } = distances[0];
    const kept = peaks.filter((_, i) => i !== outlierIdx);
    const maxForce = kept.reduce((s, v) => s + v, 0) / kept.length;
    return { maxForce, outlierIdx, outlierPeak: peaks[outlierIdx] };
}

function calStorageKey() {
    return `dynamometerMaxForce_${window.participantID ?? 'anon'}`;
}

function speedStorageKey() {
    return `dynamometerMaxSpeed_${window.participantID ?? 'anon'}`;
}

function getRecordedPeaks() {
    const rows = jsPsych.data.get()
        .filter({ trialphase: 'dynamometer_calibration' })
        .last(N_SQUEEZES)
        .values();

    // Do not combine a partial retry with rows from the previous attempt.
    const isCompleteAttempt = rows.length === N_SQUEEZES && rows.every(
        (row, index) => Number(row.trial_number) === index + 1
    );
    if (!isCompleteAttempt) return [];

    return rows.map(row => {
        const peak = Number(row.peak_force_n);
        return Number.isFinite(peak) ? peak : 0;
    });
}

// ── Connect / reconnect trial ─────────────────────────────────────────────────
// Placed INSIDE the calibration loop so it runs on the first pass and on every
// retry. Closing any existing connection first ensures a clean reconnect after
// a BLE drop that caused zero peaks.

const connectTrial = {
    type: jsPsychHtmlKeyboardResponse,
    choices: 'NO_KEYS',
    stimulus: function () {
        const reconnect = !!window.dynamometerSensor;
        return `
            <div id="instruction-container">
                <div id="instruction-text">
                    <h2>For the experimenter</h2>
                    ${reconnect
                        ? '<p>Switch on the grip and select <strong>Reconnect grip</strong>.</p>'
                        : '<p>Switch on the grip and select <strong>Connect grip</strong>.</p>'}
                    <p id="connect-status" class="cal-connection-status" role="status" aria-live="polite"></p>
                    <button id="connect-btn" class="jspsych-btn">${reconnect ? 'Reconnect grip' : 'Connect grip'}</button>
                </div>
            </div>
        `;
    },
    data: { trialphase: 'dynamometer_connect' },
    on_load: function () {
        const btn    = document.getElementById('connect-btn');
        const status = document.getElementById('connect-status');

        btn.addEventListener('click', async () => {
            btn.disabled = true;
            status.textContent = 'Connecting…';
            try {
                // Fully disconnect any existing handle — this resets _listenerAttached in
                // dynamometer.js so the new device gets a fresh listener registration.
                if (window.dynamometerSensor) {
                    try { await disconnectDynamometer(window.dynamometerSensor); } catch (_) {}
                    window.dynamometerSensor = null;
                }
                window.dynamometerSensor = await connectDynamometer();
                // Start the stream (or attach listener if already streaming).
                startForceStream(window.dynamometerSensor, () => {});
                _streamTimedOut = false;
                jsPsych.finishTrial({ connected: true });
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

// ── Calibration instructions ──────────────────────────────────────────────────

const calibrationInstructions = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
        <div id="instruction-container">
            <div id="instruction-text">
                <p>First, we need to measure how hard you can squeeze the device.</p>
                <p>Squeeze as hard as you can and let go <strong>${N_SQUEEZES} times</strong>.</p>
            </div>
        </div>
    `,
    choices: ['Start'],
    data: { trialphase: 'dynamometer_calibration_instructions' },
    conditional_function: () => _showInstructions,
    on_finish: () => { _showInstructions = false; }
};

// ── One calibration trial ─────────────────────────────────────────────────────

function validDuration(value, fallback) {
    const duration = Number(value);
    return Number.isFinite(duration) && duration >= 0 ? duration : fallback;
}

function makeCalibrationTrial(trialIndex, settings) {
    const squeezeWaitTimeoutMs = validDuration(
        settings?.squeezeWaitTimeoutMs,
        DEFAULT_SQUEEZE_WAIT_TIMEOUT_MS
    );
    let phase = 'awaiting-release';
    let selfInitiationRt = null;
    let measuredSqueezeDurationMs = null;

    return {
        type: jsPsychHtmlKeyboardResponse,
        choices: 'NO_KEYS',
        stimulus: `
            <div id="instruction-container">
                <div id="instruction-text" class="calibration-stage">
                    <p id="cal-phase-prompt">Squeeze and release</p>
                    <p id="cal-squeeze-counter" data-completed="${trialIndex}"
                       role="status" aria-live="polite" aria-atomic="true">
                        ${trialIndex} / ${N_SQUEEZES}
                    </p>
                </div>
            </div>
        `,
        data: {
            trialphase: 'dynamometer_calibration',
            trial_number: trialIndex + 1,
            peak_force_n: () => _trialPeak,
            self_initiation_rt_ms: () => selfInitiationRt,
            squeeze_duration_ms: () => measuredSqueezeDurationMs,
            squeeze_wait_timeout_ms: squeezeWaitTimeoutMs,
            squeeze_wait_timed_out: false
        },
        on_start: function () {
            _trialPeak = 0;
            phase = 'awaiting-release';
            selfInitiationRt = null;
            measuredSqueezeDurationMs = null;
        },
        on_load: function () {
            const counter = document.getElementById('cal-squeeze-counter');
            let readyAt = null;
            let squeezeStartedAt = null;

            const armSqueeze = () => {
                if (phase !== 'awaiting-release') return;
                phase = 'waiting';
                readyAt = performance.now();
            };

            const beginSqueeze = (forceN) => {
                if (phase !== 'waiting') return;
                phase = 'squeezing';
                squeezeStartedAt = performance.now();
                selfInitiationRt = Math.round(squeezeStartedAt - readyAt);
                _trialPeak = Math.max(_trialPeak, forceN);
            };

            const completeSqueeze = () => {
                if (phase !== 'squeezing') return;
                phase = 'complete';
                measuredSqueezeDurationMs = Math.round(performance.now() - squeezeStartedAt);
                const completedSqueezes = trialIndex + 1;
                if (counter) {
                    counter.textContent = `${completedSqueezes} / ${N_SQUEEZES}`;
                    // Intermediate trials immediately render the next screen with
                    // its stable completed count. Mark the final state here because
                    // there is no following calibration screen.
                    if (completedSqueezes === N_SQUEEZES) {
                        counter.dataset.completed = String(completedSqueezes);
                    }
                }
                setForceCallback(() => {});
                if (completedSqueezes === N_SQUEEZES) {
                    jsPsych.pluginAPI.setTimeout(() => jsPsych.finishTrial(), FINAL_COUNT_DISPLAY_MS);
                } else {
                    jsPsych.finishTrial();
                }
            };

            setForceCallback((forceN) => {
                if (phase === 'awaiting-release') {
                    if (forceN <= SQUEEZE_RELEASE_THRESHOLD_N) {
                        armSqueeze();
                    }
                } else if (phase === 'waiting' && forceN > SQUEEZE_START_THRESHOLD_N) {
                    beginSqueeze(forceN);
                } else if (phase === 'squeezing') {
                    _trialPeak = Math.max(_trialPeak, forceN);
                    if (forceN <= SQUEEZE_RELEASE_THRESHOLD_N) completeSqueeze();
                }
            });

            if (window.simulating) {
                jsPsych.pluginAPI.setTimeout(armSqueeze, 5);
                jsPsych.pluginAPI.setTimeout(() => beginSqueeze(70 + Math.random() * 20), 10);
                jsPsych.pluginAPI.setTimeout(completeSqueeze, 20);
            }

            jsPsych.pluginAPI.setTimeout(() => {
                if (phase === 'complete' || phase === 'timed-out') return;
                phase = 'timed-out';
                _streamTimedOut = true;
                setForceCallback(() => {});
                jsPsych.finishTrial({ squeeze_wait_timed_out: true });
            }, squeezeWaitTimeoutMs);
        },
        on_finish: function (data) {
            if (window.simulating && _trialPeak <= SQUEEZE_START_THRESHOLD_N) {
                _trialPeak = 70 + Math.random() * 20;
                data.peak_force_n = _trialPeak;
            }
            setForceCallback(() => {});
        },
        // A timed-out stream means the remaining trials cannot collect useful
        // data. Skip them so the existing reconnect loop is reached at once.
        conditional_function: () => !_streamTimedOut
    };
}

// ── Compute calibration result without a participant-facing feedback screen ───

function createCalibrationResults() {
    return {
        type: jsPsychCallFunction,
        func: function () {
            const peaks = getRecordedPeaks();
            const validPeaks = peaks.filter(p => p > 1.0);

            // Preserve the existing calibration rule: tolerate one bad reading,
            // but require all remaining squeezes to be valid.
            _needsRetry = validPeaks.length < N_SQUEEZES - 1;

            if (_needsRetry) {
                return {
                    max_force_n: null,
                    had_bad_peaks: true,
                    calibration_retry: true
                };
            }

            // When all 10 peaks are valid, use outlier removal (drop the one farthest
            // from the median and average the remaining 9).
            // When exactly 9 are valid, average them directly — passing the full set
            // to computeMaxForce could discard the wrong trial if a high outlier is
            // present (e.g. [0, 40, 41, 42, 43, 44, 45, 46, 47, 200]: outlier
            // removal drops 200 and averages the zero, producing a biased threshold).
            const maxForce = validPeaks.length === peaks.length
                ? computeMaxForce(peaks).maxForce
                : validPeaks.reduce((s, v) => s + v, 0) / validPeaks.length;
            window.dynamometerMaxForce = maxForce;
            sessionStorage.setItem(calStorageKey(), String(maxForce));

            return {
                max_force_n: maxForce,
                had_bad_peaks: peaks.some(p => p <= 1.0),
                calibration_retry: false
            };
        },
        data: { trialphase: 'dynamometer_calibration_results' },
        on_finish: function (data) {
            Object.assign(data, data.value);
        }
    };
}

const calibrationRetryPrompt = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
        <div id="instruction-container">
            <div id="instruction-text">
                <h2>Grip not detected</h2>
                <p>The grip may have lost its connection.</p>
                <p>Tap <strong>Continue</strong> to reconnect and try again.</p>
            </div>
        </div>
    `,
    choices: ['Continue'],
    data: { trialphase: 'dynamometer_calibration_retry' }
};

// jsPsych applies conditional_function to timeline nodes, not individual trial
// nodes. Wrapping the prompt prevents it from appearing after a valid result.
const calibrationRetry = {
    timeline: [calibrationRetryPrompt],
    conditional_function: () => _needsRetry
};

// ── Speed calibration at the task's force threshold ──────────────────────────

function validPositiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

function makeSpeedCalibrationInstructions(settings) {
    const durationSeconds = validPositiveNumber(
        settings.speedCalibrationDurationMs,
        DEFAULT_SPEED_CALIBRATION_DURATION_MS
    ) / 1000;
    const durationLabel = Number.isInteger(durationSeconds)
        ? String(durationSeconds)
        : durationSeconds.toFixed(1);

    return {
        type: jsPsychHtmlButtonResponse,
        stimulus: `
            <div id="instruction-container">
                <div id="instruction-text">
                    <p>Now we need to measure how quickly you can squeeze and release.</p>
                    <p>You do not need to squeeze as hard as before. On the next screen, squeeze once when you are ready. Then squeeze and fully let go as fast as you can for <strong>${durationLabel} seconds</strong>.</p>
                </div>
            </div>
        `,
        choices: ['Start'],
        data: { trialphase: 'dynamometer_speed_calibration_instructions' }
    };
}

function makeSpeedCalibrationTrial(settings) {
    const configuredDurationMs = validPositiveNumber(
        settings.speedCalibrationDurationMs,
        DEFAULT_SPEED_CALIBRATION_DURATION_MS
    );
    const thresholdFraction = validPositiveNumber(
        settings.thresholdFraction,
        DEFAULT_THRESHOLD_FRACTION
    );
    const speedBarMaxHz = validPositiveNumber(
        settings.speedBarMaxHz,
        DEFAULT_SPEED_BAR_MAX_HZ
    );

    let detector = null;
    let countdownInterval = null;
    let finishTimer = null;
    let squeezeCount = 0;
    let responseTimes = [];
    let averageSpeedHz = 0;

    const cleanUp = () => {
        detector?.reset();
        detector = null;
        setForceCallback(() => {});
        if (countdownInterval !== null) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
        if (finishTimer !== null) {
            clearTimeout(finishTimer);
            finishTimer = null;
        }
    };

    return {
        type: jsPsychHtmlKeyboardResponse,
        choices: 'NO_KEYS',
        stimulus: `
            <div id="instruction-container">
                <div id="instruction-text" class="grip-speed-live">
                    <h3 id="grip-speed-countdown">Squeeze once to start.<br>Then squeeze and release as fast as you can!</h3>
                    <div id="grip-speed-counter" role="status" aria-live="polite">Squeezes: 0</div>
                    <div id="grip-speed-rate">Speed: 0.00 squeezes/sec</div>
                    <div id="grip-speed-indicator" aria-hidden="true">
                        <div class="grip-speed-indicator-core"></div>
                    </div>
                    <div id="grip-speed-track" role="progressbar" aria-label="Squeeze speed"
                         aria-valuemin="0" aria-valuemax="${speedBarMaxHz}" aria-valuenow="0">
                        <div id="grip-speed-bar"></div>
                    </div>
                </div>
            </div>
        `,
        data: {
            trialphase: 'dynamometer_speed_calibration',
            max_force_n: () => window.dynamometerMaxForce,
            threshold_fraction: thresholdFraction,
            speed_calibration_duration_ms: configuredDurationMs,
            response_time: () => responseTimes,
            trial_squeezes: () => squeezeCount,
            avg_speed_hz: () => averageSpeedHz
        },
        on_start: function () {
            squeezeCount = 0;
            responseTimes = [];
            averageSpeedHz = 0;
        },
        on_load: function () {
            const countdown = document.getElementById('grip-speed-countdown');
            const counter = document.getElementById('grip-speed-counter');
            const rate = document.getElementById('grip-speed-rate');
            const track = document.getElementById('grip-speed-track');
            const bar = document.getElementById('grip-speed-bar');
            const indicator = document.getElementById('grip-speed-indicator');
            const effectiveDurationMs = window.simulating ? 200 : configuredDurationMs;
            let startedAt = null;
            let lastSqueezeAt = null;
            let finished = false;

            const updateMeter = (now = performance.now()) => {
                if (startedAt === null) return;
                const elapsedSeconds = Math.max((now - startedAt) / 1000, 0.1);
                const speedHz = squeezeCount / Math.min(elapsedSeconds, effectiveDurationMs / 1000);
                const width = Math.min((speedHz / speedBarMaxHz) * 100, 100);
                rate.textContent = `Speed: ${speedHz.toFixed(2)} squeezes/sec`;
                bar.style.width = `${width}%`;
                track.setAttribute('aria-valuenow', String(Math.min(speedHz, speedBarMaxHz).toFixed(1)));
            };

            const showRegisteredFeedback = () => {
                indicator.classList.remove('grip-speed-indicator-hit');
                void indicator.offsetWidth;
                indicator.classList.add('grip-speed-indicator-hit');
            };

            const finishSpeedCalibration = () => {
                if (finished) return;
                finished = true;
                detector?.reset();
                setForceCallback(() => {});
                if (countdownInterval !== null) {
                    clearInterval(countdownInterval);
                    countdownInterval = null;
                }
                averageSpeedHz = squeezeCount / (configuredDurationMs / 1000);
                window.dynamometerMaxSpeed = averageSpeedHz;
                sessionStorage.setItem(speedStorageKey(), String(averageSpeedHz));
                jsPsych.finishTrial();
            };

            const startTimedCalibration = (now) => {
                startedAt = now;
                lastSqueezeAt = now;
                countdown.textContent = `${(configuredDurationMs / 1000).toFixed(1)} s left`;
                updateState('dynamometer_speed_calibration_start');

                countdownInterval = setInterval(() => {
                    const elapsedMs = performance.now() - startedAt;
                    const remainingSeconds = Math.max(0, (effectiveDurationMs - elapsedMs) / 1000);
                    countdown.textContent = `${remainingSeconds.toFixed(1)} s left`;
                    updateMeter();
                }, 100);
                finishTimer = setTimeout(() => {
                    finishTimer = null;
                    finishSpeedCalibration();
                }, effectiveDurationMs);
            };

            const registerSqueeze = () => {
                if (finished) return;
                const now = performance.now();
                showRegisteredFeedback();

                // As in the tapping speed check, the first response self-initiates
                // the timed period; subsequent responses measure maximum speed.
                if (startedAt === null) {
                    startTimedCalibration(now);
                    return;
                }

                squeezeCount += 1;
                responseTimes.push(Math.round(now - lastSqueezeAt));
                lastSqueezeAt = now;
                counter.textContent = `Squeezes: ${squeezeCount}`;
                updateMeter(now);
            };

            detector = createPressDetector(window.dynamometerMaxForce, {
                thresholdFraction,
                holdDurationMs: 0,
                onPress: registerSqueeze
            });
            setForceCallback(forceN => detector.update(forceN));

            if (window.simulating) {
                jsPsych.pluginAPI.setTimeout(registerSqueeze, 5);
                for (let index = 1; index <= 5; index += 1) {
                    jsPsych.pluginAPI.setTimeout(registerSqueeze, 20 + index * 25);
                }
            }
        },
        on_finish: function (data) {
            cleanUp();
            if (window.simulating) {
                data.trial_squeezes = 35;
                data.avg_speed_hz = 5;
                window.dynamometerMaxSpeed = 5;
                sessionStorage.setItem(speedStorageKey(), '5');
            }
        }
    };
}

function makeSpeedCalibrationFeedback(settings) {
    return {
        type: jsPsychHtmlButtonResponse,
        stimulus: function () {
            const row = jsPsych.data.get()
                .filter({ trialphase: 'dynamometer_speed_calibration' })
                .last(1)
                .values()[0];
            const speedHz = Number(row?.avg_speed_hz);
            const speedLabel = Number.isFinite(speedHz) ? speedHz.toFixed(2) : '0.00';
            return `
                <div id="instruction-container">
                    <div id="instruction-text">
                        <h2><span class="highlight-txt">Well done!</span></h2>
                        <p>Your speed was <strong>${speedLabel} squeezes per second</strong>.</p>
                        <p>Tap <strong>Continue</strong> to go on to the piggy-bank game.</p>
                    </div>
                </div>
            `;
        },
        choices: ['Continue'],
        post_trial_gap: 800,
        data: { trialphase: 'dynamometer_speed_calibration_feedback' },
        on_finish: function () {
            // Standalone calibration releases Bluetooth here. Combined modules keep
            // the connection for the immediately following dynamometer task.
            if (settings.disconnectOnFinish !== false && window.dynamometerSensor) {
                disconnectDynamometer(window.dynamometerSensor).catch(() => {});
                window.dynamometerSensor = null;
            }
            updateState('dynamometer_speed_calibration_end');
            updateState('dynamometer_calibration_end');
        }
    };
}

function createSpeedCalibration(settings) {
    return {
        timeline: [
            makeSpeedCalibrationInstructions(settings),
            makeSpeedCalibrationTrial(settings),
            makeSpeedCalibrationFeedback(settings)
        ],
        conditional_function: () => !_needsRetry
    };
}

// ── Public timeline factory ───────────────────────────────────────────────────

export function createDynamometerCalibrationTimeline(settings) {
    // Clear any stale calibration for this participant so vigour cannot pick up
    // a previous participant's max force from the same browser tab.
    sessionStorage.removeItem(calStorageKey());
    sessionStorage.removeItem(speedStorageKey());
    window.dynamometerMaxForce = undefined;
    window.dynamometerMaxSpeed = undefined;
    window.dynamometerSensor   = null;
    _streamTimedOut = false;
    _showInstructions = true;
    _needsRetry = false;

    const trials = Array.from({ length: N_SQUEEZES }, (_, i) => makeCalibrationTrial(i, settings));
    const calibrationResults = createCalibrationResults();
    const speedCalibration = createSpeedCalibration(settings);

    // connectTrial runs first AND on every retry. On retry the existing handle is
    // retained so connectTrial can disconnect it cleanly before pairing again.
    const calibrationProcedure = {
        timeline: [
            connectTrial,
            calibrationInstructions,
            ...trials,
            calibrationResults,
            calibrationRetry,
            speedCalibration
        ],
        loop_function: function () {
            if (_needsRetry) {
                // Retain window.dynamometerSensor so the Connect button in connectTrial
                // can call disconnectDynamometer on it, which resets _listenerAttached
                // before a new device is selected and its listener attached.
                return true;
            }
            return false;
        }
    };

    return [calibrationProcedure];
}

import { connectDynamometer, startForceStream, setForceCallback, disconnectDynamometer } from '@utils/dynamometer.js';
import { updateState } from '@utils/index.js';

const N_TRIALS = 6;
const SQUEEZE_START_THRESHOLD_N = 1.0;
const SQUEEZE_RELEASE_THRESHOLD_N = 0.5;
const RELEASE_SETTLE_MS = 100;
const DEFAULT_SQUEEZE_DURATION_MS = 500;
const DEFAULT_RELAX_DURATION_MS = 3000;
const DEFAULT_SQUEEZE_WAIT_TIMEOUT_MS = 30000;

let _peaks = [];
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
                <h2>Measuring your maximum squeeze</h2>
                <p>Squeeze the grip as hard as you can <strong>${N_TRIALS} times</strong>.</p>
                <p>Start when the ring appears. Let go when you see <strong>Rest</strong>.</p>
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
    const squeezeDurationMs = validDuration(settings?.squeezeDurationMs, DEFAULT_SQUEEZE_DURATION_MS);
    const relaxDurationMs = validDuration(settings?.relaxDurationMs, DEFAULT_RELAX_DURATION_MS);
    const squeezeWaitTimeoutMs = validDuration(
        settings?.squeezeWaitTimeoutMs,
        DEFAULT_SQUEEZE_WAIT_TIMEOUT_MS
    );
    let phase = 'awaiting-release';
    let selfInitiationRt = null;

    return {
        type: jsPsychHtmlKeyboardResponse,
        choices: 'NO_KEYS',
        stimulus: `
            <div id="instruction-container">
                <div id="instruction-text" class="calibration-stage">
                    <div id="cal-timing-ring" hidden>
                        <svg viewBox="0 0 120 120" aria-hidden="true">
                            <circle class="cal-ring-track" cx="60" cy="60" r="52"></circle>
                            <circle id="cal-ring-progress" cx="60" cy="60" r="52"></circle>
                        </svg>
                    </div>
                    <p id="cal-phase-prompt" role="status" aria-live="polite" aria-atomic="true" hidden>Squeeze hard</p>
                    <p id="cal-rest-label" role="status" aria-live="polite" aria-atomic="true">Rest</p>
                </div>
            </div>
        `,
        data: {
            trialphase: 'dynamometer_calibration',
            trial_number: trialIndex + 1,
            peak_force_n: () => _trialPeak,
            self_initiation_rt_ms: () => selfInitiationRt,
            squeeze_duration_ms: squeezeDurationMs,
            relax_duration_ms: relaxDurationMs,
            squeeze_wait_timeout_ms: squeezeWaitTimeoutMs,
            squeeze_wait_timed_out: false
        },
        on_start: function () {
            _trialPeak = 0;
            phase = 'awaiting-release';
            selfInitiationRt = null;
        },
        on_load: function () {
            const prompt = document.getElementById('cal-phase-prompt');
            const restLabel = document.getElementById('cal-rest-label');
            const ring = document.getElementById('cal-timing-ring');
            const ringProgress = document.getElementById('cal-ring-progress');
            let readyAt = null;
            let releaseStartedAt = null;
            // Keep automated simulations fast without changing the recorded task settings.
            const activeSqueezeDuration = window.simulating ? Math.min(squeezeDurationMs, 50) : squeezeDurationMs;
            const activeRelaxDuration = window.simulating ? Math.min(relaxDurationMs, 50) : relaxDurationMs;
            const activeReleaseSettle = window.simulating ? Math.min(RELEASE_SETTLE_MS, 10) : RELEASE_SETTLE_MS;

            const showRest = () => {
                if (ring) ring.hidden = true;
                if (prompt) prompt.hidden = true;
                if (restLabel) restLabel.hidden = false;
            };

            const showSqueeze = () => {
                if (ring) ring.hidden = false;
                if (prompt) {
                    prompt.hidden = false;
                    prompt.textContent = 'Squeeze hard';
                }
                if (restLabel) restLabel.hidden = true;
            };

            const armSqueeze = () => {
                if (phase !== 'awaiting-release') return;
                phase = 'waiting';
                readyAt = performance.now();
                showSqueeze();
            };

            const beginSqueeze = (forceN) => {
                if (phase !== 'waiting') return;
                phase = 'squeezing';
                selfInitiationRt = Math.round(performance.now() - readyAt);
                _trialPeak = Math.max(_trialPeak, forceN);

                if (ring) ring.classList.add('active');
                if (ringProgress) {
                    ringProgress.style.transitionDuration = `${activeSqueezeDuration}ms`;
                    // Force the empty-ring style to render before starting the fill.
                    void ringProgress.getBoundingClientRect();
                    ringProgress.classList.add('filling');
                }

                jsPsych.pluginAPI.setTimeout(() => {
                    phase = 'relaxing';
                    if (ring) {
                        ring.classList.remove('active');
                        ring.classList.add('complete');
                    }
                    showRest();

                    jsPsych.pluginAPI.setTimeout(() => {
                        jsPsych.finishTrial();
                    }, activeRelaxDuration);
                }, activeSqueezeDuration);
            };

            setForceCallback((forceN) => {
                const now = performance.now();

                if (phase === 'awaiting-release') {
                    if (forceN <= SQUEEZE_RELEASE_THRESHOLD_N) {
                        if (releaseStartedAt === null) releaseStartedAt = now;
                        if (now - releaseStartedAt >= activeReleaseSettle) armSqueeze();
                    } else {
                        releaseStartedAt = null;
                        showRest();
                    }
                } else if (phase === 'waiting' && forceN > SQUEEZE_START_THRESHOLD_N) {
                    beginSqueeze(forceN);
                } else if (phase === 'squeezing') {
                    _trialPeak = Math.max(_trialPeak, forceN);
                }
            });

            if (window.simulating) {
                jsPsych.pluginAPI.setTimeout(armSqueeze, activeReleaseSettle);
                jsPsych.pluginAPI.setTimeout(
                    () => beginSqueeze(70 + Math.random() * 20),
                    activeReleaseSettle + 10
                );
            }

            jsPsych.pluginAPI.setTimeout(() => {
                if (phase !== 'awaiting-release' && phase !== 'waiting') return;
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
            _peaks.push(_trialPeak);
            setForceCallback(() => {});
        },
        // A timed-out stream means the remaining trials cannot collect useful
        // data. Skip them so the existing reconnect loop is reached at once.
        conditional_function: () => !_streamTimedOut
    };
}

// ── Compute calibration result without a participant-facing feedback screen ───

function createCalibrationResults(settings) {
    return {
        type: jsPsychCallFunction,
        func: function () {
            const validPeaks = _peaks.filter(p => p > 1.0);

            // Require at least 5 valid peaks so the result always rests on five
            // detected squeezes.
            _needsRetry = validPeaks.length < 5;

            if (_needsRetry) {
                return {
                    max_force_n: null,
                    had_bad_peaks: true,
                    calibration_retry: true
                };
            }

            // When all 6 peaks are valid, use outlier removal (drop the one farthest
            // from the median and average the remaining 5).
            // When exactly 5 are valid, average them directly — passing the full set
            // to computeMaxForce could discard the wrong trial if a high outlier is
            // present (e.g. [0, 40, 42, 43, 44, 200]: outlier removal drops 200 and
            // averages the zero, producing a biased threshold).
            const maxForce = validPeaks.length === _peaks.length
                ? computeMaxForce(_peaks).maxForce
                : validPeaks.reduce((s, v) => s + v, 0) / validPeaks.length;
            window.dynamometerMaxForce = maxForce;
            sessionStorage.setItem(calStorageKey(), String(maxForce));

            return {
                max_force_n: maxForce,
                had_bad_peaks: _peaks.some(p => p <= 1.0),
                calibration_retry: false
            };
        },
        data: { trialphase: 'dynamometer_calibration_results' },
        on_finish: function (data) {
            Object.assign(data, data.value);
            if (!_needsRetry) {
                // Standalone calibration releases Bluetooth here. The combined module
                // keeps this connection so its immediately following vigour task can reuse it.
                if (settings.disconnectOnFinish !== false && window.dynamometerSensor) {
                    disconnectDynamometer(window.dynamometerSensor).catch(() => {});
                    window.dynamometerSensor = null;
                }
                updateState('dynamometer_calibration_end');
            }
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
    data: { trialphase: 'dynamometer_calibration_retry' },
    conditional_function: () => _needsRetry
};

// ── Public timeline factory ───────────────────────────────────────────────────

export function createDynamometerCalibrationTimeline(settings) {
    // Clear any stale calibration for this participant so vigour cannot pick up
    // a previous participant's max force from the same browser tab.
    sessionStorage.removeItem(calStorageKey());
    window.dynamometerMaxForce = undefined;
    window.dynamometerSensor   = null;
    _streamTimedOut = false;
    _showInstructions = true;

    const trials = Array.from({ length: N_TRIALS }, (_, i) => makeCalibrationTrial(i, settings));
    const calibrationResults = createCalibrationResults(settings);

    // connectTrial runs first AND on every retry. On retry the existing handle is
    // retained so connectTrial can disconnect it cleanly before pairing again.
    const calibrationProcedure = {
        timeline: [connectTrial, calibrationInstructions, ...trials, calibrationResults, calibrationRetryPrompt],
        loop_function: function () {
            if (_needsRetry) {
                _peaks = [];
                // Retain window.dynamometerSensor so the Connect button in connectTrial
                // can call disconnectDynamometer on it, which resets _listenerAttached
                // before a new device is selected and its listener attached.
                return true;
            }
            return false;
        },
        on_timeline_start: function () {
            _peaks = [];
        }
    };

    return [calibrationProcedure];
}

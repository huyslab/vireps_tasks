import { connectDynamometer, startForceStream, setForceCallback, disconnectDynamometer } from '@utils/dynamometer.js';
import { updateState } from '@utils/index.js';

const N_SQUEEZES = 10;
const SQUEEZE_START_THRESHOLD_N = 1.0;
const SQUEEZE_RELEASE_THRESHOLD_N = 0.5;
const DEFAULT_SQUEEZE_WAIT_TIMEOUT_MS = 30000;
const FINAL_COUNT_DISPLAY_MS = 300;

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
                <p>We need to measure how hard you can squeeze the device.</p>
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

function createCalibrationResults(settings) {
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
    data: { trialphase: 'dynamometer_calibration_retry' }
};

// jsPsych applies conditional_function to timeline nodes, not individual trial
// nodes. Wrapping the prompt prevents it from appearing after a valid result.
const calibrationRetry = {
    timeline: [calibrationRetryPrompt],
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
    _needsRetry = false;

    const trials = Array.from({ length: N_SQUEEZES }, (_, i) => makeCalibrationTrial(i, settings));
    const calibrationResults = createCalibrationResults(settings);

    // connectTrial runs first AND on every retry. On retry the existing handle is
    // retained so connectTrial can disconnect it cleanly before pairing again.
    const calibrationProcedure = {
        timeline: [connectTrial, calibrationInstructions, ...trials, calibrationResults, calibrationRetry],
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

import { connectDynamometer, startForceStream, setForceCallback, disconnectDynamometer } from '@utils/dynamometer.js';
import { updateState } from '@utils/index.js';

const N_TRIALS = 6;
const SQUEEZE_START_THRESHOLD_N = 1.0;
const DEFAULT_SQUEEZE_DURATION_MS = 500;
const DEFAULT_RELAX_DURATION_MS = 3000;

let _peaks = [];
let _trialPeak = 0;
// Set inside calibrationResults.stimulus (which jsPsych evaluates before on_start)
// so the loop_function can read whether a retry is needed.
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
                    <h2>${reconnect ? 'Reconnect the grip' : 'Connect the grip'}</h2>
                    ${reconnect
                        ? '<p>The grip sensor did not pick up any squeezes. Make sure it is switched on and within range, then tap <strong>Connect</strong> to pair again.</p>'
                        : '<p>Make sure the hand dynamometer is switched on and close by. Then tap <strong>Connect</strong> to pair it with this device.</p>'}
                    <p id="connect-status" style="color: var(--rlm-accent, #c0392b)"></p>
                    <button id="connect-btn" class="jspsych-btn">Connect</button>
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
                <p>We will measure how hard you can squeeze <strong>${N_TRIALS} times</strong>.</p>
                <p>Each time you see <strong>"Ready when you are"</strong>, start squeezing whenever you feel ready.</p>
                <p>Squeeze as hard as you can until the screen tells you to relax.</p>
            </div>
        </div>
    `,
    choices: ["OK, let's go"],
    data: { trialphase: 'dynamometer_calibration_instructions' }
};

// ── One calibration trial ─────────────────────────────────────────────────────

function validDuration(value, fallback) {
    const duration = Number(value);
    return Number.isFinite(duration) && duration >= 0 ? duration : fallback;
}

function makeCalibrationTrial(trialIndex, settings) {
    const squeezeDurationMs = validDuration(settings?.squeezeDurationMs, DEFAULT_SQUEEZE_DURATION_MS);
    const relaxDurationMs = validDuration(settings?.relaxDurationMs, DEFAULT_RELAX_DURATION_MS);
    let phase = 'waiting';
    let selfInitiationRt = null;

    return {
        type: jsPsychHtmlKeyboardResponse,
        choices: 'NO_KEYS',
        stimulus: `
            <div id="instruction-container">
                <div id="instruction-text">
                    <h2 id="cal-phase-label">Ready when you are</h2>
                    <p id="cal-trial-counter">Squeeze ${trialIndex + 1} of ${N_TRIALS}</p>
                    <div id="cal-timing-ring" role="img" aria-label="Squeeze duration">
                        <svg viewBox="0 0 120 120" aria-hidden="true">
                            <circle class="cal-ring-track" cx="60" cy="60" r="52"></circle>
                            <circle id="cal-ring-progress" cx="60" cy="60" r="52"></circle>
                        </svg>
                        <span id="cal-ring-label">Ready</span>
                    </div>
                    <p id="cal-phase-prompt">Press hard</p>
                </div>
            </div>
        `,
        data: {
            trialphase: 'dynamometer_calibration',
            trial_number: trialIndex + 1,
            peak_force_n: () => _trialPeak,
            self_initiation_rt_ms: () => selfInitiationRt,
            squeeze_duration_ms: squeezeDurationMs,
            relax_duration_ms: relaxDurationMs
        },
        on_start: function () {
            _trialPeak = 0;
            phase = 'waiting';
            selfInitiationRt = null;
        },
        on_load: function () {
            const label = document.getElementById('cal-phase-label');
            const prompt = document.getElementById('cal-phase-prompt');
            const ring = document.getElementById('cal-timing-ring');
            const ringProgress = document.getElementById('cal-ring-progress');
            const ringLabel = document.getElementById('cal-ring-label');
            const readyAt = performance.now();
            // Keep automated simulations fast without changing the recorded task settings.
            const activeSqueezeDuration = window.simulating ? Math.min(squeezeDurationMs, 50) : squeezeDurationMs;
            const activeRelaxDuration = window.simulating ? Math.min(relaxDurationMs, 50) : relaxDurationMs;

            const beginSqueeze = (forceN) => {
                if (phase !== 'waiting') return;
                phase = 'squeezing';
                selfInitiationRt = Math.round(performance.now() - readyAt);
                _trialPeak = Math.max(_trialPeak, forceN);

                if (label) {
                    label.textContent = 'Keep squeezing';
                    label.classList.add('squeeze');
                }
                if (prompt) prompt.textContent = 'Press hard';
                if (ring) ring.classList.add('active');
                if (ringLabel) ringLabel.textContent = 'Squeeze';
                if (ringProgress) {
                    ringProgress.style.transitionDuration = `${activeSqueezeDuration}ms`;
                    // Force the empty-ring style to render before starting the fill.
                    void ringProgress.getBoundingClientRect();
                    ringProgress.classList.add('filling');
                }

                jsPsych.pluginAPI.setTimeout(() => {
                    phase = 'relaxing';
                    if (label) {
                        label.textContent = 'Relax';
                        label.classList.remove('squeeze');
                    }
                    if (prompt) prompt.textContent = 'Let go and rest';
                    if (ring) {
                        ring.classList.remove('active');
                        ring.classList.add('complete');
                    }
                    if (ringLabel) ringLabel.textContent = 'Rest';

                    jsPsych.pluginAPI.setTimeout(() => {
                        jsPsych.finishTrial();
                    }, activeRelaxDuration);
                }, activeSqueezeDuration);
            };

            setForceCallback((forceN) => {
                if (phase === 'waiting' && forceN > SQUEEZE_START_THRESHOLD_N) {
                    beginSqueeze(forceN);
                } else if (phase === 'squeezing') {
                    _trialPeak = Math.max(_trialPeak, forceN);
                }
            });

            if (window.simulating) {
                jsPsych.pluginAPI.setTimeout(() => beginSqueeze(70 + Math.random() * 20), 10);
            }
        },
        on_finish: function (data) {
            if (window.simulating && _trialPeak <= SQUEEZE_START_THRESHOLD_N) {
                _trialPeak = 70 + Math.random() * 20;
                data.peak_force_n = _trialPeak;
            }
            _peaks.push(_trialPeak);
            setForceCallback(() => {});
        }
    };
}

// ── Results trial ─────────────────────────────────────────────────────────────
// IMPORTANT: jsPsych evaluates stimulus() BEFORE calling on_start.
// All computation must live inside stimulus(); on_start must not be used here.

function createCalibrationResults(settings) {
    return {
        type: jsPsychHtmlButtonResponse,
        stimulus: function () {
            const validPeaks = _peaks.filter(p => p > 1.0);

            // Require at least 5 valid peaks so the result always rests on five
            // detected squeezes.
            _needsRetry = validPeaks.length < 5;

            if (_needsRetry) {
                return `
                <div id="instruction-container">
                    <div id="instruction-text">
                        <h2>Grip not detected</h2>
                        <p>Not enough valid squeezes were recorded (${validPeaks.length} of ${N_TRIALS} detected). The sensor may have lost connection.</p>
                        <p>Tap <strong>Continue</strong> to reconnect and try again.</p>
                    </div>
                </div>
                `;
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

            const threshold = (maxForce * 0.75).toFixed(1);
            return `
            <div id="instruction-container">
                <div id="instruction-text">
                    <h2>Well done!</h2>
                    <p>Your maximum squeeze: <strong>${maxForce.toFixed(1)} N</strong></p>
                    <p>During the game, a squeeze that reaches <strong>${threshold} N</strong> and lasts long enough will count.</p>
                    <p>Tap <strong>Continue</strong> when you are ready.</p>
                </div>
            </div>
            `;
        },
        choices: ['Continue'],
        data: {
            trialphase: 'dynamometer_calibration_results',
            max_force_n: () => window.dynamometerMaxForce,
            had_bad_peaks: () => _peaks.some(p => p <= 1.0),
            calibration_retry: () => _needsRetry
        },
        on_finish: function () {
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

// ── Public timeline factory ───────────────────────────────────────────────────

export function createDynamometerCalibrationTimeline(settings) {
    // Clear any stale calibration for this participant so vigour cannot pick up
    // a previous participant's max force from the same browser tab.
    sessionStorage.removeItem(calStorageKey());
    window.dynamometerMaxForce = undefined;
    window.dynamometerSensor   = null;

    const trials = Array.from({ length: N_TRIALS }, (_, i) => makeCalibrationTrial(i, settings));
    const calibrationResults = createCalibrationResults(settings);

    // connectTrial runs first AND on every retry. On retry the existing handle is
    // retained so connectTrial can disconnect it cleanly before pairing again.
    const calibrationProcedure = {
        timeline: [connectTrial, ...trials, calibrationResults],
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

    return [
        calibrationInstructions,
        calibrationProcedure
    ];
}

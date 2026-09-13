import { connectDynamometer, startForceStream, setForceCallback } from '@utils/dynamometer.js';
import { updateState } from '@utils/index.js';

const N_TRIALS = 6;
const READY_MS   = 500;
const SQUEEZE_MS = 1000;
const RELAX_MS   = 1500;
const COUNTDOWN_MS = 3000;
const TRIAL_DURATION_MS = READY_MS + COUNTDOWN_MS + SQUEEZE_MS + RELAX_MS; // 6000 ms

let _peaks = [];
let _trialPeak = 0;
// Set inside calibrationResults.stimulus (before on_finish runs) so the loop
// function can read whether a retry is needed without depending on on_start order.
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

// ── Connect trial ─────────────────────────────────────────────────────────────

const connectTrial = {
    type: jsPsychHtmlKeyboardResponse,
    choices: 'NO_KEYS',
    stimulus: `
        <div id="instruction-container">
            <div id="instruction-text">
                <h2>Connect the grip</h2>
                <p>Make sure the hand dynamometer is switched on and close by.</p>
                <p>Then tap <strong>Connect</strong> to pair it with this device.</p>
                <p id="connect-status" style="color: var(--rlm-accent, #c0392b)"></p>
                <button id="connect-btn" class="jspsych-btn">Connect</button>
            </div>
        </div>
    `,
    data: { trialphase: 'dynamometer_connect' },
    on_load: function () {
        const btn    = document.getElementById('connect-btn');
        const status = document.getElementById('connect-status');

        btn.addEventListener('click', async () => {
            btn.disabled = true;
            status.textContent = 'Connecting…';
            try {
                window.dynamometerSensor = await connectDynamometer();
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
                <p>Each time, wait for <strong>"Squeeze!"</strong>, then squeeze the grip as hard as you can for one second.</p>
                <p>Relax between each squeeze.</p>
            </div>
        </div>
    `,
    choices: ["OK, let's go"],
    data: { trialphase: 'dynamometer_calibration_instructions' }
};

// ── One calibration trial ─────────────────────────────────────────────────────

function makeCalibrationTrial(trialIndex) {
    return {
        type: jsPsychHtmlKeyboardResponse,
        choices: 'NO_KEYS',
        stimulus: `
            <div id="instruction-container">
                <div id="instruction-text">
                    <h2 id="cal-phase-label">Get ready…</h2>
                    <p id="cal-trial-counter">Squeeze ${trialIndex + 1} of ${N_TRIALS}</p>
                </div>
            </div>
        `,
        trial_duration: TRIAL_DURATION_MS,
        data: {
            trialphase: 'dynamometer_calibration',
            trial_number: trialIndex + 1,
            peak_force_n: () => _trialPeak
        },
        on_start: function (trial) {
            _trialPeak = 0;
            if (window.simulating) trial.trial_duration = 300;
        },
        on_load: function () {
            let inSqueeze = false;

            setForceCallback((forceN) => {
                if (inSqueeze) _trialPeak = Math.max(_trialPeak, forceN);
            });

            const label = document.getElementById('cal-phase-label');

            [3, 2, 1].forEach((n, i) => {
                jsPsych.pluginAPI.setTimeout(() => {
                    if (label) label.textContent = `${n}…`;
                }, READY_MS + i * 1000);
            });

            jsPsych.pluginAPI.setTimeout(() => {
                inSqueeze = true;
                if (label) {
                    label.textContent = 'Squeeze!';
                    label.classList.add('squeeze');
                }
            }, READY_MS + COUNTDOWN_MS);

            jsPsych.pluginAPI.setTimeout(() => {
                inSqueeze = false;
                if (label) {
                    label.textContent = 'Relax.';
                    label.classList.remove('squeeze');
                }
            }, READY_MS + COUNTDOWN_MS + SQUEEZE_MS);
        },
        on_finish: function (data) {
            if (window.simulating) {
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
// All computation must live inside stimulus(); on_start must not be used.

const calibrationResults = {
    type: jsPsychHtmlButtonResponse,
    stimulus: function () {
        const validPeaks = _peaks.filter(p => p > 1.0);
        _needsRetry = validPeaks.length < 2;

        if (_needsRetry) {
            return `
                <div id="instruction-container">
                    <div id="instruction-text">
                        <h2>Grip not detected</h2>
                        <p>We did not pick up any squeezes. Check that the grip sensor is still switched on and connected.</p>
                        <p>Tap <strong>Continue</strong> to repeat the measurement.</p>
                    </div>
                </div>
            `;
        }

        // Use all N_TRIALS peaks when available; fall back to valid subset so
        // computeMaxForce (which discards one outlier) still has enough data.
        const peaks = validPeaks.length === N_TRIALS ? _peaks : validPeaks;
        const { maxForce } = computeMaxForce(peaks);
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
            setForceCallback(() => {});
            updateState('dynamometer_calibration_end');
        }
    }
};

// ── Public timeline factory ───────────────────────────────────────────────────

export function createDynamometerCalibrationTimeline(settings) {
    // Clear any stale calibration stored for this participant so vigour
    // cannot pick up a previous participant's max force.
    sessionStorage.removeItem(calStorageKey());
    window.dynamometerMaxForce = undefined;

    const trials = Array.from({ length: N_TRIALS }, (_, i) => makeCalibrationTrial(i));

    // Loop repeats all calibration trials if the sensor failed to deliver data.
    const calibrationProcedure = {
        timeline: [...trials, calibrationResults],
        loop_function: function () {
            if (_needsRetry) {
                _peaks = [];
                return true;
            }
            return false;
        },
        on_timeline_start: function () {
            _peaks = [];
        }
    };

    return [
        connectTrial,
        calibrationInstructions,
        calibrationProcedure
    ];
}

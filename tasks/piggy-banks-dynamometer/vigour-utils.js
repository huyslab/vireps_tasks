import { saveDataREDCap, updateBonusState, updateState, showTemporaryWarning, kickOut, fullscreen_prompt } from '@utils/index.js';
import { setForceCallback, createPressDetector, disconnectDynamometer } from '@utils/dynamometer.js';
import { shakePiggy, updatePiggyTails } from '@tasks/piggy-banks/utils.js';

const VIGOUR_TRIALS = [{ "magnitude": 1, "ratio": 1, "trialDuration": 6825 }, { "magnitude": 2, "ratio": 8, "trialDuration": 6956 }, { "magnitude": 1, "ratio": 16, "trialDuration": 7228 }, { "magnitude": 5, "ratio": 1, "trialDuration": 7221 }, { "magnitude": 5, "ratio": 16, "trialDuration": 7261 }, { "magnitude": 2, "ratio": 1, "trialDuration": 7386 }, { "magnitude": 1, "ratio": 8, "trialDuration": 7009 }, { "magnitude": 5, "ratio": 8, "trialDuration": 7376 }, { "magnitude": 2, "ratio": 16, "trialDuration": 6666 }, { "magnitude": 1, "ratio": 1, "trialDuration": 6962 }, { "magnitude": 2, "ratio": 8, "trialDuration": 6501 }, { "magnitude": 2, "ratio": 1, "trialDuration": 7236 }, { "magnitude": 5, "ratio": 1, "trialDuration": 7490 }, { "magnitude": 1, "ratio": 16, "trialDuration": 6902 }, { "magnitude": 1, "ratio": 8, "trialDuration": 6888 }, { "magnitude": 2, "ratio": 16, "trialDuration": 6891 }, { "magnitude": 5, "ratio": 8, "trialDuration": 6535 }, { "magnitude": 5, "ratio": 16, "trialDuration": 6652 }, { "magnitude": 1, "ratio": 8, "trialDuration": 6890 }, { "magnitude": 5, "ratio": 8, "trialDuration": 7452 }, { "magnitude": 5, "ratio": 16, "trialDuration": 6954 }, { "magnitude": 2, "ratio": 1, "trialDuration": 6827 }, { "magnitude": 5, "ratio": 1, "trialDuration": 6679 }, { "magnitude": 1, "ratio": 16, "trialDuration": 7199 }, { "magnitude": 2, "ratio": 16, "trialDuration": 7207 }, { "magnitude": 1, "ratio": 1, "trialDuration": 7145 }, { "magnitude": 2, "ratio": 8, "trialDuration": 7465 }, { "magnitude": 1, "ratio": 8, "trialDuration": 6870 }, { "magnitude": 5, "ratio": 8, "trialDuration": 6726 }, { "magnitude": 2, "ratio": 16, "trialDuration": 6688 }, { "magnitude": 2, "ratio": 8, "trialDuration": 6506 }, { "magnitude": 5, "ratio": 1, "trialDuration": 7044 }, { "magnitude": 2, "ratio": 1, "trialDuration": 7293 }, { "magnitude": 1, "ratio": 1, "trialDuration": 7182 }, { "magnitude": 1, "ratio": 16, "trialDuration": 6862 }, { "magnitude": 5, "ratio": 16, "trialDuration": 6985 }];

const magnitudes = [...new Set(VIGOUR_TRIALS.map(t => t.magnitude))].sort((a, b) => a - b);
const ratios     = [...new Set(VIGOUR_TRIALS.map(t => t.ratio))].sort((a, b) => b - a);

let taskTotalReward  = 0;
let taskTotalPresses = 0;
let trialState = {};

const VIGOUR_PRELOAD_IMAGES = [
    "1p-num.png", "2p-num.png", "5p-num.png", "10p-num.png", "piggy-bank.png",
    "ooc_2p.png", "piggy-tail2.png", "saturate-icon.png", "tail-icon.png"
].map(s => "./assets/images/piggy-banks/" + s);

const DEBUG_FORCE_GRAPH_WINDOW_MS = 5000;
const DEBUG_FORCE_GRAPH_TOP_Y = 6;
const DEBUG_FORCE_GRAPH_BOTTOM_Y = 94;

function isDebugParticipant() {
    return (window.participantID ?? '').includes('debug');
}

function forceGraphY(forceN, graphMaximumN) {
    const usableHeight = DEBUG_FORCE_GRAPH_BOTTOM_Y - DEBUG_FORCE_GRAPH_TOP_Y;
    const proportion = Math.min(Math.max(forceN / graphMaximumN, 0), 1);
    return DEBUG_FORCE_GRAPH_BOTTOM_Y - proportion * usableHeight;
}

function generateDebugForceGraph(settings) {
    if (!isDebugParticipant()) return '';

    const maximumForceN = Number(window.dynamometerMaxForce);
    const targetForceN = maximumForceN * Number(settings.thresholdFraction);
    const graphMaximumN = Math.max(maximumForceN * 1.1, targetForceN * 1.2, 1);
    const targetY = forceGraphY(targetForceN, graphMaximumN);

    return `
        <div id="dynamometer-debug-graph" data-target-force-n="${targetForceN}">
            <div class="dynamometer-debug-readout">
                <span>Current: <strong id="dynamometer-debug-current">0.0 N</strong></span>
                <span>Target: <strong>${targetForceN.toFixed(1)} N</strong></span>
            </div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none"
                 role="img" aria-label="Live grip strength; dashed line shows the target">
                <line class="dynamometer-debug-target"
                      x1="0" y1="${targetY}" x2="100" y2="${targetY}"></line>
                <polyline id="dynamometer-debug-trace" points=""></polyline>
            </svg>
        </div>
    `;
}

function createDebugForceGraphUpdater(settings) {
    const graph = document.getElementById('dynamometer-debug-graph');
    const trace = document.getElementById('dynamometer-debug-trace');
    const current = document.getElementById('dynamometer-debug-current');
    if (!graph || !trace || !current) return () => {};

    const maximumForceN = Number(window.dynamometerMaxForce);
    const targetForceN = maximumForceN * Number(settings.thresholdFraction);
    const graphMaximumN = Math.max(maximumForceN * 1.1, targetForceN * 1.2, 1);
    const samples = [];

    return forceN => {
        const now = performance.now();
        const safeForceN = Number.isFinite(Number(forceN)) ? Math.max(0, Number(forceN)) : 0;
        samples.push({ time: now, force: safeForceN });

        const windowStart = now - DEBUG_FORCE_GRAPH_WINDOW_MS;
        while (samples.length > 1 && samples[0].time < windowStart) samples.shift();

        trace.setAttribute('points', samples.map(sample => {
            const x = 100 - ((now - sample.time) / DEBUG_FORCE_GRAPH_WINDOW_MS) * 100;
            return `${Math.max(0, x).toFixed(2)},${forceGraphY(sample.force, graphMaximumN).toFixed(2)}`;
        }).join(' '));
        current.textContent = `${safeForceN.toFixed(1)} N`;
    };
}

function dropCoin(magnitude, persist = false) {
    const id = persist ? 'persist-coin-container' : 'coin-container';
    const container = document.getElementById(id);
    if (!container) return;
    const coin = document.createElement('img');
    coin.className = 'vigour_coin';
    coin.src = magnitude === 0
        ? './assets/images/piggy-banks/ooc_2p.png'
        : `./assets/images/piggy-banks/${magnitude}p-num.png`;
    coin.alt = `Coin ${magnitude}`;
    container.appendChild(coin);
    coin.animate([
        { top: '-15%', opacity: 0.8 },
        { top: '70%',  opacity: 1,   offset: 0.1 },
        { top: '70%',  opacity: 1,   offset: 0.9 },
        { top: '70%',  opacity: 0 }
    ], { duration: 1000, easing: 'ease-in-out' }).onfinish = () => coin.remove();
}

function observeResizing(elementId, callback) {
    const obs = new ResizeObserver(callback);
    const el  = document.getElementById(elementId);
    if (el) obs.observe(el);
    return obs;
}

function createPersistentCoinContainer() {
    if (document.getElementById('persist-coin-container')) return;
    const el = document.createElement('div');
    el.id = 'persist-coin-container';
    document.body.appendChild(el);
    updatePersistentCoinContainer();
}

function removePersistentCoinContainer() {
    document.getElementById('persist-coin-container')?.remove();
}

function updatePersistentCoinContainer() {
    const src  = document.getElementById('coin-container');
    const dest = document.getElementById('persist-coin-container');
    if (src && dest) {
        const r = src.getBoundingClientRect();
        dest.style.top    = `${r.top}px`;
        dest.style.left   = `${r.left}px`;
        dest.style.width  = `${r.width}px`;
        dest.style.height = `${r.height}px`;
    }
}

function generateTrialStimulus(magnitude, ratio, settings) {
    const ratio_index  = ratios.indexOf(ratio);
    const ratio_factor = ratio_index / (ratios.length - 1);
    const piggy_style  = `filter: saturate(${50 * (400 / 50) ** ratio_factor}%) brightness(${115 * (90 / 115) ** ratio_factor}%);`;
    return `
        <div class="experiment-wrapper">
            <div id="experiment-container">
                <div id="coin-container"></div>
                <div id="piggy-container">
                    <img id="piggy-bank" src="./assets/images/piggy-banks/piggy-bank.png" alt="Piggy Bank" style="${piggy_style}">
                </div>
                ${generateDebugForceGraph(settings)}
            </div>
        </div>
    `;
}

let dynTrialCounter    = 0;
let dynFsChangeHandler = null;
let dynResizeHandler   = null;
let dynResizeTimer     = null;
let dynResizeObserver  = null;

function piggyBankTrial(settings) {
    let detector = null;

    return {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: function () {
            return generateTrialStimulus(
                jsPsych.evaluateTimelineVariable('magnitude'),
                jsPsych.evaluateTimelineVariable('ratio'),
                settings
            );
        },
        choices: 'NO_KEYS',
        trial_duration: jsPsych.timelineVariable('trialDuration'),
        save_timeline_variables: ['magnitude', 'ratio'],
        data: {
            trialphase: 'dynamometer_vigour_trial',
            trial_duration: jsPsych.timelineVariable('trialDuration'),
            responseTime:     () => trialState.responseTime,
            viewport_width:   () => trialState.viewportWidth,
            viewport_height:  () => trialState.viewportHeight,
            viewport_changed: () => trialState.viewportChanged,
            wrong_orientation:       () => trialState.wrongOrientation,
            wrong_orientation_times: () => trialState.wrongOrientationTimes,
            trial_presses:  () => trialState.trialPresses,
            trial_reward:   () => trialState.trialReward,
            total_presses:  () => taskTotalPresses,
            total_reward:   () => taskTotalReward,
            max_force_n:          () => window.dynamometerMaxForce,
            threshold_fraction:   settings.thresholdFraction,
            hold_duration_ms:     settings.holdDurationMs
        },
        on_start: function (trial) {
            if (window.simulating) trial.trial_duration = 500;
            trialState = {
                trialPresses: 0,
                trialReward:  0,
                responseTime: [],
                viewportWidth:  null,
                viewportHeight: null,
                viewportChanged: false,
                wrongOrientation: false,
                wrongOrientationTimes: []
            };
        },
        on_load: function () {
            const magnitude = jsPsych.evaluateTimelineVariable('magnitude');
            const ratio     = jsPsych.evaluateTimelineVariable('ratio');

            trialState.viewportWidth  = window.innerWidth;
            trialState.viewportHeight = window.innerHeight;

            const trialOnset = performance.now();
            const isRotateGateVisible = () => {
                const ov = document.getElementById('rotate-overlay');
                return !!ov && getComputedStyle(ov).display !== 'none';
            };
            let gateVisible = isRotateGateVisible();
            if (gateVisible) {
                trialState.wrongOrientation = true;
                trialState.wrongOrientationTimes.push(Math.round(performance.now() - trialOnset));
            }

            settings.magnitudes = magnitudes;
            settings.ratios     = ratios;
            updatePiggyTails(magnitude, ratio, settings);
            updatePersistentCoinContainer();
            dynResizeObserver = observeResizing('coin-container', updatePersistentCoinContainer);

            dynFsChangeHandler = () => {
                if (document.fullscreenElement || document.webkitFullscreenElement) {
                    updatePiggyTails(magnitude, ratio, settings);
                }
            };
            document.addEventListener('fullscreenchange', dynFsChangeHandler);
            document.addEventListener('webkitfullscreenchange', dynFsChangeHandler);

            dynResizeHandler = () => {
                trialState.viewportChanged = true;
                const nowVisible = isRotateGateVisible();
                if (nowVisible && !gateVisible) {
                    trialState.wrongOrientation = true;
                    trialState.wrongOrientationTimes.push(Math.round(performance.now() - trialOnset));
                }
                gateVisible = nowVisible;
                clearTimeout(dynResizeTimer);
                dynResizeTimer = setTimeout(() => {
                    updatePiggyTails(magnitude, ratio, settings);
                    updatePersistentCoinContainer();
                }, 150);
            };
            window.addEventListener('resize', dynResizeHandler);
            window.addEventListener('orientationchange', dynResizeHandler);

            // Press state
            let pressCount    = 0;
            let lastPressTime = null;
            const trialStartTime = performance.now();

            function handlePress() {
                const now = performance.now();
                trialState.responseTime.push(
                    lastPressTime === null ? now - trialStartTime : now - lastPressTime
                );
                lastPressTime = now;

                shakePiggy();
                pressCount++;
                trialState.trialPresses++;
                taskTotalPresses++;

                if (pressCount === ratio) {
                    trialState.trialReward += magnitude;
                    taskTotalReward        += magnitude;
                    pressCount = 0;
                    dropCoin(magnitude, true);
                }
            }

            if (window.simulating) {
                const nPresses = jsPsych.randomization.randomInt(1, 3);
                for (let i = 0; i < nPresses; i++) {
                    jsPsych.pluginAPI.setTimeout(handlePress, 120 * (i + 1));
                }
            } else {
                // window.dynamometerMaxForce is guaranteed valid by the calibration
                // gate in vigour-timeline.js; no 80 N fallback needed here.
                detector = createPressDetector(window.dynamometerMaxForce, {
                    thresholdFraction: settings.thresholdFraction,
                    holdDurationMs:    settings.holdDurationMs,
                    onPress: handlePress
                });
                const updateDebugGraph = createDebugForceGraphUpdater(settings);
                setForceCallback(forceN => {
                    detector.update(forceN);
                    updateDebugGraph(forceN);
                });
            }
        },
        on_finish: function (data) {
            detector?.reset();
            detector = null;
            setForceCallback(() => {}); // idle stream between trials
            jsPsych.pluginAPI.cancelAllKeyboardResponses();
            dynTrialCounter++;
            data.trial_number = dynTrialCounter;

            if (dynTrialCounter % (VIGOUR_TRIALS.length / 3) === 0 || dynTrialCounter === VIGOUR_TRIALS.length) {
                saveDataREDCap();
                updateBonusState(settings);
            }

            if (dynFsChangeHandler) {
                document.removeEventListener('fullscreenchange', dynFsChangeHandler);
                document.removeEventListener('webkitfullscreenchange', dynFsChangeHandler);
                dynFsChangeHandler = null;
            }
            if (dynResizeHandler) {
                window.removeEventListener('resize', dynResizeHandler);
                window.removeEventListener('orientationchange', dynResizeHandler);
                dynResizeHandler = null;
            }
            if (dynResizeTimer) {
                clearTimeout(dynResizeTimer);
                dynResizeTimer = null;
            }
            if (dynResizeObserver) {
                dynResizeObserver.disconnect();
                dynResizeObserver = null;
            }

            if (data.trial_presses === 0 && data.timeline_variables.ratio === 1) {
                const prev = jsPsych.data.get().last(1).select('n_warnings').values[0] ?? 0;
                jsPsych.data.addProperties({ n_warnings: prev + 1 });
                showTemporaryWarning("Didn't catch a response - moving on", 800);
            }
        }
    };
}

function createDynVigourCoreTimeline(settings) {
    const timeline = VIGOUR_TRIALS.map(trial => ({
        timeline: [kickOut(settings), fullscreen_prompt, piggyBankTrial(settings)],
        timeline_variables: [trial]
    }));

    timeline[0]['on_timeline_start'] = () => {
        updateState('no_resume_10_minutes');
        updateState('dynamometer_vigour_task_start');
        createPersistentCoinContainer();
        taskTotalReward  = 0;
        taskTotalPresses = 0;
        dynTrialCounter  = 0;
    };

    timeline.at(-1)['on_timeline_finish'] = () => {
        removePersistentCoinContainer();
        // Disconnect and release the Bluetooth device so it does not continue
        // streaming and draining its battery after the task ends.
        if (window.dynamometerSensor) {
            disconnectDynamometer(window.dynamometerSensor).catch(() => {});
            window.dynamometerSensor = null;
        }
    };

    return timeline;
}

export {
    createDynVigourCoreTimeline,
    updatePersistentCoinContainer,
    observeResizing,
    dropCoin,
    VIGOUR_PRELOAD_IMAGES,
    createDebugForceGraphUpdater
};

// Grip session state and screens shared by every grip task: the calibration
// value, the connect screen, and the gate that keeps grip games from running
// without a calibration.
import { connectDynamometer, disconnectDynamometer, isDynamometerConnected, startForceStream } from './dynamometer.js';

// Scoped to the participant so a calibration from someone else sharing the
// tab cannot carry over. sessionStorage keeps it across a page reload.
function calibrationKey() {
    return `dynamometerMedianSqueezeForceN_${window.participantID ?? 'anon'}`;
}

/** Stores the median quick-squeeze peak from the speed test. */
export function saveGripCalibration(medianSqueezeForceN) {
    sessionStorage.setItem(calibrationKey(), String(medianSqueezeForceN));
}

export function clearGripCalibration() {
    sessionStorage.removeItem(calibrationKey());
}

/**
 * The median quick-squeeze peak in newtons, or null if the speed test has not
 * run for this participant. Grip games only need it to know calibration ran
 * and to scale the debug graph; squeezes are counted with no strength target.
 */
export function getGripCalibration() {
    const value = Number(sessionStorage.getItem(calibrationKey()));
    return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Screen that pairs the grip over Bluetooth, replacing any stale handle.
 * `reconnect` words it for a grip that dropped out mid-session.
 */
export function makeConnectTrial({ reconnect = false, skipControl } = {}) {
    const [heading, text, label] = reconnect
        ? ['Reconnect the grip', 'The grip needs to be paired again. Make sure it is switched on and close by, then tap <strong>Connect grip</strong>.', 'dynamometer_reconnect']
        : ['For the experimenter', 'Switch on the grip and select <strong>Connect grip</strong>.', 'dynamometer_connect'];
    return {
        type: jsPsychHtmlKeyboardResponse,
        choices: 'NO_KEYS',
        stimulus: `
            <div id="instruction-container"><div id="instruction-text">
                <h2>${heading}</h2>
                <p>${text}</p>
                <p id="connect-status" class="cal-connection-status" role="status" aria-live="polite"></p>
                <button id="connect-btn" class="jspsych-btn">Connect grip</button>
                ${skipControl?.button ?? ''}
            </div></div>`,
        data: { trialphase: label },
        on_load: () => {
            const button = document.getElementById('connect-btn');
            const status = document.getElementById('connect-status');
            let skipRequested = false;
            skipControl?.onLoad(() => {
                skipRequested = true;
                button.disabled = true;
            });
            button.addEventListener('click', async () => {
                button.disabled = true;
                status.textContent = 'Connecting…';
                try {
                    const previousSensor = window.dynamometerSensor;
                    if (previousSensor) {
                        window.dynamometerSensor = null;
                        try { await disconnectDynamometer(previousSensor); } catch (_) {}
                    }
                    if (skipRequested) return;

                    const sensor = await connectDynamometer();
                    if (skipRequested) {
                        await disconnectDynamometer(sensor);
                        return;
                    }
                    window.dynamometerSensor = sensor;
                    startForceStream(sensor, () => {});
                    jsPsych.finishTrial({ connected: true });
                } catch (error) {
                    if (skipRequested) return;
                    status.textContent = `Could not connect: ${error.message}. Please try again.`;
                    button.disabled = false;
                }
            });
            if (window.simulating) jsPsych.pluginAPI.setTimeout(() => button.click(), 100);
        },
        on_finish: skipControl?.onFinish
    };
}

/**
 * Connect step for a grip test that loops on retry. It is shown on the first
 * pass and again only when `shouldReconnect()` says the signal was lost, or no
 * grip is connected; otherwise a retry reuses the live connection instead of
 * asking the experimenter to pair the grip again.
 */
export function makeConnectStep(shouldReconnect, skipControl) {
    let firstPass = true;
    return {
        timeline: [makeConnectTrial({ skipControl })],
        conditional_function: () => {
            const show = firstPass || shouldReconnect() || !window.dynamometerSensor;
            firstPass = false;
            return show;
        }
    };
}

/**
 * Wraps a grip game: a "calibration required" screen if the speed test has not
 * run (e.g. the game was opened directly, or storage was cleared), otherwise a
 * reconnect screen when the grip handle is gone, then the game itself.
 */
export function gateGripGame({ preloadTrial, game, trialphasePrefix }) {
    const calibrated = () => getGripCalibration() !== null;
    return [
        preloadTrial,
        {
            timeline: [{
                type: jsPsychHtmlButtonResponse,
                choices: ['Return to setup'],
                stimulus: `
                    <div id="instruction-container"><div id="instruction-text">
                        <h2>Calibration required</h2>
                        <p>No valid grip calibration was found. Please return to setup and restart Module 2.</p>
                    </div></div>`,
                data: { trialphase: `${trialphasePrefix}_missing_calibration` },
                on_finish: () => { window.location.assign('./index.html'); }
            }],
            conditional_function: () => !calibrated()
        },
        {
            timeline: [
                {
                    timeline: [makeConnectTrial({ reconnect: true })],
                    conditional_function: () => !isDynamometerConnected(window.dynamometerSensor) && !window.simulating
                },
                ...game
            ],
            conditional_function: calibrated
        }
    ];
}

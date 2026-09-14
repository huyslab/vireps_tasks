// Vernier Go Direct Hand Dynamometer (GDX-HD) over Web Bluetooth.
// Requires @vernier/godirect vendored at core/godirect/godirect.module.js:
//   npm install @vernier/godirect
//   cp node_modules/@vernier/godirect/dist/godirect.min.esm.js core/godirect/godirect.module.js
//
// API surface used from v1.8.3:
//   GoDirect.selectDevice(true)  — shows BLE picker, opens device, returns Device
//     (selectDevice already calls open(startMeasurements=true) internally, so the
//      device is streaming when returned; do not call device.start() again)
//   device.stop()                — stops streaming (also done by close())
//   device.close()               — stops streaming AND disconnects; stop() alone is redundant
//   sensor.on('value-changed', (sensor) => …)  — fires on each new reading
//   sensor.value                 — current reading (Newtons for GDX-HD)

let _godirect      = null;
let _currentCallback = null;
let _simInterval   = null;
let _listenerAttached = false; // guard against registering duplicate value-changed listeners

async function getGoDirect() {
    if (_godirect) return _godirect;
    const mod = await import('../godirect/godirect.module.js');
    _godirect = mod.default ?? mod;
    return _godirect;
}

/**
 * Shows the browser BLE device picker and opens the selected Go Direct sensor.
 * Must be called from a user gesture (button click).
 *
 * The vendored selectDevice(true) internally calls open(startMeasurements=true),
 * so the device is already streaming when this returns. Do NOT call device.start()
 * afterwards — attach the value-changed listener via startForceStream instead.
 *
 * Returns a connected Device handle, or throws on failure.
 */
export async function connectDynamometer() {
    if (window.simulating) {
        return { simulated: true };
    }
    const GoDirect = await getGoDirect();
    return GoDirect.selectDevice(true);
}

/**
 * Attaches a force callback to the already-streaming device.
 * If the device has not yet started (e.g. manually constructed), starts it first.
 * Only one callback is active at a time; call setForceCallback() to swap it
 * without restarting the stream.
 *
 * The simulated stream fires a sinusoidal pattern at ~20 Hz.
 *
 * @param {Object}   device    - From connectDynamometer()
 * @param {Function} callback  - Called with force in Newtons on each reading
 * @param {number}   [periodMs=10]
 */
export function startForceStream(device, callback, periodMs = 10) {
    _currentCallback = callback;
    if (device.simulated) {
        if (_simInterval) clearInterval(_simInterval);
        let t = 0;
        _simInterval = setInterval(() => {
            t += 50;
            const force = Math.max(0, 50 * Math.sin(t / 2000 * Math.PI));
            if (_currentCallback) _currentCallback(force);
        }, 50);
        return;
    }
    // selectDevice calls open(startMeasurements=true) internally, so the device
    // is already streaming when returned. Never call device.start() again: in the
    // vendored v1.8.3 SDK, open(true) invokes start() synchronously but the
    // device.collecting flag only becomes true after the asynchronous START
    // response, so checking it here races and may issue a duplicate command.
    // Attach the listener once — duplicate registration causes double callbacks.
    if (!_listenerAttached) {
        _listenerAttached = true;
        const sensor = device.sensors.find(s => s.enabled) ?? device.sensors[0];
        if (sensor) {
            sensor.on('value-changed', (s) => {
                if (_currentCallback) _currentCallback(s.value ?? 0);
            });
        }
    }
}

/**
 * Swaps the active force callback without restarting the stream.
 * Use between tasks (calibration → vigour) to re-route readings.
 * @param {Function|null} callback
 */
export function setForceCallback(callback) {
    _currentCallback = callback;
}

/**
 * Stops the force stream and disconnects the device.
 * device.close() already stops measurements, so device.stop() is redundant.
 * @param {Object} device
 */
export async function disconnectDynamometer(device) {
    _currentCallback = null;
    _listenerAttached = false;
    if (device.simulated) {
        clearInterval(_simInterval);
        _simInterval = null;
        return;
    }
    await device.close();
}

/**
 * Press detector state machine.
 *
 * A press fires onPress() when force is held at or above
 * (maxForce × thresholdFraction) continuously for holdDurationMs.
 * Force must then drop below the threshold before the next press starts,
 * so a single sustained squeeze counts only once.
 *
 * Call detector.update(forceN) on every force reading.
 * Call detector.reset() to clear state between trials.
 *
 * @param {number} maxForce - Calibrated maximum force in Newtons
 * @param {Object} opts
 * @param {number} [opts.thresholdFraction=0.75]
 * @param {number} [opts.holdDurationMs=40]
 * @param {Function} opts.onPress - Called each time a press completes
 * @returns {{ update(forceN: number): void, reset(): void }}
 */
export function createPressDetector(maxForce, { thresholdFraction = 0.75, holdDurationMs = 40, onPress } = {}) {
    const threshold = maxForce * thresholdFraction;
    let state = 'IDLE'; // IDLE | PRESSING | COOLDOWN
    let holdStart = null;

    return {
        update(forceN) {
            const now = performance.now();
            const above = forceN >= threshold;

            if (state === 'IDLE') {
                if (above) {
                    state = 'PRESSING';
                    holdStart = now;
                }
            } else if (state === 'PRESSING') {
                if (!above) {
                    state = 'IDLE';
                    holdStart = null;
                } else if (now - holdStart >= holdDurationMs) {
                    state = 'COOLDOWN';
                    holdStart = null;
                    if (onPress) onPress();
                }
            } else if (state === 'COOLDOWN') {
                if (!above) {
                    state = 'IDLE';
                }
            }
        },
        reset() {
            state = 'IDLE';
            holdStart = null;
        }
    };
}

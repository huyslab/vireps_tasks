// Vernier Go Direct Hand Dynamometer (GDX-HD) over Web Bluetooth.
// Requires @vernier/godirect vendored at core/godirect/godirect.module.js:
//   npm install @vernier/godirect
//   cp node_modules/@vernier/godirect/dist/godirect.module.js core/godirect/

let _godirect = null;
let _currentCallback = null;
let _simInterval = null;

async function getGoDirect() {
    if (_godirect) return _godirect;
    const mod = await import('../godirect/godirect.module.js');
    _godirect = mod.default ?? mod;
    return _godirect;
}

/**
 * Prompts the user to pair a Go Direct Hand Dynamometer over Bluetooth.
 * Must be called from a user gesture (button click).
 * Returns a connected device handle, or throws on failure.
 */
export async function connectDynamometer() {
    if (window.simulating) {
        return { simulated: true };
    }
    const GoDirect = await getGoDirect();
    const device = await GoDirect.createDevice(GoDirect.TRANSPORT.WEB_BLE);
    await device.open();
    const sensor = device.sensors.find(s => s.number === 1) ?? device.sensors[0];
    await device.enableSensors([sensor]);
    return device;
}

/**
 * Starts streaming force values. Only one callback is active at a time —
 * use setForceCallback() to swap it without restarting the stream.
 * The simulated stream fires a sinusoidal pattern at 20 Hz.
 * @param {Object} device - From connectDynamometer()
 * @param {Function} callback - Called with force in Newtons on each reading
 */
export function startForceStream(device, callback) {
    _currentCallback = callback;
    if (device.simulated) {
        let t = 0;
        _simInterval = setInterval(() => {
            t += 50;
            const force = Math.max(0, 50 * Math.sin(t / 2000 * Math.PI));
            if (_currentCallback) _currentCallback(force);
        }, 50);
        return;
    }
    const sensor = device.sensors.find(s => s.number === 1) ?? device.sensors[0];
    sensor.on('value-changed', () => {
        if (_currentCallback) _currentCallback(sensor.value ?? 0);
    });
    device.start(10); // ~100 Hz
}

/**
 * Swaps the active force callback without restarting the stream.
 * Use this to re-route readings between tasks (e.g. calibration → vigour).
 * @param {Function|null} callback
 */
export function setForceCallback(callback) {
    _currentCallback = callback;
}

/**
 * Stops the force stream and disconnects the device.
 * @param {Object} device
 */
export async function disconnectDynamometer(device) {
    _currentCallback = null;
    if (device.simulated) {
        clearInterval(_simInterval);
        _simInterval = null;
        return;
    }
    await device.stop();
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
 * @param {number} [opts.holdDurationMs=700]
 * @param {Function} opts.onPress - Called each time a press completes
 * @returns {{ update(forceN: number): void, reset(): void }}
 */
export function createPressDetector(maxForce, { thresholdFraction = 0.75, holdDurationMs = 700, onPress } = {}) {
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

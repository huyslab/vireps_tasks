// Vernier Go Direct Hand Dynamometer (GDX-HD) over Web Bluetooth.
// Requires @vernier/godirect vendored at core/godirect/godirect.module.js:
//   npm install @vernier/godirect
//   cp node_modules/@vernier/godirect/dist/godirect.min.esm.js core/godirect/godirect.module.js
//
// API surface used from v1.8.3:
//   GoDirect.createDevice(adapter, options) — opens our race-free Web Bluetooth
//     adapter without starting measurements, returning a Device
//   device.start(periodMs)       — starts measurements at the requested period
//   device.stop()                — stops streaming (also done by close())
//   device.close()               — stops streaming AND disconnects; stop() alone is redundant
//   sensor.on('value-changed', (sensor) => …)  — fires on each new reading
//   sensor.value                 — current reading (Newtons for GDX-HD)

let _godirect      = null;
let _currentCallback = null;
let _simInterval   = null;
let _listenerAttached = false; // guard against registering duplicate value-changed listeners
let _streamStartRequested = false; // guard against racing the SDK's asynchronous start()
let _connectionGeneration = 0; // invalidates a picker/open operation when its task is skipped

const GDX_SERVICE = 'd91714ef-28b9-4f91-ba16-f0d9a604f112';
const GDX_COMMAND_CHARACTERISTIC = 'f4bf14a6-c7d5-4b6d-8aa8-df1a7c83adcb';
const GDX_RESPONSE_CHARACTERISTIC = 'b41e6675-a329-40e0-aa01-44d2f444babe';
// The GDX-HD force channel supports at most 10 samples per second.
const DYNAMOMETER_MIN_PERIOD_MS = 100;

function resetForceStreamState() {
    _currentCallback = null;
    _listenerAttached = false;
    _streamStartRequested = false;
}

function connectionCancelledError() {
    return new DOMException('Dynamometer connection cancelled.', 'AbortError');
}

/**
 * Invalidates any in-flight Bluetooth picker/open operation. A native picker cannot be
 * programmatically closed, but its eventual result is discarded before it can start a
 * stream or finish whichever jsPsych trial happens to be active by then.
 */
export function cancelPendingDynamometerConnection() {
    _connectionGeneration += 1;
}

/**
 * Web Bluetooth adapter for the Go Direct SDK.
 *
 * The adapter bundled with @vernier/godirect 1.8.3 calls startNotifications()
 * without awaiting it. Device.open() can consequently send the INIT command
 * before Chrome has enabled response notifications; the sensor replies, the
 * browser drops that reply, and the SDK reports a command 0x1a timeout five
 * seconds later. Awaiting notification setup closes that race.
 *
 * This deliberately implements the small adapter interface accepted by
 * GoDirect.createDevice() rather than modifying the vendored SDK bundle.
 */
class DynamometerBluetoothAdapter {
    constructor(device) {
        this.webBluetoothNativeDevice = device;
        this.maxPacketLength = 20;
        this.deviceCommand = null;
        this.deviceResponse = null;
        this.closedListener = null;
        this.responseListener = null;
    }

    get godirectAdapter() {
        return true;
    }

    async writeCommand(commandBuffer) {
        return this.deviceCommand.writeValue(commandBuffer);
    }

    async setup({ onClosed, onResponse }) {
        const nativeDevice = this.webBluetoothNativeDevice;
        this.closedListener = () => {
            try {
                // Preserve the Go Direct Device lifecycle: this sets opened=false
                // and emits device-closed on both expected and unexpected drops.
                onClosed();
            } finally {
                this.removeResponseListener();
                this.removeClosedListener();
            }
        };
        nativeDevice.addEventListener('gattserverdisconnected', this.closedListener);

        try {
            const server = await nativeDevice.gatt.connect();
            const service = await server.getPrimaryService(GDX_SERVICE);
            const characteristics = await service.getCharacteristics();

            this.deviceCommand = characteristics.find(
                characteristic => characteristic.uuid === GDX_COMMAND_CHARACTERISTIC
            );
            this.deviceResponse = characteristics.find(
                characteristic => characteristic.uuid === GDX_RESPONSE_CHARACTERISTIC
            );

            if (!(this.deviceCommand && this.deviceResponse)) {
                throw new Error('Expected command and response characteristics not found');
            }

            this.responseListener = event => {
                onResponse(event.target.value);
            };
            this.deviceResponse.addEventListener('characteristicvaluechanged', this.responseListener);

            // Do not allow Device.open() to send INIT until replies can be received.
            await this.deviceResponse.startNotifications();
        } catch (error) {
            // The upstream adapter leaves GATT connected when setup/open fails,
            // which can make every subsequent retry fail until the sensor is power-cycled.
            this.cleanupAfterFailedOpen();
            throw error;
        }
    }

    removeResponseListener() {
        if (this.responseListener) {
            this.deviceResponse?.removeEventListener?.('characteristicvaluechanged', this.responseListener);
            this.responseListener = null;
        }
    }

    removeClosedListener() {
        if (this.closedListener) {
            this.webBluetoothNativeDevice.removeEventListener?.(
                'gattserverdisconnected',
                this.closedListener
            );
            this.closedListener = null;
        }
    }

    cleanupAfterFailedOpen() {
        // An SDK Device that never finished opening must not receive a synthetic
        // device-closed event. Remove its callbacks before releasing GATT.
        this.removeResponseListener();
        this.removeClosedListener();
        try {
            if (this.webBluetoothNativeDevice.gatt.connected) {
                this.webBluetoothNativeDevice.gatt.disconnect();
            }
        } catch (cleanupError) {
            // Keep the original setup/protocol error for the participant-facing UI.
            console.warn('Could not clean up failed dynamometer connection:', cleanupError);
        }
    }

    async close() {
        this.removeResponseListener();
        if (this.webBluetoothNativeDevice.gatt.connected) {
            // Keep closedListener attached until the browser's disconnect event
            // lets the SDK update Device.opened and emit device-closed.
            this.webBluetoothNativeDevice.gatt.disconnect();
        } else {
            this.removeClosedListener();
        }
    }
}

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
 * The device is opened without starting measurements. startForceStream() then
 * attaches the value listener before starting once at the requested period.
 *
 * Returns a connected Device handle, or throws on failure.
 */
export async function connectDynamometer() {
    if (window.simulating) {
        return { simulated: true };
    }
    if (!navigator.bluetooth) {
        throw new Error('No Web Bluetooth support. Please use Chrome or Edge on a Bluetooth-enabled device.');
    }

    const connectionGeneration = _connectionGeneration;
    const GoDirect = await getGoDirect();
    if (connectionGeneration !== _connectionGeneration) {
        throw connectionCancelledError();
    }

    const nativeDevice = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'GDX' }],
        optionalServices: [GDX_SERVICE]
    });
    if (connectionGeneration !== _connectionGeneration) {
        throw connectionCancelledError();
    }

    const adapter = new DynamometerBluetoothAdapter(nativeDevice);
    try {
        const device = await GoDirect.createDevice(adapter, { open: true, startMeasurements: false });
        if (connectionGeneration !== _connectionGeneration) {
            try { await device.close(); } catch (_) {}
            throw connectionCancelledError();
        }
        // The SDK marks `opened` false when GATT drops. Clear both our stream
        // guards and the shared handle so the next task offers reconnection
        // instead of trying to use a dead object.
        device.on('device-closed', () => {
            resetForceStreamState();
            if (window.dynamometerSensor === device) window.dynamometerSensor = null;
        });
        return device;
    } catch (error) {
        // createDevice does not close its adapter when protocol initialization
        // fails (including an INIT timeout), so release GATT before allowing retry.
        adapter.cleanupAfterFailedOpen();
        throw error;
    }
}

/**
 * Returns whether a retained device handle still represents a live connection.
 * Real Go Direct devices expose `opened`; the GATT check covers compatible
 * adapters, while simple test doubles without either signal remain usable.
 */
export function isDynamometerConnected(device) {
    if (!device) return false;
    if (device.simulated) return true;
    if (device.opened === false) return false;
    const gattConnected = device.device?.webBluetoothNativeDevice?.gatt?.connected;
    if (gattConnected === false) return false;
    return true;
}

/**
 * Attaches a force callback, then starts the device once at the requested rate.
 * Only one callback is active at a time; call setForceCallback() to swap it
 * without restarting the stream.
 *
 * The simulated stream fires a sinusoidal pattern at ~20 Hz.
 *
 * @param {Object}   device    - From connectDynamometer()
 * @param {Function} callback  - Called with force in Newtons on each reading
 * @param {number}   [periodMs=100] - Sampling period (the GDX-HD minimum is 100 ms)
 */
export function startForceStream(device, callback, periodMs = DYNAMOMETER_MIN_PERIOD_MS) {
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

    // Device.start() launches an asynchronous SDK command sequence but returns
    // immediately. Track that we requested it instead of checking collecting,
    // which remains false until the START response and previously allowed a
    // duplicate command race.
    if (!_streamStartRequested) {
        _streamStartRequested = true;
        const parsedPeriodMs = Number(periodMs);
        const safePeriodMs = Number.isFinite(parsedPeriodMs)
            ? Math.max(DYNAMOMETER_MIN_PERIOD_MS, parsedPeriodMs)
            : DYNAMOMETER_MIN_PERIOD_MS;
        device.start(safePeriodMs);
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
    resetForceStreamState();
    if (device.simulated) {
        clearInterval(_simInterval);
        _simInterval = null;
        return;
    }
    await device.close();
}

// Fast squeezing rarely gets back to rest, so the force trace looks like a wave
// riding above zero. A squeeze counts as over once force has dipped this fraction
// of its height below its peak, and the next one as started once force has risen
// the same fraction of the previous squeeze's height above the dip between them.
// Both changes must also be at least SQUEEZE_MIN_CHANGE_N, so sensor noise and
// small wobbles at the top or bottom of a squeeze are not counted.
export const SQUEEZE_PROMINENCE_FRACTION = 0.25;
export const SQUEEZE_MIN_CHANGE_N = 1.0;
// Force within this of the trough counts as the grip being let go.
export const SQUEEZE_REST_N = 0.5;

/**
 * Detects discrete squeezes in the force trace. Every grip task counts squeezes
 * with this one rule: the quick-squeeze speed test, the maximum-strength test,
 * and the grip vigour and PIT games (through listenForSqueezes).
 *
 * The lowest force since the last squeeze is the trough. A squeeze starts once
 * force rises SQUEEZE_MIN_CHANGE_N above it (or SQUEEZE_PROMINENCE_FRACTION of
 * the previous squeeze's height, if larger). There is no minimum strength, and a
 * grip that rests slightly above zero (sensor drift, a hand resting on it) still
 * works. A squeeze already held when tracking starts only sets a high trough,
 * so it is not counted unless force then rises clearly above it.
 *
 * - `fullRelease: false` (default, quick squeezes): a squeeze ends at the dip
 *   after its peak - once force falls SQUEEZE_PROMINENCE_FRACTION of the
 *   squeeze's height below the peak (at least SQUEEZE_MIN_CHANGE_N) - or when
 *   the grip is let go. The bottom of that dip is the next squeeze's trough.
 * - `fullRelease: true` (maximum strength): a squeeze ends only once force is
 *   back within SQUEEZE_REST_N of the trough, i.e. the grip was let go.
 *
 * `triggerN` is the force the trace must next cross: above it to start a
 * squeeze, or below it to end the current one (null before the first reading).
 */
export function createSqueezeTracker({ onStart = () => {}, onRelease = () => {}, fullRelease = false } = {}) {
    let trough = Infinity;
    let startTrough = 0;
    let lastHeight = 0;
    let squeezing = false;
    let peak = 0;
    let count = 0;

    const prominence = height => Math.max(SQUEEZE_MIN_CHANGE_N, SQUEEZE_PROMINENCE_FRACTION * height);
    const startLevel = () => trough + (fullRelease ? SQUEEZE_MIN_CHANGE_N : prominence(lastHeight));
    const endLevel = () => fullRelease
        ? startTrough + SQUEEZE_REST_N
        : Math.max(startTrough + SQUEEZE_REST_N, peak - prominence(peak - startTrough));

    return {
        update(forceN) {
            const force = Math.max(0, Number(forceN) || 0);
            if (!squeezing) {
                trough = Math.min(trough, force);
                if (force > startLevel()) {
                    squeezing = true;
                    startTrough = trough;
                    peak = force;
                    count += 1;
                    onStart(force);
                }
                return;
            }
            peak = Math.max(peak, force);
            if (force <= endLevel()) {
                squeezing = false;
                lastHeight = peak - startTrough;
                trough = force;
                onRelease(peak);
            }
        },
        get squeezing() { return squeezing; },
        get count() { return count; },
        get triggerN() {
            if (squeezing) return endLevel();
            return Number.isFinite(trough) ? startLevel() : null;
        }
    };
}

/**
 * Routes the live force stream into a squeeze tracker for the grip games: one
 * press per squeeze, counted the moment the squeeze starts. `onForce(forceN,
 * tracker)` sees every reading after the tracker has, e.g. to draw the debug graph.
 *
 * @param {Function} onSqueeze - Called once at the start of each squeeze
 * @param {Object} [opts]
 * @param {Function} [opts.onForce]
 * @returns {Function} stop - Detaches from the force stream
 */
export function listenForSqueezes(onSqueeze, { onForce } = {}) {
    const tracker = createSqueezeTracker({ onStart: () => onSqueeze() });
    setForceCallback(forceN => {
        tracker.update(forceN);
        if (onForce) onForce(forceN, tracker);
    });
    return () => setForceCallback(() => {});
}

/**
 * Disconnects the shared grip handle unless the task was told to keep it
 * (`disconnectOnFinish: false`) for the grip task that follows.
 */
export function releaseGrip(settings = {}) {
    if (settings.disconnectOnFinish === false || !window.dynamometerSensor) return;
    const sensor = window.dynamometerSensor;
    window.dynamometerSensor = null;
    disconnectDynamometer(sensor).catch(() => {});
}

/** Shared onDemoSkip clean-up for grip tasks. */
export function cleanUpGripTask(settings = {}) {
    cancelPendingDynamometerConnection();
    setForceCallback(() => {});
    releaseGrip(settings);
}

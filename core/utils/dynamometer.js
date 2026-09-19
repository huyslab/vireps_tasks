// Vernier Go Direct Hand Dynamometer (GDX-HD) over Web Bluetooth.
// Requires @vernier/godirect vendored at core/godirect/godirect.module.js:
//   npm install @vernier/godirect
//   cp node_modules/@vernier/godirect/dist/godirect.min.esm.js core/godirect/godirect.module.js
//
// API surface used from v1.8.3:
//   GoDirect.createDevice(adapter, options) — opens our race-free Web Bluetooth
//     adapter and starts measurements, returning a Device
//   device.stop()                — stops streaming (also done by close())
//   device.close()               — stops streaming AND disconnects; stop() alone is redundant
//   sensor.on('value-changed', (sensor) => …)  — fires on each new reading
//   sensor.value                 — current reading (Newtons for GDX-HD)

let _godirect      = null;
let _currentCallback = null;
let _simInterval   = null;
let _listenerAttached = false; // guard against registering duplicate value-changed listeners
let _streamStartRequested = false; // guard against racing the SDK's asynchronous start()

const GDX_SERVICE = 'd91714ef-28b9-4f91-ba16-f0d9a604f112';
const GDX_COMMAND_CHARACTERISTIC = 'f4bf14a6-c7d5-4b6d-8aa8-df1a7c83adcb';
const GDX_RESPONSE_CHARACTERISTIC = 'b41e6675-a329-40e0-aa01-44d2f444babe';
// The GDX-HD force channel supports at most 10 samples per second.
const DYNAMOMETER_MIN_PERIOD_MS = 100;

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

    const GoDirect = await getGoDirect();
    const nativeDevice = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'GDX' }],
        optionalServices: [GDX_SERVICE]
    });
    const adapter = new DynamometerBluetoothAdapter(nativeDevice);
    try {
        return await GoDirect.createDevice(adapter, { open: true, startMeasurements: false });
    } catch (error) {
        // createDevice does not close its adapter when protocol initialization
        // fails (including an INIT timeout), so release GATT before allowing retry.
        adapter.cleanupAfterFailedOpen();
        throw error;
    }
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
    _currentCallback = null;
    _listenerAttached = false;
    _streamStartRequested = false;
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
    const parsedHoldDuration = Number(holdDurationMs);
    const requiredHoldMs = Number.isFinite(parsedHoldDuration)
        ? Math.max(0, parsedHoldDuration)
        : 40;
    let state = 'IDLE'; // IDLE | PRESSING | COOLDOWN
    let holdTimer = null;

    function cancelHold() {
        if (holdTimer !== null) {
            clearTimeout(holdTimer);
            holdTimer = null;
        }
    }

    function completePress() {
        if (state !== 'PRESSING') return;
        state = 'COOLDOWN';
        holdTimer = null;
        if (onPress) onPress();
    }

    return {
        update(forceN) {
            const above = forceN >= threshold;

            if (state === 'IDLE') {
                if (above) {
                    state = 'PRESSING';
                    if (requiredHoldMs === 0) {
                        completePress();
                    } else {
                        // Go Direct can batch several measurements into one Bluetooth
                        // notification. Using arrival timestamps therefore makes a
                        // millisecond hold depend on the next packet. A real timer makes
                        // the configured duration independent of notification batching.
                        holdTimer = setTimeout(completePress, requiredHoldMs);
                    }
                }
            } else if (state === 'PRESSING') {
                if (!above) {
                    cancelHold();
                    state = 'IDLE';
                }
            } else if (state === 'COOLDOWN') {
                if (!above) {
                    state = 'IDLE';
                }
            }
        },
        reset() {
            cancelHold();
            state = 'IDLE';
        }
    };
}

import { expect, test } from '@playwright/test';

test('dynamometer waits for Bluetooth notifications before sending INIT', async ({ page }) => {
  await page.goto('/index.html');

  const result = await page.evaluate(async () => {
    const SERVICE = 'd91714ef-28b9-4f91-ba16-f0d9a604f112';
    const COMMAND = 'f4bf14a6-c7d5-4b6d-8aa8-df1a7c83adcb';
    const RESPONSE = 'b41e6675-a329-40e0-aa01-44d2f444babe';

    let notificationsReady = false;
    let responseListener = null;
    let disconnectedListener = null;
    let writesBeforeNotifications = 0;
    let disconnectCount = 0;
    let pendingCommand = [];

    const responseCharacteristic = {
      uuid: RESPONSE,
      addEventListener(type, listener) {
        if (type === 'characteristicvaluechanged') responseListener = listener;
      },
      removeEventListener(type, listener) {
        if (type === 'characteristicvaluechanged' && responseListener === listener) {
          responseListener = null;
        }
      },
      async startNotifications() {
        // Make the race deterministic. The old Vernier adapter returns from setup()
        // immediately and sends INIT during this delay.
        await new Promise(resolve => setTimeout(resolve, 75));
        notificationsReady = true;
        return this;
      },
    };

    const commandCharacteristic = {
      uuid: COMMAND,
      async writeValue(chunk) {
        if (!notificationsReady) {
          writesBeforeNotifications += 1;
          return;
        }

        pendingCommand.push(...chunk);
        const commandLength = pendingCommand[1];
        if (!commandLength || pendingCommand.length < commandLength) return;

        const command = pendingCommand[4];
        const rollingCounter = pendingCommand[2];
        pendingCommand = [];

        // A zero-filled response is sufficient for the mocked device discovery.
        // It reports no available sensors, while acknowledging every SDK command.
        const response = new Uint8Array(156);
        response[1] = response.length;
        response[4] = command;
        response[5] = rollingCounter;
        queueMicrotask(() => responseListener({
          target: { value: new DataView(response.buffer) },
        }));
      },
    };

    const service = {
      async getCharacteristics() {
        return [commandCharacteristic, responseCharacteristic];
      },
    };
    const server = {
      async getPrimaryService(uuid) {
        if (uuid !== SERVICE) throw new Error(`Unexpected service ${uuid}`);
        return service;
      },
    };
    const nativeDevice = {
      addEventListener(type, listener) {
        if (type === 'gattserverdisconnected') disconnectedListener = listener;
      },
      removeEventListener(type, listener) {
        if (type === 'gattserverdisconnected' && disconnectedListener === listener) {
          disconnectedListener = null;
        }
      },
      gatt: {
        connected: false,
        async connect() {
          this.connected = true;
          return server;
        },
        disconnect() {
          this.connected = false;
          disconnectCount += 1;
          disconnectedListener?.();
        },
      },
    };

    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: {
        async requestDevice() {
          return nativeDevice;
        },
      },
    });
    window.simulating = false;

    const { connectDynamometer, disconnectDynamometer } = await import('/core/utils/dynamometer.js');
    const device = await connectDynamometer();
    const openedBeforeDisconnect = device.opened;
    let deviceClosedEvents = 0;
    device.on('device-closed', () => { deviceClosedEvents += 1; });
    await disconnectDynamometer(device);

    return {
      writesBeforeNotifications,
      disconnectCount,
      openedBeforeDisconnect,
      openedAfterDisconnect: device.opened,
      deviceClosedEvents,
    };
  });

  expect(result.writesBeforeNotifications).toBe(0);
  expect(result.disconnectCount).toBe(1);
  expect(result.openedBeforeDisconnect).toBe(true);
  expect(result.openedAfterDisconnect).toBe(false);
  expect(result.deviceClosedEvents).toBe(1);
});

test('dynamometer preserves the setup error when failed-open cleanup also errors', async ({ page }) => {
  await page.goto('/index.html');

  const result = await page.evaluate(async () => {
    const COMMAND = 'f4bf14a6-c7d5-4b6d-8aa8-df1a7c83adcb';
    const RESPONSE = 'b41e6675-a329-40e0-aa01-44d2f444babe';
    let disconnectCount = 0;

    const nativeDevice = {
      addEventListener() {},
      gatt: {
        connected: false,
        async connect() {
          this.connected = true;
          return {
            async getPrimaryService() {
              return {
                async getCharacteristics() {
                  return [
                    { uuid: COMMAND, async writeValue() {} },
                    {
                      uuid: RESPONSE,
                      addEventListener() {},
                      async startNotifications() {
                        throw new Error('notification setup failed');
                      },
                    },
                  ];
                },
              };
            },
          };
        },
        disconnect() {
          this.connected = false;
          disconnectCount += 1;
          throw new Error('disconnect cleanup failed');
        },
      },
    };

    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: { requestDevice: async () => nativeDevice },
    });
    window.simulating = false;

    const { connectDynamometer } = await import('/core/utils/dynamometer.js');
    let message = '';
    try {
      await connectDynamometer();
    } catch (error) {
      message = error.message;
    }

    return { disconnectCount, message };
  });

  expect(result.disconnectCount).toBe(1);
  expect(result.message).toContain('notification setup failed');
});

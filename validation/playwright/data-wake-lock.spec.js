import { expect, test } from '@playwright/test';

test('screen wake lock is held during a module and reacquired after returning to the app', async ({ page }) => {
  await page.goto('/index.html');

  const result = await page.evaluate(async () => {
    const sentinels = [];
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        async request(type) {
          const sentinel = new EventTarget();
          sentinel.type = type;
          sentinel.released = false;
          sentinel.release = async () => {
            if (sentinel.released) return;
            sentinel.released = true;
            sentinel.dispatchEvent(new Event('release'));
          };
          sentinels.push(sentinel);
          return sentinel;
        }
      }
    });

    const { startScreenWakeLock, stopScreenWakeLock } = await import('/core/utils/wake-lock.js');
    const acquired = await startScreenWakeLock();
    await sentinels[0].release();
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(resolve => setTimeout(resolve, 0));
    await stopScreenWakeLock();

    return {
      acquired,
      requestTypes: sentinels.map(sentinel => sentinel.type),
      released: sentinels.map(sentinel => sentinel.released)
    };
  });

  expect(result).toEqual({
    acquired: true,
    requestTypes: ['screen', 'screen'],
    released: [true, true]
  });
});

test('unsupported wake lock does not prevent the experiment from continuing', async ({ page }) => {
  await page.goto('/index.html');

  const acquired = await page.evaluate(async () => {
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: undefined
    });
    const { startScreenWakeLock, stopScreenWakeLock } = await import('/core/utils/wake-lock.js');
    const result = await startScreenWakeLock();
    await stopScreenWakeLock();
    return result;
  });

  expect(acquired).toBe(false);
});

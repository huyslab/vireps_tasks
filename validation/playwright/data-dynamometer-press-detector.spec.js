import { expect, test } from '@playwright/test';

async function openTimelineHarness(page) {
  await page.goto('/experiment.html?participant_id=invalid%20participant');
}

test('zero hold duration responds immediately on each upward threshold crossing', async ({ page }) => {
  await openTimelineHarness(page);

  const result = await page.evaluate(async () => {
    const { createPressDetector } = await import('/core/utils/dynamometer.js');
    let presses = 0;
    const detector = createPressDetector(100, {
      thresholdFraction: 0.5,
      holdDurationMs: 0,
      onPress: () => { presses += 1; },
    });

    detector.update(60);
    const afterCrossing = presses;
    detector.update(70);
    const whileStillAbove = presses;
    detector.update(40);
    detector.update(60);

    return { afterCrossing, whileStillAbove, afterSecondCrossing: presses };
  });

  expect(result.afterCrossing).toBe(1);
  expect(result.whileStillAbove).toBe(1);
  expect(result.afterSecondCrossing).toBe(2);
});

test('press hold duration uses a wall-clock timer rather than waiting for another sample', async ({ page }) => {
  await openTimelineHarness(page);

  const result = await page.evaluate(async () => {
    const { createPressDetector } = await import('/core/utils/dynamometer.js');
    let presses = 0;
    let pressElapsedMs = null;
    const startedAt = performance.now();
    const detector = createPressDetector(100, {
      thresholdFraction: 0.5,
      holdDurationMs: 50,
      onPress: () => {
        presses += 1;
        pressElapsedMs = performance.now() - startedAt;
      },
    });

    // Only one above-threshold sample is delivered. The timer should complete
    // the press without requiring a later Bluetooth notification.
    detector.update(60);
    await new Promise(resolve => setTimeout(resolve, 25));
    const pressesBeforeHold = presses;
    await new Promise(resolve => setTimeout(resolve, 50));
    detector.reset();

    return { pressesBeforeHold, presses, pressElapsedMs };
  });

  expect(result.pressesBeforeHold).toBe(0);
  expect(result.presses).toBe(1);
  expect(result.pressElapsedMs).toBeGreaterThanOrEqual(40);
  expect(result.pressElapsedMs).toBeLessThan(100);
});

test('dropping below target or resetting cancels a pending press', async ({ page }) => {
  await openTimelineHarness(page);

  const result = await page.evaluate(async () => {
    const { createPressDetector } = await import('/core/utils/dynamometer.js');
    let presses = 0;
    const detector = createPressDetector(100, {
      thresholdFraction: 0.5,
      holdDurationMs: 50,
      onPress: () => { presses += 1; },
    });

    detector.update(60);
    await new Promise(resolve => setTimeout(resolve, 20));
    detector.update(40);
    await new Promise(resolve => setTimeout(resolve, 50));
    const afterRelease = presses;

    detector.update(60);
    await new Promise(resolve => setTimeout(resolve, 20));
    detector.reset();
    await new Promise(resolve => setTimeout(resolve, 50));

    return { afterRelease, afterReset: presses };
  });

  expect(result.afterRelease).toBe(0);
  expect(result.afterReset).toBe(0);
});

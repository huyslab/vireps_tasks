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

test('fast squeezes that never drop below the target still count once each', async ({ page }) => {
  await openTimelineHarness(page);

  const result = await page.evaluate(async () => {
    const { createPressDetector } = await import('/core/utils/dynamometer.js');
    const count = trace => {
      let presses = 0;
      const detector = createPressDetector(100, {
        thresholdFraction: 0.5,
        holdDurationMs: 0,
        onPress: () => { presses += 1; },
      });
      trace.forEach(force => detector.update(force));
      return presses;
    };
    // Four squeezes peaking at 90 N; after the first, the grip only dips to 55-60 N,
    // above the 50 N target.
    const lows = [0, 55, 60, 55, 0];
    const fast = [0];
    for (let squeeze = 0; squeeze < 4; squeeze++) {
      const [from, to] = [lows[squeeze], lows[squeeze + 1]];
      for (let step = 1; step <= 12; step++) {
        const phase = Math.PI * step / 12;
        fast.push(step <= 6 ? from + (90 - from) * Math.sin(phase) : to + (90 - to) * Math.sin(phase));
      }
    }
    return {
      fast: count(fast),
      // One sustained squeeze wobbling a few newtons at the top.
      sustained: count([0, 60, 80, 76, 80, 78, 81, 77, 80, 0]),
      // A small dip mid-squeeze that rises only slightly again.
      smallDip: count([0, 60, 80, 62, 66, 64, 0]),
    };
  });

  expect(result.fast).toBe(4);
  expect(result.sustained).toBe(1);
  expect(result.smallDip).toBe(1);
});

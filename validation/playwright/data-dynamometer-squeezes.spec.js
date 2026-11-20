import { expect, test } from '@playwright/test';

async function openTimelineHarness(page) {
  await page.goto('/experiment.html?participant_id=invalid%20participant');
}

// Builds a squeeze trace that rises from each dip to `peak` and falls to the next dip.
const WAVE_SOURCE = `(lows, peak) => {
  const trace = [lows[0]];
  for (let squeeze = 0; squeeze < lows.length - 1; squeeze++) {
    const [from, to] = [lows[squeeze], lows[squeeze + 1]];
    for (let step = 1; step <= 12; step++) {
      const level = step <= 6 ? from : to;
      trace.push(level + (peak - level) * Math.sin(Math.PI * step / 12));
    }
  }
  return trace;
}`;

test('one squeeze rule: counts at the start of each squeeze, with no strength target', async ({ page }) => {
  await openTimelineHarness(page);

  const result = await page.evaluate(async (waveSource) => {
    const { createSqueezeTracker } = await import('/core/utils/dynamometer.js');
    const wave = eval(waveSource);
    const count = (trace, options = {}) => {
      const peaks = [];
      const tracker = createSqueezeTracker({ ...options, onRelease: peak => peaks.push(peak) });
      trace.forEach(force => tracker.update(force));
      return { starts: tracker.count, peaks: peaks.map(Math.round) };
    };
    // After the first squeeze the grip only dips to 8-10 N - never back near zero.
    const fast = wave([0, 8, 10, 8, 10, 0], 30);
    return {
      light: count([0, 3, 5, 0, 2.5, 0]),
      held: count([0, 60, 80, 76, 80, 78, 81, 77, 80, 0]),
      smallDip: count([0, 60, 80, 62, 66, 64, 0]),
      alreadySqueezing: count([60, 60.5, 59.8, 60.3, 59.9]),
      restingAboveZero: count([0.8, 20, 40, 15, 0.9, 25, 30, 0.8]),
      fast: count(fast),
      fastFullRelease: count(fast, { fullRelease: true }),
    };
  }, WAVE_SOURCE);

  expect(result.light.starts).toBe(2);              // light squeezes count
  expect(result.held.starts).toBe(1);               // wobbles at the top do not
  expect(result.smallDip.starts).toBe(1);           // nor a small dip mid-squeeze
  expect(result.alreadySqueezing.starts).toBe(0);   // nor a squeeze already held when tracking starts
  expect(result.restingAboveZero.starts).toBe(2);   // a drifting baseline still works
  expect(result.fast.starts).toBe(5);               // each wave counts without letting go
  expect(result.fast.peaks).toEqual([30, 30, 30, 30, 30]);
  expect(result.fastFullRelease.starts).toBe(1);    // maximum strength needs a full release
});

test('grip games take their presses from the force stream with the same rule', async ({ page }) => {
  await openTimelineHarness(page);

  const result = await page.evaluate(async (waveSource) => {
    const { createSqueezeTracker, listenForSqueezes, startForceStream, disconnectDynamometer } =
      await import('/core/utils/dynamometer.js');
    const wave = eval(waveSource);
    let emit;
    const sensor = {
      enabled: true,
      value: 0,
      on: (_event, handler) => { emit = force => { sensor.value = force; handler(sensor); }; },
    };
    const device = { sensors: [sensor], start: () => {}, close: async () => {} };
    startForceStream(device, () => {});

    const trace = wave([0, 55, 60, 55, 0], 90);
    let presses = 0;
    let lastTrackerCount = null;
    const stop = listenForSqueezes(() => { presses += 1; }, {
      onForce: (_force, tracker) => { lastTrackerCount = tracker.count; },
    });
    trace.forEach(emit);
    stop();
    emit(0); emit(90); emit(0);             // ignored once stopped

    const reference = createSqueezeTracker();
    trace.forEach(force => reference.update(force));
    await disconnectDynamometer(device);
    return { presses, lastTrackerCount, reference: reference.count };
  }, WAVE_SOURCE);

  expect(result.presses).toBe(4);
  expect(result.presses).toBe(result.reference);
  expect(result.lastTrackerCount).toBe(4);
});

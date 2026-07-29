import { expect, test } from '@playwright/test';

/**
 * The final practice interleaves all four training faces before the task proper.
 *
 * Checked here rather than in the journey because it needs a full simulate run to
 * completion, which the journey deliberately does not do. Simulate answers every
 * practice trial correctly, so this exercises the pass-first-time path. The loop,
 * its safety cap and the per-block order rotation were verified separately by
 * temporarily raising the criterion: 3 per face -> 2 blocks; unreachable -> stops
 * at the 4-block cap having used all four orders, each exactly once.
 */
test('final practice runs whole blocks of 8 with all four faces', async ({ page }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/examples/go-no-go.html?participant_id=simulate_practice');

  // Wait until the task proper has started, i.e. practice is finished.
  await expect
    .poll(
      async () =>
        page.evaluate(
          () => window.jsPsych?.data?.get()?.filter({ trialphase: 'go_no_go', block: 1 })?.count() ?? 0
        ),
      { timeout: 120000, intervals: [500] }
    )
    .toBeGreaterThan(0);

  const trials = await page.evaluate(() =>
    window.jsPsych.data.get().filter({ trialphase: 'go_no_go_training', practice_stage: 'combined' }).values()
  );

  expect(trials.length, 'final practice runs in whole blocks of 8').toBeGreaterThan(0);
  expect(trials.length % 8, 'final practice runs in whole blocks of 8').toBe(0);

  const firstBlock = trials.slice(0, 8).map((t) => t.practice_item);
  expect(new Set(firstBlock).size, 'a block contains all four faces').toBe(4);
  expect(
    firstBlock.some((item, i) => i > 0 && item === firstBlock[i - 1]),
    'no face repeats back to back within a block'
  ).toBe(false);

  const perItem = {};
  for (const t of trials) {
    perItem[t.practice_item] = perItem[t.practice_item] || { n: 0, correct: 0 };
    perItem[t.practice_item].n += 1;
    if (t.correct) perItem[t.practice_item].correct += 1;
  }
  expect(Object.keys(perItem).length, 'all four faces appear').toBe(4);
  for (const [item, counts] of Object.entries(perItem)) {
    expect(counts.n % 2, `${item} appears twice per block`).toBe(0);
    expect(counts.correct, `${item} reached the 2-correct criterion`).toBeGreaterThanOrEqual(2);
  }

  // Whichever block ran, its order must be one of the four defined ones, and each
  // must satisfy the constraints those orders were generated under.
  const ORDERS = [
    [0, 3, 2, 3, 1, 2, 0, 1],
    [2, 0, 3, 1, 0, 2, 1, 3],
    [1, 0, 2, 1, 3, 0, 2, 3],
    [0, 2, 1, 0, 2, 3, 1, 3],
  ].map((o) => o.join());
  const ids = ['press_win', 'wait_win', 'press_lose_less', 'wait_lose_less'];
  const seen = [];
  for (let i = 0; i < trials.length; i += 8) {
    const order = trials.slice(i, i + 8).map((t) => ids.indexOf(t.practice_item));
    expect(ORDERS, `block ${i / 8 + 1} uses a defined order`).toContain(order.join());
    expect(
      order.some((v, j) => j > 0 && v === order[j - 1]),
      'no face repeats back to back'
    ).toBe(false);
    expect(
      order.slice(0, 4).join() === order.slice(4).join(),
      'the second half of a block is not a repeat of the first'
    ).toBe(false);
    seen.push(order.join());
  }
  expect(new Set(seen).size, 'repeated blocks use different orders').toBe(seen.length);

  expect(errors).toEqual([]);
});

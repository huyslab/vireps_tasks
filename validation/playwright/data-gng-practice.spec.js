import { expect, test } from '@playwright/test';

/**
 * The final practice interleaves all four training faces before the task proper.
 *
 * Checked here rather than in the journey because it needs a full simulate run to
 * completion, which the journey deliberately does not do. Simulate answers every
 * practice trial correctly, so this exercises the pass-first-time path; the loop
 * and its safety cap were verified separately by temporarily raising the
 * criterion (3 per face -> 2 blocks; unreachable -> stops at the 4-block cap).
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

  expect(errors).toEqual([]);
});

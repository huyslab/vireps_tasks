import { expect, test } from '@playwright/test';

/**
 * The go/no-go presentation settings, checked against what actually renders.
 *
 * These four - signal_valence, feedback_tint, play_sounds and outcome_display -
 * are the switches that decide what a participant is told and when, so the
 * things worth pinning down are correspondences: the rim light must agree with
 * the trial's valence on EVERY trial (a light that drifted out of step would
 * teach the wrong contingency while looking perfectly fine), and the points
 * readout must equal the outcome that was actually recorded.
 *
 * Driven by real key presses rather than simulate mode: simulate tears trials
 * down on its own schedule, and these assertions have to read the DOM of a
 * specific trial and then match it to that trial's data row.
 */

const CUE = '#gng-stimulus';

/** Plays `n` go trials, returning what was on screen for each. */
async function walkTrials(page, n) {
  const seen = [];
  for (let i = 0; i < n; i++) {
    await page.waitForSelector(CUE, { state: 'visible', timeout: 20000 });
    seen.push(
      await page.evaluate(() => {
        const glow = document.querySelector('.gng-glow');
        return {
          glow: glow.classList.contains('gng-glow-win')
            ? 'win'
            : glow.classList.contains('gng-glow-avoid-loss')
              ? 'avoid_loss'
              : null,
          hasTint: !!document.querySelector('#gng-tint'),
        };
      })
    );
    // Well inside the 1800 ms window, so every trial resolves as a go.
    await page.keyboard.press('Space');
    // Past the resize into feedback, but before the coin is cleared.
    await page.waitForTimeout(700);
    Object.assign(seen[i], await page.evaluate(() => {
      const coin = document.querySelector('#gng-coin');
      const tint = document.querySelector('#gng-tint');
      return {
        outcomeText: coin.textContent,
        outcomeSrc: coin.getAttribute('src'),
        tintClass: tint ? [...tint.classList].find((c) => c.startsWith('gng-tint-')) ?? null : null,
      };
    }));
    // Wait for the row to be committed rather than for a fixed delay: the row
    // lands at the very end of the trial (resize + feedback + iti), so a timeout
    // tuned to look long enough still left the last trial unwritten when the
    // test went to read it.
    await expect
      .poll(
        () =>
          page.evaluate(
            () => window.jsPsych.data.get().filter({ trialphase: 'go_no_go' }).count()
          ),
        { timeout: 15000, intervals: [100] }
      )
      .toBe(i + 1);
  }
  return seen;
}

const trialData = (page) =>
  page.evaluate(() => window.jsPsych.data.get().filter({ trialphase: 'go_no_go' }).values());

test('rim light matches the trial valence, and no wash by default', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/examples/go-no-go.html?participant_id=demo&skip_instructions=1');

  const seen = await walkTrials(page, 8);
  const data = (await trialData(page)).slice(0, seen.length);
  expect(data.length, 'a data row per trial walked').toBe(seen.length);

  // The point of the whole feature: what is lit must be what is scored.
  expect(seen.map((s) => s.glow)).toEqual(data.map((d) => d.valence));
  expect(
    data.every((d) => d.valence_signalled === true),
    'every trial records that the domain was signalled'
  ).toBe(true);

  // Both domains have to occur, or the correspondence above is vacuous.
  expect(new Set(seen.map((s) => s.glow)), 'both domains appear').toEqual(
    new Set(['win', 'avoid_loss'])
  );

  expect(
    seen.every((s) => !s.hasTint),
    'the correctness wash is off by default - hue means the domain, and only that'
  ).toBe(true);
  expect(seen.every((s) => s.outcomeSrc), 'coins mode shows a coin image').toBe(true);
});

test('points mode shows the recorded value, and no coin image', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto(
    '/examples/go-no-go.html?participant_id=demo&skip_instructions=1&outcome_display=points'
  );

  const seen = await walkTrials(page, 4);
  const data = (await trialData(page)).slice(0, seen.length);

  expect(
    seen.map((s) => s.outcomeText),
    'the number on screen is the outcome that was scored, signed'
  ).toEqual(data.map((d) => `${d.outcome > 0 ? '+' : ''}${d.outcome}`));
  expect(seen.every((s) => !s.outcomeSrc), 'no coin image in points mode').toBe(true);
  // Sam's scheme: £1 -> 10, 1p -> 1, and the same negated.
  expect(
    data.every((d) => [10, 1, -1, -10].includes(d.outcome)),
    'outcomes are the four RobotFactory values'
  ).toBe(true);
});

test('the unsignalled configuration puts colour back on correctness', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto(
    '/examples/go-no-go.html?participant_id=demo&skip_instructions=1&signal_valence=0&feedback_tint=1'
  );

  const seen = await walkTrials(page, 3);
  const data = (await trialData(page)).slice(0, seen.length);

  expect(seen.every((s) => s.glow === null), 'no rim light when the domain is not signalled').toBe(
    true
  );
  expect(
    data.every((d) => d.valence_signalled === false),
    'and the data says so, so the two configurations are told apart in analysis'
  ).toBe(true);
  expect(
    seen.map((s) => s.tintClass),
    'the wash reports correctness instead'
  ).toEqual(data.map((d) => (d.correct ? 'gng-tint-correct' : 'gng-tint-incorrect')));
});

import { expect, test } from '@playwright/test';

/**
 * The go/no-go presentation settings, checked against what actually renders.
 *
 * These four - signal_valence, feedback_tint, play_sounds and outcome_display -
 * are the switches that decide what a participant is told and when, so the
 * things worth pinning down are correspondences: the frame must agree with
 * the trial's valence on EVERY trial (a frame that drifted out of step would
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
    const trialFrame = await page.$('.gng-frame');
    seen.push(
      await page.evaluate(() => {
        const frame = document.querySelector('.gng-frame');
        return {
          frame: frame?.dataset.valence ?? null,
          border: frame ? getComputedStyle(frame).borderTopStyle : null,
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
        feedbackFrame: document.querySelector('.gng-frame:not([hidden])')?.dataset.valence ?? null,
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
    if (trialFrame) {
      // The handle still points to this trial's frame after it leaves the DOM.
      // Its hidden flag can be checked even after the brief blank interval.
      expect(await trialFrame.evaluate((frame) => frame.hidden)).toBe(true);
      await trialFrame.dispose();
    }
  }
  return seen;
}

const trialData = (page) =>
  page.evaluate(() => window.jsPsych.data.get().filter({ trialphase: 'go_no_go' }).values());

test('study defaults frame the outcome domain and show stochastic points without a correctness signal', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto(
    '/examples/go-no-go.html?participant_id=demo&skip_instructions=1'
  );

  // Includes trial 5, where sham feedback gives +1 for the optimal Go action.
  const seen = await walkTrials(page, 5);
  const data = (await trialData(page)).slice(0, seen.length);
  expect(data).toHaveLength(seen.length);
  expect(new Set(seen.map((s) => s.frame))).toEqual(new Set(['win', 'avoid_loss']));
  expect(seen.map((s) => s.frame)).toEqual(data.map((d) => d.valence));
  expect(seen.map((s) => s.feedbackFrame)).toEqual(seen.map((s) => s.frame));
  expect(seen.map((s) => s.border)).toEqual(data.map((d) => d.valence === 'win' ? 'solid' : 'double'));
  expect(data.every((d) => d.valence_signalled)).toBe(true);

  expect(
    seen.map((s) => s.outcomeText),
    'the number on screen is the outcome that was scored, signed'
  ).toEqual(data.map((d) => `${d.outcome > 0 ? '+' : ''}${d.outcome}`));
  expect(seen.every((s) => !s.outcomeSrc), 'no coin image in points mode').toBe(true);
  expect(seen.every((s) => !s.hasTint && s.tintClass === null), 'no correctness wash').toBe(true);
  const sham = data.find((d) => d.sham && d.correct);
  expect(sham, 'an optimal action with misleading outcome was exercised').toBeTruthy();
  expect(sham.outcome).toBe(1);
  // Sam's scheme: £1 -> 10, 1p -> 1, and the same negated.
  expect(
    data.every((d) => [10, 1, -1, -10].includes(d.outcome)),
    'outcomes are the four RobotFactory values'
  ).toBe(true);
});

test('the legacy demo can use coins and correctness colours with the valence frame off', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto(
    '/examples/go-no-go.html?participant_id=demo&skip_instructions=1&signal_valence=0&feedback_tint=1&outcome_display=coins'
  );

  const seen = await walkTrials(page, 3);
  const data = (await trialData(page)).slice(0, seen.length);

  expect(seen.every((s) => s.frame === null), 'no frame when the domain is not signalled').toBe(
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
  expect(seen.every((s) => s.outcomeSrc), 'coins mode shows a coin image').toBe(true);
});

test('default instructions and practice teach both frames and signed points', async ({ page }) => {
  await page.goto('/examples/go-no-go.html?participant_id=demo');
  await expect(page.locator('#jspsych-instructions-next')).toBeVisible({ timeout: 20000 });
  const copy = await page.evaluate(async () => {
    const { TaskRegistry } = await import('/api/task-registry.js');
    const { prepareGoNoGoInstructions } = await import('/tasks/go-no-go/instructions.js');
    const timeline = prepareGoNoGoInstructions(TaskRegistry.go_no_go.defaultConfig, ['a', 'b', 'c', 'd']);
    return timeline.filter((t) => Array.isArray(t.pages)).flatMap((t) => t.pages).join('\n');
  });
  expect(copy).toContain('+10');
  expect(copy).toContain('−10');
  expect(copy).toContain('A plus number');
  expect(copy).toContain('A minus number');
  expect(copy).not.toMatch(/£|penny|coin|green|red<\/b>/i);
  expect(copy).toContain('A solid blue frame means there are <b>points to win</b>');
  expect(copy).toContain('A double amber frame means there are <b>points to lose</b>');
  expect(copy).toContain('Practice 4 of 4');
});

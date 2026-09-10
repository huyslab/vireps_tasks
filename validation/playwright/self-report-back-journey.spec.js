import { expect, test } from '@playwright/test';
import { patchWebkitTouchPoints, trackPageErrors } from './support/helpers.js';

/**
 * The questionnaire block is 115 items over 121 screens, each committed by a single
 * tap. Without a way back, one mis-hit was unrecoverable and invisible: nothing on
 * screen said what had been recorded, and nothing downstream could tell a mistake
 * from an answer. These tests cover the way back, and the data trail it leaves.
 */

const FIRST_ITEM = 'I plan tasks carefully';
const SECOND_ITEM = 'I do things without thinking';

/**
 * Items per questionnaire, in module order. Asserted individually so a cursor or
 * section-boundary regression names the questionnaire it broke rather than just
 * moving a total.
 *
 * BIS is 31 rather than the canonical 30 because the source data dictionary repeats
 * "I plan trips well ahead of time" under two ids. That is a known content issue
 * raised separately; this test pins current reality so a silently dropped item
 * cannot hide behind it.
 */
const EXPECTED_ITEMS = { BIS: 31, ARI: 7, STAXI2: 57, STAI: 20 };
const EXPECTED_TOTAL = Object.values(EXPECTED_ITEMS).reduce((a, b) => a + b, 0); // 115

async function openQuestionnaire(page, participantId) {
  await patchWebkitTouchPoints(page);
  await page.addInitScript(() => {
    window.__redcapDeviceStatusForTesting = { approved: true, verified: true };
  });
  await page.goto(`/experiment.html?participant_id=${participantId}&task=self_report`);
  await expect(page.locator('.srq-screen')).toBeVisible({ timeout: 15000 });
}

/** Rows an analysis would actually read: one live answer per item. */
function liveAnswers(page) {
  return page.evaluate(() => jsPsych.data.get()
    .filter({ trial_type: 'self-report-item' })
    .values()
    .filter((row) => row.navigation === 'forward' && !row.superseded && row.item_id));
}

test('a mis-tapped answer can be corrected, and only the correction counts', async ({ page }) => {
  test.setTimeout(120000);
  const errors = trackPageErrors(page);
  await openQuestionnaire(page, 'back_correct');

  // The opening instructions screen has nowhere to go back to.
  await expect(page.locator('.srq-btn-back'), 'the first screen should offer no way back').toHaveCount(0);
  await page.locator('.srq-btn-primary').click();

  await expect(page.locator('.srq-prompt')).toHaveText(FIRST_ITEM);
  await page.locator('.srq-option').first().click();

  // Land on the next item, then step back to the one just answered.
  await expect(page.locator('.srq-prompt')).toHaveText(SECOND_ITEM);
  await expect(page.locator('.srq-btn-back'), 'an item screen should offer a way back').toHaveCount(1);
  await page.locator('.srq-btn-back').click();

  await expect(page.locator('.srq-prompt'), 'Back should return to the previous item').toHaveText(FIRST_ITEM);

  // The standing answer is shown, so the participant can see what they are changing.
  const previous = page.locator('.srq-option-previous');
  await expect(previous, 'the existing answer should be marked on return').toHaveCount(1);
  await expect(previous).toHaveAttribute('aria-pressed', 'true');
  await expect(previous).toHaveText(await page.locator('.srq-option').first().innerText());

  await page.locator('.srq-option').nth(2).click();
  await expect(page.locator('.srq-prompt'), 'answering again should move forward').toHaveText(SECOND_ITEM);

  const live = await liveAnswers(page);
  const forFirstItem = live.filter((row) => row.item_text === FIRST_ITEM);
  expect(forFirstItem, 'exactly one answer should be live for a corrected item').toHaveLength(1);
  expect(forFirstItem[0].response, 'the correction should be the live answer').toBe(3);
  expect(forFirstItem[0].revisited).toBe(true);

  // The original is kept, marked, so the correction is auditable rather than erased.
  const all = await page.evaluate(() => jsPsych.data.get()
    .filter({ trial_type: 'self-report-item' }).values()
    .filter((row) => row.item_text === 'I plan tasks carefully'));
  expect(all, 'the original answer should be retained alongside the correction').toHaveLength(2);
  expect(all.filter((row) => row.superseded === true), 'the original should be marked superseded').toHaveLength(1);

  expect(errors).toEqual([]);
});

test('stepping back is recorded without overwriting an answer', async ({ page }) => {
  test.setTimeout(120000);
  await openQuestionnaire(page, 'back_recorded');
  await page.locator('.srq-btn-primary').click();
  await expect(page.locator('.srq-prompt')).toHaveText(FIRST_ITEM);
  await page.locator('.srq-option').first().click();
  await expect(page.locator('.srq-prompt')).toHaveText(SECOND_ITEM);
  await page.locator('.srq-btn-back').click();
  await expect(page.locator('.srq-prompt')).toHaveText(FIRST_ITEM);

  const back = await page.evaluate(() => jsPsych.data.get()
    .filter({ trial_type: 'self-report-item' }).values()
    .filter((row) => row.navigation === 'back'));
  expect(back, 'the back step should leave a row').toHaveLength(1);
  expect(back[0].response, 'a back step is not an answer').toBeNull();
  expect(back[0].item_text, 'the row should name the screen stepped away from').toBe(SECOND_ITEM);
});

test('a simulated run still terminates with one live answer per item', async ({ page }) => {
  test.setTimeout(180000);
  const errors = trackPageErrors(page);
  await openQuestionnaire(page, 'simulate_back_loop');

  // The questionnaire is a loop with a cursor now, so "does it end" is a real question:
  // a Back that simulation could reach would run forever.
  await page.waitForFunction(() => document.body.innerText.includes('Thank you'), undefined, { timeout: 150000 });

  const summary = await page.evaluate(() => {
    const rows = jsPsych.data.get().filter({ trial_type: 'self-report-item' }).values();
    const live = rows.filter((row) => row.navigation === 'forward' && !row.superseded && row.item_id);
    const perQuestionnaire = {};
    live.forEach((row) => {
      perQuestionnaire[row.questionnaire] = (perQuestionnaire[row.questionnaire] || 0) + 1;
    });
    return {
      live: live.length,
      unique: new Set(live.map((row) => row.item_id)).size,
      back: rows.filter((row) => row.navigation === 'back').length,
      perQuestionnaire,
    };
  });

  expect(summary.back, 'simulation must never press Back, or a run would not terminate').toBe(0);

  // Counting, not just de-duplicating: uniqueness alone would still pass if the cursor
  // skipped most of the battery, as long as whatever survived had distinct ids.
  expect(
    summary.perQuestionnaire,
    'every questionnaire should deliver all of its items'
  ).toEqual(EXPECTED_ITEMS);
  expect(summary.live, `the battery should record ${EXPECTED_TOTAL} answers`).toBe(EXPECTED_TOTAL);
  expect(summary.unique, 'each answer should belong to a distinct item').toBe(EXPECTED_TOTAL);
  expect(errors).toEqual([]);
});

test('number-key shortcuts still address answers, not the Back button', async ({ page }) => {
  test.setTimeout(120000);
  // Keyboard mode: the shortcuts are a keyboard affordance, so force it rather than
  // depending on the project's device.
  await patchWebkitTouchPoints(page);
  await page.addInitScript(() => {
    window.__redcapDeviceStatusForTesting = { approved: true, verified: true };
  });
  await page.goto('/experiment.html?participant_id=back_keys&task=self_report');
  await expect(page.locator('.srq-screen')).toBeVisible({ timeout: 15000 });
  await page.locator('.srq-btn-primary').click();
  await expect(page.locator('.srq-prompt')).toHaveText(FIRST_ITEM);

  const optionCount = await page.locator('.srq-option').count();
  // One past the last option: with Back in the numbered run this stepped back instead
  // of doing nothing.
  await page.keyboard.press(String(optionCount + 1));
  await page.waitForTimeout(400);
  await expect(page.locator('.srq-prompt'), 'a number past the scale should do nothing').toHaveText(FIRST_ITEM);
});

test('the last item of a questionnaire is still correctable', async ({ page }) => {
  test.setTimeout(180000);
  const errors = trackPageErrors(page);
  await openQuestionnaire(page, 'back_boundary');

  // Walk BIS to its end. Each questionnaire owns its own cursor and the next one opens
  // with no way back, so without a screen after the final item that answer would be
  // sealed the moment it was given.
  const LAST_BIS_ITEM = 'I plan for the future [I am future oriented].';
  for (let step = 0; step < 40; step++) {
    if ((await page.locator('.srq-prompt').innerText()) === LAST_BIS_ITEM) break;
    const primary = page.locator('.srq-btn-primary');
    if (await primary.count()) await primary.click();
    else await page.locator('.srq-option').first().click();
    await page.waitForTimeout(400);
  }
  await expect(page.locator('.srq-prompt'), 'should reach the final BIS item').toHaveText(LAST_BIS_ITEM);

  await page.locator('.srq-option').first().click();

  // The completion screen stands between the last item and the next questionnaire.
  await expect(
    page.locator('.srq-prompt'),
    'a completion screen should follow the last item'
  ).toContainText('You have finished set 1 of 4');
  await expect(
    page.locator('.srq-btn-back'),
    'the completion screen must offer a way back, or the last answer is sealed'
  ).toHaveCount(1);

  await page.locator('.srq-btn-back').click();
  await expect(page.locator('.srq-prompt'), 'Back should return to the final item').toHaveText(LAST_BIS_ITEM);
  await expect(page.locator('.srq-option-previous'), 'the standing answer should be shown').toHaveCount(1);

  await page.locator('.srq-option').nth(3).click();

  // The row is written after the screen transition, so wait for the next screen rather
  // than reading the data straight after the tap.
  await expect(page.locator('.srq-prompt')).toContainText('You have finished set 1 of 4');

  const live = await liveAnswers(page);
  const finalItem = live.filter((row) => row.item_text === LAST_BIS_ITEM);
  expect(finalItem, 'the corrected final item should have one live answer').toHaveLength(1);
  expect(finalItem[0].response, 'the correction should stand').toBe(4);
  expect(errors).toEqual([]);
});

test('crossing into the next questionnaire closes the previous one', async ({ page }) => {
  test.setTimeout(180000);
  await openQuestionnaire(page, 'back_crossing');

  const LAST_BIS_ITEM = 'I plan for the future [I am future oriented].';
  for (let step = 0; step < 40; step++) {
    if ((await page.locator('.srq-prompt').innerText()) === LAST_BIS_ITEM) break;
    const primary = page.locator('.srq-btn-primary');
    if (await primary.count()) await primary.click();
    else await page.locator('.srq-option').first().click();
    await page.waitForTimeout(400);
  }
  await page.locator('.srq-option').first().click();
  await expect(page.locator('.srq-prompt')).toContainText('You have finished set 1 of 4');
  await page.locator('.srq-btn-primary').click();

  // Past the boundary the previous questionnaire is finalised and saved, so its cursor
  // is gone: the opening screen of the next one correctly offers no way back into it.
  await expect(page.locator('.srq-screen')).toBeVisible();
  await expect(
    page.locator('.srq-btn-back'),
    'the first screen of the next questionnaire has nowhere to go back to'
  ).toHaveCount(0);
});

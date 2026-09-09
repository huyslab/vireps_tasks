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
    return {
      live: live.length,
      unique: new Set(live.map((row) => row.item_id)).size,
      back: rows.filter((row) => row.navigation === 'back').length,
      questionnaires: [...new Set(live.map((row) => row.questionnaire))].sort(),
    };
  });

  expect(summary.back, 'simulation must never press Back, or a run would not terminate').toBe(0);
  expect(summary.live, 'every item should have exactly one live answer').toBe(summary.unique);
  expect(summary.questionnaires).toEqual(['ARI', 'BIS', 'STAI', 'STAXI2']);
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

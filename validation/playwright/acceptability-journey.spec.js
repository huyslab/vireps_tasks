import { expect, test } from '@playwright/test';
import { patchWebkitTouchPoints, trackPageErrors } from './support/helpers.js';

/**
 * The acceptability ratings, which follow every game and so are the most-repeated
 * screens in a session (nine times in Module 2 alone).
 *
 * They used to use the stock jsPsych Likert plugin - five 24px radio buttons in a
 * row - while the questionnaire block used the one-item-per-screen component. Two
 * ways of answering the same shape of question in one session, and the worse one
 * was the one met most often. These tests pin the port: the shared component, both
 * scale anchors named, and the three ratings still recoverable by their old names.
 */

const GAME = 'game you have just completed';

async function openAcceptability(page, participantId) {
  await patchWebkitTouchPoints(page);
  await page.addInitScript(() => {
    window.__redcapDeviceStatusForTesting = { approved: true, verified: true };
  });
  await page.goto(`/experiment.html?participant_id=${participantId}&task=acceptability_judgment`);
  await expect(page.locator('.srq-screen')).toBeVisible({ timeout: 20000 });
}

test('ratings use the shared component with both anchors named', async ({ page }) => {
  test.setTimeout(120000);
  const errors = trackPageErrors(page);
  await openAcceptability(page, 'accept_render');

  await page.locator('.srq-btn-primary').click();

  const options = page.locator('.srq-option');
  await expect(options).toHaveCount(5);
  await expect(page.locator('.srq-prompt')).toHaveText(`How difficult was the ${GAME}?`);

  // "1 Not at all" did not finish the sentence the question started; both ends are
  // now named in full.
  await expect(options.first()).toHaveText('1 - Not difficult at all');
  await expect(options.last()).toHaveText('5 - Very difficult');

  // The reason for the port: these are met nine times a session and were half the
  // minimum tap target.
  for (const option of await options.all()) {
    const box = await option.boundingBox();
    expect(box.height, 'options must clear the shared minimum tap target').toBeGreaterThanOrEqual(44);
  }

  expect(errors).toEqual([]);
});

test('all three ratings are recorded under their original names', async ({ page }) => {
  test.setTimeout(120000);
  await openAcceptability(page, 'accept_data');

  await page.locator('.srq-btn-primary').click();
  for (let i = 0; i < 3; i++) {
    await expect(page.locator('.srq-options')).toBeVisible();
    await page.locator('.srq-option').nth(i).click();
    await page.waitForTimeout(450);
  }

  const rows = await page.evaluate(() => jsPsych.data.get()
    .filter({ trial_type: 'self-report-item' })
    .values()
    .filter((row) => row.item_id));

  // One row per rating now, rather than three keys on a single row - but the same
  // three field names, so the values stay recoverable.
  expect(rows.map((row) => row.item_id)).toEqual([
    'task_difficulty',
    'task_enjoy',
    'task_clear',
  ]);
  // 0-based, matching what jsPsychSurveyLikert stored before the port: the plugin
  // wrote the radio's index, not its label, so tapping "1" has always recorded 0.
  // Asserting the codes here is what stops a future change shifting them silently.
  expect(rows.map((row) => row.response), 'response codes must stay 0-based').toEqual([0, 1, 2]);
  for (const row of rows) {
    expect(row.trialphase, 'phase should still identify the task').toBe('acceptability_task');
  }
});

import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, patchWebkitTouchPoints, trackPageErrors } from './support/helpers.js';

test('self-report items provide large one-tap responses without horizontal overflow', async ({ page }) => {
  const errors = trackPageErrors(page);
  await patchWebkitTouchPoints(page);
  await page.addInitScript(() => {
    window.__redcapDeviceStatusForTesting = { approved: true, verified: true };
  });

  await page.goto('/experiment.html?participant_id=questionnaire_render&task=self_report');
  await expect(page.locator('.srq-screen')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Continue' }).click();

  const screen = page.locator('.srq-screen');
  const options = page.locator('.srq-option');
  await expect(options).toHaveCount(4);
  await expect(page.locator('.srq-prompt')).toHaveText('I plan tasks carefully');
  await expect(page.locator('.srq-context')).toContainText('frequently');
  await expectNoHorizontalOverflow(page);

  for (const option of await options.all()) {
    const box = await option.boundingBox();
    expect(box).toBeTruthy();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  const mode = await screen.evaluate((element) => ({
    touch: element.classList.contains('srq-touch'),
    keyboard: element.classList.contains('srq-keyboard'),
  }));
  expect(mode.touch).not.toBe(mode.keyboard);

  await options.first().click();
  const latestResponse = () => page.evaluate(() => {
    return window.jsPsych?.data.get().filter({ item_id: 'bis_plan_task' }).last(1).values()[0] || null;
  });
  await expect.poll(latestResponse).not.toBeNull();
  const response = await latestResponse();
  expect(response).toMatchObject({
    questionnaire: 'BIS',
    item_id: 'bis_plan_task',
    item_index: 0,
    item_text: 'I plan tasks carefully',
    response: 1,
    response_label: '1 = Rarely/Never',
  });
  expect(errors).toEqual([]);
});

import { expect, test } from '@playwright/test';

const MAX_PARTICIPANT_ID_LENGTH = 236;

test('the launcher rejects participant IDs that cannot fit in a REDCap record ID', async ({ page }) => {
  await page.goto('/index.html');
  const input = page.locator('#participantId');
  await expect(input).toHaveAttribute('maxlength', String(MAX_PARTICIPANT_ID_LENGTH));

  await input.evaluate((element, value) => {
    element.value = value;
  }, 'a'.repeat(MAX_PARTICIPANT_ID_LENGTH + 1));
  await page.selectOption('#task', 'vigour');
  await page.locator('#startForm').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  await expect(page.locator('#errorMessage')).toBeVisible();
  await expect(page.locator('#errorMessage')).toContainText('236 characters or fewer');
  await expect(page).toHaveURL(/\/index\.html$/);
});

test('a direct launch rejects an oversized participant ID before the experiment starts', async ({ page }) => {
  await page.addInitScript(() => {
    window.__redcapDeviceStatusForTesting = { approved: true, verified: true };
  });
  const participantId = 'a'.repeat(MAX_PARTICIPANT_ID_LENGTH + 1);
  await page.goto(`/experiment.html?participant_id=${participantId}&task=vigour`);

  await expect(page.getByRole('heading', { name: 'Error Loading Experiment' })).toBeVisible();
  await expect(page.locator('#display_element')).toContainText('236 characters or fewer');
  await expect(page.locator('#demo-mode-overlay')).toBeHidden();
});

test('the maximum participant ID produces an authorizer-compatible record ID', async ({ page }) => {
  await page.goto('/index.html');
  const result = await page.evaluate(async (participantId) => {
    const { createREDCapRecordId } = await import('/core/utils/participant-id.js');
    return createREDCapRecordId(participantId, '2026-09-04_22:45:00');
  }, 'a'.repeat(MAX_PARTICIPANT_ID_LENGTH));

  expect(result).toHaveLength(256);
});

import { expect, test } from '@playwright/test';

const MAX_PARTICIPANT_ID_LENGTH = 236;
const REDCAP_ENDPOINT = 'https://7vv2kgkas9.execute-api.eu-north-1.amazonaws.com/Prod/redcap';

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

test('a snapshot that cannot be stored raises a visible notice for staff', async ({ page }) => {
  await page.addInitScript(() => {
    window.__redcapDeviceStatusForTesting = { approved: true, verified: true };
    // 127.0.0.1 is a development host, where saves are dropped before they are ever written
    // and so can never fail to store. This is the queue's escape hatch for exercising the
    // real store path from a locally served page.
    window.__forceOnlineRedcapForTesting = true;
    window.__redcapRetryDelayMsForTesting = 60000;
  });
  await page.route(REDCAP_ENDPOINT, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.goto('/experiment.html?participant_id=simulate_storage&task=vigour');

  const banner = page.locator('#save-failure-banner');
  await expect(banner).toBeHidden();

  // Nothing in the timeline awaits a save, so a rejected one would otherwise reach only the
  // console: the participant sees the completion screen and the tablet moves on with the
  // session unwritten. Staff have to be told while they can still act on it.
  await page.evaluate(async () => {
    const { submitRecord } = await import('/core/utils/data-queue.js');
    const originalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
      if (mode === 'readwrite') {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      }
      return originalTransaction.call(this, stores, mode, ...rest);
    };
    try {
      await submitRecord('storage-failure-record', JSON.stringify([{ record_id: 'storage-failure-record' }]));
    } catch (error) {
      // Expected: the notice is what this test is about.
    } finally {
      IDBDatabase.prototype.transaction = originalTransaction;
    }
  });

  await expect(banner).toBeVisible();
  await expect(banner).toContainText('not being saved');
});

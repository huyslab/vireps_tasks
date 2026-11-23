import { expect, test } from '@playwright/test';

const REDCAP_ENDPOINT = 'https://7vv2kgkas9.execute-api.eu-north-1.amazonaws.com/Prod/redcap';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.__forceOnlineRedcapForTesting = true;
    window.__redcapRetryDelayMsForTesting = 60000;
    window.__redcapDeviceSignerForTesting = async () => ({});
    window.__redcapDeviceStatusForTesting = { approved: true, verified: true };
  });
});

test('a duplicate setup tab stays blocked until the owner closes and the user retries', async ({ page, context }) => {
  await page.goto('/index.html');
  expect(await page.evaluate(async () => (await import('/core/utils/single-tab.js')).ensureSingleTab())).toBe(true);
  const duplicate = await context.newPage();
  await duplicate.goto('/index.html');
  const notice = duplicate.getByRole('dialog', { name: 'VIREPS is already open' });
  await expect(notice).toBeVisible();
  await duplicate.keyboard.press('Escape');
  await expect(notice).toBeVisible();

  await page.close();
  // No automatic takeover of the previous participant's session.
  await expect(notice).toBeVisible();
  await duplicate.getByRole('button', { name: 'Try again' }).click();
  await expect(notice).toHaveCount(0);
  expect(await duplicate.evaluate(async () => (await import('/core/utils/single-tab.js')).ensureSingleTab())).toBe(true);

  // Same-tab reload/navigation must reacquire rather than leave a stale ownership flag.
  await duplicate.reload();
  await expect(duplicate.locator('#single-tab-notice')).toHaveCount(0);
  expect(await duplicate.evaluate(async () => (await import('/core/utils/single-tab.js')).ensureSingleTab())).toBe(true);

  await duplicate.goto('/experiment.html?participant_id=invalid');
  expect(await duplicate.evaluate(async () => (await import('/core/utils/single-tab.js')).ensureSingleTab())).toBe(true);
  await duplicate.goBack();
  await expect(duplicate).toHaveURL(/index\.html$/);
  const third = await context.newPage();
  await third.goto('/index.html');
  await expect(third.getByRole('dialog', { name: 'VIREPS is already open' })).toBeVisible();
});

test('a direct experiment in another tab cannot start or enqueue data', async ({ page, context }) => {
  await page.goto('/index.html');
  await page.evaluate(async () => (await import('/core/utils/single-tab.js')).ensureSingleTab());
  const duplicate = await context.newPage();
  await duplicate.goto('/experiment.html?participant_id=debug&session_number=1&module=questionnaires');
  await expect(duplicate.getByRole('dialog', { name: 'VIREPS is already open' })).toBeVisible();
  expect(await duplicate.evaluate(() => jsPsych.getStartTime())).toBeFalsy();
  const result = await duplicate.evaluate(async () => {
    const { submitRecord, getPendingCount } = await import('/core/utils/data-queue.js');
    let rejected = false;
    try {
      await submitRecord('blocked-module', JSON.stringify([{ record_id: 'blocked-module' }]));
    } catch {
      rejected = true;
    }
    return { rejected, pending: await getPendingCount() };
  });
  expect(result).toEqual({ rejected: true, pending: 0 });
});

test('opening setup during a checkpoint upload cannot create a second sender', async ({ page, context }) => {
  const uploads = [];
  let releaseCheckpoint;
  const checkpointHeld = new Promise((resolve) => { releaseCheckpoint = resolve; });
  await context.route(REDCAP_ENDPOINT, async (route) => {
    const snapshot = route.request().postDataJSON()[0];
    uploads.push(snapshot);
    if (!snapshot.module_completed) await checkpointHeld;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/validation/fixtures/data-queue.html');
  await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY);
  await page.evaluate(() => window.__dataQueue.submitRecord('shared-record', JSON.stringify([
    { record_id: 'shared-record', data: 'checkpoint' }
  ])));
  await expect.poll(() => uploads.length).toBe(1);

  const duplicate = await context.newPage();
  await duplicate.goto('/index.html');
  await expect(duplicate.getByRole('dialog', { name: 'VIREPS is already open' })).toBeVisible();
  await duplicate.evaluate(async () => (await import('/core/utils/data-queue.js')).flushQueue());
  expect(uploads).toHaveLength(1);

  await page.evaluate(() => window.__dataQueue.submitRecord('shared-record', JSON.stringify([
    { record_id: 'shared-record', data: 'final', module_completed: true }
  ])));
  releaseCheckpoint();
  await page.evaluate(() => window.__dataQueue.flushQueue());
  expect(uploads.map((snapshot) => snapshot.data)).toEqual(['checkpoint', 'final']);
  expect(await page.evaluate(() => window.__dataQueue.getPendingCount())).toBe(0);
});

test('a browser without shared locks cannot start an unsafe session', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
  await page.goto('/experiment.html?participant_id=debug&session_number=1&module=questionnaires');
  await expect(page.getByRole('dialog', { name: 'This browser cannot run VIREPS safely' })).toBeVisible();
  expect(await page.evaluate(() => jsPsych.getStartTime())).toBeFalsy();
});

import { expect, test } from '@playwright/test';

const REDCAP_ENDPOINT = 'https://7vv2kgkas9.execute-api.eu-north-1.amazonaws.com/Prod/redcap';

test('the launcher carries a clinician email without including it in URLs or trial data', async ({ page }) => {
  await page.addInitScript(() => {
    window.__redcapDeviceStatusForTesting = { approved: true, verified: true };
  });
  await page.goto('/index.html');
  await page.locator('#participantId').fill('debug');
  await page.locator('#sessionNumber').selectOption('1');
  await page.locator('#module').selectOption('questionnaires');
  await page.locator('#clinicianEmail').fill('clinician@example.test');
  await page.locator('#startButton').click();
  await expect(page).toHaveURL(/experiment\.html\?.*receipt=/);
  await expect.poll(() => page.evaluate(() => window.clinicianEmail)).toBe('clinician@example.test');
  expect(decodeURIComponent(page.url())).not.toContain('clinician@example.test');
  expect(await page.evaluate(() => jsPsych.data.get().json())).not.toContain('clinician@example.test');

  // A direct launch must not silently reuse the previous clinician's address.
  await page.goto('/experiment.html?participant_id=invalid');
  await expect.poll(() => page.evaluate(() => window.clinicianEmail)).toBe('');
});

test('a receipt token cannot attach an address to a different participant or module', async ({ page }) => {
  await page.goto('/index.html');
  const result = await page.evaluate(async () => {
    const { prepareCompletionReceipt, readCompletionReceipt } = await import('/core/utils/completion-receipt.js');
    const parameters = new URLSearchParams({ participant_id: 'debug', session_number: '1', module: 'module_1' });
    prepareCompletionReceipt('clinician@example.test', parameters);
    const original = readCompletionReceipt(parameters);
    parameters.set('participant_id', 'demo');
    const otherParticipant = readCompletionReceipt(parameters);
    parameters.set('participant_id', 'debug');
    parameters.set('module', 'module_2');
    const otherModule = readCompletionReceipt(parameters);
    prepareCompletionReceipt('', parameters);
    return { original, otherParticipant, otherModule, cleared: readCompletionReceipt(parameters) };
  });
  expect(result).toEqual({ original: 'clinician@example.test', otherParticipant: '', otherModule: '', cleared: '' });
});

test('invalid clinician emails block launch and a blank address remains optional', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#participantId').fill('debug');
  await page.locator('#sessionNumber').selectOption('1');
  await page.locator('#module').selectOption('questionnaires');
  await page.locator('#clinicianEmail').fill('not-an-email');
  await page.locator('#startButton').click();
  await expect(page).toHaveURL(/index\.html$/);
  expect(await page.locator('#clinicianEmail').evaluate((input) => input.validity.typeMismatch)).toBe(true);
  // Addresses the browser accepts but REDCap's email validation would reject.
  for (const address of ['name@ucl', 'x@localhost', 'a..b@ucl.ac.uk', 'a.@ucl.ac.uk']) {
    await page.locator('#clinicianEmail').fill(address);
    await page.locator('#startButton').click();
    await expect(page).toHaveURL(/index\.html$/);
    expect(await page.locator('#clinicianEmail').evaluate((input) => input.validity.valid), address).toBe(false);
  }
  await page.locator('#clinicianEmail').fill('first.last+tag@ucl.ac.uk');
  expect(await page.locator('#clinicianEmail').evaluate((input) => input.validity.valid)).toBe(true);
  await page.locator('#clinicianEmail').fill('');
  await page.locator('#startButton').click();
  await expect(page).toHaveURL(/experiment\.html\?/);
  expect(new URL(page.url()).searchParams.has('receipt')).toBe(false);
});

test('start and checkpoints register the recipient; only completion marks the queued snapshot final', async ({ page }) => {
  await page.addInitScript(() => {
    window.__forceOnlineRedcapForTesting = true;
    window.__redcapRetryDelayMsForTesting = 60000;
    window.__redcapDeviceSignerForTesting = async () => ({});
  });
  let failing = true;
  const uploads = [];
  await page.route(REDCAP_ENDPOINT, async (route) => {
    uploads.push(route.request().postDataJSON()[0]);
    await route.fulfill({ status: failing ? 503 : 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/experiment.html?participant_id=invalid');
  await page.evaluate(async () => {
    window.participantID = 'debug_receipt';
    window.session = 'wk0';
    window.module = 'module_1';
    window.clinicianEmail = 'clinician@example.test';
    jsPsych.getStartTime = () => new Date('2026-11-23T10:00:00Z');
    const { enterExperiment } = await import('/core/utils/setup.js');
    enterExperiment.func();
  });
  const queued = () => page.evaluate(async () => {
    const { listQueuedRecords } = await import('/core/utils/data-queue.js');
    return (await listQueuedRecords()).map((entry) => JSON.parse(entry.payload)[0]);
  });
  await expect.poll(async () => (await queued()).length).toBe(1);
  let record = (await queued())[0];
  expect(record.clinician_email).toBe('clinician@example.test');
  expect(record.module_completed).toBeUndefined();
  expect(record.data).not.toContain('clinician@example.test');

  await page.evaluate(async () => {
    const { saveDataREDCap } = await import('/core/utils/data-handling.js');
    await saveDataREDCap();
  });
  expect((await queued())[0].module_completed).toBeUndefined();

  await page.evaluate(async () => {
    const { endExperiment, saveDataREDCap } = await import('/core/utils/data-handling.js');
    await endExperiment();
    await endExperiment();
    // A subsequent cumulative save must preserve a pending completion request.
    await saveDataREDCap();
    const { flushQueue } = await import('/core/utils/data-queue.js');
    await flushQueue();
  });
  record = (await queued())[0];
  expect(record.module_completed).toBe(true);
  expect(record.clinician_email).toBe('clinician@example.test');

  // The recipient and final marker live in IndexedDB, so closing the experiment
  // does not lose the confirmation request when a later page retries the outbox.
  failing = false;
  await page.goto('/validation/fixtures/data-queue.html');
  await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY);
  await page.evaluate(() => window.__dataQueue.flushQueue());
  await expect.poll(async () => (await queued()).length).toBe(0);
  expect(uploads.at(-1).module_completed).toBe(true);
  expect(uploads.at(-1).clinician_email).toBe('clinician@example.test');
});

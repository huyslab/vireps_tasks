import { expect, test } from '@playwright/test';

const REDCAP_ENDPOINT = 'https://4csc8jmaw2.execute-api.eu-north-1.amazonaws.com/Prod/pharmaciespilot';
const ENROLLMENT_ENDPOINT = `${REDCAP_ENDPOINT}/enroll`;
const STATUS_ENDPOINT = `${REDCAP_ENDPOINT}/device-status`;

function decodeBase64url(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob((value + padding).replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
}

test('enrollment stores a non-exportable key that signs the exact record ID after reload', async ({ page }) => {
  let enrolledPublicKey;
  await page.route(ENROLLMENT_ENDPOINT, async (route) => {
    const request = JSON.parse(route.request().postData());
    enrolledPublicKey = request.public_key;
    expect(request.enrollment_code).toBe('single-use-enrollment-code-for-test');
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ device_id: request.device_id, label: 'Test tablet', status: 'approved' })
    });
  });

  await page.goto('/validation/fixtures/device-auth.html');
  await page.waitForFunction(() => window.__DEVICE_AUTH_FIXTURE_READY === true);
  const enrollment = await page.evaluate(() =>
    window.__deviceAuth.enrollDevice('single-use-enrollment-code-for-test')
  );
  expect(enrollment.label).toBe('Test tablet');

  await page.reload();
  await page.waitForFunction(() => window.__DEVICE_AUTH_FIXTURE_READY === true);
  const recordId = 'participant_session';
  const signed = await page.evaluate(async (id) => {
    const identity = await window.__deviceAuth.getDeviceIdentity();
    const headers = await window.__deviceAuth.createSignedRequestHeaders(id);
    return { headers, privateKeyExtractable: identity.private_key.extractable };
  }, recordId);

  expect(signed.privateKeyExtractable).toBe(false);
  expect(signed.headers['X-Record-Id']).toBe(recordId);
  expect(signed.headers['X-Device-Id']).toBe(enrollment.device_id);

  const canonical = [
    'v1',
    signed.headers['X-Device-Id'],
    recordId,
    signed.headers['X-Request-Timestamp'],
    signed.headers['X-Request-Nonce']
  ].join('\n');
  const signatureIsValid = await page.evaluate(async ({ jwk, message, signature }) => {
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify']
    );
    const padding = '='.repeat((4 - (signature.length % 4)) % 4);
    const bytes = Uint8Array.from(
      atob((signature + padding).replace(/-/g, '+').replace(/_/g, '/')),
      (char) => char.charCodeAt(0)
    );
    return crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      bytes,
      new TextEncoder().encode(message)
    );
  }, { jwk: enrolledPublicKey, message: canonical, signature: signed.headers['X-Device-Signature'] });
  expect(signatureIsValid).toBe(true);
  expect(decodeBase64url(signed.headers['X-Request-Nonce'])).toHaveLength(16);
});

test('an enrolled device treats a status-service failure as offline, not demo mode', async ({ page }) => {
  await page.route(ENROLLMENT_ENDPOINT, async (route) => {
    const request = JSON.parse(route.request().postData());
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ device_id: request.device_id, label: 'Offline tablet', status: 'approved' })
    });
  });
  await page.route(STATUS_ENDPOINT, async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' });
  });

  await page.goto('/validation/fixtures/device-auth.html');
  await page.waitForFunction(() => window.__DEVICE_AUTH_FIXTURE_READY === true);
  const status = await page.evaluate(async () => {
    await window.__deviceAuth.enrollDevice('single-use-enrollment-code-for-test');
    return window.__deviceAuth.getDeviceAuthorizationStatus();
  });

  expect(status).toEqual({ approved: true, verified: false });
});

test('an unapproved device gets a demo notice and its data is not saved', async ({ page }) => {
  let requestCount = 0;
  await page.addInitScript(() => {
    window.__forceOnlineRedcapForTesting = true;
  });
  await page.route(REDCAP_ENDPOINT, async (route) => {
    requestCount += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });

  await page.goto('/experiment.html?participant_id=simulate_demo&task=vigour');
  const overlay = page.locator('#demo-mode-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('no data will be saved');
  expect(await page.evaluate(() => window.__redcapDemoMode)).toBe(true);

  const result = await page.evaluate(async () => {
    const { submitRecord, listQueuedRecords } = await import('/core/utils/data-queue.js');
    const recordId = 'demo-record';
    const submission = await submitRecord(
      recordId,
      JSON.stringify([{ record_id: recordId }]),
      0,
      () => {}
    );
    const queued = (await listQueuedRecords()).some((record) => record.record_id === recordId);
    return { submission, queued };
  });

  expect(result).toEqual({ submission: { persisted: false, skipped: true }, queued: false });
  expect(requestCount).toBe(0);
  await page.locator('#demo-mode-continue').click();
  await expect(overlay).toBeHidden();
});

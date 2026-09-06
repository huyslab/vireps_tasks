import { expect, test } from '@playwright/test';

const REDCAP_ENDPOINT = 'https://7vv2kgkas9.execute-api.eu-north-1.amazonaws.com/Prod/redcap';
const ENROLLMENT_ENDPOINT = `${REDCAP_ENDPOINT}/enroll`;
const STATUS_ENDPOINT = `${REDCAP_ENDPOINT}/device-status`;

function decodeBase64url(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob((value + padding).replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
}

test('a QR enrollment link loads the code and removes it from browser history', async ({ page }) => {
  let submittedCode;
  await page.route(ENROLLMENT_ENDPOINT, async (route) => {
    const request = JSON.parse(route.request().postData());
    submittedCode = request.enrollment_code;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ device_id: request.device_id, label: 'QR tablet', status: 'approved' })
    });
  });

  await page.goto('/device-enrollment.html#code=7k3m-p9xr-d2hf');

  await expect(page.locator('#enrollment-code')).toHaveValue('7K3M-P9XR-D2HF');
  await expect(page.locator('#status')).toContainText('Enrollment code loaded');
  expect(new URL(page.url()).hash).toBe('');

  await page.getByRole('button', { name: 'Approve device' }).click();

  await expect(page.locator('#status')).toContainText('QR tablet is approved');
  const startButton = page.getByRole('link', { name: 'Start data collection' });
  await expect(startButton).toBeVisible();
  await expect(startButton).toHaveAttribute('href', './index.html');
  expect(submittedCode).toBe('7K3MP9XRD2HF');
});

test('an enrollment code can be corrected in the middle without moving the caret', async ({ page }) => {
  await page.goto('/device-enrollment.html');
  const codeInput = page.locator('#enrollment-code');
  await codeInput.fill('7X3M-P9XR-D2HF');
  await codeInput.evaluate((input) => input.setSelectionRange(2, 2));

  await page.keyboard.press('Backspace');
  await page.keyboard.type('K');

  await expect(codeInput).toHaveValue('7K3M-P9XR-D2HF');
  expect(await codeInput.evaluate((input) => input.selectionStart)).toBe(2);
});

test('an enrollment code is grouped for readability after typing finishes', async ({ page }) => {
  await page.goto('/device-enrollment.html');
  const codeInput = page.locator('#enrollment-code');
  await codeInput.fill('7k3mp9xrd2hf');

  await codeInput.blur();

  await expect(codeInput).toHaveValue('7K3M-P9XR-D2HF');
});

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

test('a device unknown to the relay is reported unapproved, not merely unauthorized', async ({ page }) => {
  await page.route(ENROLLMENT_ENDPOINT, async (route) => {
    const request = JSON.parse(route.request().postData());
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ device_id: request.device_id, label: 'Revoked tablet', status: 'approved' })
    });
  });
  await page.route(STATUS_ENDPOINT, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'unapproved', server_time: Math.floor(Date.now() / 1000) })
    });
  });

  await page.goto('/validation/fixtures/device-auth.html');
  await page.waitForFunction(() => window.__DEVICE_AUTH_FIXTURE_READY === true);
  const status = await page.evaluate(async () => {
    await window.__deviceAuth.enrollDevice('single-use-enrollment-code-for-test');
    return window.__deviceAuth.getDeviceAuthorizationStatus();
  });

  // The explicit verdict is the only thing that may stop a device collecting.
  expect(status).toEqual({ approved: false, reason: 'not-approved' });
});

test('a drifted clock corrects itself instead of sending the tablet to demo mode', async ({ page }) => {
  // An hour ahead of the tablet. The write route's authorizer collapses this into the same
  // opaque 401 as revocation, which is why the status route reports it as its own verdict:
  // read as "unapproved", a drifted clock would put the session in demo mode and discard it.
  const serverTime = Math.floor(Date.now() / 1000) + 3600;
  const seenTimestamps = [];

  await page.route(ENROLLMENT_ENDPOINT, async (route) => {
    const request = JSON.parse(route.request().postData());
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ device_id: request.device_id, label: 'Drifted tablet', status: 'approved' })
    });
  });
  await page.route(STATUS_ENDPOINT, async (route) => {
    seenTimestamps.push(Number(route.request().headers()['x-request-timestamp']));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'clock_skew', server_time: serverTime })
    });
  });

  await page.goto('/validation/fixtures/device-auth.html');
  await page.waitForFunction(() => window.__DEVICE_AUTH_FIXTURE_READY === true);
  const result = await page.evaluate(async () => {
    await window.__deviceAuth.enrollDevice('single-use-enrollment-code-for-test');
    const status = await window.__deviceAuth.getDeviceAuthorizationStatus();
    const headers = await window.__deviceAuth.createSignedRequestHeaders('drifted-record');
    return { status, signedTimestamp: Number(headers['X-Request-Timestamp']) };
  });

  expect(result.status.approved, 'a drifted clock is not a revoked device').toBe(true);
  expect(result.status.clockCorrected).toBe(true);

  // The first request went out on the device's own clock; every later one - the REDCap
  // writes included - is signed against the server's, so they can actually be accepted.
  expect(Math.abs(seenTimestamps[0] - serverTime)).toBeGreaterThan(300);
  expect(Math.abs(result.signedTimestamp - serverTime)).toBeLessThanOrEqual(5);
});

test('a drifted tablet keeps collecting and stores its session', async ({ page }) => {
  await page.addInitScript(() => {
    window.__forceOnlineRedcapForTesting = true;
    window.__redcapRetryDelayMsForTesting = 60000;
    window.__redcapDeviceSignerForTesting = async (recordId) => ({
      'X-Device-Id': 'drifted-device',
      'X-Record-Id': recordId,
      'X-Request-Timestamp': '1788523200',
      'X-Request-Nonce': 'AAAAAAAAAAAAAAAAAAAAAA',
      'X-Device-Signature': 'test-signature',
    });
  });
  await page.route(STATUS_ENDPOINT, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'clock_skew', server_time: Math.floor(Date.now() / 1000) + 3600 })
    });
  });
  await page.route(REDCAP_ENDPOINT, async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"stale"}' });
  });

  await page.goto('/experiment.html?participant_id=simulate_drift&task=vigour');
  await expect(page.locator('#demo-mode-overlay')).toBeHidden();
  expect(await page.evaluate(() => window.__redcapDemoMode)).toBe(false);

  const result = await page.evaluate(async () => {
    const { submitRecord, listQueuedRecords } = await import('/core/utils/data-queue.js');
    const recordId = 'drifted-record';
    const outcome = await submitRecord(recordId, JSON.stringify([{ record_id: recordId }]));
    return {
      stored: outcome.stored,
      queued: (await listQueuedRecords()).some((record) => record.record_id === recordId)
    };
  });

  expect(result.stored, 'a drifted clock must never cost a session').toBe(true);
  expect(result.queued).toBe(true);
});

test('a tablet that booted offline still drains its queue once it reconnects', async ({ page }) => {
  // The scenario the startup-only calibration missed: a skewed tablet whose status check
  // fails because it has no network yet. Without a later refresh its offset stays at zero,
  // so every retry after connectivity returns is signed with the drifted local clock and
  // rejected - the records are safe, but the outbox cannot drain for the whole session.
  const serverTime = Math.floor(Date.now() / 1000) + 3600;
  const MAX_AGE_SECONDS = 300;
  let statusReachable = false;
  const statusAttempts = [];
  const writeOutcomes = [];

  await page.addInitScript(() => {
    window.__forceOnlineRedcapForTesting = true;
    window.__redcapRetryDelayMsForTesting = 100;
  });

  await page.route(ENROLLMENT_ENDPOINT, async (route) => {
    const request = JSON.parse(route.request().postData());
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ device_id: request.device_id, label: 'Offline-boot tablet', status: 'approved' })
    });
  });

  await page.route(STATUS_ENDPOINT, async (route) => {
    statusAttempts.push(statusReachable ? 'online' : 'offline');
    if (!statusReachable) {
      await route.abort('connectionfailed');
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'clock_skew', server_time: serverTime })
    });
  });

  // Stands in for the authorizer's freshness window: a timestamp signed on the device's own
  // drifted clock is rejected exactly as the real relay would reject it.
  await page.route(REDCAP_ENDPOINT, async (route) => {
    const timestamp = Number(route.request().headers()['x-request-timestamp']);
    const fresh = Math.abs(timestamp - serverTime) <= MAX_AGE_SECONDS;
    writeOutcomes.push(fresh ? 'accepted' : 'rejected');
    await route.fulfill({
      status: fresh ? 200 : 401,
      contentType: 'application/json',
      body: fresh ? '{"ok":true}' : '{"message":"Unauthorized"}'
    });
  });

  // Enrol first: experiment.html would otherwise see an unenrolled browser at startup and
  // go into demo mode, which is a different case entirely.
  await page.goto('/validation/fixtures/device-auth.html');
  await page.waitForFunction(() => window.__DEVICE_AUTH_FIXTURE_READY === true);
  await page.evaluate(() => window.__deviceAuth.enrollDevice('single-use-enrollment-code-for-test'));

  // Boots with no network: the startup status check fails, so nothing is calibrated.
  await page.goto('/experiment.html?participant_id=simulate_offline_boot&task=vigour');
  await expect(page.locator('#demo-mode-overlay')).toBeHidden();
  expect(await page.evaluate(() => window.__redcapDemoMode)).toBe(false);
  expect(statusAttempts).toEqual(['offline']);

  const recordId = 'offline-boot-record';
  const stored = await page.evaluate(async (id) => {
    const { submitRecord } = await import('/core/utils/data-queue.js');
    const outcome = await submitRecord(id, JSON.stringify([{ record_id: id }]));
    return outcome.stored;
  }, recordId);
  expect(stored).toBe(true);

  // Connectivity returns. No further save and no page reload - only the outbox's own retry,
  // which is the sender the review pointed out never refreshed its calibration.
  statusReachable = true;

  await expect
    .poll(
      () => page.evaluate((id) => import('/core/utils/data-queue.js')
        .then(({ listQueuedRecords }) => listQueuedRecords())
        .then((records) => records.some((record) => record.record_id === id)), recordId),
      { message: 'the queue should drain once the clock is re-measured', timeout: 10000 }
    )
    .toBe(false);

  // The first attempt was signed on the drifted clock and refused; the recalibration that
  // refusal triggered is what let the retry succeed.
  expect(writeOutcomes[0]).toBe('rejected');
  expect(writeOutcomes.at(-1)).toBe('accepted');
  expect(statusAttempts).toContain('online');
});

test('an unapproved device can still run a demo when the outbox is unwritable', async ({ page }) => {
  await page.addInitScript(() => {
    window.__redcapDeviceStatusForTesting = { approved: false, reason: 'not-approved' };
    // A browser restricted to read-only site data. A demo stores nothing, so this must not
    // stand between the tablet and the one thing it is still allowed to do.
    const originalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
      if (mode === 'readwrite') {
        throw new DOMException('site data is read-only', 'InvalidStateError');
      }
      return originalTransaction.call(this, stores, mode, ...rest);
    };
  });

  await page.goto('/experiment.html?participant_id=simulate_demo_unwritable&task=vigour');

  const overlay = page.locator('#demo-mode-overlay');
  await expect(overlay).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Error Loading Experiment' })).toBeHidden();
  expect(await page.evaluate(() => window.__redcapDemoMode)).toBe(true);

  await page.locator('#demo-mode-continue').click();
  await expect(overlay).toBeHidden();
});

test('an unapproved device is announced, and collects no data at all', async ({ page }) => {
  let requestCount = 0;
  await page.addInitScript(() => {
    window.__forceOnlineRedcapForTesting = true;
    window.__redcapRetryDelayMsForTesting = 60000;
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

  // A confirmed-unapproved device is outside the study's data-collection boundary: the
  // session may be demonstrated, but nothing about it may be transmitted or left on the
  // tablet for a later enrollment to upload.
  const result = await page.evaluate(async () => {
    const { submitRecord, listQueuedRecords, flushQueue } = await import('/core/utils/data-queue.js');
    const recordId = 'demo-record';
    const outcome = await submitRecord(recordId, JSON.stringify([{ record_id: recordId }]));
    await flushQueue();
    return {
      stored: outcome.stored,
      queued: (await listQueuedRecords()).some((record) => record.record_id === recordId)
    };
  });

  expect(result.stored).toBe(false);
  expect(result.queued).toBe(false);
  expect(requestCount).toBe(0);
  await page.locator('#demo-mode-continue').click();
  await expect(overlay).toBeHidden();
});

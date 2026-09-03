import { expect, test } from '@playwright/test';

// Not using trackPageErrors/expectNoPageErrors (support/helpers.js) here: these tests
// deliberately mock 500 responses from the REDCap endpoint, and the browser itself logs a
// console.error for every failed fetch ("Failed to load resource..."), which is expected
// noise from the scenario under test, not an app bug.

/**
 * Exercises core/utils/data-queue.js's actual send/retry/flush logic against a mocked
 * network. The rest of the Playwright suite runs on http://127.0.0.1:4173 (see
 * playwright.config.js), which the queue's dev-mode guard (isDevHost()) always treats as
 * "skip the network" - by design, so the suite never hits the real REDCap/Lambda endpoint.
 * That means this is the only place the real submit/retry/flush path is exercised at all;
 * window.__forceOnlineRedcapForTesting (set below) is the queue module's escape hatch for
 * exactly this purpose.
 *
 * Uses validation/fixtures/data-queue.html, which exposes the queue's functions directly on
 * window rather than driving a full jsPsych timeline - the behaviour under test lives
 * entirely in data-queue.js.
 */

const REDCAP_ENDPOINT = 'https://4csc8jmaw2.execute-api.eu-north-1.amazonaws.com/Prod/pharmaciespilot';

function uniqueRecordId(label) {
  return `data-queue-spec_${label}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

/** Registers a controllable route for the REDCap endpoint; call setFailing() to flip it. */
async function mockRedcapEndpoint(page) {
  let failing = true;
  await page.route(REDCAP_ENDPOINT, async (route) => {
    if (failing) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"mocked failure"}' });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
  });
  return {
    setFailing: (value) => {
      failing = value;
    },
  };
}

test.describe('data-queue', () => {
  test.beforeEach(async ({ page }) => {
    // Forces isDevHost() to false so submitRecord()/flushQueue() attempt real fetch()es
    // against the (mocked) endpoint even though the page is served from 127.0.0.1.
    // addInitScript re-runs on every navigation within this page, so it also covers the
    // reload in the third test below.
    await page.addInitScript(() => {
      window.__forceOnlineRedcapForTesting = true;
    });
  });

  test('a failed send leaves the record queued, and a later flush drains it', async ({ page }) => {
    const { setFailing } = await mockRedcapEndpoint(page);

    await page.goto('/validation/fixtures/data-queue.html');
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    const recordId = uniqueRecordId('flush');

    // One immediate retry, endpoint failing throughout: submitRecord() must not throw, and
    // the record must still be in the queue once the immediate retries are exhausted.
    await page.evaluate(
      ({ id }) =>
        new Promise((resolve) => {
          window.__dataQueue.submitRecord(id, JSON.stringify([{ record_id: id }]), 1, () => resolve());
        }),
      { id: recordId }
    );

    const queuedAfterFailure = await page.evaluate(
      (id) => window.__dataQueue.listQueuedRecords().then((records) => records.some((r) => r.record_id === id)),
      recordId
    );
    expect(queuedAfterFailure, 'record should remain queued after exhausting immediate retries').toBe(true);

    // Endpoint recovers; an explicit flush (mirrors the 'online' event / periodic timer
    // triggers wired up in data-queue.js) should drain it.
    setFailing(false);
    await page.evaluate(() => window.__dataQueue.flushQueue());

    const pendingAfterFlush = await page.evaluate((id) =>
      window.__dataQueue.listQueuedRecords().then((records) => records.some((r) => r.record_id === id))
    , recordId);
    expect(pendingAfterFlush, 'record should be removed from the queue once the flush succeeds').toBe(false);
  });

  test('a record still queued after a page reload is picked up by the load-time flush', async ({ page }) => {
    const { setFailing } = await mockRedcapEndpoint(page);

    await page.goto('/validation/fixtures/data-queue.html');
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    const recordId = uniqueRecordId('reload');

    // Queue a record while the endpoint is failing, with zero immediate retries so it's
    // left queued right away.
    await page.evaluate(
      ({ id }) =>
        new Promise((resolve) => {
          window.__dataQueue.submitRecord(id, JSON.stringify([{ record_id: id }]), 0, () => resolve());
        }),
      { id: recordId }
    );

    // Endpoint recovers, then the page reloads (simulating this tablet's next page load,
    // e.g. for the next task or participant) - data-queue.js flushes once on module load,
    // with no test code calling flushQueue() explicitly this time.
    setFailing(false);
    await page.reload();
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    await expect
      .poll(
        async () =>
          page.evaluate(
            (id) => window.__dataQueue.listQueuedRecords().then((records) => records.some((r) => r.record_id === id)),
            recordId
          ),
        { message: 'record queued before reload should be flushed automatically on load', timeout: 5000 }
      )
      .toBe(false);
  });

  test('newer snapshots for one record are sent in order and are not deleted by older sends', async ({ page }) => {
    const requestBodies = [];
    const releaseRequest = [];

    // Hold each response until the test releases it. This makes the older request remain
    // in flight while a newer cumulative snapshot is queued for the same REDCap row.
    await page.route(REDCAP_ENDPOINT, async (route) => {
      requestBodies.push(JSON.parse(route.request().postData()));
      await new Promise((resolve) => {
        releaseRequest.push(async () => {
          await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
          resolve();
        });
      });
    });

    await page.goto('/validation/fixtures/data-queue.html');
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    const recordId = uniqueRecordId('versions');
    await page.evaluate(
      ({ id }) => window.__dataQueue.submitRecord(
        id,
        JSON.stringify([{ record_id: id, snapshot: 'older' }]),
        0,
        () => {}
      ),
      { id: recordId }
    );
    await expect.poll(() => requestBodies.length).toBe(1);

    await page.evaluate(
      ({ id }) => window.__dataQueue.submitRecord(
        id,
        JSON.stringify([{ record_id: id, snapshot: 'newer' }]),
        0,
        () => {}
      ),
      { id: recordId }
    );

    // A second request must not start until the first completes; otherwise a slow older
    // response can overwrite the newer REDCap value or delete its queued snapshot.
    await page.waitForTimeout(100);
    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0][0].snapshot).toBe('older');

    await releaseRequest[0]();
    await expect.poll(() => requestBodies.length).toBe(2);
    expect(requestBodies[1][0].snapshot).toBe('newer');

    await releaseRequest[1]();
    await expect.poll(
      () => page.evaluate((id) =>
        window.__dataQueue.listQueuedRecords().then((records) => records.some((r) => r.record_id === id))
      , recordId)
    ).toBe(false);
  });

  test('development-mode saves do not create an unflushable local backlog', async ({ page }) => {
    let requestCount = 0;
    await page.route(REDCAP_ENDPOINT, async (route) => {
      requestCount += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });

    await page.goto('/validation/fixtures/data-queue.html');
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    const recordId = uniqueRecordId('dev-host');
    await page.evaluate(async ({ id }) => {
      window.__forceOnlineRedcapForTesting = false;
      await window.__dataQueue.submitRecord(id, JSON.stringify([{ record_id: id }]), 0, () => {});
    }, { id: recordId });

    expect(requestCount).toBe(0);
    const queued = await page.evaluate((id) =>
      window.__dataQueue.listQueuedRecords().then((records) => records.some((r) => r.record_id === id))
    , recordId);
    expect(queued).toBe(false);
  });
});

import { expect, test } from '@playwright/test';

// Not using trackPageErrors/expectNoPageErrors (support/helpers.js) here: these tests
// deliberately mock 500 responses from the REDCap endpoint, and the browser itself logs a
// console.error for every failed fetch ("Failed to load resource..."), which is expected
// noise from the scenario under test, not an app bug.

/**
 * Exercises core/utils/data-queue.js's actual store/send logic against a mocked network.
 * The rest of the Playwright suite runs on http://127.0.0.1:4173 (see playwright.config.js),
 * which the queue's dev-host guard (isDevHost()) treats as "neither store nor send" - by
 * design, so the suite never hits the real REDCap/Lambda endpoint and never leaves a backlog
 * behind. That means this is the only place the real store/send path is exercised at all;
 * window.__forceOnlineRedcapForTesting (set below) is the queue module's escape hatch for
 * exactly this purpose.
 *
 * The outbox splits saving from sending: submitRecord() only stores a snapshot, and
 * flushQueue() is the only sender. So the deterministic pattern throughout is
 * `await submitRecord(...)` (stored) followed by `await flushQueue()` (delivery attempted),
 * where flushQueue() joins any pass already running and guarantees one further pass.
 *
 * Uses validation/fixtures/data-queue.html, which exposes the queue's functions directly on
 * window rather than driving a full jsPsych timeline - the behaviour under test lives
 * entirely in data-queue.js.
 */

const REDCAP_ENDPOINT = 'https://7vv2kgkas9.execute-api.eu-north-1.amazonaws.com/Prod/redcap';

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

/** Stores a snapshot and waits for the resulting delivery pass to finish. */
function submitAndFlush(page, recordId, record = {}) {
  return page.evaluate(
    async ({ id, extra }) => {
      await window.__dataQueue.submitRecord(id, JSON.stringify([{ record_id: id, ...extra }]));
      await window.__dataQueue.flushQueue();
    },
    { id: recordId, extra: record }
  );
}

function queuedRecordIds(page) {
  return page.evaluate(() =>
    window.__dataQueue.listQueuedRecords().then((records) => records.map((record) => record.record_id))
  );
}

function isQueued(page, recordId) {
  return page.evaluate(
    (id) => window.__dataQueue.listQueuedRecords().then((records) => records.some((r) => r.record_id === id)),
    recordId
  );
}

test.describe('data-queue', () => {
  test.beforeEach(async ({ context }) => {
    // Forces isDevHost() to false so submitRecord()/flushQueue() attempt real fetch()es
    // against the (mocked) endpoint even though the page is served from 127.0.0.1.
    // addInitScript re-runs on every navigation within this page, so it also covers the
    // reload in the page-reload test below.
    //
    // The retry backoff is pushed far out by default so a failed pass cannot fire a
    // background retry mid-assertion; the dedicated retry test lowers it deliberately.
    await context.addInitScript(() => {
      window.__forceOnlineRedcapForTesting = true;
      window.__redcapRetryDelayMsForTesting = 60000;
      window.__redcapDeviceSignerForTesting = async (recordId) => ({
        'X-Device-Id': 'test-approved-device',
        'X-Record-Id': recordId,
        'X-Request-Timestamp': '1788523200',
        'X-Request-Nonce': 'AAAAAAAAAAAAAAAAAAAAAA',
        'X-Device-Signature': 'test-signature',
      });
    });
  });

  test('an approved submission sends authorization bound to its record ID', async ({ page }) => {
    let requestHeaders;
    await page.route(REDCAP_ENDPOINT, async (route) => {
      requestHeaders = route.request().headers();
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });

    await page.goto('/validation/fixtures/data-queue.html');
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    const recordId = uniqueRecordId('authorized');
    await submitAndFlush(page, recordId);

    expect(requestHeaders['x-device-id']).toBe('test-approved-device');
    expect(requestHeaders['x-record-id']).toBe(recordId);
    expect(requestHeaders['x-device-signature']).toBe('test-signature');
  });

  test('a device confirmed unapproved neither sends nor keeps the session', async ({ page }) => {
    let requestCount = 0;
    await page.route(REDCAP_ENDPOINT, async (route) => {
      requestCount += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });

    await page.goto('/validation/fixtures/data-queue.html');
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    // A browser that is definitively unapproved - never enrolled, or revoked - must collect
    // nothing at all. Keeping the session would leave participant data on an unapproved
    // device for whenever that device is next enrolled, which is a privacy boundary rather
    // than a queueing detail. (An unreachable status service is a different case: it leaves
    // the device approved, so those sessions are stored and queued - see
    // data-device-auth.spec.js.)
    const recordId = uniqueRecordId('unapproved');
    const result = await page.evaluate(async ({ id }) => {
      delete window.__redcapDeviceSignerForTesting;
      window.__redcapDemoMode = true;
      const outcome = await window.__dataQueue.submitRecord(id, JSON.stringify([{ record_id: id }]));
      await window.__dataQueue.flushQueue();
      return outcome;
    }, { id: recordId });

    expect(requestCount, 'an unapproved device must not transmit').toBe(0);
    expect(result.stored, 'submitRecord must report that nothing was stored').toBe(false);
    expect(await isQueued(page, recordId), 'no demo session may be left on the device').toBe(false);

    // Approving the device afterwards must not resurrect it: there is nothing to resurrect.
    await page.evaluate(async () => {
      window.__redcapDemoMode = false;
      window.__redcapDeviceSignerForTesting = async (recordId) => ({
        'X-Device-Id': 'test-approved-device',
        'X-Record-Id': recordId,
        'X-Request-Timestamp': '1788523200',
        'X-Request-Nonce': 'AAAAAAAAAAAAAAAAAAAAAA',
        'X-Device-Signature': 'test-signature',
      });
      await window.__dataQueue.flushQueue();
    });

    expect(requestCount).toBe(0);
    expect(await isQueued(page, recordId)).toBe(false);
  });

  test('a failed send leaves the record queued, and a later flush drains it', async ({ page }) => {
    const { setFailing } = await mockRedcapEndpoint(page);

    await page.goto('/validation/fixtures/data-queue.html');
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    const recordId = uniqueRecordId('flush');

    // Endpoint failing throughout: submitRecord() must not throw, and the record must still
    // be in the outbox once the delivery pass has failed.
    await submitAndFlush(page, recordId);
    expect(await isQueued(page, recordId), 'record should remain queued after a failed send').toBe(true);

    // Endpoint recovers; an explicit flush exercises the same path used when the next
    // session loads and should drain it.
    setFailing(false);
    await page.evaluate(() => window.__dataQueue.flushQueue());
    expect(await isQueued(page, recordId), 'record should be removed once the send succeeds').toBe(false);
  });

  test('a failed pass retries on its own without a further save', async ({ page }) => {
    const { setFailing } = await mockRedcapEndpoint(page);

    await page.goto('/validation/fixtures/data-queue.html');
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    // The final save of a session is never followed by another save, so the outbox has to
    // retry by itself rather than waiting for the next page load.
    const recordId = uniqueRecordId('auto-retry');
    await page.evaluate(() => {
      window.__redcapRetryDelayMsForTesting = 50;
    });
    await submitAndFlush(page, recordId);
    expect(await isQueued(page, recordId)).toBe(true);

    setFailing(false);
    await expect
      .poll(() => isQueued(page, recordId), {
        message: 'a failed record should be retried automatically once the endpoint recovers',
        timeout: 5000,
      })
      .toBe(false);
  });

  test('a record still queued after a page reload is picked up by the load-time flush', async ({ page }) => {
    const { setFailing } = await mockRedcapEndpoint(page);

    await page.goto('/validation/fixtures/data-queue.html');
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    const recordId = uniqueRecordId('reload');
    await submitAndFlush(page, recordId);
    expect(await isQueued(page, recordId)).toBe(true);

    // Endpoint recovers, then the page reloads (simulating this tablet's next page load,
    // e.g. for the next task or participant) - data-queue.js flushes once on module load,
    // with no test code calling flushQueue() explicitly this time.
    setFailing(false);
    await page.reload();
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    await expect
      .poll(() => isQueued(page, recordId), {
        message: 'record queued before reload should be sent automatically on load',
        timeout: 5000,
      })
      .toBe(false);
  });

  test('a snapshot written while a send is in flight is not deleted by that send', async ({ page }) => {
    const requestBodies = [];
    const releaseRequest = [];

    // Hold each response until the test releases it, so the older request is still in flight
    // while a newer cumulative snapshot is stored for the same REDCap row.
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

    const recordId = uniqueRecordId('in-flight');
    const firstFlush = page.evaluate(
      async ({ id }) => {
        await window.__dataQueue.submitRecord(id, JSON.stringify([{ record_id: id, snapshot: 'older' }]));
        await window.__dataQueue.flushQueue();
      },
      { id: recordId }
    );
    await expect.poll(() => requestBodies.length).toBe(1);

    await page.evaluate(
      ({ id }) => window.__dataQueue.submitRecord(id, JSON.stringify([{ record_id: id, snapshot: 'newer' }])),
      { id: recordId }
    );

    // One sender means a second request cannot start while the first is in flight;
    // otherwise a slow older response could overwrite the newer value in REDCap.
    await page.waitForTimeout(100);
    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0][0].snapshot).toBe('older');

    // The older send succeeds, but its compare-and-delete must not remove the newer
    // snapshot that replaced it, and the follow-up pass must send that newer snapshot.
    await releaseRequest[0]();
    await expect.poll(() => requestBodies.length).toBe(2);
    expect(requestBodies[1][0].snapshot).toBe('newer');
    expect(requestBodies.map((body) => body[0].snapshot_version)).toEqual([1, 2]);

    await releaseRequest[1]();
    await firstFlush;
    expect(await isQueued(page, recordId)).toBe(false);
  });

  test('a newer save replaces a failed snapshot without re-sending the older payload', async ({ page }) => {
    let failing = true;
    const requestBodies = [];
    await page.route(REDCAP_ENDPOINT, async (route) => {
      requestBodies.push(JSON.parse(route.request().postData()));
      await route.fulfill({
        status: failing ? 500 : 200,
        contentType: 'application/json',
        body: failing ? '{"error":"mocked failure"}' : '{"ok":true}'
      });
    });

    await page.goto('/validation/fixtures/data-queue.html');
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    const recordId = uniqueRecordId('replace');
    await submitAndFlush(page, recordId, { snapshot: 'older' });
    expect(requestBodies).toHaveLength(1);

    // Saves are cumulative, so the newer snapshot replaces the failed one in place and only
    // that newer payload is ever sent again.
    failing = false;
    await submitAndFlush(page, recordId, { snapshot: 'newer' });

    expect(requestBodies.map((body) => body[0].snapshot)).toEqual(['older', 'newer']);
    expect(requestBodies.map((body) => body[0].snapshot_version)).toEqual([1, 2]);
    expect(await isQueued(page, recordId)).toBe(false);
  });

  test('snapshot versions continue increasing after successful sends clear the queue', async ({ page }) => {
    const requestBodies = [];
    await page.route(REDCAP_ENDPOINT, async (route) => {
      requestBodies.push(JSON.parse(route.request().postData()));
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });

    await page.goto('/validation/fixtures/data-queue.html');
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    const recordId = uniqueRecordId('versions-after-success');
    for (const snapshot of ['first', 'second']) {
      await submitAndFlush(page, recordId, { snapshot });
    }

    expect(requestBodies.map((body) => body[0].snapshot_version)).toEqual([1, 2]);
  });

  test('snapshot versions are allocated atomically across tabs', async ({ context, page }) => {
    await context.route(REDCAP_ENDPOINT, async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"mocked failure"}' });
    });

    const secondPage = await context.newPage();
    await Promise.all([
      page.goto('/validation/fixtures/data-queue.html'),
      secondPage.goto('/validation/fixtures/data-queue.html')
    ]);
    await Promise.all([
      page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true),
      secondPage.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true)
    ]);

    const recordId = uniqueRecordId('cross-tab-version');
    await Promise.all([
      page.evaluate(
        ({ id }) => window.__dataQueue.submitRecord(id, JSON.stringify([{ record_id: id, tab: 'first' }])),
        { id: recordId }
      ),
      secondPage.evaluate(
        ({ id }) => window.__dataQueue.submitRecord(id, JSON.stringify([{ record_id: id, tab: 'second' }])),
        { id: recordId }
      )
    ]);

    const [queuedEntry] = await page.evaluate((id) =>
      window.__dataQueue.listQueuedRecords().then((records) => records.filter((record) => record.record_id === id))
    , recordId);
    expect(queuedEntry.version).toBe(2);
    expect(JSON.parse(queuedEntry.payload)[0].snapshot_version).toBe(2);
  });

  test('development-mode saves are neither transmitted nor left in the outbox', async ({ page }) => {
    let requestCount = 0;
    await page.route(REDCAP_ENDPOINT, async (route) => {
      requestCount += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });

    await page.goto('/validation/fixtures/data-queue.html');
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    // Nothing ever drains a development host, so storing there would accumulate records for
    // good and raise the pending-data notice on later local runs.
    const recordId = uniqueRecordId('dev-host');
    const result = await page.evaluate(async ({ id }) => {
      window.__forceOnlineRedcapForTesting = false;
      const outcome = await window.__dataQueue.submitRecord(id, JSON.stringify([{ record_id: id }]));
      await window.__dataQueue.flushQueue();
      return outcome;
    }, { id: recordId });

    expect(requestCount, 'development mode must not transmit').toBe(0);
    expect(result.stored).toBe(false);
    expect(await isQueued(page, recordId), 'a local run must not build a permanent backlog').toBe(false);
  });

  test('the storage check commits a probe write and leaves nothing behind', async ({ page }) => {
    await mockRedcapEndpoint(page);

    await page.goto('/validation/fixtures/data-queue.html');
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    const result = await page.evaluate(async () => ({
      available: await window.__dataQueue.isQueueAvailable(),
      pending: await window.__dataQueue.getPendingCount(),
      queuedIds: (await window.__dataQueue.listQueuedRecords()).map((record) => record.record_id),
    }));

    expect(result.available).toBe(true);
    // The probe is written and removed in one transaction, so it can never be counted as
    // pending data or picked up by a delivery pass.
    expect(result.pending).toBe(0);
    expect(result.queuedIds).toEqual([]);
  });

  test('the storage check fails a browser that cannot commit a write', async ({ page }) => {
    await mockRedcapEndpoint(page);

    await page.goto('/validation/fixtures/data-queue.html');
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    // A browser restricted to read-only site data, or one out of quota, opens the database
    // quite happily and only then refuses to write. Opening a connection is therefore not
    // evidence that a session can be collected safely.
    const available = await page.evaluate(async () => {
      const originalTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
        if (mode === 'readwrite') {
          throw new DOMException('site data is read-only', 'InvalidStateError');
        }
        return originalTransaction.call(this, stores, mode, ...rest);
      };
      try {
        return await window.__dataQueue.isQueueAvailable();
      } finally {
        IDBDatabase.prototype.transaction = originalTransaction;
      }
    });

    expect(available).toBe(false);
  });

  test('a snapshot that cannot be stored announces itself', async ({ page }) => {
    await mockRedcapEndpoint(page);

    await page.goto('/validation/fixtures/data-queue.html');
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    // Nothing downstream awaits a save - interim saves are fire-and-forget and the final one
    // runs from an unawaited jsPsych callback - so a storage failure that only rejects a
    // promise reaches nobody. It has to be announced for staff to act on.
    const recordId = uniqueRecordId('storage-failure');
    const result = await page.evaluate(async ({ id }) => {
      const failures = [];
      const unsubscribe = window.__dataQueue.onStorageFailure((failure) => failures.push(failure.record_id));
      const originalTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
        if (mode === 'readwrite') {
          throw new DOMException('quota exceeded', 'QuotaExceededError');
        }
        return originalTransaction.call(this, stores, mode, ...rest);
      };
      let rejected = false;
      try {
        await window.__dataQueue.submitRecord(id, JSON.stringify([{ record_id: id }]));
      } catch (error) {
        rejected = true;
      } finally {
        IDBDatabase.prototype.transaction = originalTransaction;
        unsubscribe();
      }
      return { rejected, failures };
    }, { id: recordId });

    expect(result.rejected, 'an unstored snapshot must not resolve as if it were saved').toBe(true);
    expect(result.failures).toEqual([recordId]);
    expect(await isQueued(page, recordId)).toBe(false);
  });

  test('pending count uses the IndexedDB count operation without loading payloads', async ({ page }) => {
    await mockRedcapEndpoint(page);

    await page.goto('/validation/fixtures/data-queue.html');
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    const recordId = uniqueRecordId('count');
    await submitAndFlush(page, recordId);

    const pendingCount = await page.evaluate(async () => {
      const originalGetAll = IDBObjectStore.prototype.getAll;
      IDBObjectStore.prototype.getAll = () => {
        throw new Error('getAll should not be called when counting records');
      };
      try {
        return await window.__dataQueue.getPendingCount();
      } finally {
        IDBObjectStore.prototype.getAll = originalGetAll;
      }
    });

    expect(pendingCount).toBe(1);
  });

  test('a stalled request does not prevent other queued records from sending', async ({ page }) => {
    let phase = 'queue';
    const flushAttempts = [];
    let releaseStalledRequest;
    const recordPrefix = uniqueRecordId('timeout');
    const stalledRecordId = `${recordPrefix}_a-stalled`;
    const laterRecordId = `${recordPrefix}_b-later`;

    await page.route(REDCAP_ENDPOINT, async (route) => {
      const [{ record_id: recordId }] = JSON.parse(route.request().postData());
      if (phase === 'queue') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"mocked failure"}' });
        return;
      }

      flushAttempts.push(recordId);
      if (recordId === stalledRecordId) {
        await new Promise((resolve) => {
          releaseStalledRequest = async () => {
            await route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: '{"error":"mocked failure"}'
            });
            resolve();
          };
        });
        return;
      }

      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });

    await page.goto('/validation/fixtures/data-queue.html');
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    for (const recordId of [stalledRecordId, laterRecordId]) {
      await submitAndFlush(page, recordId);
    }

    phase = 'flush';
    const flushPromise = page.evaluate(async () => {
      window.__redcapRequestTimeoutMsForTesting = 5000;
      return window.__dataQueue.flushQueue();
    });

    await expect.poll(
      () => flushAttempts,
      { message: 'an independent record should start while the first is stalled', timeout: 1000 }
    ).toEqual([stalledRecordId, laterRecordId]);

    await releaseStalledRequest();
    await flushPromise;

    expect(flushAttempts).toEqual([stalledRecordId, laterRecordId]);
    expect(await queuedRecordIds(page)).toEqual([stalledRecordId]);
  });

  test('a flush starts no more than four records concurrently', async ({ page }) => {
    let phase = 'queue';
    const flushAttempts = [];
    const releaseByRecord = new Map();
    const recordPrefix = uniqueRecordId('bounded-flush');
    const recordIds = Array.from({ length: 5 }, (_, index) => `${recordPrefix}_${index}`);

    await page.route(REDCAP_ENDPOINT, async (route) => {
      const [{ record_id: recordId }] = JSON.parse(route.request().postData());
      if (phase === 'queue') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"mocked failure"}' });
        return;
      }

      flushAttempts.push(recordId);
      await new Promise((resolve) => {
        releaseByRecord.set(recordId, async () => {
          await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"mocked failure"}' });
          resolve();
        });
      });
    });

    await page.goto('/validation/fixtures/data-queue.html');
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    for (const recordId of recordIds) {
      await submitAndFlush(page, recordId);
    }

    phase = 'flush';
    const flushPromise = page.evaluate(() => window.__dataQueue.flushQueue());

    await expect.poll(() => flushAttempts.length).toBe(4);
    await page.waitForTimeout(100);
    expect(flushAttempts).toHaveLength(4);

    await releaseByRecord.get(flushAttempts[0])();
    await expect.poll(() => flushAttempts.length).toBe(5);

    await Promise.all(
      flushAttempts.slice(1).map((recordId) => releaseByRecord.get(recordId)())
    );
    await flushPromise;

    expect(flushAttempts).toHaveLength(5);
  });
});

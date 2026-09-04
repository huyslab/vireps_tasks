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
  test.beforeEach(async ({ context }) => {
    // Forces isDevHost() to false so submitRecord()/flushQueue() attempt real fetch()es
    // against the (mocked) endpoint even though the page is served from 127.0.0.1.
    // addInitScript re-runs on every navigation within this page, so it also covers the
    // reload in the third test below.
    await context.addInitScript(() => {
      window.__forceOnlineRedcapForTesting = true;
      window.__redcapDeviceSignerForTesting = async (recordId) => ({
        'X-Device-Id': 'test-approved-device',
        'X-Record-Id': recordId,
        'X-Request-Timestamp': '1788523200',
        'X-Request-Nonce': 'AAAAAAAAAAAAAAAAAAAAAA',
        'X-Device-Signature': 'test-signature',
      });
    });
  });

  test('an unapproved demo device neither transmits nor queues data', async ({ page }) => {
    let requestCount = 0;
    await page.route(REDCAP_ENDPOINT, async (route) => {
      requestCount += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });

    await page.goto('/validation/fixtures/data-queue.html');
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    const recordId = uniqueRecordId('demo');
    const result = await page.evaluate(async ({ id }) => {
      delete window.__redcapDeviceSignerForTesting;
      window.__redcapDemoMode = true;
      return window.__dataQueue.submitRecord(
        id,
        JSON.stringify([{ record_id: id }]),
        0,
        () => {}
      );
    }, { id: recordId });

    expect(result).toEqual({ persisted: false, skipped: true });
    expect(requestCount).toBe(0);
    const queued = await page.evaluate((id) =>
      window.__dataQueue.listQueuedRecords().then((records) => records.some((record) => record.record_id === id))
    , recordId);
    expect(queued).toBe(false);
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
    await page.evaluate(
      ({ id }) => new Promise((resolve) => {
        window.__dataQueue.submitRecord(id, JSON.stringify([{ record_id: id }]), 0, () => resolve());
      }),
      { id: recordId }
    );

    expect(requestHeaders['x-device-id']).toBe('test-approved-device');
    expect(requestHeaders['x-record-id']).toBe(recordId);
    expect(requestHeaders['x-device-signature']).toBe('test-signature');
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

    // Endpoint recovers; an explicit flush exercises the same path used once when the next
    // session loads and should drain it.
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
    expect(requestBodies.map((body) => body[0].snapshot_version)).toEqual([1, 2]);

    await releaseRequest[1]();
    await expect.poll(
      () => page.evaluate((id) =>
        window.__dataQueue.listQueuedRecords().then((records) => records.some((r) => r.record_id === id))
      , recordId)
    ).toBe(false);
  });

  test('a newer successful save replaces a failed snapshot without re-sending the older payload', async ({ page }) => {
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
    await page.evaluate(
      ({ id }) => new Promise((resolve) => {
        window.__dataQueue.submitRecord(
          id,
          JSON.stringify([{ record_id: id, snapshot: 'older' }]),
          0,
          () => resolve()
        );
      }),
      { id: recordId }
    );

    // Reconnects do not drain the local queue under the coalescing strategy. The next
    // cumulative save replaces the failed snapshot and gets its own direct attempt.
    failing = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(100);
    expect(requestBodies).toHaveLength(1);

    await page.evaluate(
      ({ id }) => new Promise((resolve) => {
        window.__dataQueue.submitRecord(
          id,
          JSON.stringify([{ record_id: id, snapshot: 'newer' }]),
          0,
          () => resolve()
        );
      }),
      { id: recordId }
    );

    expect(requestBodies.map((body) => body[0].snapshot)).toEqual(['older', 'newer']);
    expect(requestBodies.map((body) => body[0].snapshot_version)).toEqual([1, 2]);
    const queued = await page.evaluate((id) =>
      window.__dataQueue.listQueuedRecords().then((records) => records.some((record) => record.record_id === id))
    , recordId);
    expect(queued).toBe(false);
  });

  test('a successful fallback send removes an older snapshot left by a transient write failure', async ({ page }) => {
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

    const recordId = uniqueRecordId('fallback-cleanup');
    await page.evaluate(
      ({ id }) => new Promise((resolve) => {
        window.__dataQueue.submitRecord(
          id,
          JSON.stringify([{ record_id: id, snapshot: 'older' }]),
          0,
          () => resolve()
        );
      }),
      { id: recordId }
    );

    failing = false;
    const fallbackResult = await page.evaluate(async ({ id }) => {
      const originalPut = IDBObjectStore.prototype.put;
      let failedQueueWrite = false;
      IDBObjectStore.prototype.put = function (...args) {
        if (!failedQueueWrite && this.name === 'records') {
          failedQueueWrite = true;
          this.transaction.abort();
          return undefined;
        }
        return originalPut.apply(this, args);
      };

      try {
        let resolveCallback;
        const callbackFinished = new Promise((resolve) => {
          resolveCallback = resolve;
        });
        const persistence = await window.__dataQueue.submitRecord(
          id,
          JSON.stringify([{ record_id: id, snapshot: 'newer' }]),
          0,
          (error) => resolveCallback(error ? error.message : null)
        );
        const callbackError = await callbackFinished;
        return { ...persistence, callbackError, failedQueueWrite };
      } finally {
        IDBObjectStore.prototype.put = originalPut;
      }
    }, { id: recordId });

    expect(fallbackResult).toEqual({
      persisted: false,
      skipped: false,
      callbackError: null,
      failedQueueWrite: true
    });
    expect(requestBodies.map((body) => body[0].snapshot)).toEqual(['older', 'newer']);
    expect(requestBodies[1][0].snapshot_version).toBeGreaterThan(requestBodies[0][0].snapshot_version);

    const queued = await page.evaluate((id) =>
      window.__dataQueue.listQueuedRecords().then((records) => records.some((record) => record.record_id === id))
    , recordId);
    expect(queued, 'the older queued snapshot must not survive the newer successful fallback send').toBe(false);
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
      await page.evaluate(
        ({ id, value }) => new Promise((resolve) => {
          window.__dataQueue.submitRecord(
            id,
            JSON.stringify([{ record_id: id, snapshot: value }]),
            0,
            () => resolve()
          );
        }),
        { id: recordId, value: snapshot }
      );
    }

    expect(requestBodies.map((body) => body[0].snapshot_version)).toEqual([1, 2]);
  });

  test('snapshot versions are allocated atomically across tabs', async ({ context, page }) => {
    await context.route(REDCAP_ENDPOINT, async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"mocked failure"}' });
    });

    const secondPage = await context.newPage();
    await secondPage.addInitScript(() => {
      window.__forceOnlineRedcapForTesting = true;
    });
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
        ({ id }) => new Promise((resolve) => {
          window.__dataQueue.submitRecord(id, JSON.stringify([{ record_id: id, tab: 'first' }]), 0, () => resolve());
        }),
        { id: recordId }
      ),
      secondPage.evaluate(
        ({ id }) => new Promise((resolve) => {
          window.__dataQueue.submitRecord(id, JSON.stringify([{ record_id: id, tab: 'second' }]), 0, () => resolve());
        }),
        { id: recordId }
      )
    ]);

    const [queuedEntry] = await page.evaluate((id) =>
      window.__dataQueue.listQueuedRecords().then((records) => records.filter((record) => record.record_id === id))
    , recordId);
    expect(queuedEntry.version).toBe(2);
    expect(JSON.parse(queuedEntry.payload)[0].snapshot_version).toBe(2);
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

  test('pending count uses the IndexedDB count operation without loading payloads', async ({ page }) => {
    await mockRedcapEndpoint(page);

    await page.goto('/validation/fixtures/data-queue.html');
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    const recordId = uniqueRecordId('count');
    await page.evaluate(
      ({ id }) => new Promise((resolve) => {
        window.__dataQueue.submitRecord(id, JSON.stringify([{ record_id: id }]), 0, () => resolve());
      }),
      { id: recordId }
    );

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

  test('a timed-out request does not prevent later queued records from flushing', async ({ page }) => {
    let phase = 'queue';
    const flushAttempts = [];
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
        // Leave this request half-open well beyond the short test timeout. The production
        // timeout remains 30 seconds; the override only keeps this regression test fast.
        await new Promise((resolve) => setTimeout(resolve, 500));
        try {
          await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
        } catch (error) {
          // Expected: AbortController has already cancelled the intercepted request.
        }
        return;
      }

      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });

    await page.goto('/validation/fixtures/data-queue.html');
    await page.waitForFunction(() => window.__DATA_QUEUE_FIXTURE_READY === true);

    for (const recordId of [stalledRecordId, laterRecordId]) {
      await page.evaluate(
        ({ id }) => new Promise((resolve) => {
          window.__dataQueue.submitRecord(id, JSON.stringify([{ record_id: id }]), 0, () => resolve());
        }),
        { id: recordId }
      );
    }

    phase = 'flush';
    await page.evaluate(async () => {
      window.__redcapRequestTimeoutMsForTesting = 50;
      await window.__dataQueue.flushQueue();
    });

    expect(flushAttempts).toEqual([stalledRecordId, laterRecordId]);
    const queuedRecordIds = await page.evaluate(() =>
      window.__dataQueue.listQueuedRecords().then((records) => records.map((record) => record.record_id))
    );
    expect(queuedRecordIds).toEqual([stalledRecordId]);
  });
});

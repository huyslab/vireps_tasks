/**
 * Durable local queue for REDCap submissions.
 *
 * Owns all network mechanics for the single data-saving route (a hardcoded AWS API
 * Gateway -> Lambda endpoint that writes into REDCap) and a persistent, origin-scoped
 * queue backed by IndexedDB. The queue exists because the study runs on tablets with a
 * potentially unreliable internet connection: a record is written to IndexedDB before any
 * network attempt is made, and it is only ever removed once the endpoint confirms receipt.
 * A failed attempt - however many times it fails, across however many page loads - never
 * discards the record; it stays queued for the next flush.
 *
 * IndexedDB rather than localStorage: payloads are full per-module jsPsych trial data
 * (potentially several hundred KB), and localStorage is synchronous (blocks the main thread
 * on every read/write of a large string) with a small, easy-to-exhaust quota. IndexedDB is a
 * native browser API - no new dependency, consistent with this repo having zero runtime
 * dependencies and no build step.
 */

const DB_NAME = 'redcap_pending_queue';
const DB_VERSION = 1;
const STORE_NAME = 'records';
const REDCAP_ENDPOINT = 'https://4csc8jmaw2.execute-api.eu-north-1.amazonaws.com/Prod/pharmaciespilot';

// Frequent enough to drain a backlog reasonably soon after connectivity returns,
// infrequent enough not to hammer a flaky-but-not-fully-offline connection.
const FLUSH_INTERVAL_MS = 45000;

let dbPromise = null;
let flushInFlight = false;
let recordVersionCounter = 0;
const recordSendChains = new Map();

function createRecordVersion() {
    recordVersionCounter += 1;
    return `${Date.now()}-${recordVersionCounter}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Whether network sends should be skipped (development/test mode).
 * Mirrors the previous behaviour of skipping saves on localhost/127.0.0.1, now applied
 * uniformly rather than only to the disused parent-window route. The
 * window.__forceOnlineRedcapForTesting escape hatch lets a dedicated Playwright spec
 * exercise the real send/retry/flush logic while still served from 127.0.0.1.
 * @returns {boolean}
 */
function isDevHost() {
    if (window.__forceOnlineRedcapForTesting === true) {
        return false;
    }
    return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

/**
 * Opens (creating if necessary) the IndexedDB database backing the queue. Cached so
 * repeated calls share one connection.
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
    if (dbPromise) {
        return dbPromise;
    }
    if (!('indexedDB' in window)) {
        dbPromise = Promise.reject(new Error('IndexedDB unavailable in this browser context'));
        return dbPromise;
    }
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE_NAME)) {
                request.result.createObjectStore(STORE_NAME, { keyPath: 'record_id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    return dbPromise;
}

/**
 * Persists a record to the queue, overwriting any existing entry with the same record_id
 * (an interim save for the same module supersedes the previous one rather than piling up).
 * Never throws: if IndexedDB is unavailable, logs a warning and resolves anyway so the
 * caller can still attempt a direct send.
 * @param {string} record_id
 * @param {string} payload - Already-serialized JSON body to POST.
 * @returns {Promise<Object|null>} The stored queue entry, or null if persistence failed.
 */
async function enqueueRecord(record_id, payload) {
    const entry = {
        record_id,
        payload,
        queued_at: new Date().toISOString(),
        version: createRecordVersion()
    };
    try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(entry);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        return entry;
    } catch (error) {
        console.warn('data-queue: could not persist record for later retry (IndexedDB unavailable?); falling back to best-effort send only:', error);
        return null;
    }
}

/**
 * Checks whether an entry is still the newest queued snapshot for its record.
 * Older in-flight snapshots must not be sent again after a newer save supersedes them.
 * @param {{record_id: string, version?: string}} entry
 * @returns {Promise<boolean>}
 */
async function isCurrentEntry(entry) {
    try {
        const db = await openDB();
        const current = await new Promise((resolve, reject) => {
            const request = db.transaction(STORE_NAME, 'readonly')
                .objectStore(STORE_NAME)
                .get(entry.record_id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
        return current !== null && current.version === entry.version;
    } catch (error) {
        // If the queue cannot be inspected, allow the best-effort network attempt. This is
        // preferable to silently suppressing a record when IndexedDB becomes unavailable.
        return true;
    }
}

/**
 * Removes an entry only if it is still the newest queued snapshot for that record. The
 * comparison and delete share one transaction, so a successful older request can never
 * delete a newer snapshot that was queued while it was in flight.
 * @param {{record_id: string, version?: string}} entry
 * @returns {Promise<void>}
 */
async function dequeueIfCurrent(entry) {
    try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(entry.record_id);
            request.onsuccess = () => {
                if (request.result && request.result.version === entry.version) {
                    store.delete(entry.record_id);
                }
            };
            request.onerror = () => reject(request.error);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    } catch (error) {
        console.warn(`data-queue: could not remove ${entry.record_id} from the queue after a successful send:`, error);
    }
}

/**
 * Lists every record currently queued. Never throws: returns an empty array if IndexedDB
 * is unavailable or the read fails.
 * @returns {Promise<Array<{record_id: string, payload: string, queued_at: string, version?: string}>>}
 */
async function listQueuedRecords() {
    try {
        const db = await openDB();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const request = tx.objectStore(STORE_NAME).getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        return [];
    }
}

/**
 * Number of submissions currently queued locally, unconfirmed by REDCap.
 * @returns {Promise<number>}
 */
async function getPendingCount() {
    return (await listQueuedRecords()).length;
}

// Exposed for a quick devtools check on a tablet ("is this device carrying a backlog?"),
// independent of the on-page gate in experiment.html.
if (typeof window !== 'undefined') {
    window.getPendingSubmissionsCount = getPendingCount;
}

/**
 * Performs a single POST to the REDCap Lambda endpoint. Treats a non-2xx response as a
 * failure (the previous implementation only checked the response's parsed JSON body for a
 * status field, which meant an HTTP-level error was never actually retried).
 * @param {string} payload
 * @returns {Promise<*>} Parsed JSON response body, or null if the body wasn't JSON.
 */
async function sendOnce(payload) {
    const response = await fetch(REDCAP_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: payload
    });
    if (!response.ok) {
        throw new Error(`REDCap endpoint responded with HTTP ${response.status}`);
    }
    return response.json().catch(() => null);
}

/**
 * Serializes sends for one REDCap record. Interim saves are cumulative snapshots that all
 * target the same REDCap row, so allowing two versions to arrive out of order could leave
 * the server with the older snapshot even if both requests succeed.
 * @param {string} record_id
 * @param {Function} work
 * @returns {Promise<*>}
 */
function serializeRecordSend(record_id, work) {
    const previous = recordSendChains.get(record_id) || Promise.resolve();
    const current = previous.catch(() => {}).then(work);
    recordSendChains.set(record_id, current);

    const cleanup = () => {
        if (recordSendChains.get(record_id) === current) {
            recordSendChains.delete(record_id);
        }
    };
    current.then(cleanup, cleanup);
    return current;
}

function invokeCallback(callback, error) {
    try {
        callback(error);
    } catch (callbackError) {
        // A consumer callback must not turn a confirmed submission into a network retry.
        console.error('data-queue: submission callback threw:', callbackError);
    }
}

function wait(delay) {
    return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Immediate retry loop for a single record, used right after it's built (short backoff,
 * bounded by retriesLeft). Exhausting retriesLeft does NOT drop the record - it stays
 * queued in IndexedDB for flushQueue() to keep retrying in the background.
 * @param {{record_id: string, payload: string, version?: string}} entry
 * @param {number} retriesLeft
 * @param {Function} callback
 */
function attemptWithRetries(entry, retriesLeft, callback) {
    serializeRecordSend(entry.record_id, async () => {
        let remaining = Math.max(0, Number(retriesLeft) || 0);

        while (true) {
            if (entry.version && !(await isCurrentEntry(entry))) {
                // A newer cumulative snapshot contains everything in this one. Let that
                // snapshot send next instead of delaying it or later overwriting it.
                invokeCallback(callback);
                return;
            }

            try {
                const body = await sendOnce(entry.payload);
                console.log('Data successfully submitted to REDCap:', body);
                if (entry.version) {
                    await dequeueIfCurrent(entry);
                }
                invokeCallback(callback);
                // Network is clearly working - opportunistically drain any other backlog.
                flushQueue();
                return;
            } catch (error) {
                console.warn(`data-queue: submit attempt failed for ${entry.record_id}:`, error);
                if (remaining > 0) {
                    remaining -= 1;
                    await wait(1000);
                    continue;
                }
                console.warn(`data-queue: exhausted immediate retries for ${entry.record_id}; left queued for background flush (page reload / reconnect / periodic retry).`);
                invokeCallback(callback, error);
                return;
            }
        }
    }).catch((error) => {
        console.error(`data-queue: unexpected submission failure for ${entry.record_id}:`, error);
        invokeCallback(callback, error);
    });
}

/**
 * Queues a record and attempts to submit it to REDCap.
 * Write-ahead: the record is persisted to IndexedDB before any network attempt, so it
 * survives a crash or reload mid-attempt.
 * @param {string} record_id
 * @param {string} payload - Already-serialized JSON body to POST.
 * @param {number} immediateRetries - Immediate/synchronous retry attempts before falling
 *   back to the background queue.
 * @param {Function} callback - Called with no arguments on success, or an Error once
 *   immediate retries are exhausted (the record remains queued regardless).
 * @returns {Promise<{persisted: boolean, skipped: boolean}>} Resolves once the write-ahead
 *   persistence step is complete and the network attempt has been scheduled.
 */
async function submitRecord(record_id, payload, immediateRetries, callback = () => {}) {
    if (isDevHost()) {
        console.log('Development mode: skipping REDCap network save.');
        invokeCallback(callback);
        return { persisted: false, skipped: true };
    }

    const queuedEntry = await enqueueRecord(record_id, payload);
    const entry = queuedEntry || { record_id, payload };
    attemptWithRetries(entry, immediateRetries, callback);
    return { persisted: queuedEntry !== null, skipped: false };
}

/**
 * Attempts to send every currently-queued record. Records that send successfully are
 * removed; records that fail are left in place for the next flush. Guarded against
 * overlapping runs (e.g. an 'online' event firing during a periodic tick).
 * @returns {Promise<void>}
 */
async function flushQueue() {
    if (isDevHost() || flushInFlight) {
        return;
    }
    flushInFlight = true;
    try {
        const records = await listQueuedRecords();
        if (records.length === 0) {
            return;
        }
        console.log(`data-queue: attempting to flush ${records.length} pending record(s)`);
        for (const entry of records) {
            await serializeRecordSend(entry.record_id, async () => {
                // The snapshot returned by getAll() may have been replaced while earlier
                // records were flushing. Never send that stale copy after its replacement.
                if (!(await isCurrentEntry(entry))) {
                    return;
                }
                try {
                    await sendOnce(entry.payload);
                    await dequeueIfCurrent(entry);
                    console.log(`data-queue: flushed pending record ${entry.record_id}`);
                } catch (error) {
                    console.warn(`data-queue: still unable to send ${entry.record_id}; will retry later:`, error);
                    // Left in place - never deleted on failure.
                }
            });
        }
    } finally {
        flushInFlight = false;
    }
}

// Wire up background flush triggers once per page load. This file is only evaluated once
// per page regardless of how many modules import it (ES module caching), so this runs a
// single time.
if (typeof window !== 'undefined') {
    flushQueue(); // catches anything stranded by a previous session/task on this tablet
    window.addEventListener('online', () => flushQueue());
    setInterval(() => flushQueue(), FLUSH_INTERVAL_MS);
}

export {
    submitRecord,
    flushQueue,
    getPendingCount,
    listQueuedRecords,
    isDevHost
};

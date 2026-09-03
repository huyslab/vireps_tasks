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
 * @returns {Promise<void>}
 */
async function enqueueRecord(record_id, payload) {
    try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put({ record_id, payload, queued_at: new Date().toISOString() });
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    } catch (error) {
        console.warn('data-queue: could not persist record for later retry (IndexedDB unavailable?); falling back to best-effort send only:', error);
    }
}

/**
 * Removes a record from the queue (call only once its submission is confirmed).
 * @param {string} record_id
 * @returns {Promise<void>}
 */
async function dequeueRecord(record_id) {
    try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(record_id);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    } catch (error) {
        console.warn(`data-queue: could not remove ${record_id} from the queue after a successful send:`, error);
    }
}

/**
 * Lists every record currently queued. Never throws: returns an empty array if IndexedDB
 * is unavailable or the read fails.
 * @returns {Promise<Array<{record_id: string, payload: string, queued_at: string}>>}
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
 * Immediate retry loop for a single record, used right after it's built (short backoff,
 * bounded by retriesLeft). Exhausting retriesLeft does NOT drop the record - it stays
 * queued in IndexedDB for flushQueue() to keep retrying in the background.
 * @param {string} record_id
 * @param {string} payload
 * @param {number} retriesLeft
 * @param {Function} callback
 */
function attemptWithRetries(record_id, payload, retriesLeft, callback) {
    sendOnce(payload)
        .then(async (body) => {
            console.log('Data successfully submitted to REDCap:', body);
            await dequeueRecord(record_id);
            callback();
            // Network is clearly working - opportunistically drain any other backlog now.
            flushQueue();
        })
        .catch((error) => {
            console.warn(`data-queue: submit attempt failed for ${record_id}:`, error);
            if (retriesLeft > 0) {
                setTimeout(() => attemptWithRetries(record_id, payload, retriesLeft - 1, callback), 1000);
            } else {
                console.warn(`data-queue: exhausted immediate retries for ${record_id}; left queued for background flush (page reload / reconnect / periodic retry).`);
                callback(error);
            }
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
 */
async function submitRecord(record_id, payload, immediateRetries, callback) {
    await enqueueRecord(record_id, payload);

    if (isDevHost()) {
        console.log('Development mode: skipping REDCap network save.');
        callback();
        return;
    }

    attemptWithRetries(record_id, payload, immediateRetries, callback);
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
        for (const { record_id, payload } of records) {
            try {
                await sendOnce(payload);
                await dequeueRecord(record_id);
                console.log(`data-queue: flushed pending record ${record_id}`);
            } catch (error) {
                console.warn(`data-queue: still unable to send ${record_id}; will retry later:`, error);
                // Left in place - never deleted on failure.
            }
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

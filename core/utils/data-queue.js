import {
    REDCAP_ENDPOINT,
    createSignedRequestHeaders,
    hasDeviceIdentity
} from './device-auth.js';

/**
 * Durable local outbox for REDCap submissions.
 *
 * The study runs on tablets with a potentially unreliable connection, so saving and sending
 * are deliberately separate jobs:
 *
 *   - submitRecord() only writes the newest snapshot to IndexedDB. It never touches the
 *     network, so no failure on the sending side can ever cost data. The one thing it does
 *     consult is whether this session may hold data at all (isCollectionSuppressed) - a
 *     governance question, not a delivery one.
 *   - flushQueue() is the only code that sends. It runs one pass at a time and deletes an
 *     entry only once the endpoint has confirmed receipt.
 *
 * Because every save is a cumulative snapshot targeting one REDCap row (the relay imports
 * with overwriteBehavior "normal"), only the newest snapshot per record is ever worth
 * sending. One sender means one in-flight request per record by construction, so no ordering
 * bookkeeping is needed: the single guard is a compare-and-delete on `version`, which stops a
 * completed send from deleting a snapshot that was written while it was in flight.
 *
 * IndexedDB rather than localStorage: payloads are full per-module jsPsych trial data
 * (potentially several hundred KB), and localStorage is synchronous (blocks the main thread
 * on every read/write of a large string) with a small, easy-to-exhaust quota. IndexedDB is a
 * native browser API - no new dependency, consistent with this repo having zero runtime
 * dependencies and no build step.
 */

const DB_NAME = 'redcap_pending_queue';
const DB_VERSION = 2;
const STORE_NAME = 'records';
const METADATA_STORE_NAME = 'metadata';
const VERSION_COUNTER_KEY = 'snapshot_version';
const STORAGE_PROBE_KEY = '__storage_probe__';
const REDCAP_REQUEST_TIMEOUT_MS = 30000;
const FLUSH_CONCURRENCY = 4;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30000;

let dbPromise = null;
let activeFlush = null;
let flushRequested = false;
let retryTimer = null;
let retryAttempt = 0;
const storageFailureHandlers = new Set();

/**
 * Adds the locally assigned snapshot version to every REDCap record in the request. Keeping
 * it beside the data makes the rare ambiguous/out-of-order network case easy to diagnose in
 * REDCap's record history without making the server responsible for version enforcement.
 * @param {string} payload
 * @param {number} version
 * @returns {string}
 */
function addSnapshotVersion(payload, version) {
    const records = JSON.parse(payload);
    if (!Array.isArray(records) || records.length === 0) {
        throw new Error('REDCap payload must be a non-empty array');
    }
    return JSON.stringify(records.map((record) => ({
        ...record,
        snapshot_version: version
    })));
}

/**
 * Whether this page is running against a development host (localhost/127.0.0.1), where
 * saves are neither sent nor kept. The window.__forceOnlineRedcapForTesting escape hatch
 * lets a dedicated Playwright spec exercise the real store/send logic while still served
 * from 127.0.0.1.
 * @returns {boolean}
 */
function isDevHost() {
    if (window.__forceOnlineRedcapForTesting === true) {
        return false;
    }
    return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

/**
 * Opens (creating if necessary) the IndexedDB database backing the outbox. Cached so
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
            if (!request.result.objectStoreNames.contains(METADATA_STORE_NAME)) {
                request.result.createObjectStore(METADATA_STORE_NAME, { keyPath: 'key' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    dbPromise.catch(() => {
        // A failed open must not be cached as a permanent verdict; the next call retries.
        dbPromise = null;
    });
    return dbPromise;
}

/**
 * Whether this browser can store the outbox at all. Checked once before a session starts:
 * a tablet that cannot durably hold data should not be collecting it (see experiment.html).
 *
 * Opening the database proves too little to gate a session on. A browser with an exhausted
 * quota, or one restricted to read-only site data, hands back a connection quite happily and
 * then rejects every write. So this commits a real readwrite transaction with the same store
 * scope and write footprint as enqueueRecord(), and removes the probe in that same
 * transaction: IndexedDB transactions are atomic, so either both operations commit - leaving
 * nothing for listQueuedRecords()/getPendingCount() to find, whatever happens to the page
 * afterwards - or the transaction aborts and this reports false.
 *
 * What it still cannot promise is that a particular several-hundred-KB snapshot will fit
 * later in the session. That is why an enqueue failure mid-session is announced separately
 * rather than left to the caller (see onStorageFailure).
 * @returns {Promise<boolean>}
 */
async function isQueueAvailable() {
    try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_NAME, METADATA_STORE_NAME], 'readwrite');
            const queueStore = tx.objectStore(STORE_NAME);
            const metadataStore = tx.objectStore(METADATA_STORE_NAME);
            queueStore.put({
                record_id: STORAGE_PROBE_KEY,
                payload: '[]',
                queued_at: new Date().toISOString(),
                version: 0
            });
            queueStore.delete(STORAGE_PROBE_KEY);
            metadataStore.put({ key: STORAGE_PROBE_KEY });
            metadataStore.delete(STORAGE_PROBE_KEY);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('Storage probe transaction aborted'));
        });
        return true;
    } catch (error) {
        console.error('data-queue: local storage for unsent data is unavailable:', error);
        return false;
    }
}

/**
 * Asks the browser to exempt the outbox from best-effort eviction under storage pressure.
 * Best-effort itself: a refusal is not an error, it just leaves the default policy in place.
 */
async function requestPersistentStorage() {
    try {
        if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
            await navigator.storage.persist();
        }
    } catch (error) {
        console.warn('data-queue: could not request persistent storage:', error);
    }
}

/**
 * Writes a record to the outbox, replacing any existing entry with the same record_id (a
 * later cumulative save supersedes the previous one rather than piling up). Version
 * allocation and the replacement share one transaction, making the single origin-wide
 * counter monotonic across records, reloads, and tabs.
 * @param {string} record_id
 * @param {string} payload - Already-serialized JSON body to POST.
 * @returns {Promise<Object>} The versioned entry that was stored.
 * @throws If the record could not be stored, so the caller never mistakes an unstored
 *   snapshot for a safe one.
 */
async function enqueueRecord(record_id, payload) {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME, METADATA_STORE_NAME], 'readwrite');
        const queueStore = tx.objectStore(STORE_NAME);
        const metadataStore = tx.objectStore(METADATA_STORE_NAME);
        const versionRequest = metadataStore.get(VERSION_COUNTER_KEY);
        let entry = null;

        versionRequest.onsuccess = () => {
            const storedVersion = Number.isSafeInteger(versionRequest.result?.last_version)
                ? versionRequest.result.last_version
                : 0;
            const version = storedVersion + 1;
            entry = {
                record_id,
                payload: addSnapshotVersion(payload, version),
                queued_at: new Date().toISOString(),
                version
            };
            metadataStore.put({ key: VERSION_COUNTER_KEY, last_version: version });
            queueStore.put(entry);
        };

        tx.oncomplete = () => resolve(entry);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Snapshot transaction aborted'));
    });
}

/**
 * Removes a confirmed entry, unless a newer snapshot replaced it while the send was in
 * flight. The comparison and the delete share one transaction, so a newer snapshot can never
 * be dropped by an older request's success. This is the only concurrency guard the outbox
 * needs, because flushQueue() is the only sender.
 * @param {{record_id: string, version: number}} entry
 * @returns {Promise<void>}
 */
async function dequeueIfUnchanged(entry) {
    try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(entry.record_id);
            request.onsuccess = () => {
                if (request.result?.version === entry.version) {
                    store.delete(entry.record_id);
                }
            };
            request.onerror = () => reject(request.error);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    } catch (error) {
        console.warn(`data-queue: could not remove ${entry.record_id} from the outbox after a successful send:`, error);
    }
}

/**
 * Lists every record currently waiting to be sent. Never throws: returns an empty array if
 * IndexedDB is unavailable or the read fails.
 * @returns {Promise<Array<{record_id: string, payload: string, queued_at: string, version: number}>>}
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
 * Number of submissions currently in the outbox, unconfirmed by REDCap.
 * @returns {Promise<number>}
 */
async function getPendingCount() {
    try {
        const db = await openDB();
        return await new Promise((resolve, reject) => {
            const request = db.transaction(STORE_NAME, 'readonly')
                .objectStore(STORE_NAME)
                .count();
            request.onsuccess = () => resolve(request.result || 0);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        return 0;
    }
}

// Exposed for a quick devtools check on a tablet ("is this device carrying a backlog?"),
// independent of the one-time on-page notice in experiment.html.
if (typeof window !== 'undefined') {
    window.getPendingSubmissionsCount = getPendingCount;
}

/**
 * Performs a single POST to the REDCap Lambda endpoint. Treats a non-2xx response as a
 * failure so an HTTP-level error is retried. The request is bounded so a half-open
 * connection cannot hold the outbox indefinitely.
 * @param {string} record_id
 * @param {string} payload
 * @returns {Promise<*>} Parsed JSON response body, or null if the body wasn't JSON.
 */
async function sendOnce(record_id, payload) {
    const testingTimeout = Number(window.__redcapRequestTimeoutMsForTesting);
    const timeoutMs = Number.isFinite(testingTimeout) && testingTimeout > 0
        ? testingTimeout
        : REDCAP_REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);

    try {
        const signedHeaders = await createSignedRequestHeaders(record_id);
        const response = await fetch(REDCAP_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...signedHeaders
            },
            body: payload,
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`REDCap endpoint responded with HTTP ${response.status}`);
        }
        // Awaited inside the try so the timeout still covers reading the body: a stalled
        // body would otherwise hold this pass open indefinitely.
        return await response.json().catch(() => null);
    } catch (error) {
        if (timedOut) {
            throw new Error(`REDCap request timed out after ${timeoutMs} ms`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Whether this session must not put participant data on this device at all.
 *
 * Storing is otherwise unconditional, because the outbox exists precisely so that a problem
 * on the sending side never costs data. These two cases are not sending problems, though;
 * they are sessions whose data is never going to leave the device, so writing it would only
 * build a backlog that nothing can drain:
 *
 *   - Development hosts, where canSend() refuses permanently. Repeated local runs would
 *     otherwise accumulate records for good and raise the pending-data notice on later runs.
 *   - Confirmed demo mode, where the browser is definitively unapproved: never enrolled, or
 *     revoked. The study's contract is that such a browser collects nothing, so keeping the
 *     session would leave participant data on an unapproved device, to be uploaded whenever
 *     that device is next enrolled.
 *
 * "Confirmed" is the load-bearing word for demo mode. experiment.html sets the flag from
 * getDeviceAuthorizationStatus(), which reports approved whenever the verdict is merely
 * unavailable - an unreachable or failing status service, a 5xx - so a transient outage
 * still stores and queues normally (see device-auth.js).
 * @returns {boolean}
 */
function isCollectionSuppressed() {
    return isDevHost() || window.__redcapDemoMode === true;
}

/**
 * Whether sending is currently possible. Only ever suppresses transmission - anything this
 * rejects stays in the outbox and is retried later.
 * @returns {Promise<boolean>}
 */
async function canSend() {
    // A suppressed session stores nothing, but a backlog from an earlier one may still be
    // here - and must stay here while the device is unapproved.
    if (isCollectionSuppressed()) {
        return false;
    }
    return await hasDeviceIdentity();
}

/**
 * One delivery pass over everything currently in the outbox. Independent record IDs use a
 * small worker pool so one slow request does not hold up the backlog. Records that fail are
 * left in place, never deleted.
 * @returns {Promise<boolean>} Whether every attempted record was confirmed.
 */
async function drainOnce() {
    if (!(await canSend())) {
        return true;
    }
    const records = await listQueuedRecords();
    if (records.length === 0) {
        return true;
    }
    console.log(`data-queue: attempting to send ${records.length} pending record(s)`);

    let nextRecordIndex = 0;
    let allConfirmed = true;
    const sendNextRecord = async () => {
        while (nextRecordIndex < records.length) {
            const entry = records[nextRecordIndex];
            nextRecordIndex += 1;
            try {
                await sendOnce(entry.record_id, entry.payload);
                await dequeueIfUnchanged(entry);
                console.log(`data-queue: sent pending record ${entry.record_id}`);
            } catch (error) {
                allConfirmed = false;
                console.warn(`data-queue: still unable to send ${entry.record_id}; will retry later:`, error);
            }
        }
    };

    const workerCount = Math.min(FLUSH_CONCURRENCY, records.length);
    await Promise.all(Array.from({ length: workerCount }, () => sendNextRecord()));
    return allConfirmed;
}

/**
 * Attempts delivery of everything in the outbox and resolves when the sender is idle. A call
 * made while a pass is running joins that pass rather than forcing another one.
 * @returns {Promise<void>}
 */
function flushQueue() {
    return activeFlush || startFlushing();
}

/**
 * Like flushQueue(), but guarantees a pass that starts after this call - the pass already
 * running may have listed the outbox before the caller's record was written to it. Used by
 * submitRecord() so a save made mid-flush is never left waiting for the next page load.
 * @returns {Promise<void>}
 */
function requestFlush() {
    if (activeFlush) {
        flushRequested = true;
        return activeFlush;
    }
    return startFlushing();
}

/**
 * Runs delivery passes until no further pass has been requested.
 * @returns {Promise<void>}
 */
function startFlushing() {
    activeFlush = (async () => {
        try {
            let allConfirmed = true;
            do {
                flushRequested = false;
                allConfirmed = await drainOnce();
            } while (flushRequested);
            scheduleRetry(allConfirmed);
        } finally {
            activeFlush = null;
        }
    })();
    return activeFlush;
}

/**
 * Retries automatically after a failed pass with a bounded exponential backoff, so a
 * transient outage resolves within the session instead of waiting for the next page load.
 * This is what replaces the old per-call immediate retry count: it matters most for the
 * final save of a session, after which no further save will poke the sender. Records are
 * safe on disk either way - this only affects how soon they leave.
 * @param {boolean} allConfirmed
 */
function scheduleRetry(allConfirmed) {
    if (allConfirmed) {
        retryAttempt = 0;
        return;
    }
    if (retryTimer !== null) {
        return;
    }
    const testingDelay = Number(window.__redcapRetryDelayMsForTesting);
    const base = Number.isFinite(testingDelay) && testingDelay > 0
        ? testingDelay
        : RETRY_BASE_DELAY_MS;
    const delay = Math.min(base * (2 ** retryAttempt), RETRY_MAX_DELAY_MS);
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
        retryTimer = null;
        flushQueue();
    }, delay);
}

/**
 * Registers a listener for a snapshot that could not be stored, and returns a function that
 * unregisters it.
 *
 * A rejected save reaches nobody on its own: interim saves go through updateState(), which
 * does not await them, and the final save runs from a jsPsych callback that is not awaited
 * either - so the completion screen appears whether or not anything was written. Storage
 * failures therefore have to announce themselves, loudly enough for staff to act on before
 * the tablet moves to the next participant (experiment.html renders the notice).
 * @param {(failure: {record_id: string, error: Error}) => void} handler
 * @returns {() => void}
 */
function onStorageFailure(handler) {
    storageFailureHandlers.add(handler);
    return () => storageFailureHandlers.delete(handler);
}

/**
 * @param {string} record_id
 * @param {Error} error
 */
function reportStorageFailure(record_id, error) {
    console.error(`data-queue: could not store a snapshot for ${record_id}:`, error);
    for (const handler of storageFailureHandlers) {
        try {
            handler({ record_id, error });
        } catch (handlerError) {
            // One broken listener must not stop the others, nor mask the original failure.
            console.error('data-queue: a storage-failure listener threw:', handlerError);
        }
    }
}

/**
 * Records a snapshot for later delivery and pokes the sender.
 *
 * Resolves once the snapshot is durably stored, which is what makes it safe to navigate
 * away - delivery happens independently and is retried until REDCap confirms it. Rejects
 * only if the snapshot could not be stored at all, having first announced that failure to
 * onStorageFailure() listeners.
 *
 * Resolves with stored:false, having written nothing, for a session that must not hold data
 * at all (see isCollectionSuppressed).
 * @param {string} record_id
 * @param {string} payload - Already-serialized JSON body to POST.
 * @returns {Promise<{stored: boolean, version: number|null}>}
 */
async function submitRecord(record_id, payload) {
    if (isCollectionSuppressed()) {
        return { stored: false, version: null };
    }
    let entry;
    try {
        entry = await enqueueRecord(record_id, payload);
    } catch (error) {
        reportStorageFailure(record_id, error);
        throw error;
    }
    requestFlush();
    return { stored: true, version: entry.version };
}

// Retry anything left by an earlier session as soon as this page loads.
if (typeof window !== 'undefined') {
    requestPersistentStorage();
    flushQueue();
}

export {
    submitRecord,
    flushQueue,
    getPendingCount,
    listQueuedRecords,
    isQueueAvailable,
    isDevHost,
    onStorageFailure
};

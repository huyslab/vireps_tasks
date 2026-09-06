/**
 * Per-device authentication for REDCap submissions.
 *
 * Enrollment creates a non-exportable P-256 private key in IndexedDB. Every network
 * attempt signs a fresh, five-minute request credential, so queued records do not carry
 * an authorization token that can expire while the tablet is offline.
 *
 * Requests are signed against the server's clock rather than the device's: a tablet drifted
 * past that five-minute window could otherwise never produce a credential the relay accepts
 * (see currentTimestamp and getDeviceAuthorizationStatus).
 */

const DEVICE_DB_NAME = 'redcap_device_identity';
const DEVICE_DB_VERSION = 1;
const DEVICE_STORE_NAME = 'identity';
const DEVICE_IDENTITY_KEY = 'current_device';
const REQUEST_VERSION = 'v1';
const STATUS_RECORD_ID = '__device_status__';

const REDCAP_ENDPOINT = 'https://4csc8jmaw2.execute-api.eu-north-1.amazonaws.com/Prod/pharmaciespilot';
const DEVICE_ENROLLMENT_ENDPOINT = `${REDCAP_ENDPOINT}/enroll`;
const DEVICE_STATUS_ENDPOINT = `${REDCAP_ENDPOINT}/device-status`;
const DEVICE_STATUS_TIMEOUT_MS = 5000;

let deviceDBPromise = null;
let identityPromise = null;
let serverTimeOffsetSeconds = 0;

/**
 * Seconds since the epoch, corrected by whatever offset the server last reported.
 *
 * Tablets in the field do drift, and the authorizer rejects anything more than five
 * minutes out. Left uncorrected, a drifted device cannot sign a request the server will
 * accept - not the status check, and not a single REDCap write - so its data would queue
 * forever. Signing against the server's clock instead makes the drift irrelevant.
 * @returns {number}
 */
function currentTimestamp() {
    return Math.floor(Date.now() / 1000) + serverTimeOffsetSeconds;
}

/**
 * Records how far this device's clock is from the server's. Every status response carries
 * server_time, including the 401s, so any answer at all is enough to calibrate from.
 * @param {*} serverTime - Unix seconds as reported by the relay.
 */
function calibrateClock(serverTime) {
    const reported = Number(serverTime);
    if (!Number.isFinite(reported)) {
        return;
    }
    serverTimeOffsetSeconds = Math.round(reported - Date.now() / 1000);
}

function openDeviceDB() {
    if (deviceDBPromise) {
        return deviceDBPromise;
    }
    if (!('indexedDB' in window)) {
        return Promise.reject(new Error('IndexedDB is unavailable'));
    }
    deviceDBPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DEVICE_DB_NAME, DEVICE_DB_VERSION);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(DEVICE_STORE_NAME)) {
                request.result.createObjectStore(DEVICE_STORE_NAME, { keyPath: 'key' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    return deviceDBPromise;
}

/**
 * Reads this browser's enrollment, or null if it has none. Rejects if the enrollment could
 * not be read: "we could not tell" is not the same as "not enrolled", and conflating them
 * would let a transient IndexedDB failure look like an unenrolled device.
 * @returns {Promise<Object|null>}
 */
async function readStoredIdentity() {
    const db = await openDeviceDB();
    return await new Promise((resolve, reject) => {
        const request = db.transaction(DEVICE_STORE_NAME, 'readonly')
            .objectStore(DEVICE_STORE_NAME)
            .get(DEVICE_IDENTITY_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Caches only a successful read. A failed one is not remembered, so a transient error
 * cannot mark an enrolled device unenrolled for the lifetime of the page.
 * @returns {Promise<Object|null>}
 */
function getDeviceIdentity() {
    if (!identityPromise) {
        identityPromise = readStoredIdentity();
        identityPromise.catch(() => {
            identityPromise = null;
        });
    }
    return identityPromise;
}

async function storeDeviceIdentity(identity) {
    const db = await openDeviceDB();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(DEVICE_STORE_NAME, 'readwrite');
        tx.objectStore(DEVICE_STORE_NAME).put(identity);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Device enrollment transaction aborted'));
    });
    identityPromise = Promise.resolve(identity);
}

function base64urlEncode(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomIdentifier() {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return base64urlEncode(bytes);
}

/**
 * Whether this browser holds an enrollment. Only ever gates sending, so an unreadable
 * enrollment is reported as false: the affected records stay in the outbox and are retried.
 * @returns {Promise<boolean>}
 */
async function hasDeviceIdentity() {
    if (typeof window.__redcapDeviceSignerForTesting === 'function') {
        return true;
    }
    try {
        return (await getDeviceIdentity()) !== null;
    } catch (error) {
        console.warn('device-auth: could not read device enrollment; treating as unavailable for now:', error);
        return false;
    }
}

async function createSignedRequestHeaders(recordId) {
    if (typeof window.__redcapDeviceSignerForTesting === 'function') {
        return window.__redcapDeviceSignerForTesting(recordId);
    }

    const identity = await getDeviceIdentity();
    if (!identity?.private_key || !identity?.device_id) {
        throw new Error('This device is not enrolled for data collection');
    }

    const timestamp = String(currentTimestamp());
    const nonceBytes = new Uint8Array(16);
    crypto.getRandomValues(nonceBytes);
    const nonce = base64urlEncode(nonceBytes);
    const canonical = [REQUEST_VERSION, identity.device_id, recordId, timestamp, nonce].join('\n');
    const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        identity.private_key,
        new TextEncoder().encode(canonical)
    );

    return {
        'X-Device-Id': identity.device_id,
        'X-Record-Id': recordId,
        'X-Request-Timestamp': timestamp,
        'X-Request-Nonce': nonce,
        'X-Device-Signature': base64urlEncode(signature)
    };
}

async function enrollDevice(enrollmentCode) {
    // Deliberately not using hasDeviceIdentity() here: an unreadable enrollment must abort
    // rather than be treated as "not enrolled", which would overwrite a working private key.
    if (await getDeviceIdentity()) {
        throw new Error('This browser is already enrolled');
    }
    if (!window.isSecureContext || !window.crypto?.subtle) {
        throw new Error('Device enrollment requires HTTPS and Web Crypto support');
    }

    const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign', 'verify']
    );
    const publicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const deviceId = randomIdentifier();

    const response = await fetch(DEVICE_ENROLLMENT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            enrollment_code: enrollmentCode,
            device_id: deviceId,
            public_key: publicKey
        })
    });
    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(responseBody.error || `Enrollment failed with HTTP ${response.status}`);
    }

    const identity = {
        key: DEVICE_IDENTITY_KEY,
        device_id: deviceId,
        label: responseBody.label || 'Approved device',
        private_key: keyPair.privateKey,
        enrolled_at: new Date().toISOString()
    };
    await storeDeviceIdentity(identity);
    return { device_id: deviceId, label: identity.label };
}

/**
 * Establishes whether this browser may collect data, and corrects its clock while it is at
 * it. The answer gates collection entirely (experiment.html turns approved:false into demo
 * mode, which stores nothing), so the bar for approved:false is deliberately high: only an
 * explicit "unapproved" verdict from the relay clears it.
 *
 * That is why this reads the relay's typed verdict rather than the HTTP status. The request
 * authorizer that guards the write route answers one question - may this write proceed -
 * and collapses revocation, an unknown device, a bad signature and a stale timestamp into
 * one 401. Treating that 401 as "unapproved" would send a tablet whose clock has drifted
 * past the five-minute window into demo mode and discard the session. The status route
 * therefore verifies the signature itself and distinguishes the cases (see
 * device_auth.status_handler):
 *
 *   - "unapproved" - revoked or unknown to the server. The one definitive no.
 *   - "clock_skew" - signature and enrollment verified, only the timestamp was stale. The
 *     device is approved; server_time has now corrected the drift for every later request,
 *     including the queued writes that were failing because of it.
 *   - "approved"   - all good.
 *
 * Anything else - an HTTP 401 (malformed or unverifiable credentials, still
 * undifferentiated), a 5xx, an unreachable service, a timeout - means the verdict is
 * unavailable, not negative. A locally enrolled tablet stays in collection mode so the
 * outbox keeps working, and the server independently rejects a revoked device when a send
 * is eventually attempted.
 * @returns {Promise<{approved: boolean, verified?: boolean, reason?: string, clockCorrected?: boolean}>}
 */
async function getDeviceAuthorizationStatus() {
    if (window.__redcapDeviceStatusForTesting) {
        return typeof window.__redcapDeviceStatusForTesting === 'function'
            ? window.__redcapDeviceStatusForTesting()
            : window.__redcapDeviceStatusForTesting;
    }

    if (!(await hasDeviceIdentity())) {
        return { approved: false, reason: 'not-enrolled' };
    }

    try {
        const signedHeaders = await createSignedRequestHeaders(STATUS_RECORD_ID);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DEVICE_STATUS_TIMEOUT_MS);
        let response;
        try {
            response = await fetch(DEVICE_STATUS_ENDPOINT, {
                method: 'POST',
                headers: signedHeaders,
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeoutId);
        }

        const body = await response.json().catch(() => ({}));
        calibrateClock(body.server_time);

        if (response.ok && body.status === 'approved') {
            return { approved: true, verified: true };
        }
        if (response.ok && body.status === 'clock_skew') {
            console.warn(
                `device-auth: this device's clock is ${serverTimeOffsetSeconds}s from the server's; `
                + 'corrected for subsequent requests'
            );
            return { approved: true, verified: true, clockCorrected: true };
        }
        if (response.ok && body.status === 'unapproved') {
            return { approved: false, reason: 'not-approved' };
        }
        console.warn(`device-auth: status check returned HTTP ${response.status}; continuing offline`);
        return { approved: true, verified: false };
    } catch (error) {
        console.warn('device-auth: status check unavailable; continuing with offline queue:', error);
        return { approved: true, verified: false };
    }
}

export {
    REDCAP_ENDPOINT,
    DEVICE_ENROLLMENT_ENDPOINT,
    DEVICE_STATUS_ENDPOINT,
    STATUS_RECORD_ID,
    createSignedRequestHeaders,
    enrollDevice,
    getDeviceAuthorizationStatus,
    getDeviceIdentity,
    hasDeviceIdentity
};

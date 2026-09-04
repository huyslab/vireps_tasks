/**
 * Per-device authentication for REDCap submissions.
 *
 * Enrollment creates a non-exportable P-256 private key in IndexedDB. Every network
 * attempt signs a fresh, five-minute request credential, so queued records do not carry
 * an authorization token that can expire while the tablet is offline.
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

async function readStoredIdentity() {
    try {
        const db = await openDeviceDB();
        return await new Promise((resolve, reject) => {
            const request = db.transaction(DEVICE_STORE_NAME, 'readonly')
                .objectStore(DEVICE_STORE_NAME)
                .get(DEVICE_IDENTITY_KEY);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.warn('device-auth: could not read device enrollment:', error);
        return null;
    }
}

function getDeviceIdentity() {
    if (!identityPromise) {
        identityPromise = readStoredIdentity();
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

async function hasDeviceIdentity() {
    if (typeof window.__redcapDeviceSignerForTesting === 'function') {
        return true;
    }
    return (await getDeviceIdentity()) !== null;
}

async function createSignedRequestHeaders(recordId) {
    if (typeof window.__redcapDeviceSignerForTesting === 'function') {
        return window.__redcapDeviceSignerForTesting(recordId);
    }

    const identity = await getDeviceIdentity();
    if (!identity?.private_key || !identity?.device_id) {
        throw new Error('This device is not enrolled for data collection');
    }

    const timestamp = String(Math.floor(Date.now() / 1000));
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
 * Confirms enrollment when online. A locally enrolled tablet remains in collection mode
 * during a network outage so the offline queue still works; the server independently
 * rejects a device that has been revoked when a send is eventually attempted.
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
        if (response.ok) {
            return { approved: true, verified: true };
        }
        if (response.status === 401 || response.status === 403) {
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

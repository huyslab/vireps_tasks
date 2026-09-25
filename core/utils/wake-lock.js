// Keep the tablet display awake while an experiment is running. Browsers release a
// screen wake lock whenever the document is hidden, so it must be requested again
// when the participant returns to the app.

let wakeLockSentinel = null;
let keepScreenAwake = false;
let visibilityListenerAttached = false;

async function acquireScreenWakeLock() {
    if (!keepScreenAwake
        || document.visibilityState !== 'visible'
        || !navigator.wakeLock?.request) {
        return false;
    }

    if (wakeLockSentinel && !wakeLockSentinel.released) {
        return true;
    }

    try {
        const sentinel = await navigator.wakeLock.request('screen');

        // The experiment may have ended while the asynchronous request was pending.
        if (!keepScreenAwake) {
            await sentinel.release();
            return false;
        }

        wakeLockSentinel = sentinel;
        sentinel.addEventListener('release', () => {
            if (wakeLockSentinel === sentinel) wakeLockSentinel = null;
        });
        return true;
    } catch (error) {
        // Wake lock is an enhancement. Permission or platform failures must never stop
        // the experiment from running.
        console.warn('Could not keep the screen awake:', error);
        return false;
    }
}

function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && keepScreenAwake) {
        acquireScreenWakeLock();
    }
}

export function startScreenWakeLock() {
    keepScreenAwake = true;

    if (!visibilityListenerAttached) {
        document.addEventListener('visibilitychange', handleVisibilityChange);
        visibilityListenerAttached = true;
    }

    return acquireScreenWakeLock();
}

export async function stopScreenWakeLock() {
    keepScreenAwake = false;

    if (visibilityListenerAttached) {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        visibilityListenerAttached = false;
    }

    const sentinel = wakeLockSentinel;
    wakeLockSentinel = null;
    if (sentinel && !sentinel.released) {
        try {
            await sentinel.release();
        } catch (error) {
            console.warn('Could not release the screen wake lock:', error);
        }
    }
}

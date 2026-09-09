/**
 * Shared pointer/touch helpers.
 *
 * The battery runs on an Android tablet, but the same pages are opened on a lab
 * desktop for piloting and on the rendering tests' headless browser. Pointer
 * events cover all three - a finger, a stylus and a mouse all raise
 * `pointerdown` - so tasks bind the pointer once and vary only the WORD they use
 * for it. That is what keeps a task from growing two parallel input paths, which
 * is how the piggy-bank tasks ended up tappable while PIT next door stayed on the
 * B key.
 *
 * `isTouchDevice()` therefore decides wording, not mechanism. Nothing here should
 * gate whether input works at all.
 */

/**
 * Whether the device has a touchscreen. Drives instruction wording only.
 *
 * Three tests rather than one, because `navigator.maxTouchPoints` alone is not
 * reliable: WebKit reports 0 for it on emulated iPhone/iPad (verified across the
 * Playwright device matrix), which would tell an iPad user to press keys it does
 * not have. `ontouchstart` and `pointer: coarse` both catch that case, and all
 * three are false on the desktop projects, so the desktop wording is unaffected.
 *
 * @returns {boolean}
 */
export function isTouchDevice() {
    if (navigator.maxTouchPoints > 0) return true;
    if ('ontouchstart' in window) return true;
    return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

// The task plugins (plugin-reversal, plugin-go-no-go, plugin-card-choosing,
// plugin-self-report-item) are loaded as classic <script> tags rather than modules,
// so they cannot import this. They all read it inside a trial, long after this
// deferred module has run, so a global is the one path that reaches both worlds.
if (typeof window !== 'undefined') {
    window.isTouchDevice = isTouchDevice;
}

/**
 * The action word for the participant's device: a touchscreen is tapped, a
 * laptop is clicked. Adapted from huyslab/pharmacy_tasks, where it was local to
 * the vigour instructions.
 *
 * @param {boolean} [capitalized=false] - Capitalise it for the start of a sentence
 * @returns {string} 'tap'/'Tap' on touch devices, 'click'/'Click' otherwise
 */
export function pressVerb(capitalized = false) {
    const verb = isTouchDevice() ? 'tap' : 'click';
    return capitalized ? verb.charAt(0).toUpperCase() + verb.slice(1) : verb;
}

/**
 * Binds a tap/click handler to an element.
 *
 * Two guards, both learned from the piggy-bank tasks: `isPrimary` drops the
 * second finger of a multi-touch, which would otherwise double-count presses on
 * a rate-sensitive task, and `button !== 0` drops right-click, middle-click and
 * the stylus barrel button. `preventDefault` stops the synthetic mouse events and
 * the double-tap zoom that follow a touch.
 *
 * @param {HTMLElement|null} element - Element to make tappable
 * @param {Function} callback - Called with the originating PointerEvent
 * @returns {{element: HTMLElement, handler: Function}|null} Handle for cleanupTapListener, or null if the element is missing
 */
export function setupTapListener(element, callback) {
    if (!element) return null;
    const handler = function (event) {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        callback(event);
    };
    element.addEventListener('pointerdown', handler);
    return { element, handler };
}

/**
 * Removes a listener bound by setupTapListener. Safe to call with null.
 * @param {{element: HTMLElement, handler: Function}|null} listener
 */
export function cleanupTapListener(listener) {
    if (listener && listener.element && listener.handler) {
        listener.element.removeEventListener('pointerdown', listener.handler);
    }
}

/**
 * Dispatches a synthetic tap. Simulation mode only - these trials end on real
 * input, so an automated run has nothing to advance them otherwise.
 *
 * `button: 0` and `isPrimary` are set explicitly because setupTapListener drops
 * events without them.
 *
 * @param {HTMLElement|null} element - Element to tap
 * @param {number} delay - Milliseconds to wait before dispatching
 */
export function simulateTap(element, delay) {
    setTimeout(() => {
        if (element) {
            element.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true,
                isPrimary: true,
                pointerType: 'touch',
                button: 0
            }));
        }
    }, delay);
}

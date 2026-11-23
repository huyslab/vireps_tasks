// A lifetime lock shared by same-origin tabs in this browser profile. Keep the
// owner's callback pending until the browser destroys the page; never steal it
// from a backgrounded experiment or elect a replacement on a timer.
const LOCK_NAME = 'vireps-active-tab';
let ownershipPromise;

function showBlocked(message, unsupported = false) {
    if (document.getElementById('single-tab-notice')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'single-tab-notice';
    dialog.setAttribute('aria-labelledby', 'single-tab-title');
    dialog.style.cssText = 'max-width: 480px; padding: 32px; border-radius: 12px; font: 18px/1.5 system-ui;';
    const heading = document.createElement('h2');
    heading.id = 'single-tab-title';
    heading.textContent = unsupported ? 'This browser cannot run VIREPS safely' : 'VIREPS is already open';
    const explanation = document.createElement('p');
    explanation.textContent = message;
    const retry = document.createElement('button');
    retry.textContent = 'Try again';
    retry.style.cssText = 'font: inherit; padding: 12px 20px; min-height: 48px;';
    retry.addEventListener('click', () => window.location.reload());
    dialog.append(heading, explanation, retry);
    document.body.append(dialog);
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    dialog.showModal();
}

function ensureSingleTab() {
    if (ownershipPromise) return ownershipPromise;
    ownershipPromise = new Promise((resolve) => {
        const unavailable = () => {
            showBlocked('Please use an up-to-date browser and open the task site over HTTPS.', true);
            resolve(false);
        };
        if (!navigator.locks?.request) {
            unavailable();
            return;
        }
        try {
            navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
                if (!lock) {
                    showBlocked('Use the VIREPS tab already open in this browser. To use this tab, close the other tab, then tap Try again.');
                    resolve(false);
                    return;
                }
                resolve(true);
                return new Promise(() => {});
            }).catch(unavailable);
        } catch {
            unavailable();
        }
    });
    return ownershipPromise;
}

export { ensureSingleTab };

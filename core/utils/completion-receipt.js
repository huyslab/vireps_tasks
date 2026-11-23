// Carry the clinician address between pages without putting it in the URL or trial data.
// A fresh token binds it to this launch; direct links cannot inherit a previous recipient.
const STORAGE_KEY = 'vireps_completion_receipt';

function prepareCompletionReceipt(email, parameters) {
    if (!email) {
        try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* No receipt requested. */ }
        return;
    }
    const token = crypto.randomUUID();
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        token,
        email,
        participant: parameters.get('participant_id'),
        session: parameters.get('session_number'),
        module: parameters.get('module')
    }));
    parameters.set('receipt', token);
}

function readCompletionReceipt(parameters) {
    if (!parameters.get('receipt')) return '';
    try {
        const receipt = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
        if (receipt?.token === parameters.get('receipt') &&
            receipt.participant === parameters.get('participant_id') &&
            receipt.session === parameters.get('session_number') &&
            receipt.module === parameters.get('module') &&
            typeof receipt.email === 'string') {
            return receipt.email;
        }
    } catch { /* Direct launches and unavailable storage have no recipient. */ }
    return '';
}

export { prepareCompletionReceipt, readCompletionReceipt };

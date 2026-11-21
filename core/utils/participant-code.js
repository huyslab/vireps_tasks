// Keep these constants and the REDCap task_code formulas in step. Codes identify
// participants; they are not passwords or evidence that a record exists.
const PARTICIPANT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTVWXYZ23456789';
const PARTICIPANT_CODE_CAPACITY = 31 ** 5;
const PARTICIPANT_CODE_MULTIPLIER = 104729;
const PARTICIPANT_CODE_OFFSET = 9102473;
const DEBUG_PARTICIPANT_IDS = new Set(['debugdemo', 'demo', 'debug']);

function isDebugParticipantId(value) {
    return typeof value === 'string' && DEBUG_PARTICIPANT_IDS.has(value.trim().toLowerCase());
}

function normalizeParticipantCode(value) {
    if (typeof value !== 'string') return '';
    return isDebugParticipantId(value) ? value.trim().toLowerCase() : value.trim().toUpperCase();
}

function participantCodeValidationError(value) {
    const code = normalizeParticipantCode(value);
    if (!code) return 'Please enter the participant code from the registration email';
    if (isDebugParticipantId(code)) return null;
    if (code.length !== 6 || [...code].some(character => !PARTICIPANT_CODE_ALPHABET.includes(character))) {
        return 'Enter the six-character participant code from the registration email';
    }
    const digits = [...code].map(character => PARTICIPANT_CODE_ALPHABET.indexOf(character));
    const check = digits.slice(0, 5).reduce((sum, digit, index) => sum + (index + 1) * digit, 0) % 31;
    if (check !== digits[5]) return 'Participant code does not pass its typing check. Check it against the registration email';
    return null;
}

function createParticipantCode(recordNumber) {
    if (!Number.isSafeInteger(recordNumber) || recordNumber < 1 || recordNumber > PARTICIPANT_CODE_CAPACITY) {
        throw new RangeError(`Record number must be an integer from 1 to ${PARTICIPANT_CODE_CAPACITY}`);
    }
    let payload = ((recordNumber - 1) * PARTICIPANT_CODE_MULTIPLIER + PARTICIPANT_CODE_OFFSET) % PARTICIPANT_CODE_CAPACITY;
    const digits = Array(5).fill(0);
    for (let index = 4; index >= 0; index--) {
        digits[index] = payload % 31;
        payload = Math.floor(payload / 31);
    }
    const check = digits.reduce((sum, digit, index) => sum + (index + 1) * digit, 0) % 31;
    return [...digits, check].map(digit => PARTICIPANT_CODE_ALPHABET[digit]).join('');
}

export {
    PARTICIPANT_CODE_ALPHABET,
    PARTICIPANT_CODE_CAPACITY,
    PARTICIPANT_CODE_MULTIPLIER,
    PARTICIPANT_CODE_OFFSET,
    isDebugParticipantId,
    normalizeParticipantCode,
    participantCodeValidationError,
    createParticipantCode
};

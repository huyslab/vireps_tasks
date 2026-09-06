/**
 * REDCap record IDs append "_YYYY-MM-DD_HH:MM:SS" to the participant ID.
 * Keep browser validation aligned with the request authorizer's maximum.
 */
const REDCAP_RECORD_ID_MAX_LENGTH = 256;
const MODULE_START_TIME_SUFFIX_LENGTH = 20;
const PARTICIPANT_ID_MAX_LENGTH = REDCAP_RECORD_ID_MAX_LENGTH - MODULE_START_TIME_SUFFIX_LENGTH;
const PARTICIPANT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function participantIdValidationError(participantId) {
    if (typeof participantId !== 'string' || participantId.length === 0) {
        return 'Please enter a participant ID';
    }
    if (participantId.length > PARTICIPANT_ID_MAX_LENGTH) {
        return `Participant ID must be ${PARTICIPANT_ID_MAX_LENGTH} characters or fewer`;
    }
    if (!PARTICIPANT_ID_PATTERN.test(participantId)) {
        return 'Participant ID can only contain letters, numbers, hyphens, and underscores';
    }
    return null;
}

function createREDCapRecordId(participantId, moduleStartTime) {
    const validationError = participantIdValidationError(participantId);
    if (validationError) {
        throw new Error(validationError);
    }
    const recordId = `${participantId}_${moduleStartTime}`;
    if (recordId.length > REDCAP_RECORD_ID_MAX_LENGTH) {
        throw new Error(`REDCap record ID exceeds ${REDCAP_RECORD_ID_MAX_LENGTH} characters`);
    }
    return recordId;
}

export {
    PARTICIPANT_ID_MAX_LENGTH,
    REDCAP_RECORD_ID_MAX_LENGTH,
    createREDCapRecordId,
    participantIdValidationError
};

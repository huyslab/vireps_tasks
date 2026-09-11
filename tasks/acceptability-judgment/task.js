/**
 * Acceptability Questionnaire
 *
 * Three ratings collected after each game: how difficult it was, how enjoyable,
 * and how clear the instructions were.
 *
 * Presented with the same one-item-per-screen component as the questionnaire
 * block (tasks/self-report/plugin-self-report-item.js). It used to use the stock
 * jsPsych Likert plugin, which meant a participant met two different ways of
 * answering the same shape of question in one session - and met the worse of the
 * two nine times, since this runs after every game. That one put five 24px radio
 * buttons in a row, under half the tap target the theme sets as its minimum.
 *
 * DATA SHAPE. This now writes one row per rating rather than one row carrying all
 * three. The values are unchanged and the names are preserved as `item_id`
 * (`<task>_difficulty`, `<task>_enjoy`, `<task>_clear`), so the same three fields
 * are recoverable - they arrive as three rows keyed by item_id instead of three
 * keys on one row.
 */

/** Five-point scale with both ends named, so neither anchor is left implicit. */
const scale = (low, high) => [
    { value: 1, label: `1 - ${low}` },
    { value: 2, label: '2' },
    { value: 3, label: '3' },
    { value: 4, label: '4' },
    { value: 5, label: `5 - ${high}` }
];

/**
 * Creates the acceptability ratings for one task.
 *
 * @param {Object} settings
 * @param {string} settings.task_name - Short identifier, used in the data field names
 * @param {string} settings.game_description - What the participant calls the game
 * @returns {Array} jsPsych timeline
 */
export function createAcceptabilityTimeline(settings) {
    const game = settings.game_description;

    const questions = [
        {
            id: `${settings.task_name}_difficulty`,
            prompt: `How difficult was the ${game}?`,
            // "Not at all" alone did not finish the sentence the question started.
            options: scale('Not difficult at all', 'Very difficult')
        },
        {
            id: `${settings.task_name}_enjoy`,
            prompt: `How enjoyable was the ${game}?`,
            options: scale('Not enjoyable at all', 'Very enjoyable')
        },
        {
            id: `${settings.task_name}_clear`,
            prompt: `Was it clear what you had to do in the ${game}?`,
            options: scale('Not clear at all', 'Extremely clear')
        }
    ];

    const shared = {
        type: jsPsychSelfReportItem,
        questionnaire: `acceptability_${settings.task_name}`,
        // No way back: these are three quick impressions, and the questionnaire
        // block's cursor machinery would be a lot of apparatus for three screens.
        allow_back: false
    };

    return [
        {
            ...shared,
            question_type: 'message',
            prompt: `<p>A few short questions about the ${game}.</p>`,
            button_label: 'Continue',
            data: { trialphase: 'pre_debrief_instructions' }
        },
        ...questions.map((question, index) => ({
            ...shared,
            question_type: 'likert',
            prompt: question.prompt,
            item_id: question.id,
            item_index: index,
            n_items: questions.length,
            progress_label: `${game} - ${index + 1} / ${questions.length}`,
            options: question.options,
            data: { trialphase: `acceptability_${settings.task_name}` }
        }))
    ];
}

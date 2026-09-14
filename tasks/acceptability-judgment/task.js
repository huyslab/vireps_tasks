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
 * three. The field names are preserved as `item_id` (`<task>_difficulty`,
 * `<task>_enjoy`, `<task>_clear`) and the response codes are preserved exactly -
 * see the note on `scale` below, which is the part that is easy to get wrong.
 */

/**
 * Five-point scale with both ends named, so neither anchor is left implicit.
 *
 * THE STORED VALUE IS NOT THE PRINTED NUMBER, and that is deliberate. The stock
 * jsPsych Likert plugin this replaced wrote the radio's zero-based index rather
 * than anything from the label - `value="' + j + '"` in plugin-survey-likert.js,
 * read back with parseInt - so a participant tapping "1" has always been recorded
 * as 0, and "5" as 4.
 *
 * Declaring 1-5 here would have shifted every acceptability outcome by one and
 * silently mixed two codings in one dataset, with nothing to tell them apart after
 * the fact. The participant-facing labels are unchanged and the stored codes are
 * unchanged; only the component drawing them is new.
 */
const scale = (low, high) => [
    { value: 0, label: `1 - ${low}` },
    { value: 1, label: '2' },
    { value: 2, label: '3' },
    { value: 3, label: '4' },
    { value: 4, label: `5 - ${high}` }
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

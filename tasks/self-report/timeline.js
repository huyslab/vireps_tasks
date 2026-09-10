import { saveDataREDCap, updateState } from '@utils/index.js';
import { getQuestionnaire } from './questionnaires.js';

/**
 * Builds the ordered list of screens for one questionnaire: a message screen at the
 * head of each section, then that section's items.
 *
 * These are plain specs rather than jsPsych trials because the questionnaire runs as
 * a loop over a single trial whose parameters are swapped per iteration (see
 * questionnaireTimeline). A flat array of trials cannot step backwards, and stepping
 * backwards is the point: 115 items, one per screen, each previously committed by a
 * single tap with no way to correct a mis-hit.
 *
 * The list ends with a completion screen, which is what makes the LAST item of a
 * questionnaire correctable. Each questionnaire owns its own cursor and the next one
 * starts at zero with no way back, so without a screen after it, the final answer of
 * every questionnaire - and of the whole module - could not be revisited.
 *
 * @param {object} questionnaire - From questionnaires.js
 * @param {number} position - 1-based place in the module, for the completion screen
 * @param {number} total - How many questionnaires the module runs
 */
function questionnaireScreens(questionnaire, position, total) {
    const screens = [];

    questionnaire.sections.forEach((section, sectionIndex) => {
        const nextSection = questionnaire.sections[sectionIndex + 1];
        const end = nextSection ? nextSection.start : questionnaire.items.length;

        screens.push({
            question_type: 'message',
            prompt: section.instructions,
            progress_label: questionnaire.name,
            button_label: 'Continue',
            context: '',
            item_id: null,
            item_index: null,
            n_items: null,
            options: [],
            trialphase: `${questionnaire.key}_instructions`
        });

        questionnaire.items.slice(section.start, end).forEach((item, offset) => {
            const index = section.start + offset;
            screens.push({
                question_type: 'likert',
                context: section.context,
                prompt: item.text,
                item_id: item.id,
                item_index: index,
                n_items: questionnaire.items.length,
                progress_label: `${questionnaire.name} — ${index + 1} / ${questionnaire.items.length}`,
                options: section.scale || questionnaire.scale,
                button_label: 'Continue',
                trialphase: questionnaire.key
            });
        });
    });

    // The screen that keeps the last item reachable. It doubles as the only pause in a
    // block that is otherwise 121 screens without one.
    const isFinal = position === total;
    screens.push({
        question_type: 'message',
        prompt: isFinal
            ? `<p>You have finished the last set of questions.</p>
               <p>Tap <b>Back</b> if you want to change your last answer, or <b>Continue</b> to finish.</p>`
            : `<p>You have finished set ${position} of ${total}.</p>
               <p>Take a moment if you need one.</p>
               <p>Tap <b>Back</b> if you want to change your last answer, or <b>Continue</b> for the next set.</p>`,
        progress_label: `Set ${position} of ${total}`,
        button_label: 'Continue',
        context: '',
        item_id: null,
        item_index: null,
        n_items: null,
        options: [],
        trialphase: `${questionnaire.key}_complete`
    });

    return screens;
}

/**
 * The answer an item currently holds, or null if it has none yet.
 *
 * Rows accumulate as the participant moves back and forth, so "current" is the most
 * recent forward answer that has not since been superseded.
 */
function currentAnswer(questionnaireKey, itemId) {
    if (!itemId) return null;
    const rows = jsPsych.data.get()
        .filter({ trial_type: 'self-report-item', questionnaire: questionnaireKey, item_id: itemId })
        .values()
        .filter((row) => row.navigation === 'forward' && !row.superseded);
    const last = rows[rows.length - 1];
    return last && last.response !== null && last.response !== undefined ? last.response : null;
}

/**
 * Marks every earlier answer to this item as superseded, so exactly one row per item
 * is live at any time.
 *
 * Corrections are kept rather than overwritten - the record of what the participant
 * first tapped is worth having - but only one of them is the answer, and analysis
 * should not have to infer which by timestamp. Take rows where navigation is
 * 'forward' and superseded is falsy, one per item_id.
 */
function supersedeEarlierAnswers(questionnaireKey, itemId, currentTrialIndex) {
    if (!itemId) return;
    jsPsych.data.get()
        .filter({ trial_type: 'self-report-item', questionnaire: questionnaireKey, item_id: itemId })
        .values()
        .forEach((row) => {
            if (row.trial_index !== currentTrialIndex && row.navigation === 'forward') {
                row.superseded = true;
            }
        });
}

/**
 * One questionnaire, as a loop over a single trial with an explicit cursor.
 *
 * jsPsych timelines only run forwards, so the sequence is held here instead: the
 * trial's parameters are assigned in on_start from screens[index], and on_finish
 * moves the cursor either way. The cursor is bounded by construction - Back is only
 * offered above 0, and the loop ends once it reaches the end - so it cannot run away.
 */
function questionnaireTimeline(questionnaire, settings, position, total) {
    const screens = questionnaireScreens(questionnaire, position, total);
    let index = 0;

    // Every screen-varying parameter is a function of the cursor. jsPsych evaluates
    // these while resolving parameters, which is also when it enforces required ones -
    // so this cannot be done by mutating the trial in on_start, which runs after that
    // check and fails on the required `prompt`.
    const at = () => screens[index];

    const screenTrial = {
        type: jsPsychSelfReportItem,
        questionnaire: questionnaire.key,
        transition_duration: settings.transition_duration,
        input_mode: settings.input_mode,
        question_type: () => at().question_type,
        prompt: () => at().prompt,
        context: () => at().context,
        item_id: () => at().item_id,
        item_index: () => at().item_index,
        n_items: () => at().n_items,
        progress_label: () => at().progress_label,
        options: () => at().options,
        button_label: () => at().button_label,
        // No way back out of the first screen of a questionnaire, so no button on it.
        allow_back: () => index > 0,
        initial_value: () => currentAnswer(questionnaire.key, at().item_id),
        on_finish: (data) => {
            const screen = screens[index];
            // `data` is the parameter jsPsych merges from the trial object's cache, which
            // on_start cannot reach - so the phase is stamped here instead.
            data.trialphase = screen.trialphase;

            if (data.navigation === 'back') {
                index = Math.max(0, index - 1);
                return;
            }

            supersedeEarlierAnswers(questionnaire.key, screen.item_id, data.trial_index);
            index += 1;

            // Save on the same cadence as before, counting screens completed rather than
            // items answered, and never on the last one (the timeline saves on finish).
            const isLast = index >= screens.length;
            if (!isLast && screen.item_index !== null
                && (screen.item_index + 1) % settings.save_every === 0) {
                saveDataREDCap().catch(() => {});
            }
        }
    };

    return {
        timeline: [screenTrial],
        loop_function: () => index < screens.length,
        on_timeline_start: () => {
            index = 0;
            updateState(`${questionnaire.key}_start`);
        },
        on_timeline_finish: () => {
            updateState(`${questionnaire.key}_finish`, false);
            saveDataREDCap().catch(() => {});
        }
    };
}

export function createSelfReportTimeline(settings) {
    const questionnaires = settings.questionnaires.map(getQuestionnaire);
    return questionnaires.map((questionnaire, position) =>
        questionnaireTimeline(questionnaire, settings, position + 1, questionnaires.length));
}

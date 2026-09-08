import { saveDataREDCap, updateState } from '@utils/index.js';
import { getQuestionnaire } from './questionnaires.js';

function questionnaireScreens(questionnaire, settings) {
    const shared = {
        type: jsPsychSelfReportItem,
        questionnaire: questionnaire.key,
        transition_duration: settings.transition_duration,
        input_mode: settings.input_mode
    };
    const screens = [];

    questionnaire.sections.forEach((section, sectionIndex) => {
        const nextSection = questionnaire.sections[sectionIndex + 1];
        const end = nextSection ? nextSection.start : questionnaire.items.length;

        screens.push({
            ...shared,
            question_type: 'message',
            prompt: section.instructions,
            progress_label: questionnaire.name,
            button_label: 'Continue',
            data: { trialphase: `${questionnaire.key}_instructions` }
        });

        questionnaire.items.slice(section.start, end).forEach((item, offset) => {
            const index = section.start + offset;
            screens.push({
                ...shared,
                question_type: 'likert',
                context: section.context,
                prompt: item.text,
                item_id: item.id,
                item_index: index,
                n_items: questionnaire.items.length,
                progress_label: `${questionnaire.name} — ${index + 1} / ${questionnaire.items.length}`,
                options: section.scale || questionnaire.scale,
                data: { trialphase: questionnaire.key },
                on_finish: () => {
                    const isLast = index === questionnaire.items.length - 1;
                    if (!isLast && (index + 1) % settings.save_every === 0) {
                        saveDataREDCap().catch(() => {});
                    }
                }
            });
        });
    });

    return screens;
}

export function createSelfReportTimeline(settings) {
    const questionnaires = settings.questionnaires.map(getQuestionnaire);
    return questionnaires.map((questionnaire) => ({
        timeline: questionnaireScreens(questionnaire, settings),
        on_timeline_start: () => { updateState(`${questionnaire.key}_start`); },
        on_timeline_finish: () => {
            updateState(`${questionnaire.key}_finish`, false);
            saveDataREDCap().catch(() => {});
        }
    }));
}

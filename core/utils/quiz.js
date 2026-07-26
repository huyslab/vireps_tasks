/**
 * Instruction comprehension quizzes.
 *
 * Presents one statement per screen with True/False buttons, rather than a single page of
 * radio buttons - a page of small radios is hard to use on a touchscreen, and one question
 * at a time keeps each statement legible on a phone or tablet.
 *
 * The data contract of the old single-page survey is preserved deliberately: after the last
 * question, one aggregate record is written under the caller's `trialphase` carrying a
 * `response` object keyed Q0, Q1, ... exactly as jsPsychSurveyMultiChoice produced. Every
 * existing consumer - the wrong-answer review screens, the pass/fail loop conditions,
 * control's failure counter, and any analysis of previously collected sessions - keeps
 * working against that shape unchanged. The per-question trials are additional rows, marked
 * `<trialphase>_item`, not a replacement.
 */

const QUIZ_STYLE_ID = 'instruction-quiz-styles';

/**
 * Injects the quiz button styles once per page. Kept here rather than in a task stylesheet
 * because the quiz is shared across tasks that load their own CSS separately.
 */
function injectQuizStyles() {
    if (document.getElementById(QUIZ_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = QUIZ_STYLE_ID;
    style.textContent = `
        .quiz-prompt {
            max-width: min(700px, 92vw);
            margin: 0 auto 1.5em auto;
            text-align: left;
        }
        .quiz-statement {
            font-size: 1.15em;
            font-weight: bold;
        }
        .quiz-progress {
            color: #4a6fa5;
            font-size: 0.95em;
            margin-bottom: 0.5em;
        }
        .quiz-btn {
            min-width: 9rem;
            min-height: 3.5rem;
            margin: 0 0.75rem;
            padding: 0.6rem 1.5rem;
            font-size: 1.25rem;
            font-family: inherit;
            font-weight: bold;
            color: #182b4b;
            background-color: #f0f0f0;
            border: 2px solid #b6c2d4;
            border-radius: 12px;
            cursor: pointer;
            touch-action: manipulation;
            user-select: none;
            -webkit-user-select: none;
            -webkit-touch-callout: none;
            -webkit-tap-highlight-color: transparent;
        }
        .quiz-btn:active {
            background-color: #d8e0ec;
            border-color: #4a6fa5;
            transform: translateY(1.5px);
        }
        /* Touch devices: taller targets, and stacked on a narrow screen so the two buttons
           never end up side by side and thumb-width apart. */
        @media (pointer: coarse) {
            .quiz-btn {
                min-width: 10rem;
                min-height: 4rem;
                font-size: 1.35rem;
            }
        }
        @media (pointer: coarse) and (max-width: 500px) {
            .quiz-btn {
                display: block;
                width: min(18rem, 80vw);
                margin: 0.6rem auto;
            }
        }
    `;
    document.head.appendChild(style);
}

/**
 * Builds a one-question-per-screen comprehension quiz.
 *
 * @param {Array<Object>} questions - Statements to judge
 * @param {string} questions[].prompt - The statement (HTML allowed)
 * @param {string} [questions[].correct] - Correct answer, "True" or "False" (default "True")
 * @param {Object} options
 * @param {string} options.trialphase - Phase for the aggregate record; per-question rows use
 *   `<trialphase>_item`. Existing consumers filter on this exactly as before.
 * @param {string|Function} [options.preamble] - HTML shown above every statement; a function
 *   is evaluated per question, so it can react to data recorded earlier (control uses this
 *   to warn when the participant is near the failure limit).
 * @param {Function} [options.onComplete] - Called as (responseObject, allCorrect) from the
 *   aggregate trial's on_finish, for callers that need to update counters.
 * @returns {Array<Object>} jsPsych trials: one per question, then the aggregate record
 */
export function createInstructionQuiz(questions, options = {}) {
    const { trialphase, preamble = '', onComplete } = options;

    if (!trialphase) {
        throw new Error('createInstructionQuiz requires options.trialphase');
    }

    const CHOICES = ['True', 'False'];

    // Answers for the attempt currently in progress. Reset by the first question so a retry
    // through the instruction loop starts clean rather than inheriting the failed attempt.
    let answers = [];

    const questionTrials = questions.map((question, index) => {
        const correct = question.correct || 'True';

        return {
            type: jsPsychHtmlButtonResponse,
            css_classes: ['instructions'],
            stimulus: () => {
                const preambleHtml = typeof preamble === 'function' ? preamble() : preamble;
                return `${preambleHtml}
                    <div class="quiz-prompt">
                        <p class="quiz-progress">Question ${index + 1} of ${questions.length}</p>
                        <p class="quiz-statement">${question.prompt}</p>
                    </div>`;
            },
            choices: CHOICES,
            button_html: (choice) => `<button class="quiz-btn">${choice}</button>`,
            data: {
                trialphase: `${trialphase}_item`,
                quiz_item: index,
                quiz_prompt: question.prompt
            },
            simulation_options: { data: { response: CHOICES.indexOf(correct) } },
            on_start: () => {
                injectQuizStyles();
                if (index === 0) answers = [];
            },
            on_finish: (data) => {
                const given = CHOICES[data.response] ?? null;
                answers[index] = given;
                data.quiz_response = given;
                data.quiz_correct = given === correct;
            }
        };
    });

    // Aggregate record: reproduces the single-page survey's data shape so downstream
    // review/loop/counter logic needs no changes.
    const aggregateTrial = {
        type: jsPsychCallFunction,
        func: () => {},
        data: { trialphase: trialphase },
        on_finish: (data) => {
            const response = {};
            questions.forEach((_, index) => {
                response[`Q${index}`] = answers[index] ?? null;
            });
            data.response = response;

            const allCorrect = questions.every(
                (question, index) => answers[index] === (question.correct || 'True')
            );
            data.quiz_passed = allCorrect;

            if (onComplete) onComplete(response, allCorrect);
        }
    };

    return [...questionTrials, aggregateTrial];
}

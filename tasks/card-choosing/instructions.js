// Import necessary functions and components
import { interBlockStimulus } from './utils.js';
import {
    updateState,
    createReadyTrial,
    createInstructionQuiz,
    shuffleArray,
    isTouchDevice } from '@utils/index.js';
import { 
    buildCardChoosingTask,
    getPavlovianImages 
} from './utils.js';

// Configuration constants for PILT instructions
const small_coin_size = 100; // Size of coin images in pixels

// Touch devices tap the cards directly; keyboard devices use the arrow keys. Read once at
// module load, matching how the plugin decides whether to render tap targets.
const touchCapable = isTouchDevice();

/**
 * Spells out a response deadline in words, from the configured value in ms.
 *
 * This used to be a literal that switched on window.context - "four" seconds for
 * RELMED and "three" for Prolific - and the Prolific branch had drifted out of
 * step with the actual deadline, which globalConfig sets to 4000ms. Deriving the
 * number from the setting means the sentence cannot contradict the task again.
 */
function secondsWord(ms) {
    const seconds = Math.round((ms ?? 4000) / 1000);
    return ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'][seconds] ?? String(seconds);
}

/** How the participant selects a card, for use mid-sentence in instruction copy. */
const chooseCardPhrase = touchCapable
    ? "tapping the card you want"
    : "pressing the left or the right arrow keys";
const demo_stimuli = [
    "almond_1.jpg",
    "envelope_1.jpg",
    "strainer_1.jpg",
    "anchor_1.jpg",
    "bus_1.jpg",
    "cantaloupe_1.jpg"
]

/**
 * Prepares the complete instruction sequence for the PILT (Pavlovian-Instrumental Learning Task)
 * @returns {Array} Array of jsPsych trial objects containing all instruction pages, practice trials, and quiz
 */
/**
 * Prepares the complete instruction sequence for the PILT (Pavlovian-Instrumental Learning Task)
 * @returns {Array} Array of jsPsych trial objects containing all instruction pages, practice trials, and quiz
 */
function preparePILTInstructions(settings) {
    // Create inter-block instruction stimulus
    const inter_block_instruct = {
        type: jsPsychInstructions,
        css_classes: ['instructions'],
        pages: () => [interBlockStimulus()],
        show_clickable_nav: true,
        data: {trialphase: "pilt_instruction"}
    }

    // Main instruction sequence
    let inst =  [
        {
            type: jsPsychInstructions,
            css_classes: ['instructions'],
            pages: () => {

            let pages = [
            `<p><b>THE CARD CHOOSING GAME</b></p>
                <p>In this game you turn over cards to find the coins behind them.</p>
                <p>Some cards are luckier than others.</p>
                <p>Try to collect as many coins as you can${window.task == "screening" ? "" : ", and try not to lose them"}.</p>`,
            `<p>Each turn you see two cards. You have <b>${secondsWord(settings.default_response_deadline)} seconds</b> to turn one over.</p>
                <p>Behind it is the coin you collect: £1, 50p or 1p.</p>
                <div style='display: grid;'><table class='rlm-coin-table'><tr>
                <td><img src='./assets/images/card-choosing/outcomes/1pound.png' style='width:${small_coin_size}px; height:${small_coin_size}px;'></td>
                <td><img src='./assets/images/card-choosing/outcomes/50pence.png' style='width:${small_coin_size}px; height:${small_coin_size}px;'></td>
                <td><img src='./assets/images/card-choosing/outcomes/1penny.png' style='width:${small_coin_size}px; height:${small_coin_size}px;'></td></tr></table></div>`,
        ];

        // Add broken coin instructions for non-screening sessions
        if (settings.session !== "screening"){
            pages.push(`<p>Sometimes you will turn over a broken coin, like these.</p>\
                <div style='display: grid;'><table class='rlm-coin-table'><tr>
                <td><img src='./assets/images/card-choosing/outcomes/1poundbroken.png' style='width:${small_coin_size}px; height:${small_coin_size}px;'></td>
                <td><img src='./assets/images/card-choosing/outcomes/50pencebroken.png' style='width:${small_coin_size}px; height:${small_coin_size}px;'></td>
                <td><img src='./assets/images/card-choosing/outcomes/1pennybroken.png' style='width:${small_coin_size}px; height:${small_coin_size}px;'></td></tr></table></div>
                <p>A broken coin means you lose that much.</p>`);
            pages.push(`<p>Sometimes you cannot help losing coins. When that happens, try to lose as little as you can.</p>
                <p>You start with <b>£100</b> of game money, so you will not run out.</p>`)
        }

        return pages
    },
        show_clickable_nav: true,
        data: {trialphase: "pilt_instruction"},
        on_start: () => {updateState("pilt_instructions_start")}
    }
    ];

    // Add initial practice trial for screening sessions only
    if (settings.session === "screening"){
        inst.push(
            createReadyTrial(
                `<p>You choose a card by ${chooseCardPhrase}.</p>
                        <p>Let's try it out now! Flip a card on the next screen.</p>
                        `,
                "pilt_instruction"
            ),
            {
                // Simple demonstration trial with both cards giving £1
                timeline: buildCardChoosingTask(
                    [[
                        {   
                            stimulus_left: demo_stimuli[0],
                            stimulus_right: demo_stimuli[1],
                            stimulus_middle: "",
                            feedback_middle: "",
                            n_stimuli: 2,
                            present_pavlovian: settings.session !== "screening",
                            pavlovian_images: getPavlovianImages(settings),
                            optimal_side: "",
                            feedback_left: 1,
                            feedback_right: 1,
                            optimal_right: 1,
                            block: "practice1",
                            trial: 1,
                            valence: 0,
                            response_deadline: -1,
                            stimulus_group: 1,
                            stimulus_group_id: 1,
                            n_groups: 1,
                            rest: {},
                            early_stop: false
                        }
                    ]],
                    false,
                    settings
                )
            }
        );
    }

    // Add explanation and practice instructions
    inst = inst.concat([{
        type: jsPsychInstructions,
        css_classes: ['instructions'],
        pages: [
            `${settings.session === "screening" ? "<p>You found a one pound coin!</p>" : ""}
            <p>Some cards are better than others. You can learn which ones by trying them.</p>
            <p>But even the best cards give just a penny sometimes${window.task == "screening" ? "" : ". Now and then they break a £1 coin"}.</p>`
        ],
        show_clickable_nav: true,
        data: {trialphase: "pilt_instruction"}
    },
    createReadyTrial(
        `<p>Let's have a go at collecting coins.</p>
            <p>On the next screen, pick cards and collect as much as you can.</p>
            <p>One of the picture cards has mostly £1 coins behind it, while the other has mostly ${settings.session === "screening" ? "50 pence coins" : "broken £1 coins"} behind it.</p>
        `,
        "pilt_instruction"
    )
   ]);

    // Generate randomized practice trial sequences
    let dumbbell_on_right = shuffleArray([true, true, false, true, false, false], settings.session);
    let reward_magnitude = shuffleArray([1, 1, 1, 0.5, 1, 1.], settings.session + "b");

    // Shorter practice for non-screening sessions
    if (settings.session !== "screening"){
        dumbbell_on_right = dumbbell_on_right.slice(0, 4);
        reward_magnitude = reward_magnitude.slice(0, 4);
    }

    // Add main practice task
    inst.push(
        {
            timeline: buildCardChoosingTask(
                [
                    // Map trials with alternating good/bad card positions
                    dumbbell_on_right.map((e, i) => 
                        ({
                            stimulus_left: e ? demo_stimuli[2] : demo_stimuli[3],
                            stimulus_right: e ? demo_stimuli[3] : demo_stimuli[2],
                            stimulus_middle: "",
                            feedback_middle: "",
                            present_pavlovian: settings.session !== "screening",
                            pavlovian_images: getPavlovianImages(settings),
                            n_stimuli: 2,
                            optimal_side: "",
                            // Set feedback values based on card position and session type
                            feedback_left: e ? (settings.session === "screening" ? 0.5 : -1. ) : reward_magnitude[i],
                            feedback_right: e ? reward_magnitude[i] : (settings.session === "screening" ? 0.5 : -1. ),
                            optimal_right: e,
                            block: "practice2",
                            trial: i,
                            valence: 0,
                            stimulus_group: 1,
                            stimulus_group_id: 1,
                            n_groups: 1,
                            rest: {},
                            early_stop: false
                        })
                    )
                ],
                false,
                settings
            )
        }
    );

    // Add block summary message
    inst.push(inter_block_instruct);

    // Add quiz introduction
    inst.push({
                type: jsPsychInstructions,
                css_classes: ['instructions'],
                pages: [`<p>Before you start, here are a few questions about what you just read.</p>
                        <p>You need all of them right to begin.</p>
                        <p>If you get one wrong, you can read the rules again and try once more.</p>`],
                show_clickable_nav: true,
                data: {trialphase: "pilt_instruction"}
            });
    
    // Create instruction comprehension quiz questions
    let quiz_questions = [
        {
            prompt: `Some cards are better than others, but even the best cards might only give a penny${settings.session !== "screening" ? " or break a £1 coin" : ''}.`,
            options: ["True", "False"],
            required: true
        },
        {
            prompt: `My goal is to collect as many game coins as I can${settings.session !== "screening" ? " and avoid losing them" : ''}.`,
            options: ["True", "False"],
            required: true
        },
    ];

    // Add broken coin question for non-screening sessions
    if (settings.session !== "screening"){
        quiz_questions.splice(1, 0, {
            prompt: "If I find a broken coin, that means I lose that amount.",
            options: ["True", "False"],
            required: true
        });
    }

    // Create quiz trials - one statement per screen with True/False buttons. The aggregate
    // record it writes under "instruction_quiz" keeps the same {Q0, Q1, ...} response shape
    // the review screen and loop_function below already read.
    let quiz = createInstructionQuiz(quiz_questions, {
        trialphase: "instruction_quiz",
        preamble: `<div class=instructions><p>For each statement, say if it is true or false:</p></div>`
    });

    // Explanation for wrong answers
    let piltQuizExplanation = [
        {
            prompt: `Some cards are better than others, but even the best cards might only give a penny${settings.session !== "screening" ? " or break a £1 coin" : ''}.`,
            explanation: "The cards do not always pay out the same way. You learn which are better by trying them."
        },
        {
            prompt: `My goal is to collect as many game coins as I can${settings.session !== "screening" ? " and avoid losing them" : ''}.`,
            explanation: "Your goal is to collect as much money as possible. This means learning to choose cards that give you the most money, and avoiding cards that break valuable coins."
        }
    ];

    if (settings.session !== "screening"){
        piltQuizExplanation.splice(1, 0,{
            prompt: "If I find a broken coin, that means I lose that amount.",
            explanation: "If you find a broken coin, you lose that amount of game coins. This means that if you find a broken £1 coin, you lose £1 in the game."
        });
    }
    
    
    quiz.push(
        {   
            type: jsPsychInstructions,
            css_classes: ['instructions'],
            allow_keys: false,
            show_page_number: false,
            show_clickable_nav: true,
            data: {
                trialphase: "pilt_instruction_quiz_review"
            },
            timeline: [
                {
                    pages: () => {
                        const data = jsPsych.data.get().filter({trialphase: "instruction_quiz"}).last(1).select('response').values[0];
                        return piltQuizExplanation.filter((item, index) => {
                            return Object.values(data)[index] !== "True";
                        }).map(item => `
                            <p>You got this one wrong.</p>
                            <h3 style="color: darkred; width: 700px; text-align: left;">${item.prompt}</h3>
                            <br>
                            <p style="max-width: 700px; text-align: left;"><strong>Right answer:</strong> True</p>
                            <p style="max-width: 700px; text-align: left;"><strong>Why:</strong> ${item.explanation}</p>
                            ${settings.session === "screening" ? "<p>Read the rules again and try once more.</p>" : "<p>Press next to try again.</p>"}
                        `);
                    }
                }
            ],
            conditional_function: check_quiz_failed
        }
    );


    // Create instruction loop with quiz feedback and retry logic
    const inst_loop = {
        timeline: settings.session === "screening" ? inst.concat(quiz) : quiz,
        loop_function: () => {
            if (!check_quiz_failed()){
                return false; // Quiz passed, exit loop
            }

            // For non-screening sessions, allow unlimited quiz attempts
            if (settings.session !== "screening"){
                return true;
            }

            // For screening sessions, limit to 3 attempts
            const attempts = jsPsych.data.get().select('trialphase').values.filter(item => item === "instruction_quiz").length;
            
            if (attempts < 3){
                return true; // Continue loop
            } else {
                return false; // Exit after 3 attempts
            }
        }
    }

    // Build final instruction timeline
    let inst_total = [];

    // Add main instructions for non-screening sessions
    if (settings.session !== "screening"){
        inst_total = inst_total.concat(inst);
    }

    // Add instruction loop and final ready message
    inst_total = inst_total.concat(
        [
            inst_loop,
            createReadyTrial(
                `<p>Great. Now let's play for real.</p>
                <p>You will play ${settings.session === "screening" ? "one more round" : "<b>15 rounds</b>"} of the card game. It takes about ${settings.session === "screening" ? "two minutes" : "<b>10 to 15 minutes</b>"}.</p>
                ${settings.session !== "screening" ? "<p>You can take a short break between rounds if you need one.</p>" : ""}`,
                "pilt_instruction"
            )
        ]
    )

    return inst_total
} 

/**
 * Checks if the participant failed the instruction comprehension quiz
 * @returns {boolean} True if any quiz answer is incorrect, false if all answers are "True"
 */
function check_quiz_failed() {
    const data = jsPsych.data.get().filter({trialphase: "instruction_quiz"}).last(1).select('response').values[0];

    return !Object.values(data).every(value => value === "True");
}


/**
 * Creates instructions for post-PILT test phase
 * @param {string} task - The task identifier (e.g., "pilt", "ltm", "wm")
 * @returns {Object} jsPsych instruction trial object for test phase
 */
const testInstructions = (task) => {
    return {
        type: jsPsychInstructions,
        css_classes: ['instructions'],
        pages: [
            `<p>Now you will play one more round of the card game.</p>
            <p>This time you will not see the coins you win. You still collect them, and they still go in your safe.</p>
            <p>Each turn you pick between two cards you have seen before. Pick the one you think gives more.</p>
            <p>This round takes about three minutes.</p>`
        ],
        show_clickable_nav: true,
        on_start: () => {
            updateState(`${task}_test_instructions_start`);
        },
        data: {trialphase: `post-${task}_test_instructions`},
        on_finish: () => {
            jsPsych.data.addProperties({
                [`${task}_test_n_warnings`]: 0
            });
            console.log(jsPsych.data.get().last(1).select(`${task}_test_n_warnings`).values)
        }
    }
}

/**
 * Ready screen for the three-response variants (LTM's three cards, WM's single card with
 * three responses). Kept separate from the shared createReadyTrial helper because the
 * keyboard version here is a single up-arrow press, not the two-handed press-both check -
 * this preserves that exactly and only adds the touch branch.
 *
 * @param {string} stimulus - HTML shown above the modality-specific prompt
 * @param {string} trialphase - Phase identifier for data logging
 * @param {string} warningCounter - Data property to zero when the trial finishes
 * @returns {Object} jsPsych trial configuration object
 */
function threeResponseReadyTrial(stimulus, trialphase, warningCounter) {
    const resetCounter = () => {
        jsPsych.data.addProperties({
            [warningCounter]: 0
        });
    };

    if (touchCapable) {
        return {
            type: jsPsychHtmlButtonResponse,
            css_classes: ['instructions'],
            stimulus: stimulus + `<p>When you are ready to start playing, tap the button below.</p>`,
            choices: ["I'm ready"],
            data: { trialphase: trialphase },
            simulation_options: { data: { response: 0 } },
            on_finish: resetCounter
        };
    }

    return {
        type: jsPsychHtmlKeyboardResponse,
        css_classes: ['instructions'],
        stimulus: stimulus + `<p>Put your fingers on the left, right, and up arrow keys as shown. Press the up arrow key to begin.</p>
        <img src='./assets/images/3_finger_keys.jpg' style='width:250px;'></img>`,
        choices: ['arrowup'],
        data: { trialphase: trialphase },
        on_finish: resetCounter
    };
}

/**
 * Instructions for the Long-Term Memory (LTM) task variant
 * Uses three-card choice, selected by tapping a card or with the arrow keys
 */
const LTM_instructions = [
    {
        type: jsPsychInstructions,
        css_classes: ['instructions'],
        pages: [
            '<p>You will now play another round of the card choosing game.</p>\
                <p>Your goal remains to add as much money as you can to your safe.</p>',
            `<p>This time you pick from three cards each turn.</p>
            <p>One card in each set always has £1 and 50 pence coins. The other two have only pennies.</p>
            <p>Learn which card is best in each set and pick it next time.</p>`,
            touchCapable
                ? `<p><b>Tap the card you want to choose</b> - left, middle, or right.</p>`
                : `<p>Press the <b>left arrow</b> to pick the left card. Press the <b>right arrow</b> for the right. Press the <b>up arrow</b> for the middle.</p>`
        ],
        show_clickable_nav: true,
        data: {trialphase: "LTM_instructions"}
    },
    threeResponseReadyTrial(
        `<p>Let's get started!</p>
        <p>You will play one round with no breaks, lasting about 8 minutes.</p>`,
        "LTM_instructions",
        "ltm_n_warnings"
    )
]

/**
 * Instructions for the Working Memory (WM) task variant
 * Single card presented with three possible key responses (left, right, up arrows)
 */
const WM_instructions = [
    {
        type: jsPsychInstructions,
        css_classes: ['instructions'],
        pages: [
            '<p>You will now play another round of the card choosing game.</p>\
                <p>Your goal remains to add as much money as you can to your safe.</p>',
            touchCapable
                ? `<p>This time, you will see only one card on each turn.</p>
            <p>Below the card there are three buttons: <span class="cardChoosingResponseBtn">←</span> <span class="cardChoosingResponseBtn">↑</span> <span class="cardChoosingResponseBtn">→</span>. You can flip the card by tapping any one of them.</p>
            <p>For each card, tapping one of the three buttons will always reveal £1 and 50-pence coins, while the other two will reveal only pennies.</p>
            <p>You can earn more by learning which is the better button for each card, and tapping that button when you next see the same card.</p>`
                : `<p>This time, you see just one card each turn.</p>
            <p>Press <span class="spacebar-icon">&nbsp;←&nbsp;</span>, <span class="spacebar-icon">&nbsp;↑&nbsp;</span>, or <span class="spacebar-icon">&nbsp;→&nbsp;</span> to flip it.</p>
            <p>One key always shows £1 and 50 pence coins. The other two show only pennies.</p>
            <p>Learn which key is best for each card and use it again next time.</p>`
        ],
        show_clickable_nav: true,
        data: {trialphase: "WM_instructions"}
    },
    threeResponseReadyTrial(
        `<p>Let's get started!</p>
        <p>You will play one round with no breaks, lasting about 8 minutes.</p>`,
        "WM_instructions",
        "wm_n_warnings"
    )
]

export {
    preparePILTInstructions,
    testInstructions,
    WM_instructions
};

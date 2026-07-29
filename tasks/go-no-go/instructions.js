import {
  createInstructionQuiz,
  updateState,
  kickOut,
  fullscreen_prompt,
} from '@utils/index.js';

const COIN_IMAGES = {
  pound: './assets/images/card-choosing/outcomes/1pound.png',
  penny: './assets/images/card-choosing/outcomes/1penny.png',
  brokenPound: './assets/images/card-choosing/outcomes/1poundbroken.png',
  brokenPenny: './assets/images/card-choosing/outcomes/1pennybroken.png',
};

const TRAINING_MIN_TRIALS = 4;
const TRAINING_STREAK = 3;
const TRAINING_MAX_TOTAL = 60;

/**
 * Final practice: all four faces interleaved, in blocks of 8 (2 appearances each).
 *
 * One fixed order per block, so every participant meets the same sequence, but a
 * different one each time a block repeats. Each was generated under three
 * constraints, all of which matter for what a participant can anticipate:
 *   - no face repeats back to back, which would let the second appearance be
 *     answered without looking;
 *   - the second half of a block is not a repeat of the first, so finishing a
 *     block is not a matter of replaying its opening;
 *   - no ABAB run, which is the same problem locally.
 * The first draft failed the middle two - one block was a 4-cycle repeated
 * verbatim, another alternated in pairs - which is why they are checked rather
 * than assumed.
 *
 * There are exactly as many orders as FINAL_PRACTICE_MAX_BLOCKS, so no
 * participant ever sees the same order twice.
 */
const FINAL_PRACTICE_ORDERS = [
  [0, 3, 2, 3, 1, 2, 0, 1],
  [2, 0, 3, 1, 0, 2, 1, 3],
  [1, 0, 2, 1, 3, 0, 2, 3],
  [0, 2, 1, 0, 2, 3, 1, 3],
];
const FINAL_PRACTICE_BLOCK_LENGTH = 8;
/** Correct responses required PER FACE, counted across the whole final practice. */
const FINAL_PRACTICE_CORRECT_PER_ITEM = 2;
/** Safety cap, so a participant who cannot reach criterion is not stuck here. */
const FINAL_PRACTICE_MAX_BLOCKS = 4;

const isTouch = () => navigator.maxTouchPoints > 0;

const actionText = () => (isTouch() ? 'touch the picture' : 'press the space bar');
const FEEDBACK_GREEN = '#2e7d32';
const FEEDBACK_RED = '#c62828';

function coinInline(src, alt) {
  return `<img src="${src}" alt="${alt}" style="width:68px; height:68px; vertical-align:middle; margin-left:8px;">`;
}

function getStageAccuracy(stageId) {
  return jsPsych.data
    .get()
    .filter({ trialphase: 'go_no_go_training', practice_stage: stageId })
    .select('correct')
    .values;
}

function getTotalTrainingTrials() {
  return jsPsych.data.get().filter({ trialphase: 'go_no_go_training' }).count();
}

/** Correct responses so far in the final practice, keyed by face/stage id. */
function finalPracticeCorrectByItem() {
  const counts = {};
  jsPsych.data
    .get()
    .filter({ trialphase: 'go_no_go_training', practice_stage: 'combined' })
    .values()
    .forEach((t) => {
      if (t.correct) counts[t.practice_item] = (counts[t.practice_item] || 0) + 1;
    });
  return counts;
}

function finalPracticeTrialCount() {
  return jsPsych.data
    .get()
    .filter({ trialphase: 'go_no_go_training', practice_stage: 'combined' })
    .count();
}

/**
 * Criterion is per FACE, not overall: someone can be at chance on one contingency
 * while getting the other three right, and an aggregate score would hide that.
 */
function passedFinalPractice(stageIds) {
  const counts = finalPracticeCorrectByItem();
  return stageIds.every((id) => (counts[id] || 0) >= FINAL_PRACTICE_CORRECT_PER_ITEM);
}

/**
 * The final practice: four faces interleaved, repeating in blocks until every face
 * has been answered correctly FINAL_PRACTICE_CORRECT_PER_ITEM times.
 *
 * Uses timeline_variables with a custom sample rather than eight hard-coded
 * trials, because the order now differs per block: jsPsych calls sample.fn once
 * per loop iteration, so it can hand back that block's order.
 *
 * Simulated answers come from the plugin's simulate_correct parameter, not from
 * simulation_options: jsPsych does not resolve jsPsych.timelineVariable() inside
 * simulation_options.data, so a per-face answer passed that way was silently
 * ignored and every no-go trial simulated as a go.
 */
function buildFinalPracticeLoop(settings, trainingFaces, stages) {
  const stageIds = stages.map((stage) => stage.id);

  const variables = stages.map((stage, index) => ({
    stimulus: trainingFaces[index % trainingFaces.length],
    correct_response: stage.correct_response,
    outcome_correct: stage.outcome_correct,
    outcome_incorrect: stage.outcome_incorrect,
    item: stage.id,
    label: stage.label,
  }));

  return {
    timeline: [
      {
        timeline: [
          kickOut(settings),
          fullscreen_prompt,
          {
            type: jsPsychGoNoGo,
            stimulus: jsPsych.timelineVariable('stimulus'),
            correct_response: jsPsych.timelineVariable('correct_response'),
            outcome_correct: jsPsych.timelineVariable('outcome_correct'),
            outcome_incorrect: jsPsych.timelineVariable('outcome_incorrect'),
            response_window: settings.response_window,
            resize_duration: settings.resize_duration,
            feedback_duration: settings.feedback_duration,
            iti: settings.iti,
            simulate_correct: true,
            data: {
              trialphase: 'go_no_go_training',
              practice_stage: 'combined',
              practice_item: jsPsych.timelineVariable('item'),
              practice_label: jsPsych.timelineVariable('label'),
              practice_block: () =>
                Math.floor(finalPracticeTrialCount() / FINAL_PRACTICE_BLOCK_LENGTH) + 1,
            },
          },
        ],
      },
    ],
    timeline_variables: variables,
    sample: {
      type: 'custom',
      // Called once per loop iteration, before the block runs, so the completed
      // trial count identifies which block this is about to be.
      fn: () => {
        const blockIndex = Math.floor(finalPracticeTrialCount() / FINAL_PRACTICE_BLOCK_LENGTH);
        return FINAL_PRACTICE_ORDERS[blockIndex % FINAL_PRACTICE_ORDERS.length];
      },
    },
    loop_function: () => {
      if (finalPracticeTrialCount() >= FINAL_PRACTICE_MAX_BLOCKS * FINAL_PRACTICE_BLOCK_LENGTH) {
        return false;
      }
      return !passedFinalPractice(stageIds);
    },
  };
}

function passedStage(stageId) {
  const acc = getStageAccuracy(stageId);
  if (acc.length < TRAINING_MIN_TRIALS) return false;
  const recent = acc.slice(-TRAINING_STREAK);
  return recent.length === TRAINING_STREAK && recent.every(Boolean);
}

function buildPracticeLoop(settings, facePath, stage) {
  return {
    timeline: [
      {
        timeline: [
          kickOut(settings),
          fullscreen_prompt,
          {
            type: jsPsychGoNoGo,
            stimulus: facePath,
            correct_response: stage.correct_response,
            outcome_correct: stage.outcome_correct,
            outcome_incorrect: stage.outcome_incorrect,
            response_window: settings.response_window,
            resize_duration: settings.resize_duration,
            feedback_duration: settings.feedback_duration,
            iti: settings.iti,
            coin_images: {
              10: COIN_IMAGES.pound,
              1: COIN_IMAGES.penny,
              '-1': COIN_IMAGES.brokenPenny,
              '-10': COIN_IMAGES.brokenPound,
            },
            // Keep simulate-mode tests deterministic so training exits quickly.
            simulate_correct: true,
            data: {
              trialphase: 'go_no_go_training',
              practice_stage: stage.id,
              practice_label: stage.label,
            },
          },
        ],
      },
    ],
    loop_function: () => {
      // Safety cap mirrors RobotFactory-style practice safeguards.
      if (getTotalTrainingTrials() >= TRAINING_MAX_TOTAL) return false;
      return !passedStage(stage.id);
    },
  };
}

function checkQuizFailed() {
  const last = jsPsych.data.get().filter({ trialphase: 'go_no_go_instruction_quiz' }).last(1).values()[0];
  return !(last && last.quiz_passed);
}

export function prepareGoNoGoInstructions(settings, trainingFaces) {
  const mainInstructions = {
    type: jsPsychInstructions,
    css_classes: ['instructions'],
    show_clickable_nav: true,
    data: { trialphase: 'go_no_go_instruction' },
    on_start: () => updateState('go_no_go_instructions_start'),
    pages: [
      `<p><b>THE PEOPLE GAME</b></p>
       <p>In this game you will see pictures of people, one at a time.</p>
       <p>For each person, you decide whether to tap or not.</p>`,

      `<p>Each picture stays on screen for a moment.</p>
       <p><b>To tap:</b> ${actionText()}.</p>
       <p><b>To not tap:</b> just wait, and the picture will go away on its own.</p>
       <p>Choose quickly - you do not have long.</p>`,

      `<p>With some people, there is <b style="color:${FEEDBACK_GREEN};">money to win</b>.</p>
       <p>Get it right and you win <b>£1</b>. ${coinInline(COIN_IMAGES.pound, '1 pound coin')}</p>
       <p>Get it wrong and you win only <b>1p</b>. ${coinInline(COIN_IMAGES.penny, '1 penny coin')}</p>
       <p>With others, there is <b style="color:${FEEDBACK_RED};">money to lose</b>.</p>
       <p>Get it right and you lose only <b>1p</b>. ${coinInline(COIN_IMAGES.brokenPenny, 'broken 1 penny coin')}</p>
       <p>Get it wrong and you lose <b>£1</b>. ${coinInline(COIN_IMAGES.brokenPound, 'broken 1 pound coin')}</p>`,

      `<p>The same people come back again and again.</p>
       <p>Some are best tapped. Others are best left alone. You cannot tell by looking - you have to find out by trying.</p>
       <p>Watch what happens each time, and try to remember what works for each person.</p>`,

      // Feedback is only 80% valid, so a participant will make the better choice and
      // still see the worse coin. Phrased after PILT's "even the best cards may
      // sometimes give only a penny": it names the exception in terms of the coins
      // themselves, rather than telling anyone what to do about it.
      `<p>Even when you make the better choice, you may sometimes get only a penny, or occasionally break a £1 coin.</p>
       <p>First, let's try a few.</p>`,
    ],
  };

  const stages = [
    {
      id: 'press_win',
      label: 'press for £1',
      correct_response: 'go',
      outcome_correct: 10,
      outcome_incorrect: 1,
      intro: `<p><b>Let's try tapping.</b> (1 of 4)</p>
              <p>Tap this person's picture and see what happens.</p>
              <p>When you get it right, you win <b>£1</b>.</p>`,
    },
    {
      id: 'wait_win',
      label: 'wait for £1',
      correct_response: 'nogo',
      outcome_correct: 10,
      outcome_incorrect: 1,
      intro: `<p><b>Now let's try waiting.</b> (2 of 4)</p>
              <p>This time, do not tap. Just wait.</p>
              <p>When you get it right, you win <b>£1</b>.</p>`,
    },
    {
      id: 'press_lose_less',
      label: 'press to lose less',
      correct_response: 'go',
      outcome_correct: -1,
      outcome_incorrect: -10,
      intro: `<p><b>Sometimes there is money to lose.</b> (3 of 4)</p>
              <p>Here, tapping is the better choice.</p>
              <p>Get it right and you lose only <b>1p</b>. Get it wrong and you lose <b>£1</b>.</p>`,
    },
    {
      id: 'wait_lose_less',
      label: 'wait to lose less',
      correct_response: 'nogo',
      outcome_correct: -1,
      outcome_incorrect: -10,
      intro: `<p><b>One more.</b> (4 of 4)</p>
              <p>Here, waiting is the better choice.</p>
              <p>Get it right and you lose only <b>1p</b>. Get it wrong and you lose <b>£1</b>.</p>`,
    },
  ];

  const trainingBlocks = [];
  stages.forEach((stage, index) => {
    trainingBlocks.push({
      type: jsPsychInstructions,
      css_classes: ['instructions'],
      show_clickable_nav: true,
      data: { trialphase: 'go_no_go_instruction' },
      pages: [stage.intro],
    });

    trainingBlocks.push(buildPracticeLoop(settings, trainingFaces[index % trainingFaces.length], stage));
  });

  trainingBlocks.push({
    type: jsPsychInstructions,
    css_classes: ['instructions'],
    show_clickable_nav: true,
    data: { trialphase: 'go_no_go_instruction' },
    pages: [
      `<p><b>Now all four together.</b></p>
       <p>You will see the same four people, mixed up.</p>
       <p>Each one works the same way as it did just now.</p>`,
    ],
  });
  trainingBlocks.push(buildFinalPracticeLoop(settings, trainingFaces, stages));

  const quizQuestions = [
    {
      prompt: `For each person, I choose whether to tap or not.`,
      correct: 'True',
    },
    {
      prompt: `A broken coin means I have lost money.`,
      correct: 'True',
    },
    {
      prompt: `The same people come back, so I can learn what works for each one.`,
      correct: 'True',
    },
  ];

  const quizIntro = {
    type: jsPsychInstructions,
    css_classes: ['instructions'],
    show_clickable_nav: true,
    data: { trialphase: 'go_no_go_instruction' },
    pages: [
      `<p>Nicely done.</p>
       <p>Before you start, a few quick questions.</p>
       <p>You need all of them right to go on.</p>`,
    ],
  };

  const quizRetryPrompt = {
    type: jsPsychInstructions,
    css_classes: ['instructions'],
    show_clickable_nav: true,
    data: { trialphase: 'go_no_go_instruction_quiz_review' },
    pages: [
      `<p>Not quite. Have another go.</p>`,
    ],
    conditional_function: checkQuizFailed,
  };

  const quizLoop = {
    timeline: [
      ...createInstructionQuiz(quizQuestions, {
        trialphase: 'go_no_go_instruction_quiz',
        preamble:
          `<div class="instructions"><p>Is each sentence true or false?</p></div>`,
      }),
      quizRetryPrompt,
    ],
    loop_function: () => checkQuizFailed(),
  };

  return [mainInstructions, ...trainingBlocks, quizIntro, quizLoop];
}

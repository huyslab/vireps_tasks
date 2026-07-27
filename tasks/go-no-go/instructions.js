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

const isTouch = () => navigator.maxTouchPoints > 0;

const actionText = () =>
  isTouch()
    ? 'press on the face'
    : 'press SPACE when the face is on the screen';

const noActionText = () => 'do not press anything';
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
            simulation_options: {
              data:
                stage.correct_response === 'go'
                  ? { response: 'go', rt: 80, pointer_type: 'keyboard' }
                  : { response: 'nogo', rt: null, pointer_type: null },
            },
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
      `<p><b>THE FACES GAME</b></p>
       <p>Welcome.</p>
       <p>You will see many faces.</p>
       <p>Your job is simple:</p>
       <p>decide whether to press on each face or not.</p>`,

      `<p>When a face appears, choose quickly.</p>
       <p><b>Press</b>: ${actionText()}.</p>
       <p><b>Do not press</b>: ${noActionText()}.</p>`,

      `<p>Some faces let you <b style="color:${FEEDBACK_GREEN};">WIN</b> coins.</p>
        <p>If you choose correctly, you get a <b>£1 coin</b>. ${coinInline(COIN_IMAGES.pound, '1 pound coin')}</p>
        <p>If you choose incorrectly, you get a <b>1p coin</b>. ${coinInline(COIN_IMAGES.penny, '1 penny coin')}</p>
       <p>Some faces make you <b style="color:${FEEDBACK_RED};">LOSE</b> coins.</p>
        <p>If you choose correctly, you lose only <b>1p</b>. ${coinInline(COIN_IMAGES.brokenPenny, 'broken 1 penny coin')}</p>
        <p>If you choose incorrectly, you lose <b>£1</b>. ${coinInline(COIN_IMAGES.brokenPound, 'broken 1 pound coin')}</p>`,

      `<p>You may see the same face many times.</p>
       <p>Learn what works best for each face.</p>
       <p>Try to win more coins and lose fewer coins.</p>`,

      `<p>Now you will do short training rounds.</p>
       <p>This will help you get ready for the main game.</p>`,
    ],
  };

  const stages = [
    {
      id: 'press_win',
      label: 'press for £1',
      correct_response: 'go',
      outcome_correct: 10,
      outcome_incorrect: 1,
      intro: `<p>Training 1 of 4.</p>
              <p>In this round, try pressing on the face.</p>
              <p>If you choose correctly, you get a <b>£1 coin</b>.</p>`,
    },
    {
      id: 'wait_win',
      label: 'wait for £1',
      correct_response: 'nogo',
      outcome_correct: 10,
      outcome_incorrect: 1,
      intro: `<p>Training 2 of 4.</p>
              <p>In this round, try not to press.</p>
              <p>If you choose correctly, you get a <b>£1 coin</b>.</p>`,
    },
    {
      id: 'press_lose_less',
      label: 'press to lose less',
      correct_response: 'go',
      outcome_correct: -1,
      outcome_incorrect: -10,
      intro: `<p>Training 3 of 4.</p>
              <p>In this round, try pressing on the face.</p>
              <p>If you choose correctly, you lose only <b>1p</b>.</p>
              <p>If you choose incorrectly, you lose <b>£1</b>.</p>`,
    },
    {
      id: 'wait_lose_less',
      label: 'wait to lose less',
      correct_response: 'nogo',
      outcome_correct: -1,
      outcome_incorrect: -10,
      intro: `<p>Training 4 of 4.</p>
              <p>In this round, try not to press.</p>
              <p>If you choose correctly, you lose only <b>1p</b>.</p>
              <p>If you choose incorrectly, you lose <b>£1</b>.</p>`,
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

  const quizQuestions = [
    {
      prompt: `In the Faces Game, I choose to press on each face or not.`,
      correct: 'True',
    },
    {
      prompt: `A broken coin means I lose coins.`,
      correct: 'True',
    },
    {
      prompt: `I should learn the best choice for each face.`,
      correct: 'True',
    },
  ];

  const quizIntro = {
    type: jsPsychInstructions,
    css_classes: ['instructions'],
    show_clickable_nav: true,
    data: { trialphase: 'go_no_go_instruction' },
    pages: [
      `<p>Great work.</p>
       <p>Now answer a few short questions.</p>
       <p>You must get all of them right.</p>`,
    ],
  };

  const quizRetryPrompt = {
    type: jsPsychInstructions,
    css_classes: ['instructions'],
    show_clickable_nav: true,
    data: { trialphase: 'go_no_go_instruction_quiz_review' },
    pages: [
      `<p>Some answers were wrong.</p>
       <p>Please try again.</p>`,
    ],
    conditional_function: checkQuizFailed,
  };

  const quizLoop = {
    timeline: [
      ...createInstructionQuiz(quizQuestions, {
        trialphase: 'go_no_go_instruction_quiz',
        preamble:
          `<div class="instructions"><p>Read each sentence. Choose True or False.</p></div>`,
      }),
      quizRetryPrompt,
    ],
    loop_function: () => checkQuizFailed(),
  };

  return [mainInstructions, ...trainingBlocks, quizIntro, quizLoop];
}

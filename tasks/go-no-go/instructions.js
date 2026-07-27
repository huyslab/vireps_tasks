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

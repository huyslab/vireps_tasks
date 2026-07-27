import { test, expect } from '@playwright/test';
import { captureShot, expectNoPageErrors, orientationOf, patchWebkitTouchPoints, sanitize, trackPageErrors } from './helpers.js';

// tasks/piggy-banks/vigour-instructions.js: FR = 5, demo unlocks "Continue" at shakeCount === FR + 1.
const DEMO_UNLOCK_TAPS = 6;
// tasks/piggy-banks/vigour-utils.js: VIGOUR_TRIALS ratios are 1, 8, or 16 presses-per-coin;
// this comfortably covers the largest with margin so a reward triggers regardless of trial.
const MAX_RATIO_TAPS = 20;
// tasks/reversal/styles.css: --animation-duration: 0.35s drives the coin-toss keyframes
// (top 60% -> 10% at 50% -> 100% at completion). Waiting half that lands on the 50% keyframe,
// where the coin is clearly visible mid-flight, rather than at its hidden start (t=0) or
// after it has fallen back off-screen (t=350ms+).
const REVERSAL_COIN_ANIMATION_MS = 350;

async function tapOrClick(locator, hasTouch) {
  if (hasTouch) {
    await locator.tap();
  } else {
    await locator.click();
  }
}

/**
 * Clicks through the touch-only orientation hint before task-specific instructions begin.
 * api/utils.js createTaskTimeline inserts this "Got it" trial after stimulus preloading;
 * desktop/non-touch skips it entirely.
 */
async function passOrientationHint(page, hasTouch) {
  if (hasTouch) {
    await page.getByRole('button', { name: 'Got it' }).click();
  }
}

/**
 * Drives a real (non-simulate) run of the vigour task far enough to deterministically
 * capture two moments simulate mode can't reliably land on: the static rules/instructions
 * text, and an actual coin-reward feedback moment.
 *
 * #piggy-container is reused by the interactive instructions demo, the "tap to begin"
 * confirmation, and the real trial - each screenshot below targets the one that matters at
 * that point in the timeline (see the readySelector comment in support/task-config.js for
 * why the real trial needs the `:not(:has(#instruction-container))` qualifier).
 */
async function vigourJourney(page, testInfo, hasTouch) {
  await passOrientationHint(page, hasTouch);

  // Interactive instructions demo: "Continue" only unlocks after DEMO_UNLOCK_TAPS taps.
  const demoPiggy = page.locator('#piggy-container');
  await expect(demoPiggy, 'instructions demo piggy bank should appear').toBeVisible({ timeout: 15000 });
  for (let i = 0; i < DEMO_UNLOCK_TAPS; i++) {
    await tapOrClick(demoPiggy, hasTouch);
  }
  await page.locator('#continue-button').click();

  // Static rules pages (jsPsychInstructions) - the actual instructions text.
  await expect(page.locator('#jspsych-instructions-next'), 'rules instructions page should appear').toBeVisible({
    timeout: 15000,
  });
  await captureShot(page, testInfo, 'vigour', 'instructions');
  await page.locator('#jspsych-instructions-next').click(); // page 2 of 2
  await page.locator('#jspsych-instructions-next').click(); // -> startConfirmation

  // "Tap the piggy bank to begin" confirmation screen.
  await expect(demoPiggy, 'start-confirmation piggy bank should appear').toBeVisible({ timeout: 15000 });
  await tapOrClick(demoPiggy, hasTouch);

  // Real trial: tap enough times to guarantee a reward regardless of this trial's ratio.
  const trialPiggy = page.locator('.experiment-wrapper:not(:has(#instruction-container)) #piggy-container');
  await expect(trialPiggy, 'real trial piggy bank should appear').toBeVisible({ timeout: 15000 });
  for (let i = 0; i < MAX_RATIO_TAPS; i++) {
    await tapOrClick(trialPiggy, hasTouch);
  }
  await expect(page.locator('.vigour_coin').first(), 'a coin should drop after enough presses').toBeVisible({
    timeout: 5000,
  });
  await captureShot(page, testInfo, 'vigour', 'feedback');
}

/**
 * Drives a real (non-simulate) run of the reversal task through to the static instructions
 * page and one real trial's coin-reveal feedback, branching on touch vs keyboard input the
 * same way the app itself does (task.js reversalInstructions / plugin-reversal.js).
 */
async function reversalJourney(page, testInfo, hasTouch) {
  await passOrientationHint(page, hasTouch);

  // Static rules pages (jsPsychInstructions) - wording differs by touch vs keyboard, both real.
  await expect(page.locator('#jspsych-instructions-next'), 'rules instructions page should appear').toBeVisible({
    timeout: 15000,
  });
  await captureShot(page, testInfo, 'reversal', 'instructions');
  await page.locator('#jspsych-instructions-next').click(); // page 2 of 2
  await page.locator('#jspsych-instructions-next').click(); // -> ready screen

  // Ready screen: tap either squirrel (touch) or press both arrow keys at once (keyboard).
  if (hasTouch) {
    await expect(page.locator('#rev-tap-left'), 'touch ready screen tap zone should appear').toBeVisible({
      timeout: 15000,
    });
    await page.locator('#rev-tap-left').tap();
  } else {
    await expect(page.locator('img[src*="2_finger_keys"]'), 'keyboard ready screen should appear').toBeVisible({
      timeout: 15000,
    });
    await Promise.all([page.keyboard.down('ArrowLeft'), page.keyboard.down('ArrowRight')]);
    await page.waitForTimeout(50); // hold both keys down together long enough to register as simultaneous
    await Promise.all([page.keyboard.up('ArrowLeft'), page.keyboard.up('ArrowRight')]);
  }

  // Real trial: respond once, then catch the coin reveal. triggerCoinAnimation sets
  // opacity:1 immediately on response, but the coin-toss CSS animation rises then falls
  // back past the bottom edge - screenshotting at t=0 catches it still at its hidden resting
  // position, and waiting past REVERSAL_COIN_ANIMATION_MS catches it already fallen off-screen.
  const stimulus = page.locator('.reversal-stimuli:has(#rev-coin-left)');
  await expect(stimulus, 'real trial stimulus should appear').toBeVisible({ timeout: 15000 });
  if (hasTouch) {
    await page.locator('#rev-tap-left').tap();
  } else {
    await page.keyboard.press('ArrowLeft');
  }
  await expect(page.locator('#rev-coin-left'), 'chosen-side coin should reveal after a response').toHaveCSS(
    'opacity',
    '1',
    { timeout: 5000 }
  );
  await page.waitForTimeout(REVERSAL_COIN_ANIMATION_MS / 2);
  await captureShot(page, testInfo, 'reversal', 'feedback');
}

/**
 * Clicks past the instruction pages that precede a card-choosing trial, then answers the
 * modality-appropriate ready screen: a button on touch, both arrow keys at once on keyboard
 * (core/utils/participation-validation.js createReadyTrial / threeResponseReadyTrial).
 */
async function passCardChoosingInstructions(page, hasTouch) {
  const next = page.locator('#jspsych-instructions-next');
  await expect(next, 'instructions page should appear').toBeVisible({ timeout: 15000 });
  while (await next.isVisible().catch(() => false)) {
    await next.click();
    await page.waitForTimeout(100);
  }

  if (hasTouch) {
    const readyButton = page.locator('.jspsych-btn');
    if (await readyButton.first().isVisible().catch(() => false)) {
      await readyButton.first().click();
    }
  } else {
    // Keyboard ready screens are either press-both-arrows (createReadyTrial) or a single
    // up-arrow (threeResponseReadyTrial); sending both covers either without branching on
    // which task this is.
    await Promise.all([page.keyboard.down('ArrowLeft'), page.keyboard.down('ArrowRight')]);
    await page.waitForTimeout(50); // hold together long enough to register as simultaneous
    await Promise.all([page.keyboard.up('ArrowLeft'), page.keyboard.up('ArrowRight')]);
    await page.keyboard.press('ArrowUp');
  }
}

/** Reads the most recent completed card-choosing trial out of the jsPsych data store. */
async function lastCardChoosingTrial(page) {
  return page.evaluate(() =>
    window.jsPsych.data.get().filter({ trial_type: 'card-choosing' }).last(1).values()[0]
  );
}

/**
 * WM is the conversion's hard case: one card and three responses, so there is no card to
 * tap and the three arrow keys become three on-screen buttons. This drives a real response
 * through the middle button (the one with no left/right analogue) and checks it is recorded
 * as that side, with the input modality captured.
 */
async function wmJourney(page, testInfo, hasTouch) {
  await passOrientationHint(page, hasTouch);
  await captureShot(page, testInfo, 'WM', 'instructions');
  await passCardChoosingInstructions(page, hasTouch);

  await expect(page.locator('#cardChoosingOptionBox'), 'WM trial should appear').toBeVisible({ timeout: 15000 });

  if (hasTouch) {
    const middle = page.locator('#middle_key');
    await expect(middle, 'WM response buttons should be present on touch').toBeVisible();
    await middle.tap();
  } else {
    await page.keyboard.press('ArrowUp');
  }

  await expect
    .poll(async () => (await lastCardChoosingTrial(page))?.response, {
      message: 'the middle response should be recorded',
      timeout: 10000,
    })
    .toBe('middle');

  const trial = await lastCardChoosingTrial(page);
  expect(trial.pointer_type, 'input modality should be recorded').toBe(hasTouch ? 'touch' : 'keyboard');
  expect(trial.rt, 'a response time should be recorded').toBeGreaterThan(0);
  await captureShot(page, testInfo, 'WM', 'feedback');
}

/**
 * The two-card layout, reached via the post-PILT test (one instructions page, then real
 * trials). Taps the left card and checks the tap selected that side.
 */
async function postPILTtestJourney(page, testInfo, hasTouch) {
  await passOrientationHint(page, hasTouch);
  await passCardChoosingInstructions(page, hasTouch);

  await expect(page.locator('#cardChoosingOptionBox'), 'test trial should appear').toBeVisible({ timeout: 15000 });
  await captureShot(page, testInfo, 'postPILTtest', 'in-task');

  if (hasTouch) {
    await page.locator('#left').tap();
  } else {
    await page.keyboard.press('ArrowLeft');
  }

  await expect
    .poll(async () => (await lastCardChoosingTrial(page))?.response, {
      message: 'the left card should be recorded as chosen',
      timeout: 10000,
    })
    .toBe('left');

  const trial = await lastCardChoosingTrial(page);
  expect(trial.pointer_type, 'input modality should be recorded').toBe(hasTouch ? 'touch' : 'keyboard');
  // Per-trial viewport values must survive the write-time merge with entry-time data
  // properties (see validation/playwright/data-properties.spec.js).
  expect(trial.viewport_width, 'per-trial viewport width should be recorded').toBeGreaterThan(0);
}

/**
 * PILT's full instruction path: rules pages, a practice round, then the comprehension quiz.
 * The quiz is the point of this journey - it is one statement per screen with True/False
 * buttons (core/utils/quiz.js), and it must still write the single aggregate record that the
 * wrong-answer review screen and the retry loop_function read.
 */
async function piltJourney(page, testInfo, hasTouch) {
  await passOrientationHint(page, hasTouch);

  // Walk whatever instruction/practice screens come before the quiz. The sequence differs by
  // modality (button vs press-both ready screens) and includes real card trials, so this
  // dispatches on what is actually on screen rather than assuming a fixed order.
  const statement = page.locator('.quiz-statement');
  for (let i = 0; i < 80 && !(await statement.isVisible().catch(() => false)); i++) {
    const next = page.locator('#jspsych-instructions-next');
    if (await next.isVisible().catch(() => false)) {
      await next.click();
      await page.waitForTimeout(80);
      continue;
    }
    const button = page.locator('.jspsych-btn').first();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      await page.waitForTimeout(80);
      continue;
    }
    if (await page.locator('#cardChoosingOptionBox').isVisible().catch(() => false)) {
      if (hasTouch) await page.locator('#left').tap();
      else await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(150);
      continue;
    }
    // Keyboard ready screen: both arrow keys held together.
    await Promise.all([page.keyboard.down('ArrowLeft'), page.keyboard.down('ArrowRight')]);
    await page.waitForTimeout(50);
    await Promise.all([page.keyboard.up('ArrowLeft'), page.keyboard.up('ArrowRight')]);
    await page.waitForTimeout(150);
  }

  await expect(statement, 'the comprehension quiz should appear').toBeVisible({ timeout: 20000 });
  await captureShot(page, testInfo, 'PILT', 'quiz');

  expect(await statement.count(), 'the quiz should show one statement per screen').toBe(1);
  expect(await page.locator('.quiz-btn').allInnerTexts()).toEqual(['True', 'False']);

  const button = await page.locator('.quiz-btn').first().boundingBox();
  expect(button.height, 'quiz buttons should clear the 44px touch-target minimum').toBeGreaterThanOrEqual(44);

  let answered = 0;
  while (await statement.isVisible().catch(() => false)) {
    await page.locator('.quiz-btn', { hasText: 'True' }).first().click();
    answered++;
    await page.waitForTimeout(200);
    expect(answered, 'quiz should terminate').toBeLessThan(11);
  }
  expect(answered, 'the quiz should have asked at least two questions').toBeGreaterThan(1);

  // The aggregate record has to keep the shape the single-page survey produced, or the
  // review screen and retry loop silently stop working.
  const aggregate = await page.evaluate(
    () => window.jsPsych.data.get().filter({ trialphase: 'instruction_quiz' }).last(1).values()[0]
  );
  expect(aggregate, 'an aggregate instruction_quiz record should be written').toBeTruthy();
  expect(
    Object.keys(aggregate.response),
    'response should be keyed Q0..Qn as jsPsychSurveyMultiChoice was'
  ).toEqual(Array.from({ length: answered }, (_, i) => `Q${i}`));
  expect(Object.values(aggregate.response).every((v) => v === 'True')).toBe(true);
  expect(aggregate.quiz_passed, 'answering all True should pass').toBe(true);

  const itemRows = await page.evaluate(
    () => window.jsPsych.data.get().filter({ trialphase: 'instruction_quiz_item' }).values().length
  );
  expect(itemRows, 'each question should also leave its own row').toBe(answered);
}


/**
 * Go/no-go: one go trial and one no-go trial, checking that the face grows on a
 * response and shrinks when the window elapses, and that both are recorded.
 */
async function goNoGoJourney(page, testInfo, hasTouch) {
  await passOrientationHint(page, hasTouch);

  const face = page.locator('#gng-stimulus');
  for (let i = 0; i < 120 && !(await face.isVisible().catch(() => false)); i++) {
    const quizTrue = page.locator('.quiz-btn', { hasText: 'True' }).first();
    if (await quizTrue.isVisible().catch(() => false)) {
      await quizTrue.click();
      await page.waitForTimeout(150);
      continue;
    }

    const nextButton = page.locator('#jspsych-instructions-next:not([disabled])').first();
    if (await nextButton.isVisible().catch(() => false)) {
      await nextButton.click();
      continue;
    }
    await page.waitForTimeout(300);
  }
  await expect(face, 'the face cue should appear').toBeVisible({ timeout: 20000 });
  await captureShot(page, testInfo, 'go_no_go', 'cue');

  // GO: respond straight away, the face should grow (approach).
  const beforeGo = (await face.boundingBox()).width;
  if (hasTouch) await face.tap();
  else await page.keyboard.press(' ');
  await page.waitForTimeout(200);
  const afterGo = (await face.boundingBox().catch(() => ({ width: 0 }))).width;
  expect(afterGo, 'face should grow on a go response').toBeGreaterThan(beforeGo);
  await captureShot(page, testInfo, 'go_no_go', 'feedback');

  // The first trials may come from training or the main task depending on the
  // instruction path, so we look at all go/no-go plugin rows.
  const trials = () =>
    page.evaluate(() => window.jsPsych.data.get().filter({ trial_type: 'go-no-go' }).values());
  await expect.poll(async () => (await trials()).length, { timeout: 10000 }).toBeGreaterThan(0);
  const go = (await trials())[0];
  expect(go.response, 'a go response should be recorded').toBe('go');
  expect(go.rt, 'go trials carry an RT').toBeGreaterThan(0);
  expect(go.pointer_type).toBe(hasTouch ? 'touch' : 'keyboard');
  expect([10, 1, -1, -10]).toContain(go.outcome);

  // NO-GO: let the window elapse.
  await expect(face, 'the next cue should appear').toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(2400);
  await expect.poll(async () => (await trials()).length, { timeout: 10000 }).toBeGreaterThan(1);
  const nogo = (await trials())[1];
  expect(nogo.response, 'letting the window elapse is a no-go').toBe('nogo');
  expect(nogo.rt, 'no-go trials have no RT').toBeNull();
}

const JOURNEYS = {
  vigour: vigourJourney,
  reversal: reversalJourney,
  WM: wmJourney,
  postPILTtest: postPILTtestJourney,
  PILT: piltJourney,
  go_no_go: goNoGoJourney,
};

/**
 * Registers a real-interaction (non-simulate) walkthrough that captures the instructions
 * text and an in-task feedback/coin moment - checkpoints simulate mode can't reliably land
 * on (see support/render-check.js for the broad, fast, simulate-mode device-matrix check).
 * Runs on a small curated device subset (see playwright.config.js JOURNEY_DEVICES) since
 * real click/tap/keypress choreography is slower and more device-flow-specific than the
 * simulate-mode rendering check.
 */
export function defineTaskJourneyTest(taskKey, taskConfig) {
  test(`${taskKey} instructions and feedback render correctly`, async ({ page }, testInfo) => {
    // Journeys drive the real instruction flow at real speed - PILT walks
    // instruction pages, practice trials with their post-trial gaps, and a
    // comprehension quiz, which is ~14s on an idle machine. Playwright's generic
    // 30s default leaves no room once the whole matrix is running in parallel
    // against one static server, and PILT then fails deterministically rather
    // than flakily. These tests are slow by design, so they get their own budget.
    test.setTimeout(120_000);

    const errors = trackPageErrors(page);
    await patchWebkitTouchPoints(page);

    const participantId = `journey_${sanitize(testInfo.project.name)}_${taskKey}`;
    await page.goto(`${taskConfig.url}?participant_id=${participantId}`);

    const hasTouch = await page.evaluate(() => navigator.maxTouchPoints > 0);

    // Unlike the rendering matrix (which deliberately checks both orientations), a journey
    // should exercise the task the way a real participant actually would: in ITS preferred
    // orientation. Phone projects default to portrait, which would otherwise hit the
    // rotate-overlay gate for reversal (landscape-preferred) and hang waiting for content
    // that's blocked behind it.
    const viewport = page.viewportSize();
    if (viewport && orientationOf(viewport) !== taskConfig.preferredOrientation) {
      await page.setViewportSize({ width: viewport.height, height: viewport.width });
    }

    await JOURNEYS[taskKey](page, testInfo, hasTouch);

    expectNoPageErrors(errors);
  });
}

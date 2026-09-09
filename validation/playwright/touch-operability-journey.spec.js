import { test } from '@playwright/test';
import { defineTouchOperabilityTest, defineTouchResponseTest } from './support/touch-check.js';

/**
 * Every task a participant meets on the study tablet, across all three modules,
 * driven by pointer input and nothing else - taps on the touch projects, clicks on
 * the desktop ones (see playwright.config.js).
 *
 * Desktop is not just filler: the piggy-bank tasks, max-press, the lottery and the
 * questionnaires are pointer-driven on EVERY device, so a mouse has to get through
 * them too. The tasks marked `keyboardOnDesktop` are the exception - reversal,
 * go/no-go and PILT keep a deliberate arrow-key path on desktop - so they are only
 * held to the keyboard-free standard on a touch device.
 */

// --- Module 1 ---
defineTouchOperabilityTest('reversal', {
  keyboardOnDesktop: true,
  url: '/examples/reversal.html',
  preferredOrientation: 'landscape',
  // .reversal-stimuli also renders on the "tap either squirrel to begin" screen; only a
  // real trial adds the coin divs (see task-config.js).
  readySelector: '.reversal-stimuli:has(#rev-coin-left)',
  tapToAdvance: '.rev-tap-zone',
});

// Reaching the first guided practice trial is the check: it is the first screen that
// needs a real response, and the whole practice loop uses that one tap target.
defineTouchOperabilityTest('go_no_go', {
  keyboardOnDesktop: true,
  url: '/examples/go-no-go.html',
  preferredOrientation: 'landscape',
  readySelector: '#gng-stimulus',
});

// --- Module 2 ---
defineTouchOperabilityTest('PILT', {
  keyboardOnDesktop: true,
  url: '/examples/PILT.html',
  preferredOrientation: 'landscape',
  readySelector: '#cardChoosingOptionBox',
});

defineTouchOperabilityTest('vigour', {
  url: '/examples/vigour.html',
  preferredOrientation: 'portrait',
  readySelector: '.experiment-wrapper:not(:has(#instruction-container)) #piggy-container',
  tapToAdvance: '#piggy-container',
});

defineTouchOperabilityTest('PIT', {
  url: '/examples/PIT.html',
  preferredOrientation: 'portrait',
  readySelector: '.experiment-wrapper:not(:has(#instruction-container)) #piggy-container',
  tapToAdvance: '#piggy-container',
});

defineTouchOperabilityTest('vigour_test', {
  url: '/examples/vigour-test.html',
  preferredOrientation: 'landscape',
  readySelector: '#piggy-container-left',
});

defineTouchOperabilityTest('max_press_test', {
  url: '/examples/max-press.html',
  readySelector: '#max-press-pad',
});

defineTouchOperabilityTest('pavlovian_lottery', {
  url: '/examples/pavlovian-lottery.html',
  readySelector: '.slot-machine-container',
});

// --- Questionnaires ---
defineTouchOperabilityTest('self_report', {
  url: '/experiment.html?task=self_report',
  readySelector: '.srq-options .srq-option',
});

/**
 * The tasks whose whole measure is how often the participant presses. Reaching the
 * screen is not enough - the taps have to register, which is what an overlay sitting
 * over the tap target silently breaks (PIT's occluding clouds did exactly this).
 */
defineTouchResponseTest('vigour', {
  url: '/examples/vigour.html',
  preferredOrientation: 'portrait',
  readySelector: '.experiment-wrapper:not(:has(#instruction-container)) #piggy-container',
  tapToAdvance: '#piggy-container',
  trialphase: 'vigour_trial',
  pressField: 'trial_presses',
});

defineTouchResponseTest('PIT', {
  url: '/examples/PIT.html',
  preferredOrientation: 'portrait',
  readySelector: '.experiment-wrapper:not(:has(#instruction-container)) #piggy-container',
  tapToAdvance: '#piggy-container',
  trialphase: 'pit_trial',
  pressField: 'trial_presses',
});

defineTouchResponseTest('max_press_test', {
  url: '/examples/max-press.html',
  readySelector: '#max-press-pad',
  trialphase: 'max_press_rate',
  pressField: 'trialPresses',
});

defineTouchResponseTest('vigour_test', {
  url: '/examples/vigour-test.html',
  preferredOrientation: 'landscape',
  readySelector: '#piggy-container-left',
  trialphase: 'vigour_test',
});

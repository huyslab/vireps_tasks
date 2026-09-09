import { expect, test } from '@playwright/test';
import { expectNoPageErrors, orientationOf, sanitize, trackPageErrors } from './helpers.js';

/**
 * Touch-operability checks: can a participant holding a tablet, with no keyboard
 * of any kind, actually get through this task?
 *
 * This is the one thing the rendering and journey checks did not ask. Module 2
 * shipped with four tasks that could only be advanced with the J key, the
 * Spacebar, the B key or the arrow keys - each perfectly renderable, each
 * impossible to complete on the study tablet. These tests fail on exactly that.
 *
 * Deliberately NOT patched with patchWebkitTouchPoints(): the other suites patch
 * navigator.maxTouchPoints because WebKit does not emulate it, but the app now
 * detects touch through `ontouchstart` and `pointer: coarse` as well
 * (core/utils/touch.js), so it should reach the touch path with the narrow signal
 * missing. Running unpatched is what proves that, and keeps these tests honest
 * about a device the harness has not corrected.
 */

/** Wording that can only be obeyed with a physical keyboard. */
const KEYBOARD_ONLY_COPY = [
  /press (the |down )?(the )?(space ?bar|spacebar)/i,
  /\barrow keys?\b/i,
  /press (the )?[A-Z] key/,
  /place your (fingers?|index finger)/i,
];



/**
 * Taps on a touch device, clicks on a desktop one. Playwright's tap() requires a
 * context created with hasTouch, so the desktop projects have to click - which is
 * the right gesture for them anyway. Both dispatch the pointer events the tasks
 * listen for, so the "no keyboard needed" question is asked the same way on each.
 */
async function pointerPress(page, locator, options = {}) {
  const canTap = await page.evaluate(() => 'ontouchstart' in window).catch(() => false);
  if (canTap) return locator.tap(options).catch(() => {});
  return locator.click(options).catch(() => {});
}

/**
 * A journey should exercise the task the way a participant would: in the orientation
 * it asks for. Phone projects default to portrait, so a landscape-preferring task
 * would otherwise sit behind the rotate-overlay for the whole walk.
 */
async function openInPreferredOrientation(page, config, participantId) {
  const viewport = page.viewportSize();
  if (viewport && config.preferredOrientation && orientationOf(viewport) !== config.preferredOrientation) {
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
  }
  const separator = config.url.includes('?') ? '&' : '?';
  await page.goto(`${config.url}${separator}participant_id=${participantId}`);
}

/**
 * Walks a task using taps alone, then asserts it reached a real trial.
 *
 * @param {string} taskKey - Name used in the test title
 * @param {object} config
 * @param {string} config.url - Page to load
 * @param {string} config.readySelector - Matches the real per-trial stimulus
 * @param {string} [config.preferredOrientation] - Rotate into this before walking
 * @param {boolean} [config.keyboardOnDesktop] - This task is deliberately keyboard-driven
 *   on non-touch devices (reversal, go/no-go and the card-choosing tasks all keep a
 *   keyboard-only desktop path on purpose, so a mouse cannot stand in for an arrow key).
 *   Such a task is only required to be keyboard-free on a touch device, so the check is
 *   skipped elsewhere rather than asserting something the design does not promise.
 * @param {string} [config.tapToAdvance] - Extra element that advances the task when
 *   tapped (a piggy bank on a "tap to begin" screen offers no forward button)
 * @param {number} [config.steps=40] - Screens to walk before giving up
 */
export function defineTouchOperabilityTest(taskKey, config) {
  test(`${taskKey} can be completed by touch alone`, async ({ page }, testInfo) => {
    test.setTimeout(120000);
    const errors = trackPageErrors(page);
    const participantId = `touch_${sanitize(testInfo.project.name)}_${taskKey}`;
    await openInPreferredOrientation(page, config, participantId);

    if (config.keyboardOnDesktop) {
      const hasTouch = await page.evaluate(() => 'ontouchstart' in window).catch(() => false);
      test.skip(!hasTouch, `${taskKey} is keyboard-driven by design on non-touch devices`);
    }

    const trial = page.locator(config.readySelector).first();
    const seen = [];

    for (let step = 0; step < (config.steps ?? 40); step++) {
      await page.waitForTimeout(250);
      if (await trial.isVisible().catch(() => false)) break;

      // Record instruction copy so a keyboard-only demand is reported with its text.
      const body = await page.locator('body').innerText().catch(() => '');
      if (body.trim()) seen.push(body);

      // Forward buttons only - never "Previous" or "Re-read", which loop.
      const forward = page.locator('button:visible, input[type=submit]:visible')
        .filter({ hasNotText: /Previous|Re-read/ });
      if (await forward.count() > 0) {
        await pointerPress(page, forward.last(), { noWaitAfter: true });
        continue;
      }
      if (config.tapToAdvance) {
        const target = page.locator(config.tapToAdvance).first();
        if (await target.isVisible().catch(() => false)) await pointerPress(page, target);
      }
    }

    // No screen along the way may have demanded a key.
    for (const screen of seen) {
      for (const pattern of KEYBOARD_ONLY_COPY) {
        expect(
          screen,
          `${taskKey}: an instruction screen asks for a key a tablet does not have (${pattern})`
        ).not.toMatch(pattern);
      }
    }

    await expect(
      trial,
      `${taskKey}: taps alone never reached ${config.readySelector} - the task is unreachable without a keyboard`
    ).toBeVisible({ timeout: 20000 });

    expectNoPageErrors(errors);
  });
}

/**
 * Asserts the task records a response to taps on its real trial surface - the task
 * being reachable is not the same as it being playable.
 *
 * @param {string} taskKey
 * @param {object} config - As above, plus:
 * @param {string} config.trialphase - jsPsych data trialphase to look for
 * @param {string} [config.pressField] - Field that must be non-zero across trials
 */
export function defineTouchResponseTest(taskKey, config) {
  test(`${taskKey} records responses to taps`, async ({ page }, testInfo) => {
    test.setTimeout(120000);
    const participantId = `touchresp_${sanitize(testInfo.project.name)}_${taskKey}`;
    await openInPreferredOrientation(page, config, participantId);

    const trial = page.locator(config.readySelector).first();
    for (let step = 0; step < (config.steps ?? 40); step++) {
      await page.waitForTimeout(250);
      if (await trial.isVisible().catch(() => false)) break;
      const forward = page.locator('button:visible, input[type=submit]:visible')
        .filter({ hasNotText: /Previous|Re-read/ });
      if (await forward.count() > 0) {
        await pointerPress(page, forward.last(), { noWaitAfter: true });
        continue;
      }
      if (config.tapToAdvance) {
        const target = page.locator(config.tapToAdvance).first();
        if (await target.isVisible().catch(() => false)) await pointerPress(page, target);
      }
    }
    await expect(trial, `${taskKey}: never reached a real trial`).toBeVisible({ timeout: 20000 });

    for (let i = 0; i < 12; i++) {
      if (!(await trial.isVisible().catch(() => false))) break;
      await pointerPress(page, trial);
      await page.waitForTimeout(50);
    }

    await page.waitForFunction(
      (phase) => window.jsPsych && jsPsych.data.get().filter({ trialphase: phase }).count() > 0,
      config.trialphase,
      { timeout: 25000 }
    );

    const rows = await page.evaluate(
      (phase) => jsPsych.data.get().filter({ trialphase: phase }).values(),
      config.trialphase
    );
    expect(rows.length, `${taskKey}: no ${config.trialphase} trials recorded`).toBeGreaterThan(0);

    if (config.pressField) {
      const total = rows.reduce((sum, row) => sum + (Number(row[config.pressField]) || 0), 0);
      expect(
        total,
        `${taskKey}: taps landed but were not counted in ${config.pressField} - check for an overlay intercepting them`
      ).toBeGreaterThan(0);
    }
  });
}

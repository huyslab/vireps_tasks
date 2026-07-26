import { expect } from '@playwright/test';
import { defineTaskRenderingTest } from './support/render-check.js';
import { TASKS } from './support/task-config.js';

/**
 * The two card-choosing layouts have different response targets, so each gets its own
 * rendering check. PILT presents two cards side by side and the cards themselves are the
 * tap targets; WM presents a single card with no spatial mapping, so three response
 * buttons stand in for the three arrow keys (plugin-card-choosing.js responseTargetIds).
 * Both render tap targets on touch only - desktop stays keyboard-driven so a mouse click
 * can't substitute for an arrow key.
 */

defineTaskRenderingTest('PILT', {
  ...TASKS.PILT,
  extraChecks: async (page, { hasTouch }) => {
    const tappableCards = await page.locator('.cardChoosing-tappable').count();
    if (hasTouch) {
      expect(tappableCards, 'touch devices should make both PILT cards tappable').toBe(2);
    } else {
      expect(tappableCards, 'non-touch (desktop) devices should not render tap targets').toBe(0);
    }
  },
});

defineTaskRenderingTest('WM', {
  ...TASKS.WM,
  extraChecks: async (page, { hasTouch }) => {
    // The chosen target swaps to its -pressed class after a response, so count both the
    // base class and the pressed variant - simulate mode may snapshot either state.
    const buttons = await page.locator('.cardChoosingResponseBtn, .cardChoosingResponseBtn-pressed').count();
    const keyCaps = await page.locator('.spacebar-icon, .spacebar-icon-pressed').count();

    if (hasTouch) {
      expect(buttons, 'touch devices should render three WM response buttons').toBe(3);
      expect(keyCaps, 'touch devices should not render keyboard key caps').toBe(0);

      // The whole point of the WM conversion: three independently reachable targets. A
      // zero-size or overlapping button would still satisfy a count assertion.
      const boxes = await Promise.all(
        ['left_key', 'middle_key', 'right_key'].map((id) => page.locator(`#${id}`).boundingBox())
      );
      boxes.forEach((box, i) => {
        expect(box, `WM response target ${i} should have a bounding box`).toBeTruthy();
        expect(box.width, `WM response target ${i} should be wide enough to tap`).toBeGreaterThanOrEqual(40);
        expect(box.height, `WM response target ${i} should be tall enough to tap`).toBeGreaterThanOrEqual(40);
      });
      const [left, middle, right] = boxes;
      expect(left.x + left.width, 'left and middle WM targets should not overlap').toBeLessThanOrEqual(middle.x);
      expect(middle.x + middle.width, 'middle and right WM targets should not overlap').toBeLessThanOrEqual(right.x);
    } else {
      expect(buttons, 'non-touch (desktop) devices should not render tap buttons').toBe(0);
      expect(keyCaps, 'desktop should keep the arrow-key caps').toBe(3);
    }
  },
});

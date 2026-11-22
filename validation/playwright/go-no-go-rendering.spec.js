import { expect } from '@playwright/test';
import { defineTaskRenderingTest } from './support/render-check.js';
import { TASKS } from './support/task-config.js';

defineTaskRenderingTest('go_no_go', {
  ...TASKS.go_no_go,
  extraChecks: async (page) => {
    // The face must fit the viewport with room for the coin below it. The
    // stimulus slot is sized for the grown state, so a face that already fills
    // the screen would be clipped once it scales up on a go response.
    const box = await page.locator('#gng-stimulus').boundingBox();
    const viewport = page.viewportSize();
    expect(box.width, 'face should be visible').toBeGreaterThan(40);
    expect(box.width * 1.4, 'grown face should still fit horizontally').toBeLessThanOrEqual(viewport.width);
    expect(box.height * 1.4, 'grown face should still fit vertically').toBeLessThanOrEqual(viewport.height);

    expect(await page.locator('#gng-coin.gng-points').count(), 'default outcome is signed points').toBe(1);
    expect(await page.locator('#gng-tint').count(), 'no separate correctness signal').toBe(0);

    const frame = await page.locator('.gng-frame:not([hidden])').evaluate((el) => {
      const face = document.querySelector('#gng-stimulus').getBoundingClientRect();
      const inset = parseFloat(getComputedStyle(el).borderTopWidth);
      const bounds = el.getBoundingClientRect();
      return {
        valence: el.dataset.valence,
        pointerEvents: getComputedStyle(el).pointerEvents,
        clearsFace:
          face.left > bounds.left + inset && face.right < bounds.right - inset &&
          face.top > bounds.top + inset && face.bottom < bounds.bottom - inset,
      };
    });
    expect(['win', 'avoid_loss']).toContain(frame.valence);
    expect(frame.pointerEvents).toBe('none');
    expect(frame.clearsFace).toBe(true);
  },
});

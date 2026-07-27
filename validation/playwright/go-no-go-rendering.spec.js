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

    // The coin slot is reserved up front so feedback does not shift the face.
    expect(await page.locator('#gng-coin').count(), 'coin element should be reserved').toBe(1);
  },
});

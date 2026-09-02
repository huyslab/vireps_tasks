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

    expect(await page.locator('#gng-coin').count(), 'coin element should exist').toBe(1);

    // The valence rim light is a drop-shadow on a wrapper, not on the image, so
    // that the image's bottom mask cannot clip it. Both parts have to survive
    // every device's CSS: the wrapper must exist, and it must be carrying
    // exactly one of the two domain classes.
    const glow = await page.evaluate(() => {
      const el = document.querySelector('.gng-glow');
      if (!el) return null;
      return {
        classes: [...el.classList].filter((c) => c.startsWith('gng-glow-')),
        filter: getComputedStyle(el).filter,
      };
    });
    expect(glow, '.gng-glow wrapper should exist').toBeTruthy();
    expect(glow.classes, 'exactly one domain class should be applied').toHaveLength(1);
    expect(glow.filter, 'the domain class should resolve to a drop-shadow').toContain('drop-shadow');
  },
});

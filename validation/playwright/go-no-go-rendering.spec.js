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

    // The rim-light wrapper is always rendered, but carries a domain class only when
    // signal_valence is on. The study runs unsignalled - valence is part of what the
    // task measures - so across this device matrix, which exists to check what
    // participants actually see, the wrapper should be present and unlit.
    //
    // This previously asserted exactly one domain class and had been failing on every
    // device that got as far as a stimulus: it was written for a signalled default
    // that the registry does not set. The signalled configuration is still pinned, by
    // data-gng-presentation.spec.js, which asks for it explicitly; if signalling is
    // ever turned on for a study module, the drop-shadow check belongs back here so it
    // is exercised on real devices rather than one desktop browser.
    const glow = await page.evaluate(() => {
      const el = document.querySelector('.gng-glow');
      if (!el) return null;
      return { classes: [...el.classList].filter((c) => c.startsWith('gng-glow-')) };
    });
    expect(glow, '.gng-glow wrapper should exist').toBeTruthy();
    expect(
      glow.classes,
      'unsignalled: the cue must not be lit by outcome domain, or valence is given away'
    ).toHaveLength(0);
  },
});

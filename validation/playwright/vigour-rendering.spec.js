import { expect, test } from '@playwright/test';
import { defineTaskRenderingTest } from './support/render-check.js';
import { TASKS } from './support/task-config.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__redcapDeviceStatusForTesting = { approved: true, verified: true };
  });
});

defineTaskRenderingTest('vigour', {
  ...TASKS.vigour,
  extraChecks: async (page) => {
    const loaded = await page
      .locator('#piggy-bank')
      .evaluate((img) => img.complete && img.naturalWidth > 0);
    expect(loaded, 'piggy bank image should load and render (not a broken image)').toBe(true);
  },
});

test('vigour preloads stimuli before showing the orientation hint', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'Pixel 7 landscape', 'one touch project is sufficient for timeline ordering');

  await page.goto('/experiment.html?participant_id=timeline-order-check&task=vigour');

  const firstTwoTrials = await page.evaluate(async () => {
    const { createTaskTimeline } = await import('/api/index.js');
    const timeline = await createTaskTimeline('vigour');
    return timeline.slice(0, 2).map((trial) => ({
      type: trial.type.info.name,
      trialphase: trial.data?.trialphase,
    }));
  });

  expect(firstTwoTrials).toEqual([
    { type: 'preload', trialphase: 'vigour_preload' },
    { type: 'html-button-response', trialphase: 'orientation_hint' },
  ]);
});

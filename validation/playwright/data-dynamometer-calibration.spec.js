import { expect, test } from '@playwright/test';

async function openTimelineHarness(page) {
  // The invalid ID prevents experiment.html from starting its own timeline while
  // still loading the import map, jsPsych plugins, and task API used below.
  await page.goto('/experiment.html?participant_id=invalid%20participant');
}

test('dynamometer calibration exposes the requested squeeze and rest durations', async ({ page }) => {
  await openTimelineHarness(page);

  const defaults = await page.evaluate(async () => {
    const { TaskRegistry } = await import('/api/task-registry.js');
    return TaskRegistry.dynamometer_calibration.defaultConfig;
  });

  expect(defaults).toMatchObject({
    squeezeDurationMs: 500,
    relaxDurationMs: 3000,
  });
});

test('calibration waits for a self-initiated squeeze and contains no countdown', async ({ page }) => {
  await openTimelineHarness(page);

  const details = await page.evaluate(async () => {
    const { createTaskTimeline } = await import('/api/index.js');
    const timeline = await createTaskTimeline('dynamometer_calibration', {
      squeezeDurationMs: 125,
      relaxDurationMs: 250,
    });
    const instructions = timeline[0];
    const procedure = timeline[1];
    const trial = procedure.timeline.find(
      item => item.data?.trialphase === 'dynamometer_calibration'
    );

    return {
      instructions: instructions.stimulus,
      stimulus: trial.stimulus,
      hasFixedTrialDuration: Object.hasOwn(trial, 'trial_duration'),
      squeezeDurationMs: trial.data.squeeze_duration_ms,
      relaxDurationMs: trial.data.relax_duration_ms,
    };
  });

  expect(details.instructions).toContain('start squeezing whenever you feel ready');
  expect(details.instructions).not.toContain('wait for <strong>"Squeeze!"</strong>');
  expect(details.stimulus).toContain('Ready when you are');
  expect(details.stimulus).toContain('id="cal-timing-ring"');
  expect(details.stimulus).toContain('>Press hard</p>');
  expect(details.stimulus).not.toMatch(/>\s*[321]…\s*</);
  expect(details.hasFixedTrialDuration).toBe(false);
  expect(details.squeezeDurationMs).toBe(125);
  expect(details.relaxDurationMs).toBe(250);
});

test('self-paced calibration trials complete in simulation', async ({ page }) => {
  await openTimelineHarness(page);

  const result = await page.evaluate(async () => {
    const { createTaskTimeline } = await import('/api/index.js');
    window.simulating = true;
    const timeline = await createTaskTimeline('dynamometer_calibration');
    const trial = timeline[1].timeline.find(
      item => item.data?.trialphase === 'dynamometer_calibration'
    );

    const startedAt = performance.now();
    await jsPsych.run([trial]);
    const row = jsPsych.data.get().filter({ trialphase: 'dynamometer_calibration' }).last(1).values()[0];
    return {
      elapsedMs: performance.now() - startedAt,
      peakForceN: row.peak_force_n,
      squeezeDurationMs: row.squeeze_duration_ms,
      relaxDurationMs: row.relax_duration_ms,
      selfInitiationRtMs: row.self_initiation_rt_ms,
    };
  });

  expect(result.elapsedMs).toBeLessThan(1000);
  expect(result.peakForceN).toBeGreaterThan(1);
  expect(result.squeezeDurationMs).toBe(500);
  expect(result.relaxDurationMs).toBe(3000);
  expect(result.selfInitiationRtMs).toBeGreaterThanOrEqual(0);
});

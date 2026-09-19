import { expect, test } from '@playwright/test';

async function openTimelineHarness(page) {
  // The invalid ID prevents experiment.html from starting its own timeline while
  // still loading the import map, jsPsych plugins, and task API used below.
  await page.goto('/experiment.html?participant_id=invalid%20participant');
}

test('dynamometer tasks expose the requested calibration and vigour defaults', async ({ page }) => {
  await openTimelineHarness(page);

  const defaults = await page.evaluate(async () => {
    const { TaskRegistry } = await import('/api/task-registry.js');
    return {
      calibration: TaskRegistry.dynamometer_calibration.defaultConfig,
      vigour: TaskRegistry.dynamometer_vigour.defaultConfig,
    };
  });

  expect(defaults.calibration).toMatchObject({
    squeezeDurationMs: 500,
    relaxDurationMs: 3000,
    squeezeWaitTimeoutMs: 30000,
  });
  expect(defaults.vigour).toMatchObject({
    thresholdFraction: 0.5,
    holdDurationMs: 1,
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
    const procedure = timeline[0];
    const connect = procedure.timeline[0];
    const instructions = procedure.timeline[1];
    const trial = procedure.timeline.find(
      item => item.data?.trialphase === 'dynamometer_calibration'
    );

    return {
      instructions: instructions.stimulus,
      connection: connect.stimulus(),
      firstPhase: connect.data.trialphase,
      secondPhase: instructions.data.trialphase,
      stimulus: trial.stimulus,
      hasFixedTrialDuration: Object.hasOwn(trial, 'trial_duration'),
      squeezeDurationMs: trial.data.squeeze_duration_ms,
      relaxDurationMs: trial.data.relax_duration_ms,
    };
  });

  expect(details.firstPhase).toBe('dynamometer_connect');
  expect(details.secondPhase).toBe('dynamometer_calibration_instructions');
  expect(details.connection).toContain('For the experimenter');
  expect(details.connection).toContain('Connect grip');
  expect(details.instructions).toContain('Start when the ring appears');
  expect(details.instructions).not.toContain('Ready when you are');
  expect(details.stimulus).toContain('id="cal-timing-ring"');
  expect(details.stimulus).toContain('role="status"');
  expect(details.stimulus).toContain('aria-live="polite"');
  expect(details.stimulus).toContain('>Squeeze hard</p>');
  expect(details.stimulus).not.toContain('cal-trial-counter');
  expect(details.stimulus).not.toContain('cal-phase-label');
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
    const trial = timeline[0].timeline.find(
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

test('calibration times out safely when no squeeze signal arrives', async ({ page }) => {
  await openTimelineHarness(page);

  const result = await page.evaluate(async () => {
    const { createTaskTimeline } = await import('/api/index.js');
    window.simulating = false;
    const timeline = await createTaskTimeline('dynamometer_calibration', {
      squeezeWaitTimeoutMs: 30,
    });
    const trial = timeline[0].timeline.find(
      item => item.data?.trialphase === 'dynamometer_calibration'
    );

    const startedAt = performance.now();
    await jsPsych.run([trial]);
    const row = jsPsych.data.get().filter({ trialphase: 'dynamometer_calibration' }).last(1).values()[0];
    return {
      elapsedMs: performance.now() - startedAt,
      timedOut: row.squeeze_wait_timed_out,
      peakForceN: row.peak_force_n,
    };
  });

  expect(result.elapsedMs).toBeLessThan(500);
  expect(result.timedOut).toBe(true);
  expect(result.peakForceN).toBe(0);
});

test('calibration shows only the requested text while squeezing and resting', async ({ page }) => {
  await openTimelineHarness(page);

  const result = await page.evaluate(async () => {
    const { createTaskTimeline } = await import('/api/index.js');
    const { startForceStream, disconnectDynamometer } = await import('/core/utils/dynamometer.js');
    window.simulating = false;

    let emitForce;
    const sensor = {
      enabled: true,
      value: 0,
      on: (_eventName, handler) => {
        emitForce = forceN => {
          sensor.value = forceN;
          handler(sensor);
        };
      },
    };
    const device = { sensors: [sensor], close: async () => {} };
    startForceStream(device, () => {});

    const timeline = await createTaskTimeline('dynamometer_calibration', {
      squeezeDurationMs: 50,
      relaxDurationMs: 0,
      squeezeWaitTimeoutMs: 1000,
    });
    const trial = timeline[0].timeline.find(
      item => item.data?.trialphase === 'dynamometer_calibration'
    );

    const runPromise = jsPsych.run([trial]);
    await new Promise(resolve => setTimeout(resolve, 20));
    emitForce(5);
    await new Promise(resolve => setTimeout(resolve, 20));
    const startedWhileHeld = document.getElementById('cal-ring-progress').classList.contains('filling');
    const restText = document.getElementById('instruction-text').innerText.trim();

    emitForce(0);
    await new Promise(resolve => setTimeout(resolve, 110));
    emitForce(0);
    emitForce(5);
    await new Promise(resolve => setTimeout(resolve, 10));
    const startedAfterRelease = document.getElementById('cal-ring-progress').classList.contains('filling');
    const squeezeText = document.getElementById('instruction-text').innerText.trim();

    await runPromise;
    await disconnectDynamometer(device);
    const row = jsPsych.data.get().filter({ trialphase: 'dynamometer_calibration' }).last(1).values()[0];
    return {
      startedWhileHeld,
      restText,
      startedAfterRelease,
      squeezeText,
      timedOut: row.squeeze_wait_timed_out,
    };
  });

  expect(result.startedWhileHeld).toBe(false);
  expect(result.restText).toBe('Rest');
  expect(result.startedAfterRelease).toBe(true);
  expect(result.squeezeText).toBe('Squeeze hard');
  expect(result.timedOut).toBe(false);
});

test('successful calibration computes results without showing a feedback screen', async ({ page }) => {
  await openTimelineHarness(page);

  const result = await page.evaluate(async () => {
    const { createTaskTimeline } = await import('/api/index.js');
    window.simulating = true;
    const timeline = await createTaskTimeline('dynamometer_calibration');
    const procedure = timeline[0];
    const trials = procedure.timeline.filter(
      item => item.data?.trialphase === 'dynamometer_calibration'
    );
    const resultTrial = procedure.timeline.find(
      item => item.data?.trialphase === 'dynamometer_calibration_results'
    );

    await jsPsych.run([...trials, resultTrial]);
    const row = jsPsych.data.get().filter({ trialphase: 'dynamometer_calibration_results' }).last(1).values()[0];
    return {
      pluginName: resultTrial.type.info.name,
      hasStimulus: Object.hasOwn(resultTrial, 'stimulus'),
      maxForceN: row.max_force_n,
      retry: row.calibration_retry,
    };
  });

  expect(result.pluginName).toBe('call-function');
  expect(result.hasStimulus).toBe(false);
  expect(result.maxForceN).toBeGreaterThan(1);
  expect(result.retry).toBe(false);
});

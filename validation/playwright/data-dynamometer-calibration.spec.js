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
    thresholdFraction: 0.2,
    holdDurationMs: 0,
  });
});

test('debug participants get a live force graph with the target marked', async ({ page }) => {
  await openTimelineHarness(page);

  const result = await page.evaluate(async () => {
    const {
      createDynVigourCoreTimeline,
      createDebugForceGraphUpdater,
    } = await import('/tasks/piggy-banks-dynamometer/vigour-utils.js');

    window.participantID = 'study_debug_001';
    window.dynamometerMaxForce = 200;
    const settings = { thresholdFraction: 0.5, holdDurationMs: 1 };
    const firstTrial = createDynVigourCoreTimeline(settings)[0].timeline.find(
      item => item.data?.trialphase === 'dynamometer_vigour_trial'
    );
    document.getElementById('display_element').innerHTML = firstTrial.stimulus();

    const updateGraph = createDebugForceGraphUpdater(settings);
    updateGraph(25);
    updateGraph(100);

    const graph = document.getElementById('dynamometer-debug-graph');
    const target = graph.querySelector('.dynamometer-debug-target');
    const trace = document.getElementById('dynamometer-debug-trace');
    const debugResult = {
      targetForceN: Number(graph.dataset.targetForceN),
      targetY1: Number(target.getAttribute('y1')),
      targetY2: Number(target.getAttribute('y2')),
      tracePoints: trace.getAttribute('points').split(' ').length,
      current: document.getElementById('dynamometer-debug-current').textContent,
    };

    window.participantID = 'study_001';
    const normalMarkup = firstTrial.stimulus();
    return { ...debugResult, normalMarkup };
  });

  expect(result.targetForceN).toBe(100);
  expect(result.targetY1).toBe(result.targetY2);
  expect(result.tracePoints).toBe(2);
  expect(result.current).toBe('100.0 N');
  expect(result.normalMarkup).not.toContain('dynamometer-debug-graph');
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
    const device = { sensors: [sensor], start: () => {}, close: async () => {} };
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

test('all six self-initiated squeezes fill the ring and produce a calibration', async ({ page }) => {
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
    const device = { sensors: [sensor], start: () => {}, close: async () => {} };
    startForceStream(device, () => {});

    const timeline = await createTaskTimeline('dynamometer_calibration', {
      squeezeDurationMs: 100,
      relaxDurationMs: 20,
      squeezeWaitTimeoutMs: 2000,
    });
    const procedure = timeline[0];
    const trials = procedure.timeline.filter(
      item => item.data?.trialphase === 'dynamometer_calibration'
    );
    const resultTrial = procedure.timeline.find(
      item => item.data?.trialphase === 'dynamometer_calibration_results'
    );

    const waitFor = async predicate => {
      const deadline = performance.now() + 1500;
      while (!predicate()) {
        if (performance.now() > deadline) throw new Error('Timed out waiting for calibration state');
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    };

    const runPromise = jsPsych.run([...trials, resultTrial]);
    let ringsFilled = 0;
    let initialRestScreens = 0;

    for (let i = 0; i < trials.length; i += 1) {
      await waitFor(() => {
        const rest = document.getElementById('cal-rest-label');
        return rest && !rest.hidden;
      });
      if (document.getElementById('instruction-text').innerText.trim() === 'Rest') {
        initialRestScreens += 1;
      }

      emitForce(0);
      await new Promise(resolve => setTimeout(resolve, 110));
      emitForce(0);
      await waitFor(() => {
        const ring = document.getElementById('cal-timing-ring');
        return ring && !ring.hidden;
      });

      emitForce(5);
      await waitFor(() => document.getElementById('cal-ring-progress')?.classList.contains('filling'));
      const progress = document.getElementById('cal-ring-progress');
      const offsetAtStart = Number.parseFloat(getComputedStyle(progress).strokeDashoffset);
      await new Promise(resolve => setTimeout(resolve, 40));
      const offsetDuringFill = Number.parseFloat(getComputedStyle(progress).strokeDashoffset);
      if (offsetDuringFill < offsetAtStart) ringsFilled += 1;

      await waitFor(() => (
        jsPsych.data.get().filter({ trialphase: 'dynamometer_calibration' }).count() >= i + 1
      ));
    }

    await runPromise;
    await disconnectDynamometer(device);
    const resultRow = jsPsych.data.get().filter({ trialphase: 'dynamometer_calibration_results' }).last(1).values()[0];
    return {
      ringsFilled,
      initialRestScreens,
      retry: resultRow.calibration_retry,
      maxForceN: resultRow.max_force_n,
    };
  });

  expect(result.initialRestScreens).toBe(6);
  expect(result.ringsFilled).toBe(6);
  expect(result.retry).toBe(false);
  expect(result.maxForceN).toBeGreaterThan(1);
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
    const retryTimeline = procedure.timeline.find(
      item => item.timeline?.[0]?.data?.trialphase === 'dynamometer_calibration_retry'
    );

    await jsPsych.run([...trials, resultTrial, retryTimeline]);
    const row = jsPsych.data.get().filter({ trialphase: 'dynamometer_calibration_results' }).last(1).values()[0];
    return {
      pluginName: resultTrial.type.info.name,
      hasStimulus: Object.hasOwn(resultTrial, 'stimulus'),
      maxForceN: row.max_force_n,
      retry: row.calibration_retry,
      retryScreens: jsPsych.data.get().filter({ trialphase: 'dynamometer_calibration_retry' }).count(),
    };
  });

  expect(result.pluginName).toBe('call-function');
  expect(result.hasStimulus).toBe(false);
  expect(result.maxForceN).toBeGreaterThan(1);
  expect(result.retry).toBe(false);
  expect(result.retryScreens).toBe(0);
});

test('calibration result accepts valid peaks already recorded by jsPsych', async ({ page }) => {
  await openTimelineHarness(page);

  const result = await page.evaluate(async () => {
    const { createTaskTimeline } = await import('/api/index.js');
    window.simulating = false;
    const timeline = await createTaskTimeline('dynamometer_calibration');
    const resultTrial = timeline[0].timeline.find(
      item => item.data?.trialphase === 'dynamometer_calibration_results'
    );

    [10, 11, 12, 13, 14, 50].forEach((peakForceN, index) => {
      jsPsych.data.get().push({
        trialphase: 'dynamometer_calibration',
        trial_number: index + 1,
        peak_force_n: peakForceN,
      });
    });

    await jsPsych.run([resultTrial]);
    const row = jsPsych.data.get().filter({ trialphase: 'dynamometer_calibration_results' }).last(1).values()[0];
    return {
      maxForceN: row.max_force_n,
      retry: row.calibration_retry,
      storedMaxForceN: Number(sessionStorage.getItem(`dynamometerMaxForce_${window.participantID ?? 'anon'}`)),
    };
  });

  expect(result.maxForceN).toBe(12);
  expect(result.storedMaxForceN).toBe(12);
  expect(result.retry).toBe(false);
});

test('a timed-out attempt cannot reuse peaks from an earlier calibration', async ({ page }) => {
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
    const device = { sensors: [sensor], start: () => {}, close: async () => {} };
    startForceStream(device, () => {});

    const waitFor = async predicate => {
      const deadline = performance.now() + 1500;
      while (!predicate()) {
        if (performance.now() > deadline) throw new Error('Timed out waiting for calibration state');
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    };

    const runCompleteAttempt = async peaks => {
      const timeline = await createTaskTimeline('dynamometer_calibration', {
        squeezeDurationMs: 10,
        relaxDurationMs: 0,
        squeezeWaitTimeoutMs: 1000,
      });
      const trials = timeline[0].timeline.filter(
        item => item.data?.trialphase === 'dynamometer_calibration'
      );
      const resultTrial = timeline[0].timeline.find(
        item => item.data?.trialphase === 'dynamometer_calibration_results'
      );
      const startingRowCount = jsPsych.data.get().filter({
        trialphase: 'dynamometer_calibration',
      }).count();
      const runPromise = jsPsych.run([...trials, resultTrial]);

      for (let i = 0; i < peaks.length; i += 1) {
        await waitFor(() => document.getElementById('cal-rest-label'));
        emitForce(0);
        await new Promise(resolve => setTimeout(resolve, 110));
        emitForce(0);
        await waitFor(() => !document.getElementById('cal-timing-ring')?.hidden);
        emitForce(peaks[i]);
        await waitFor(() => (
          jsPsych.data.get().filter({ trialphase: 'dynamometer_calibration' }).count()
            >= startingRowCount + i + 1
        ));
      }

      await runPromise;
      return jsPsych.data.get().filter({
        trialphase: 'dynamometer_calibration_results',
      }).last(1).values()[0];
    };

    await runCompleteAttempt([10, 11, 12, 13, 14, 50]);

    const partialTimeline = await createTaskTimeline('dynamometer_calibration', {
      squeezeDurationMs: 10,
      relaxDurationMs: 0,
      squeezeWaitTimeoutMs: 30,
    });
    const partialTrials = partialTimeline[0].timeline.filter(
      item => item.data?.trialphase === 'dynamometer_calibration'
    );
    const partialResultTrial = partialTimeline[0].timeline.find(
      item => item.data?.trialphase === 'dynamometer_calibration_results'
    );
    await jsPsych.run([...partialTrials, partialResultTrial]);
    const partialResult = jsPsych.data.get().filter({
      trialphase: 'dynamometer_calibration_results',
    }).last(1).values()[0];

    const retryResult = await runCompleteAttempt([20, 21, 22, 23, 24, 80]);
    await disconnectDynamometer(device);

    return {
      partialMaxForceN: partialResult.max_force_n,
      partialRetry: partialResult.calibration_retry,
      retryMaxForceN: retryResult.max_force_n,
      retryRequiredAgain: retryResult.calibration_retry,
    };
  });

  expect(result.partialMaxForceN).toBeNull();
  expect(result.partialRetry).toBe(true);
  expect(result.retryMaxForceN).toBe(22);
  expect(result.retryRequiredAgain).toBe(false);
});

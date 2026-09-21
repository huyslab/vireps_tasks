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
      pit: TaskRegistry.dynamometer_PIT.defaultConfig,
    };
  });

  expect(defaults.calibration).toMatchObject({
    disconnectOnFinish: true,
    squeezeWaitTimeoutMs: 30000,
    thresholdFraction: 0.05,
    speedCalibrationDurationMs: 7000,
    speedBarMaxHz: 5,
  });
  expect(defaults.calibration).not.toHaveProperty('squeezeDurationMs');
  expect(defaults.calibration).not.toHaveProperty('relaxDurationMs');
  expect(defaults.vigour).toMatchObject({
    thresholdFraction: 0.05,
    holdDurationMs: 0,
    disconnectOnFinish: true,
  });
  expect(defaults.pit).toMatchObject({
    thresholdFraction: 0.05,
    holdDurationMs: 0,
    disconnectOnFinish: true,
  });
});

test('squeezing is the primary action on the dynamometer start screen', async ({ page }) => {
  await openTimelineHarness(page);

  const markup = await page.evaluate(async () => {
    const { createDynamometerVigourInstructions } = await import(
      '/tasks/piggy-banks-dynamometer/vigour-instructions.js'
    );
    const instructions = createDynamometerVigourInstructions({
      thresholdFraction: 0.05,
      holdDurationMs: 0,
    });
    return instructions.timeline[2].stimulus();
  });

  expect(markup).toContain('<span class="highlight-txt">squeeze the grip</span>');
  expect(markup).toContain('id="reread-button" class="jspsych-btn jspsych-btn-quiet"');
});

test('dynamometer vigour uses balanced FR1, FR5, and FR10 conditions', async ({ page }) => {
  await openTimelineHarness(page);

  const ratios = await page.evaluate(async () => {
    const { createDynVigourCoreTimeline } = await import(
      '/tasks/piggy-banks-dynamometer/vigour-utils.js'
    );
    return createDynVigourCoreTimeline({ thresholdFraction: 0.05, holdDurationMs: 0 })
      .map(trial => trial.timeline_variables[0].ratio);
  });

  expect(ratios).toHaveLength(36);
  expect([...new Set(ratios)].sort((a, b) => a - b)).toEqual([1, 5, 10]);
  expect(Object.fromEntries([1, 5, 10].map(ratio => [
    ratio,
    ratios.filter(value => value === ratio).length,
  ]))).toEqual({ 1: 12, 5: 12, 10: 12 });
});

test('dynamometer PIT preserves the standard sequence with mapped force ratios', async ({ page }) => {
  await openTimelineHarness(page);

  const comparison = await page.evaluate(async () => {
    const { createPITCoreTimeline } = await import('/tasks/piggy-banks/PIT-utils.js');
    const standard = createPITCoreTimeline({ session: 'wk0' });
    const dynamometer = createPITCoreTimeline({
      session: 'wk0',
      inputMode: 'dynamometer',
      thresholdFraction: 0.05,
      holdDurationMs: 0,
    });
    const variables = timeline => timeline.map(trial => trial.timeline_variables[0]);
    return { standard: variables(standard), dynamometer: variables(dynamometer) };
  });

  const ratioMap = { 1: 1, 8: 5, 16: 10 };
  expect(comparison.dynamometer).toHaveLength(comparison.standard.length);
  expect(comparison.dynamometer).toEqual(comparison.standard.map(trial => ({
    ...trial,
    ratio: ratioMap[trial.ratio],
  })));
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

test('calibration uses ten quick self-paced squeezes with simple instructions and a counter', async ({ page }) => {
  await openTimelineHarness(page);

  const details = await page.evaluate(async () => {
    const { createTaskTimeline } = await import('/api/index.js');
    const timeline = await createTaskTimeline('dynamometer_calibration');
    const procedure = timeline[0];
    const connect = procedure.timeline[0];
    const instructions = procedure.timeline[1];
    const trials = procedure.timeline.filter(
      item => item.data?.trialphase === 'dynamometer_calibration'
    );
    const speedProcedure = procedure.timeline.find(
      item => item.timeline?.some(child => child.data?.trialphase === 'dynamometer_speed_calibration')
    );
    const speedInstructions = speedProcedure.timeline[0];
    const speedTrial = speedProcedure.timeline[1];
    const speedFeedback = speedProcedure.timeline[2];

    return {
      instructions: instructions.stimulus,
      connection: connect.stimulus(),
      firstPhase: connect.data.trialphase,
      secondPhase: instructions.data.trialphase,
      trialCount: trials.length,
      stimulus: trials[0].stimulus,
      hasFixedTrialDuration: Object.hasOwn(trials[0], 'trial_duration'),
      dataKeys: Object.keys(trials[0].data),
      speedInstructions: speedInstructions.stimulus,
      speedStimulus: speedTrial.stimulus,
      speedData: speedTrial.data,
      speedTrialCount: speedProcedure.timeline.length,
      speedFeedbackPhase: speedFeedback.data.trialphase,
      speedFeedbackChoices: speedFeedback.choices,
    };
  });

  expect(details.firstPhase).toBe('dynamometer_connect');
  expect(details.secondPhase).toBe('dynamometer_calibration_instructions');
  expect(details.connection).toContain('For the experimenter');
  expect(details.connection).toContain('Connect grip');
  expect(details.instructions).toContain('we need to measure how hard you can squeeze the device');
  expect(details.instructions).toContain('Squeeze as hard as you can and let go');
  expect(details.instructions).toContain('10 times');
  expect(details.instructions).not.toContain('<h2>');
  expect(details.instructions).not.toMatch(/ring|hold|rest/i);
  expect(details.trialCount).toBe(10);
  expect(details.stimulus).toContain('Squeeze and release');
  expect(details.stimulus).toContain('id="cal-squeeze-counter"');
  expect(details.stimulus).toContain('data-completed="0"');
  expect(details.stimulus).toContain('0 / 10');
  expect(details.stimulus).not.toMatch(/ring|rest|countdown/i);
  expect(details.hasFixedTrialDuration).toBe(false);
  expect(details.dataKeys).toContain('squeeze_duration_ms');
  expect(details.dataKeys).not.toContain('relax_duration_ms');
  expect(details.speedInstructions).toContain('measure how quickly you can squeeze and release');
  expect(details.speedInstructions).toContain('7 seconds');
  expect(details.speedStimulus).toContain('id="grip-speed-indicator"');
  expect(details.speedStimulus).toContain('id="grip-speed-track"');
  expect(details.speedStimulus).toContain('id="grip-speed-bar"');
  expect(details.speedStimulus).not.toContain('grip-speed-feedback-text');
  expect(details.speedData.threshold_fraction).toBe(0.05);
  expect(details.speedTrialCount).toBe(3);
  expect(details.speedFeedbackPhase).toBe('dynamometer_speed_calibration_feedback');
  expect(details.speedFeedbackChoices).toEqual(['Continue']);
});

test('speed calibration records repeated threshold crossings and gives visible feedback', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await openTimelineHarness(page);

  const result = await page.evaluate(async () => {
    const { createTaskTimeline } = await import('/api/index.js');
    window.simulating = true;
    window.dynamometerMaxForce = 100;
    const timeline = await createTaskTimeline('dynamometer_calibration');
    window.dynamometerMaxForce = 100;
    const speedProcedure = timeline[0].timeline.find(
      item => item.timeline?.some(child => child.data?.trialphase === 'dynamometer_speed_calibration')
    );
    const speedTrial = speedProcedure.timeline.find(
      item => item.data?.trialphase === 'dynamometer_speed_calibration'
    );
    const speedFeedback = speedProcedure.timeline.find(
      item => item.data?.trialphase === 'dynamometer_speed_calibration_feedback'
    );

    const runPromise = jsPsych.run([speedTrial]);
    await new Promise(resolve => setTimeout(resolve, 80));
    const indicator = document.getElementById('grip-speed-indicator');
    const indicatorBox = indicator?.getBoundingClientRect();
    const live = {
      counter: document.getElementById('grip-speed-counter')?.textContent,
      barWidth: parseFloat(document.getElementById('grip-speed-bar')?.style.width || '0'),
      indicatorCompressed: indicator?.classList.contains('grip-speed-indicator-compressed'),
      indicatorWidth: indicatorBox?.width,
      fitsViewport: document.documentElement.scrollWidth <= window.innerWidth,
    };
    await runPromise;
    const feedbackMarkup = speedFeedback.stimulus();

    const row = jsPsych.data.get().filter({
      trialphase: 'dynamometer_speed_calibration',
    }).last(1).values()[0];
    return {
      live,
      feedbackMarkup,
      thresholdFraction: row.threshold_fraction,
      durationMs: row.speed_calibration_duration_ms,
      squeezes: row.trial_squeezes,
      averageSpeedHz: row.avg_speed_hz,
      storedSpeedHz: Number(sessionStorage.getItem(
        `dynamometerMaxSpeed_${window.participantID ?? 'anon'}`
      )),
    };
  });

  expect(result.live.counter).toMatch(/Squeezes: [1-9]/);
  expect(result.live.barWidth).toBeGreaterThan(0);
  expect(result.live.indicatorCompressed).toBe(true);
  expect(result.live.indicatorWidth).toBeGreaterThanOrEqual(120);
  expect(result.live.fitsViewport).toBe(true);
  expect(result.feedbackMarkup).toContain('5.00 squeezes per second');
  expect(result.feedbackMarkup).toContain('Continue');
  expect(result.thresholdFraction).toBe(0.05);
  expect(result.durationMs).toBe(7000);
  expect(result.squeezes).toBe(35);
  expect(result.averageSpeedHz).toBe(5);
  expect(result.storedSpeedHz).toBeGreaterThan(0);
});

test('speed calibration counts real force crossings at five percent of calibrated force', async ({ page }) => {
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

    const timeline = await createTaskTimeline('dynamometer_calibration', {
      disconnectOnFinish: false,
      speedCalibrationDurationMs: 150,
    });
    window.dynamometerMaxForce = 100;
    startForceStream(device, () => {});
    const speedProcedure = timeline[0].timeline.find(
      item => item.timeline?.some(child => child.data?.trialphase === 'dynamometer_speed_calibration')
    );
    const speedTrial = speedProcedure.timeline.find(
      item => item.data?.trialphase === 'dynamometer_speed_calibration'
    );

    const runPromise = jsPsych.run([speedTrial]);
    await new Promise(resolve => setTimeout(resolve, 20));
    const feedbackStates = [];
    const captureFeedbackState = () => feedbackStates.push(
      document.getElementById('grip-speed-indicator')
        ?.classList.contains('grip-speed-indicator-compressed')
    );

    // The first crossing starts the timer. Each later crossing only counts after
    // a below-threshold sample has re-armed the detector.
    emitForce(6);
    captureFeedbackState();
    emitForce(7);
    captureFeedbackState();
    emitForce(0);
    emitForce(6);
    captureFeedbackState();
    emitForce(0);
    emitForce(8);
    captureFeedbackState();
    emitForce(0);
    emitForce(4);
    emitForce(5);
    captureFeedbackState();

    await runPromise;
    await disconnectDynamometer(device);
    const row = jsPsych.data.get().filter({
      trialphase: 'dynamometer_speed_calibration',
    }).last(1).values()[0];
    return {
      thresholdFraction: row.threshold_fraction,
      squeezes: row.trial_squeezes,
      responseTimes: row.response_time,
      feedbackStates,
      storedSpeedHz: Number(sessionStorage.getItem(
        `dynamometerMaxSpeed_${window.participantID ?? 'anon'}`
      )),
    };
  });

  expect(result.thresholdFraction).toBe(0.05);
  expect(result.squeezes).toBe(3);
  expect(result.responseTimes).toHaveLength(3);
  expect(result.feedbackStates).toEqual([true, true, false, true, false]);
  expect(result.storedSpeedHz).toBeCloseTo(20, 5);
});

test('self-paced calibration squeezes complete in simulation', async ({ page }) => {
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
      selfInitiationRtMs: row.self_initiation_rt_ms,
    };
  });

  expect(result.elapsedMs).toBeLessThan(500);
  expect(result.peakForceN).toBeGreaterThan(1);
  expect(result.squeezeDurationMs).toBeGreaterThanOrEqual(0);
  expect(result.squeezeDurationMs).toBeLessThan(100);
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

test('a quick squeeze ends on release and advances the counter', async ({ page }) => {
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
      squeezeWaitTimeoutMs: 1000,
    });
    const trials = timeline[0].timeline.filter(
      item => item.data?.trialphase === 'dynamometer_calibration'
    );
    const waitFor = async predicate => {
      const deadline = performance.now() + 1000;
      while (!predicate()) {
        if (performance.now() > deadline) throw new Error('Timed out waiting for calibration state');
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    };

    const runPromise = jsPsych.run(trials.slice(0, 2));
    await waitFor(() => document.getElementById('cal-squeeze-counter')?.dataset.completed === '0');

    // A squeeze already in progress when the trial loads is ignored until release.
    emitForce(5);
    await new Promise(resolve => setTimeout(resolve, 20));
    const rowsBeforeInitialRelease = jsPsych.data.get().filter({ trialphase: 'dynamometer_calibration' }).count();

    emitForce(0);
    emitForce(5);
    emitForce(8);
    await new Promise(resolve => setTimeout(resolve, 20));
    const rowsWhileSqueezing = jsPsych.data.get().filter({ trialphase: 'dynamometer_calibration' }).count();
    emitForce(0);

    await waitFor(() => document.getElementById('cal-squeeze-counter')?.dataset.completed === '1');
    const counterAfterFirst = document.getElementById('cal-squeeze-counter').innerText.trim();

    emitForce(0);
    emitForce(6);
    emitForce(0);
    await runPromise;
    await disconnectDynamometer(device);

    const rows = jsPsych.data.get().filter({ trialphase: 'dynamometer_calibration' }).values();
    return {
      rowsBeforeInitialRelease,
      rowsWhileSqueezing,
      counterAfterFirst,
      peaks: rows.map(row => row.peak_force_n),
    };
  });

  expect(result.rowsBeforeInitialRelease).toBe(0);
  expect(result.rowsWhileSqueezing).toBe(0);
  expect(result.counterAfterFirst).toBe('1 / 10');
  expect(result.peaks).toEqual([8, 6]);
});

test('ten quick squeezes produce a calibration using the existing outlier rule', async ({ page }) => {
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

    const peaks = [10, 11, 12, 13, 14, 15, 16, 17, 18, 50];
    const counters = [];
    let finalCounter = null;
    const runPromise = jsPsych.run([...trials, resultTrial]);

    for (let i = 0; i < peaks.length; i += 1) {
      await waitFor(() => document.getElementById('cal-squeeze-counter')?.dataset.completed === String(i));
      counters.push(document.getElementById('cal-squeeze-counter').innerText.trim());
      emitForce(0);
      emitForce(peaks[i]);
      emitForce(0);
      if (i === peaks.length - 1) {
        await waitFor(() => document.getElementById('cal-squeeze-counter')?.dataset.completed === '10');
        finalCounter = document.getElementById('cal-squeeze-counter').innerText.trim();
      }
      await waitFor(() => (
        jsPsych.data.get().filter({ trialphase: 'dynamometer_calibration' }).count() >= i + 1
      ));
    }

    await runPromise;
    await disconnectDynamometer(device);
    const resultRow = jsPsych.data.get().filter({ trialphase: 'dynamometer_calibration_results' }).last(1).values()[0];
    return {
      counters,
      finalCounter,
      squeezeRows: jsPsych.data.get().filter({ trialphase: 'dynamometer_calibration' }).count(),
      retry: resultRow.calibration_retry,
      maxForceN: resultRow.max_force_n,
    };
  });

  expect(result.counters).toEqual([
    '0 / 10', '1 / 10', '2 / 10', '3 / 10', '4 / 10',
    '5 / 10', '6 / 10', '7 / 10', '8 / 10', '9 / 10',
  ]);
  expect(result.finalCounter).toBe('10 / 10');
  expect(result.squeezeRows).toBe(10);
  expect(result.retry).toBe(false);
  expect(result.maxForceN).toBe(14);
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
      squeezeRows: jsPsych.data.get().filter({ trialphase: 'dynamometer_calibration' }).count(),
      maxForceN: row.max_force_n,
      retry: row.calibration_retry,
      retryScreens: jsPsych.data.get().filter({ trialphase: 'dynamometer_calibration_retry' }).count(),
    };
  });

  expect(result.pluginName).toBe('call-function');
  expect(result.hasStimulus).toBe(false);
  expect(result.squeezeRows).toBe(10);
  expect(result.maxForceN).toBeGreaterThan(1);
  expect(result.retry).toBe(false);
  expect(result.retryScreens).toBe(0);
});

test('calibration result accepts ten valid peaks already recorded by jsPsych', async ({ page }) => {
  await openTimelineHarness(page);

  const result = await page.evaluate(async () => {
    const { createTaskTimeline } = await import('/api/index.js');
    window.simulating = false;
    const timeline = await createTaskTimeline('dynamometer_calibration');
    const resultTrial = timeline[0].timeline.find(
      item => item.data?.trialphase === 'dynamometer_calibration_results'
    );

    [10, 11, 12, 13, 14, 15, 16, 17, 18, 50].forEach((peakForceN, index) => {
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

  expect(result.maxForceN).toBe(14);
  expect(result.storedMaxForceN).toBe(14);
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
        await waitFor(() => document.getElementById('cal-squeeze-counter')?.dataset.completed === String(i));
        emitForce(0);
        emitForce(peaks[i]);
        emitForce(0);
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

    await runCompleteAttempt([10, 11, 12, 13, 14, 15, 16, 17, 18, 50]);

    const partialTimeline = await createTaskTimeline('dynamometer_calibration', {
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

    const retryResult = await runCompleteAttempt([20, 21, 22, 23, 24, 25, 26, 27, 28, 80]);
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
  expect(result.retryMaxForceN).toBe(24);
  expect(result.retryRequiredAgain).toBe(false);
});

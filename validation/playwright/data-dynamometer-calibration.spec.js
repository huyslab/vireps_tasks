import { expect, test } from '@playwright/test';

async function openTimelineHarness(page) {
  // The invalid ID prevents experiment.html from starting its own timeline while
  // still loading the import map, jsPsych plugins, and task API used below.
  await page.goto('/experiment.html?participant_id=invalid%20participant');
}

test('dynamometer tasks expose the requested defaults and no strength target', async ({ page }) => {
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
    speedCalibrationDurationMs: 7000,
    speedBarMaxHz: 5,
  });
  expect(defaults.calibration).not.toHaveProperty('squeezeDurationMs');
  expect(defaults.calibration).not.toHaveProperty('relaxDurationMs');
  for (const config of [defaults.calibration, defaults.vigour, defaults.pit]) {
    // Grip games count squeezes with the speed test's rule; there is no strength target.
    expect(config).not.toHaveProperty('thresholdFraction');
    expect(config).not.toHaveProperty('holdDurationMs');
  }
  expect(defaults.vigour).toMatchObject({ disconnectOnFinish: true });
  expect(defaults.pit).toMatchObject({ disconnectOnFinish: true });
});

test('dynamometer bonuses use the five-squeezes-per-second ceiling', async ({ page }) => {
  await openTimelineHarness(page);

  const bonuses = await page.evaluate(async () => {
    const { TaskRegistry } = await import('/api/task-registry.js');
    const row = (trialphase) => ({
      trialphase,
      total_reward: 10,
      trial_duration: 1000,
      timeline_variables: { magnitude: 2, ratio: 1 },
    });
    jsPsych.data.get().push(row('dynamometer_vigour_trial'));
    jsPsych.data.get().push(row('dynamometer_pit_trial'));
    return {
      vigour: TaskRegistry.dynamometer_vigour.computeBonus(),
      pit: TaskRegistry.dynamometer_PIT.computeBonus(),
    };
  });

  expect(bonuses.vigour).toMatchObject({ earned: 0.1, min: 0.02, max: 0.1 });
  expect(bonuses.pit).toMatchObject({ earned: 0.1, min: 0.02, max: 0.1 });
});

test('missing calibration is recoverable and stale grip handles trigger reconnection', async ({ page }) => {
  await openTimelineHarness(page);

  const details = await page.evaluate(async () => {
    const { createDynamometerVigourTimeline } = await import(
      '/tasks/piggy-banks-dynamometer/vigour-timeline.js'
    );
    const { createDynamometerPITTimeline } = await import(
      '/tasks/piggy-banks-dynamometer/PIT-timeline.js'
    );
    window.simulating = false;
    window.dynamometerSensor = null;
    sessionStorage.clear();
    const settings = {
      session: 'wk0',
      task_name: 'dynamometer_PIT',
      disconnectOnFinish: true,
    };
    const summarise = (timeline) => {
      const gateTrial = timeline[1].timeline[0];
      const reconnect = timeline[2].timeline[0];
      window.dynamometerSensor = { opened: false };
      const reconnectsStale = reconnect.conditional_function();
      window.dynamometerSensor = { opened: true };
      const skipsLive = !reconnect.conditional_function();
      return {
        usesButtonTrial: gateTrial.type === jsPsychHtmlButtonResponse,
        choices: gateTrial.choices,
        hasIndefiniteDuration: gateTrial.trial_duration === null,
        reconnectsStale,
        skipsLive,
      };
    };
    return {
      vigour: summarise(createDynamometerVigourTimeline(settings)),
      pit: summarise(createDynamometerPITTimeline(settings)),
    };
  });

  for (const task of [details.vigour, details.pit]) {
    expect(task.usesButtonTrial).toBe(true);
    expect(task.choices).toEqual(['Return to setup']);
    expect(task.hasIndefiniteDuration).toBe(false);
    expect(task.reconnectsStale).toBe(true);
    expect(task.skipsLive).toBe(true);
  }
});

test('squeezing is the primary action on the dynamometer start screen', async ({ page }) => {
  await openTimelineHarness(page);

  const markup = await page.evaluate(async () => {
    const { createDynamometerVigourInstructions } = await import(
      '/tasks/piggy-banks-dynamometer/vigour-instructions.js'
    );
    const instructions = createDynamometerVigourInstructions({
    });
    return instructions.timeline[2].stimulus();
  });

  expect(markup).toContain('<span class="highlight-txt">squeeze the grip</span>');
  expect(markup).toContain('id="reread-button" class="jspsych-btn jspsych-btn-quiet"');
});

test('dynamometer vigour uses balanced FR1, FR5, and FR10 conditions', async ({ page }) => {
  await openTimelineHarness(page);

  const trials = await page.evaluate(async () => {
    const { createDynVigourCoreTimeline } = await import(
      '/tasks/piggy-banks-dynamometer/vigour-utils.js'
    );
    return createDynVigourCoreTimeline({})
      .map(trial => trial.timeline_variables[0]);
  });

  const ratios = trials.map(trial => trial.ratio);
  expect(ratios).toHaveLength(27);
  expect([...new Set(ratios)].sort((a, b) => a - b)).toEqual([1, 5, 10]);
  expect(Object.fromEntries([1, 5, 10].map(ratio => [
    ratio,
    ratios.filter(value => value === ratio).length,
  ]))).toEqual({ 1: 9, 5: 9, 10: 9 });
  for (const magnitude of [1, 2, 5]) {
    for (const ratio of [1, 5, 10]) {
      expect(trials.filter(trial => trial.magnitude === magnitude && trial.ratio === ratio))
        .toHaveLength(3);
    }
  }
});

test('dynamometer PIT preserves the standard sequence with mapped force ratios', async ({ page }) => {
  await openTimelineHarness(page);

  const comparison = await page.evaluate(async () => {
    const { createPITCoreTimeline } = await import('/tasks/piggy-banks/PIT-utils.js');
    const standard = createPITCoreTimeline({ session: 'wk0' });
    const dynamometer = createPITCoreTimeline({
      session: 'wk0',
      inputMode: 'dynamometer',
    });
    const variables = timeline => timeline.map(trial => trial.timeline_variables[0]);
    return {
      standard: variables(standard),
      dynamometer: variables(dynamometer),
      standardDataKeys: Object.keys(standard[0].timeline[2].data),
      dynamometerDataKeys: Object.keys(dynamometer[0].timeline[2].data),
    };
  });

  const ratioMap = { 1: 1, 8: 5, 16: 10 };
  expect(comparison.dynamometer).toHaveLength(comparison.standard.length);
  expect(comparison.dynamometer).toEqual(comparison.standard.map(trial => ({
    ...trial,
    ratio: ratioMap[trial.ratio],
  })));
  expect(comparison.standardDataKeys).toContain('pointer_type');
  expect(comparison.dynamometerDataKeys).not.toContain('pointer_type');
  expect(comparison.dynamometerDataKeys).not.toContain('pointer_type_counts');
  expect(comparison.dynamometerDataKeys).not.toContain('pointer_mixed');
});

test('debug participants see the squeeze rule live on the force graph', async ({ page }) => {
  await openTimelineHarness(page);

  const result = await page.evaluate(async () => {
    const { createDynVigourCoreTimeline } = await import('/tasks/piggy-banks-dynamometer/vigour-utils.js');
    const { createDebugForceGraphUpdater } = await import('/tasks/piggy-banks-dynamometer/debug-graph.js');
    const { createSqueezeTracker } = await import('/core/utils/dynamometer.js');
    const { saveGripCalibration } = await import('/core/utils/grip-session.js');

    window.participantID = 'study_debug_001';
    saveGripCalibration(30);
    const firstTrial = createDynVigourCoreTimeline({})[0].timeline.find(
      item => item.data?.trialphase === 'dynamometer_vigour_trial'
    );
    document.getElementById('display_element').innerHTML = firstTrial.stimulus();

    const updateGraph = createDebugForceGraphUpdater();
    const tracker = createSqueezeTracker();
    const feed = force => { tracker.update(force); updateGraph(force, tracker); };
    [0, 20, 40, 35].forEach(feed);
    const midSqueeze = document.getElementById('dynamometer-debug-trigger').textContent;
    [10, 30, 40].forEach(feed);

    const text = id => document.getElementById(id).textContent;
    const debugResult = {
      midSqueeze,
      waiting: null,
      current: text('dynamometer-debug-current'),
      count: text('dynamometer-debug-count'),
      ticks: document.querySelectorAll('#dynamometer-debug-squeezes line').length,
      tracePoints: document.getElementById('dynamometer-debug-trace').getAttribute('points').split(' ').length,
      triggerPoints: document.getElementById('dynamometer-debug-trigger-line').getAttribute('points').split(' ').length,
    };
    feed(5);
    debugResult.waiting = text('dynamometer-debug-trigger');

    window.participantID = 'study_001';
    const normalMarkup = firstTrial.stimulus();
    return { ...debugResult, normalMarkup };
  });

  // Peak 40 N from a 0 N trough: the squeeze ends below 40 - 25% x 40 = 30 N.
  expect(result.midSqueeze).toBe('Ends below 30.0 N');
  expect(result.current).toBe('40.0 N');
  expect(result.count).toBe('2');
  expect(result.ticks).toBe(2);
  expect(result.tracePoints).toBe(7);
  expect(result.triggerPoints).toBe(7);
  // After the second squeeze ends at 5 N, the next starts 25% x 30 N above that dip.
  expect(result.waiting).toBe('Next above 12.5 N');
  expect(result.normalMarkup).not.toContain('dynamometer-debug-graph');
});

test('quick-squeeze test records the median completed squeeze peak', async ({ page }) => {
  await openTimelineHarness(page);

  const result = await page.evaluate(async () => {
    const { createTaskTimeline } = await import('/api/index.js');
    const { startForceStream, disconnectDynamometer } = await import('/core/utils/dynamometer.js');
    window.simulating = false;
    window.participantID = 'median_quick_squeeze';
    const timeline = await createTaskTimeline('dynamometer_calibration', {
      speedCalibrationDurationMs: 350,
    });
    const rateTrial = timeline[0].timeline.find(
      item => item.data?.trialphase === 'dynamometer_speed_calibration'
    );
    let emitForce;
    const sensor = {
      enabled: true,
      value: 0,
      on: (_event, handler) => {
        emitForce = force => {
          sensor.value = force;
          handler(sensor);
        };
      },
    };
    const device = { sensors: [sensor], start: () => {}, close: async () => {} };
    startForceStream(device, () => {});
    const run = jsPsych.run([rateTrial]);
    await new Promise(resolve => setTimeout(resolve, 50));
    for (const force of [0, 10, 0, 20, 0, 40, 0, 30, 0]) emitForce(force);
    await run;
    const row = jsPsych.data.get().filter({ trialphase: 'dynamometer_speed_calibration' }).last(1).values()[0];
    await disconnectDynamometer(device);
    return {
      peaks: row.peak_forces_n,
      median: row.median_squeeze_force_n,
      stored: (await import('/core/utils/grip-session.js')).getGripCalibration(),
      speed: row.avg_speed_hz,
      retry: row.calibration_retry,
    };
  });

  expect(result.peaks).toEqual([10, 20, 40, 30]);
  expect(result.median).toBe(25);
  expect(result.stored).toBe(25);
  expect(result.speed).toBeCloseTo(3 / 0.35);
  expect(result.retry).toBe(false);
});

test('maximum-strength test is separate and records ten maximal squeeze peaks', async ({ page }) => {
  await openTimelineHarness(page);

  const result = await page.evaluate(async () => {
    const { createTaskTimeline } = await import('/api/index.js');
    window.simulating = false;
    const timeline = await createTaskTimeline('dynamometer_max_strength');
    const procedure = timeline[0];
    const instruction = procedure.timeline.find(item =>
      item.data?.trialphase === 'dynamometer_max_strength_instructions'
    );
    const results = procedure.timeline.find(item =>
      item.timeline?.[0]?.data?.trialphase === 'dynamometer_max_strength_results'
    );
    for (let index = 0; index < 10; index++) {
      jsPsych.data.get().push({
        trialphase: 'dynamometer_max_strength_trial',
        trial_number: index + 1,
        peak_force_n: 60 + index,
      });
    }
    await jsPsych.run([results]);
    const row = jsPsych.data.get().filter({ trialphase: 'dynamometer_max_strength_results' }).last(1).values()[0];
    return { instructions: instruction.stimulus, row };
  });

  expect(result.instructions).toContain('as hard as you can');
  expect(result.row.maximum_peak_force_n).toBe(69);
  expect(result.row.median_peak_force_n).toBe(64.5);
  expect(result.row.peak_forces_n).toHaveLength(10);
});

test('maximum-strength trials record peaks when the resting grip reads above zero', async ({ page }) => {
  await openTimelineHarness(page);

  const result = await page.evaluate(async () => {
    const { createTaskTimeline } = await import('/api/index.js');
    const { startForceStream, disconnectDynamometer } = await import('/core/utils/dynamometer.js');
    window.simulating = false;
    const timeline = await createTaskTimeline('dynamometer_max_strength', { disconnectOnFinish: false });
    const nodes = timeline[0].timeline.filter(item =>
      item.timeline?.[0]?.data?.trialphase === 'dynamometer_max_strength_trial'
      || item.timeline?.[0]?.data?.trialphase === 'dynamometer_max_strength_results'
    );
    let emit;
    const sensor = {
      enabled: true,
      value: 0,
      on: (_event, handler) => {
        emit = force => {
          sensor.value = force;
          handler(sensor);
        };
      },
    };
    const device = { sensors: [sensor], start: () => {}, close: async () => {} };
    startForceStream(device, () => {});
    const run = jsPsych.run(nodes);
    const waitFor = async predicate => {
      for (let tries = 0; tries < 200 && !predicate(); tries++) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    };
    let previousCounter = null;
    for (let index = 0; index < 10; index++) {
      // Each trial renders a fresh counter; the finished trial briefly shows the next
      // count too, so wait for the new element rather than matching text alone.
      await waitFor(() => {
        const counter = document.getElementById('cal-squeeze-counter');
        return counter && counter !== previousCounter && counter.textContent === `${index} / 10`;
      });
      previousCounter = document.getElementById('cal-squeeze-counter');
      // Resting force drifts to 0.8-0.9 N, above the old absolute 0.5 N release level.
      for (const force of [0.8, 20, 40 + index, 15, 0.9]) emit(force);
    }
    await run;
    await disconnectDynamometer(device);
    const trials = jsPsych.data.get().filter({ trialphase: 'dynamometer_max_strength_trial' }).values();
    const row = jsPsych.data.get().filter({ trialphase: 'dynamometer_max_strength_results' }).last(1).values()[0];
    return { trialPeaks: trials.map(trial => trial.peak_force_n), row };
  });

  expect(result.trialPeaks).toEqual([40, 41, 42, 43, 44, 45, 46, 47, 48, 49]);
  expect(result.row.calibration_retry).toBe(false);
  expect(result.row.maximum_peak_force_n).toBe(49);
  expect(result.row.median_peak_force_n).toBe(44.5);
});

test('grip retries reuse a live connection and reconnect only after signal loss', async ({ page }) => {
  await openTimelineHarness(page);

  const result = await page.evaluate(async () => {
    const { makeConnectStep } = await import('/core/utils/grip-session.js');
    let lost = false;
    const step = makeConnectStep(() => lost);
    window.dynamometerSensor = { opened: true };
    const firstPass = step.conditional_function();
    const retryWithSignal = step.conditional_function();
    lost = true;
    const retryAfterLoss = step.conditional_function();
    lost = false;
    window.dynamometerSensor = null;
    const retryWithoutSensor = step.conditional_function();
    return { firstPass, retryWithSignal, retryAfterLoss, retryWithoutSensor };
  });

  expect(result).toEqual({
    firstPass: true,
    retryWithSignal: false,
    retryAfterLoss: true,
    retryWithoutSensor: true,
  });
});

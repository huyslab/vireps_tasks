import { expect, test } from '@playwright/test';

test('Module 2 runs tap then grip vigour, rates each vigour task, and ends with maximum strength', async ({ page }) => {
  await page.goto('/index.html');
  const elements = await page.evaluate(async () => {
    const { ModuleRegistry } = await import('/api/module-registry.js');
    return ModuleRegistry.module_2.elements;
  });
  const named = elements.filter(element => element.type === 'task').map(element => element.name);
  expect(named).toEqual([
    'max_press_test', 'pavlovian_lottery', 'PILT', 'acceptability_judgment',
    'vigour', 'acceptability_judgment', 'dynamometer_calibration',
    'dynamometer_vigour', 'acceptability_judgment', 'PIT',
    'acceptability_judgment', 'vigour_test', 'post_PILT_test',
    'dynamometer_max_strength',
  ]);
  for (const taskName of ['vigour', 'dynamometer_vigour', 'PIT']) {
    const index = elements.findIndex(element => element.name === taskName);
    expect(elements[index + 1]).toMatchObject({
      type: 'task',
      name: 'acceptability_judgment',
      config: { task_name: taskName },
    });
  }
  expect(elements.find(element => element.name === 'dynamometer_calibration').config)
    .toMatchObject({ disconnectOnFinish: false });
  expect(elements.filter(element => element.name === 'dynamometer_PIT')).toHaveLength(0);
  expect(elements.at(-2)).toMatchObject({ name: 'dynamometer_max_strength' });
  expect(elements.at(-1)).toMatchObject({ type: 'instructions', config: { text: 'end_message' } });
  expect(elements.filter(element => element.config?.text === 'break_message')).toHaveLength(1);
});

test('module 2 without a dynamometer uses the tap-based effort tasks and no grip break', async ({ page }) => {
  await page.goto('/index.html');

  const elements = await page.evaluate(async () => {
    const { ModuleRegistry } = await import('/api/module-registry.js');
    return ModuleRegistry.module_2_without_dynamometer.elements;
  });
  const taskNames = elements
    .filter((element) => element.type === 'task')
    .map((element) => element.name);

  expect(taskNames).toContain('vigour');
  expect(taskNames).toContain('PIT');
  expect(taskNames).not.toContain('dynamometer_calibration');
  expect(taskNames).not.toContain('dynamometer_vigour');
  expect(taskNames).not.toContain('dynamometer_PIT');
  expect(elements.filter((element) => element.config?.text === 'break_message')).toHaveLength(0);
});

test('questionnaire module presents every questionnaire in the configured order', async ({ page }) => {
  await page.goto('/index.html');

  const elements = await page.evaluate(async () => {
    const { ModuleRegistry } = await import('/api/module-registry.js');
    return ModuleRegistry.questionnaires.elements;
  });

  expect(elements).toEqual([
    { type: 'instructions', config: { text: 'start_message' } },
    {
      type: 'task',
      name: 'self_report',
      config: { questionnaires: ['STAI', 'ARI', 'BIS', 'STAXI2'] },
    },
    { type: 'instructions', config: { text: 'end_message' } },
  ]);
});

test('dynamometer module calibrates before vigour and keeps the connection between them', async ({ page }) => {
  await page.goto('/index.html');

  const elements = await page.evaluate(async () => {
    const { ModuleRegistry } = await import('/api/module-registry.js');
    return ModuleRegistry.dynamometer.elements;
  });

  expect(elements).toEqual([
    {
      type: 'task',
      name: 'dynamometer_calibration',
      config: { disconnectOnFinish: false },
    },
    { type: 'task', name: 'dynamometer_vigour' },
  ]);
});

test('dynamometer PIT test module calibrates before PIT and keeps the connection between them', async ({ page }) => {
  await page.goto('/index.html');

  const elements = await page.evaluate(async () => {
    const { ModuleRegistry } = await import('/api/module-registry.js');
    return ModuleRegistry.dynamometer_pit.elements;
  });

  expect(elements).toEqual([
    {
      type: 'task',
      name: 'dynamometer_calibration',
      config: { disconnectOnFinish: false },
    },
    { type: 'task', name: 'dynamometer_PIT' },
  ]);
});

// VIREPS runs two sessions. The launcher was cut to two in 3ff732b ("correct number
// and name of session"), which also dropped the week labels; this test still described
// the five-session RELMED launcher and had been failing ever since. experiment.html
// keeps SESSION_CONFIG entries for weeks 4-28 so repeat-session sequences still build
// (see the timeline test below) - they are simply not offered to the experimenter.
test('experimenter launcher offers two sessions and the four participant modules', async ({ page }) => {
  await page.goto('/index.html');

  await expect(page.locator('#sessionNumber option')).toHaveCount(3);
  await expect(page.locator('#sessionNumber option').allTextContents()).resolves.toEqual([
    'Select session',
    'Session 1',
    'Session 2',
  ]);
  await expect(page.locator('#module option')).toHaveCount(5);
  await expect(page.locator('#module option').evaluateAll((options) => options.map(({ value }) => value))).resolves.toEqual([
    '',
    'module_1',
    'module_2',
    'module_2_without_dynamometer',
    'questionnaires',
  ]);
});

test('launcher sends participant, session number, and module to the experiment page', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#participantId').fill('participant_42');
  await page.locator('#sessionNumber').selectOption('2');
  await page.locator('#module').selectOption('module_2');

  await page.locator('#startButton').click({ noWaitAfter: true });
  await expect.poll(() => page.url()).toContain('/experiment.html?');

  const destination = new URL(page.url());
  expect(destination.searchParams.get('participant_id')).toBe('participant_42');
  expect(destination.searchParams.get('session_number')).toBe('2');
  expect(destination.searchParams.get('module')).toBe('module_2');
});

test('the experiment page accepts the dynamometer PIT launcher route', async ({ page }) => {
  await page.addInitScript(() => {
    window.__redcapDeviceStatusForTesting = { approved: true, verified: true };
  });

  await page.goto(
    '/experiment.html?participant_id=route_check&session_number=1&module=dynamometer_pit'
  );

  await expect(page.locator('#display_element')).not.toBeEmpty();
  await expect(page.getByRole('heading', { name: 'Error Loading Experiment' })).toHaveCount(0);
});

test('the experiment page accepts the module 2 without dynamometer route', async ({ page }) => {
  await page.addInitScript(() => {
    window.__redcapDeviceStatusForTesting = { approved: true, verified: true };
  });

  await page.goto(
    '/experiment.html?participant_id=route_check&session_number=1&module=module_2_without_dynamometer'
  );

  await expect(page.locator('#display_element')).not.toBeEmpty();
  await expect(page.getByRole('heading', { name: 'Error Loading Experiment' })).toHaveCount(0);
});

test('all complete module timelines build with repeat-session sequences', async ({ page }) => {
  // The invalid ID stops experiment.html before device authorisation or an automatic run,
  // while still loading the import map, jsPsych plugins, and API used to build timelines.
  await page.goto('/experiment.html?participant_id=invalid%20participant');

  const lengths = await page.evaluate(async () => {
    const { createModuleTimeline } = await import('/api/index.js');
    const module1 = await createModuleTimeline('module_1', {
      session: 'wk28',
      sequence: 'wk28',
      stimulus_session: 5,
      session_number: 5,
    });
    const module2 = await createModuleTimeline('module_2', {
      session: 'wk4',
      sequence: 'wk4',
      stimulus_session: 3,
      session_number: 3,
    });
    const module2WithoutDynamometer = await createModuleTimeline('module_2_without_dynamometer', {
      session: 'wk4',
      sequence: 'wk4',
      stimulus_session: 3,
      session_number: 3,
    });
    const questionnaires = await createModuleTimeline('questionnaires', {
      session: 'wk4',
      sequence: 'wk4',
      stimulus_session: 3,
      session_number: 3,
    });
    const dynamometer = await createModuleTimeline('dynamometer', {
      session: 'wk0',
      sequence: 'wk0',
      stimulus_session: 1,
      session_number: 1,
    });
    const dynamometerPit = await createModuleTimeline('dynamometer_pit', {
      session: 'wk0',
      sequence: 'wk0',
      stimulus_session: 1,
      session_number: 1,
    });
    return {
      module1: module1.length,
      module2: module2.length,
      module2WithoutDynamometer: module2WithoutDynamometer.length,
      questionnaires: questionnaires.length,
      dynamometer: dynamometer.length,
      dynamometerPit: dynamometerPit.length,
    };
  });

  expect(lengths.module1).toBeGreaterThan(10);
  expect(lengths.module2).toBeGreaterThan(lengths.module1);
  expect(lengths.module2WithoutDynamometer).toBeGreaterThan(lengths.module1);
  expect(lengths.questionnaires).toBeGreaterThan(2);
  expect(lengths.dynamometer).toBeGreaterThan(2);
  expect(lengths.dynamometerPit).toBeGreaterThan(2);
});

test('demo module timelines preserve one skippable boundary per module element', async ({ page }) => {
  await page.goto('/experiment.html?participant_id=invalid%20participant');

  const result = await page.evaluate(async () => {
    const {
      createModuleTimeline,
      DEMO_MODULE_ELEMENT_TIMELINE_NAME,
    } = await import('/api/index.js');
    const { ModuleRegistry } = await import('/api/module-registry.js');
    const timeline = await createModuleTimeline('module_1', {
      session: 'wk0',
      sequence: 'wk0',
      stimulus_session: 1,
      session_number: 1,
      enableDemoNavigation: true,
    });

    return {
      expectedCount: ModuleRegistry.module_1.elements.length,
      names: timeline.map((element) => element.name),
      childCounts: timeline.map((element) => element.timeline.length),
    };
  });

  expect(result.names).toHaveLength(result.expectedCount);
  expect(result.names.every((name) => name === 'demo-module-element')).toBe(true);
  expect(result.childCounts.every((count) => count > 0)).toBe(true);
});

test('a demo participant can skip the current module element', async ({ page }) => {
  await page.addInitScript(() => {
    window.__redcapDeviceStatusForTesting = { approved: true, verified: true };
  });
  await page.goto('/experiment.html?participant_id=tablet_Demo&session_number=1&module=module_1');

  const skipButton = page.getByRole('button', { name: 'Skip to next task' });
  await expect(skipButton).toBeVisible();
  await expect(skipButton).toBeEnabled();
  await skipButton.click();

  await expect.poll(() => page.evaluate(() => (
    jsPsych.data.get().filter({ demo_skip: true }).count()
  ))).toBe(1);
  await expect(skipButton).toBeVisible();
  await expect(skipButton).toBeEnabled();
});

test('skipping demo calibration supplies values for the following grip tasks', async ({ page }) => {
  await page.goto('/experiment.html?participant_id=invalid%20participant');

  const result = await page.evaluate(async () => {
    window.participantID = 'tablet_demo';
    let activeElement = null;
    const { createModuleTimeline } = await import('/api/index.js');
    const { ModuleRegistry } = await import('/api/module-registry.js');
    const timeline = await createModuleTimeline('module_2', {
      session: 'wk0',
      sequence: 'wk0',
      stimulus_session: 1,
      session_number: 1,
      enableDemoNavigation: true,
      onDemoElementStart: (element) => { activeElement = element; },
    });
    const calibrationIndex = ModuleRegistry.module_2.elements.findIndex(
      (element) => element.name === 'dynamometer_calibration'
    );

    timeline[calibrationIndex].on_timeline_start();
    activeElement.onDemoSkip();

    return {
      hookIsDeclared: typeof activeElement.onDemoSkip === 'function',
      maxForce: window.dynamometerMaxForce,
      maxSpeed: window.dynamometerMaxSpeed,
      storedForce: sessionStorage.getItem('dynamometerMaxForce_tablet_demo'),
      storedSpeed: sessionStorage.getItem('dynamometerMaxSpeed_tablet_demo'),
    };
  });

  expect(result).toEqual({
    hookIsDeclared: true,
    maxForce: 80,
    maxSpeed: 5,
    storedForce: '80',
    storedSpeed: '5',
  });
});

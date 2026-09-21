import { expect, test } from '@playwright/test';

const expectedModules = {
  module_1: [
    ['reversal', 'reversal'],
    ['go_no_go', 'go_no_go'],
  ],
  module_2: [
    ['max_press_test', 'max_press_test'],
    ['pavlovian_lottery', 'pavlovian_lottery'],
    ['PILT', 'PILT'],
    ['dynamometer_vigour', 'dynamometer_vigour'],
    ['dynamometer_PIT', 'dynamometer_PIT'],
    ['vigour_test', 'vigour_test'],
    ['post_PILT_test', 'post_PILT_test'],
  ],
};

test('study modules contain the requested tasks and rate every task immediately afterward', async ({ page }) => {
  await page.goto('/index.html');

  const modules = await page.evaluate(async () => {
    const { ModuleRegistry } = await import('/api/module-registry.js');
    return Object.fromEntries(['module_1', 'module_2'].map((moduleName) => [
      moduleName,
      ModuleRegistry[moduleName].elements,
    ]));
  });

  for (const [moduleName, expectedTasks] of Object.entries(expectedModules)) {
    const elements = modules[moduleName];
    expect(elements[0]).toMatchObject({ type: 'instructions', config: { text: 'start_message' } });
    expect(elements.at(-1)).toMatchObject({ type: 'instructions', config: { text: 'end_message' } });

    // Module 2 carries break screens between tasks, so the body is no longer a flat
    // run of task/rating pairs. The invariant being checked is unchanged and is the
    // one that matters: a rating follows its own task IMMEDIATELY, with nothing
    // allowed in between. A break may only sit at a boundary, after a rating.
    const body = elements.slice(1, -1);
    let cursor = 0;
    expectedTasks.forEach(([taskName, ratingName]) => {
      while (body[cursor] && (
        body[cursor].type === 'instructions'
        || body[cursor].name === 'dynamometer_calibration'
      )) cursor += 1;

      expect(body[cursor]).toMatchObject({ type: 'task', name: taskName });
      expect(
        body[cursor + 1],
        `${taskName} must be rated immediately, with no break between the task and its rating`
      ).toMatchObject({
        type: 'task',
        name: 'acceptability_judgment',
        config: { task_name: ratingName },
      });
      cursor += 2;
    });

    // Nothing but breaks may follow the last rating.
    expect(body.slice(cursor).filter((element) => element.type !== 'instructions')).toEqual([]);
  }
});

test('module 2 calibrates once and keeps the grip connected through vigour and PIT', async ({ page }) => {
  await page.goto('/index.html');

  const elements = await page.evaluate(async () => {
    const { ModuleRegistry } = await import('/api/module-registry.js');
    return ModuleRegistry.module_2.elements;
  });

  const calibrationIndex = elements.findIndex(element => element.name === 'dynamometer_calibration');
  const vigourIndex = elements.findIndex(element => element.name === 'dynamometer_vigour');
  const pitIndex = elements.findIndex(element => element.name === 'dynamometer_PIT');

  expect(elements.filter(element => element.name === 'dynamometer_calibration')).toHaveLength(1);
  expect(elements[calibrationIndex]).toEqual({
    type: 'task',
    name: 'dynamometer_calibration',
    config: { disconnectOnFinish: false },
  });
  expect(elements[vigourIndex]).toEqual({
    type: 'task',
    name: 'dynamometer_vigour',
    config: { disconnectOnFinish: false },
  });
  expect(calibrationIndex).toBeLessThan(vigourIndex);
  expect(vigourIndex).toBeLessThan(pitIndex);
  expect(elements[calibrationIndex - 1]).toEqual({
    type: 'instructions',
    config: { text: 'break_message' },
  });
  expect(elements.filter(element => element.config?.text === 'break_message')).toHaveLength(1);
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
test('experimenter launcher offers two sessions and all five study modules', async ({ page }) => {
  await page.goto('/index.html');

  await expect(page.locator('#sessionNumber option')).toHaveCount(3);
  await expect(page.locator('#sessionNumber option').allTextContents()).resolves.toEqual([
    'Select session',
    'Session 1',
    'Session 2',
  ]);
  await expect(page.locator('#module option')).toHaveCount(6);
  await expect(page.locator('#module option').evaluateAll((options) => options.map(({ value }) => value))).resolves.toEqual([
    '',
    'module_1',
    'module_2',
    'questionnaires',
    'dynamometer',
    'dynamometer_pit',
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
      questionnaires: questionnaires.length,
      dynamometer: dynamometer.length,
      dynamometerPit: dynamometerPit.length,
    };
  });

  expect(lengths.module1).toBeGreaterThan(10);
  expect(lengths.module2).toBeGreaterThan(lengths.module1);
  expect(lengths.questionnaires).toBeGreaterThan(2);
  expect(lengths.dynamometer).toBeGreaterThan(2);
  expect(lengths.dynamometerPit).toBeGreaterThan(2);
});

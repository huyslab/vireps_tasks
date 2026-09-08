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
    ['vigour', 'vigour'],
    ['PIT', 'PIT'],
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

    const body = elements.slice(1, -1);
    const ratedTasks = body.slice(0, expectedTasks.length * 2);
    expectedTasks.forEach(([taskName, ratingName], index) => {
      expect(ratedTasks[index * 2]).toMatchObject({ type: 'task', name: taskName });
      expect(ratedTasks[index * 2 + 1]).toMatchObject({
        type: 'task',
        name: 'acceptability_judgment',
        config: { task_name: ratingName },
      });
    });

    expect(body.slice(expectedTasks.length * 2)).toEqual([]);
  }
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

test('experimenter launcher offers five sessions and the three study modules', async ({ page }) => {
  await page.goto('/index.html');

  await expect(page.locator('#sessionNumber option')).toHaveCount(6);
  await expect(page.locator('#sessionNumber option').allTextContents()).resolves.toEqual([
    'Select session',
    'Session 1 (week 0)',
    'Session 2 (week 2)',
    'Session 3 (week 4)',
    'Session 4 (week 24)',
    'Session 5 (week 28)',
  ]);
  await expect(page.locator('#module option')).toHaveCount(4);
  await expect(page.locator('#module option').evaluateAll((options) => options.map(({ value }) => value))).resolves.toEqual([
    '',
    'module_1',
    'module_2',
    'questionnaires',
  ]);
});

test('launcher sends participant, session number, and module to the experiment page', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#participantId').fill('participant_42');
  await page.locator('#sessionNumber').selectOption('3');
  await page.locator('#module').selectOption('module_2');

  await page.locator('#startButton').click({ noWaitAfter: true });
  await expect.poll(() => page.url()).toContain('/experiment.html?');

  const destination = new URL(page.url());
  expect(destination.searchParams.get('participant_id')).toBe('participant_42');
  expect(destination.searchParams.get('session_number')).toBe('3');
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
    return {
      module1: module1.length,
      module2: module2.length,
      questionnaires: questionnaires.length,
    };
  });

  expect(lengths.module1).toBeGreaterThan(10);
  expect(lengths.module2).toBeGreaterThan(lengths.module1);
  expect(lengths.questionnaires).toBeGreaterThan(2);
});

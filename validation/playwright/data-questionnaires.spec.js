import { expect, test } from '@playwright/test';

test('questionnaire definitions retain the CSV field IDs, counts, sections, and response codes', async ({ page }) => {
  await page.goto('/index.html');
  const summary = await page.evaluate(async () => {
    const { Questionnaires } = await import('/tasks/self-report/questionnaires.js');
    return Object.fromEntries(Object.entries(Questionnaires).map(([key, questionnaire]) => [key, {
      count: questionnaire.items.length,
      first: questionnaire.items[0].id,
      last: questionnaire.items.at(-1).id,
      sectionStarts: questionnaire.sections.map(({ start }) => start),
      scales: questionnaire.sections.map((section) =>
        (section.scale || questionnaire.scale).map(({ value }) => value)),
    }]));
  });

  expect(summary).toEqual({
    BIS: { count: 31, first: 'bis_plan_task', last: 'bis_future_orient', sectionStarts: [0], scales: [[1, 2, 3, 4]] },
    ARI: { count: 7, first: 'ari_annoyed', last: 'ari_problems', sectionStarts: [0], scales: [[1, 2, 3]] },
    STAXI2: {
      count: 57,
      first: 'staxi_furious',
      last: 'staxi_more_irritated',
      sectionStarts: [0, 15, 25],
      scales: [[1, 2, 3, 4], [1, 2, 3, 4], [1, 2, 3, 4]],
    },
    STAI: { count: 20, first: 'stai_calm', last: 'stai_pleasant', sectionStarts: [0], scales: [[1, 2, 3, 4]] },
  });
});

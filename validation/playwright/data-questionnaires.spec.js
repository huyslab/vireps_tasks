import { expect, test } from '@playwright/test';

/**
 * Field IDs, counts, sections and response codes, pinned against the source data
 * dictionary (VIREPS_DataDictionary_2026-09-07.csv).
 *
 * The code deliberately diverges from that CSV in one place, and only one: BIS is 30
 * items rather than 31, because the CSV repeated "I plan trips well ahead of time"
 * under two ids (bis_plan_trips and bis_plan_ahead) and the participant was shown the
 * identical sentence twice in a row. bis_plan_ahead is gone; BIS-11 has 30 items.
 *
 * Item TEXT also diverges - ARI is written in the first person, and four BIS items no
 * longer carry a bracketed second wording - but no field id changed for those, so this
 * test does not see them. The ARI check below covers the part worth locking down,
 * since re-importing from the CSV would quietly restore the third-person wording.
 */
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
    BIS: { count: 30, first: 'bis_plan_task', last: 'bis_future_orient', sectionStarts: [0], scales: [[1, 2, 3, 4]] },
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

test('ARI-S wording is exactly the supplied scale, unaltered', async ({ page }) => {
  await page.goto('/index.html');
  const ari = await page.evaluate(async () => {
    const { Questionnaires } = await import('/tasks/self-report/questionnaires.js');
    return {
      items: Questionnaires.ARI.items.map(({ text }) => text),
      instructions: Questionnaires.ARI.sections[0].instructions,
    };
  });

  // The ARI is under copyright and must not be altered without written permission
  // (transatlantic-comppsych/Affective-Reactivity-Index). The self-report form is the
  // parent form with the introductory referent and the final item's pronoun adapted -
  // so six stems in the third person alongside a second-person instruction is the
  // scale as published, not a transcription slip.
  //
  // An earlier pass rewrote all seven stems into the first person, which produced an
  // unvalidated instrument. This pins the wording so that cannot happen silently:
  // changing it should require deciding to, and getting permission.
  expect(ari.items).toEqual([
    'Gets easily annoyed by others',
    'Often loses temper',
    'Stays angry for a long time',
    'Is angry most of the time',
    'Gets angry frequently',
    'Loses temper easily',
    'Overall, irritability causes you problems',
  ]);
  expect(ari.instructions).toBe(
    'In the <em>last six months,</em> how well does each of the following statements describe your behavior/feelings'
  );
});

test('no questionnaire item shows the participant a bracketed alternative wording', async ({ page }) => {
  await page.goto('/index.html');
  const bracketed = await page.evaluate(async () => {
    const { Questionnaires } = await import('/tasks/self-report/questionnaires.js');
    return Object.values(Questionnaires)
      .flatMap((questionnaire) => questionnaire.items)
      .filter((item) => /\[.+\]/.test(item.text))
      .map((item) => item.id);
  });

  // Four BIS items used to print both wordings at once, which reads as a mistake and
  // doubles the reading load on the hardest items in the set.
  expect(bracketed, 'these items show two wordings of the same sentence').toEqual([]);
});

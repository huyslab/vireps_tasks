import { expect, test } from '@playwright/test';

/**
 * Reading level of the participant-facing instructions.
 *
 * The battery is read by people across a wide range of reading ability, and several
 * screens had drifted well past them - one PIT sentence ran to 30 words and scored
 * grade 10.7. The target is UK Year 5 (age 9-10), which is US grade 4-5.
 *
 * Flesch-Kincaid is a blunt instrument: it counts sentence length and syllables, so
 * it cannot see that "trial and error" is a hard phrase made of easy words. It is
 * used here as a floor, not a ceiling - passing this does not mean a screen reads
 * well, but failing it means a screen has grown long sentences or heavy words again.
 *
 * Standardised questionnaire items and their instructions are deliberately exempt:
 * they are part of the instrument and are not ours to simplify.
 */

const MAX_GRADE = 5.0;

function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  return Math.max(1, (trimmed.match(/[aeiouy]{1,2}/g) || []).length);
}

/** Flesch-Kincaid grade level for a block of instruction HTML. */
function gradeLevel(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim());
  const words = text.match(/[A-Za-z'-]+/g) || [];
  if (!sentences.length || !words.length) return null;
  const syl = words.reduce((sum, w) => sum + syllables(w), 0);
  return Math.round((0.39 * (words.length / sentences.length) + 11.8 * (syl / words.length) - 15.59) * 10) / 10;
}

test('module messages read at Year 5 level or simpler', async ({ page }) => {
  await page.goto('/experiment.html?participant_id=invalid%20participant');
  const passages = await page.evaluate(async () => {
    const { messages } = await import(`/api/messages.js?v=${Date.now()}`);
    const out = {};
    for (const moduleName of ['module_1', 'module_2', 'questionnaires']) {
      for (const [key, value] of Object.entries(messages[moduleName])) {
        const content = typeof value === 'function' ? value({ session: 'wk0' }) : value;
        const pages = Array.isArray(content) ? content
          : Array.isArray(content?.message) ? content.message
          : [content?.message ?? content];
        pages.forEach((pageText, index) => {
          if (typeof pageText === 'string') out[`${moduleName}.${key}[${index}]`] = pageText;
        });
      }
    }
    return out;
  });

  expect(Object.keys(passages).length, 'passages should have been collected').toBeGreaterThan(6);

  const tooHard = Object.entries(passages)
    .map(([name, html]) => [name, gradeLevel(html)])
    .filter(([, grade]) => grade !== null && grade > MAX_GRADE);

  expect(tooHard, `these read above grade ${MAX_GRADE}`).toEqual([]);
});

test('no participant-facing screen uses staff or study jargon', async ({ page }) => {
  await page.goto('/experiment.html?participant_id=invalid%20participant');
  const found = await page.evaluate(async () => {
    const { messages } = await import(`/api/messages.js?v=${Date.now()}`);
    const banned = /\b(experimenter|module \d|intuitive|promptly|questionnaires?)\b/i;
    const hits = [];
    for (const moduleName of ['module_1', 'module_2', 'questionnaires']) {
      for (const [key, value] of Object.entries(messages[moduleName])) {
        const content = typeof value === 'function' ? value({ session: 'wk0' }) : value;
        const pages = Array.isArray(content) ? content
          : Array.isArray(content?.message) ? content.message
          : [content?.message ?? content];
        pages.forEach((pageText) => {
          if (typeof pageText === 'string' && banned.test(pageText)) {
            hits.push(`${moduleName}.${key}: ${pageText.match(banned)[0]}`);
          }
        });
      }
    }
    return hits;
  });

  // "Module 1" and "experimenter" are what staff say; participants are told "Part 1"
  // and "the person running the study".
  expect(found, 'participant-facing text should not use these').toEqual([]);
});

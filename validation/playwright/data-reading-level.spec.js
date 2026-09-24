import { expect, test } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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

/**
 * Extract template literals that contain participant-facing HTML (identified by
 * the presence of a <p> tag) from a JS source file.  ${…} expressions are
 * replaced with a space so they do not inflate the word count.
 */
function extractTaskPassages(source, label) {
  // Strip single-line comments so commented-out old text is not checked.
  const cleaned = source.replace(/\/\/[^\n]*/g, '');

  const passages = {};
  let i = 0;
  let n = 0;

  while (i < cleaned.length) {
    const open = cleaned.indexOf('`', i);
    if (open === -1) break;

    // Scan forward to the matching close backtick, tracking ${ … } depth.
    let depth = 0;
    let j = open + 1;
    while (j < cleaned.length) {
      if (cleaned[j] === '\\') { j += 2; continue; }
      if (cleaned.slice(j, j + 2) === '${') { depth++; j += 2; continue; }
      if (depth > 0 && cleaned[j] === '}') { depth--; j++; continue; }
      if (depth === 0 && cleaned[j] === '`') break;
      j++;
    }

    const raw = cleaned.slice(open + 1, j);
    i = j + 1;

    // Only participant-facing HTML has <p> tags; skip short or code-only strings.
    if (/<p[ >]/.test(raw) && raw.length > 40) {
      // Replace ${…} expressions so they don't contribute words to the score.
      const staticText = raw.replace(/\$\{[^}]*\}/g, ' ');
      // Skip passages with fewer than 12 plain-text words: very short strings
      // (e.g. button labels, UI state messages) produce unreliable FK scores
      // because the formula assumes sentence-length distributions that short
      // strings cannot exhibit.
      const wordCount = staticText.replace(/<[^>]+>/g, ' ').match(/[A-Za-z'-]+/g)?.length ?? 0;
      if (wordCount < 12) { i = j + 1; continue; }
      passages[`${label}[${n++}]`] = staticText;
    }
  }

  return passages;
}

// Task source files whose participant-facing instruction HTML should stay
// at or below MAX_GRADE.  Standardised questionnaire items are excluded.
const TASK_INSTRUCTION_FILES = [
  'tasks/card-choosing/instructions.js',
  'tasks/go-no-go/instructions.js',
  'tasks/pavlovian-lottery/task.js',
  'tasks/piggy-banks/PIT-instructions.js',
  'tasks/piggy-banks/vigour-instructions.js',
  'tasks/reversal/task.js',
  'core/utils/participation-validation.js',
];

test('module messages read at Year 5 level or simpler', async ({ page }) => {
  await page.goto('/experiment.html?participant_id=invalid%20participant');
  const passages = await page.evaluate(async () => {
    const { messages } = await import(`/api/messages.js?v=${Date.now()}`);
    const out = {};
    for (const moduleName of ['module_1', 'module_2', 'module_2_without_dynamometer', 'questionnaires']) {
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

test('task instruction HTML reads at Year 5 level or simpler', () => {
  const passages = {};
  const root = resolve('.');

  for (const rel of TASK_INSTRUCTION_FILES) {
    const source = readFileSync(resolve(root, rel), 'utf8');
    Object.assign(passages, extractTaskPassages(source, rel));
  }

  expect(
    Object.keys(passages).length,
    'task HTML passages should have been collected'
  ).toBeGreaterThan(5);

  const tooHard = Object.entries(passages)
    .map(([name, html]) => [name, gradeLevel(html)])
    .filter(([, grade]) => grade !== null && grade > MAX_GRADE);

  expect(tooHard, `these task passages read above grade ${MAX_GRADE}`).toEqual([]);
});

test('no participant-facing screen uses staff or study jargon', async ({ page }) => {
  await page.goto('/experiment.html?participant_id=invalid%20participant');
  const found = await page.evaluate(async () => {
    const { messages } = await import(`/api/messages.js?v=${Date.now()}`);
    const banned = /\b(experimenter|module \d|intuitive|promptly|questionnaires?)\b/i;
    const hits = [];
    for (const moduleName of ['module_1', 'module_2', 'module_2_without_dynamometer', 'questionnaires']) {
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

test('task instruction text does not use banned terms', () => {
  const banned = /\b(trial and error|experimenter|module \d|intuitive|promptly)\b/i;
  const hits = [];
  const root = resolve('.');

  for (const rel of TASK_INSTRUCTION_FILES) {
    const source = readFileSync(resolve(root, rel), 'utf8');
    const passages = extractTaskPassages(source, rel);
    for (const [name, html] of Object.entries(passages)) {
      const text = html.replace(/<[^>]+>/g, ' ');
      if (banned.test(text)) {
        hits.push(`${name}: "${text.match(banned)[0]}"`);
      }
    }
  }

  expect(hits, 'task instructions should not use these terms').toEqual([]);
});

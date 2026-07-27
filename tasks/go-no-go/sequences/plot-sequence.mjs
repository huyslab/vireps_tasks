/**
 * Renders the generated sequence as a character grid for eyeballing.
 * Run: node tasks/go-no-go/sequences/plot-sequence.mjs
 *
 * Writes sequence-plot.txt beside the sequence and prints the same thing.
 *
 * Three rows, one column per trial:
 *   valence   + = win            - = avoid loss
 *   response  + = go             - = no-go
 *   affect    + = positive face  - = negative face
 *
 * Two extra rows carry the context that makes the three readable: `cue` gives
 * each cue a letter, so repeats and the staggered introduction are visible, and
 * `new` marks the trial where a cue appears for the first time. Without those
 * it is impossible to tell a well-spaced design from a clumped one by eye.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WIDTH = 60; // trials per panel; keeps lines under ~80 columns

const CUE_LETTERS = 'ABCDEFGHIJKL';

function loadSequence() {
  const src = readFileSync(join(HERE, 'trial1.js'), 'utf8');
  return JSON.parse(src.match(/const GNG_json = '(.*)';/s)[1]);
}

function renderBlock(trials, blockNumber) {
  const lines = [];
  const seen = new Set();
  const isFirst = trials.map((t) => {
    const key = t.cue;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  lines.push('');
  lines.push(`BLOCK ${blockNumber}  (${trials.length} trials, ${new Set(trials.map((t) => t.cue)).size} cues)`);
  lines.push('='.repeat(72));

  for (let start = 0; start < trials.length; start += WIDTH) {
    const slice = trials.slice(start, start + WIDTH);
    const offset = start;

    // Ruler: a digit every 10 trials, aligned to the columns below.
    let ruler = '';
    for (let i = 0; i < slice.length; i++) {
      const n = offset + i + 1;
      ruler += n % 10 === 0 ? String(Math.floor(n / 10) % 10) : ' ';
    }

    lines.push('');
    lines.push(`          trials ${offset + 1}-${offset + slice.length}`);
    lines.push(`          ${ruler}   (tens)`);
    lines.push(`valence   ${slice.map((t) => (t.valence === 'win' ? '+' : '-')).join('')}`);
    lines.push(`response  ${slice.map((t) => (t.correct_response === 'go' ? '+' : '-')).join('')}`);
    lines.push(`affect    ${slice.map((t) => (t.affect === 'positive' ? '+' : '-')).join('')}`);
    lines.push(`cue       ${slice.map((t) => CUE_LETTERS[t.cue]).join('')}`);
    lines.push(`new       ${slice.map((t, i) => (isFirst[offset + i] ? '^' : ' ')).join('')}`);
  }

  return lines;
}

function summarise(blocks) {
  const trials = blocks.flat();
  const lines = ['', 'SUMMARY', '='.repeat(72)];

  const tally = (fn) =>
    trials.reduce((acc, t) => {
      const k = fn(t);
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});

  const cells = tally((t) => `${t.valence.padEnd(10)} ${t.correct_response.padEnd(4)} ${t.affect}`);
  lines.push('trials per cell (target 30):');
  Object.keys(cells)
    .sort()
    .forEach((k) => lines.push(`  ${k.padEnd(28)} ${cells[k]}`));

  lines.push('');
  lines.push('marginals:');
  [
    ['valence', (t) => t.valence],
    ['response', (t) => t.correct_response],
    ['affect', (t) => t.affect],
  ].forEach(([label, fn]) => {
    const counts = tally(fn);
    lines.push(`  ${label.padEnd(10)} ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  });

  // Cue introduction points, which is what the staggering is meant to spread.
  lines.push('');
  lines.push('cue introductions (trial number within block):');
  blocks.forEach((block, bi) => {
    const first = {};
    block.forEach((t, i) => {
      if (first[t.cue] === undefined) first[t.cue] = i + 1;
    });
    const parts = Object.keys(first)
      .map(Number)
      .sort((a, b) => first[a] - first[b])
      .map((cue) => `${CUE_LETTERS[cue]}@${first[cue]}`);
    lines.push(`  block ${bi + 1}: ${parts.join('  ')}`);
  });

  return lines;
}

const blocks = loadSequence();
const out = [
  'GO/NO-GO SEQUENCE - valenced faces',
  '',
  'valence   + = win            - = avoid loss',
  'response  + = go             - = no-go',
  'affect    + = positive face  - = negative face',
  'cue       letter identifies which of the 12 cues (a cue keeps one cell all block)',
  'new       ^ marks a cue\'s first appearance',
  ...blocks.flatMap((block, i) => renderBlock(block, i + 1)),
  ...summarise(blocks),
  '',
];

const text = out.join('\n');
writeFileSync(join(HERE, 'sequence-plot.txt'), text);
console.log(text);

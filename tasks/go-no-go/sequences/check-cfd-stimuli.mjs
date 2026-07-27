/**
 * Checks whether a CFD image set contains enough angry + happy faces for this
 * task, balanced on gender and ethnicity.
 *
 * Run: node tasks/go-no-go/sequences/check-cfd-stimuli.mjs <path-to-CFD-images>
 *
 * Why this exists: "CFD 3.0 Norming Data and Codebook.xlsx" cannot answer the
 * question. Every row in it is one model rated on their NEUTRAL image - the
 * `Angry` and `Happy` columns are observers' impressions of a neutral face, not
 * a record of which models were photographed with those expressions. CFD
 * provides expression images for a subset of models only, and the subset's size
 * and composition are not in the workbook or on chicagofaces.org. The image
 * directory is the only authoritative source.
 *
 * CFD filenames encode everything needed:
 *     CFD-AF-200-228-N.jpg
 *         ^^  ethnicity (A/B/L/W/M) + gender (F/M)
 *            ^^^^^^^  model id
 *                    ^  expression: N neutral, A angry, F fearful,
 *                                   HO happy open mouth, HC happy closed mouth
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ETHNICITY = { A: 'Asian', B: 'Black', L: 'Latino', W: 'White', M: 'Multiracial', I: 'Indian' };

// Per session: 24 cues (12 per block x 2 blocks), half angry, half happy.
// Two sessions with disjoint identities: 48 models.
const SESSIONS = 2;
const CUES_PER_SESSION = 24;
const NEEDED = SESSIONS * CUES_PER_SESSION;

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, files);
    else files.push(entry);
  }
  return files;
}

const root = process.argv[2];
if (!root) {
  console.error('usage: node check-cfd-stimuli.mjs <path-to-CFD-images>');
  process.exit(2);
}

const models = new Map(); // id -> { ethnicity, gender, expressions:Set }

for (const file of walk(root)) {
  const m = file.match(/^CFD-([ABLWMI])([FM])-(\d+)-(\d+)-([A-Z]{1,2})\.(jpg|jpeg|png)$/i);
  if (!m) continue;
  const [, eth, gender, num, , expr] = m;
  const id = `${eth}${gender}-${num}`;
  if (!models.has(id)) models.set(id, { ethnicity: eth, gender, expressions: new Set() });
  models.get(id).expressions.add(expr.toUpperCase());
}

if (models.size === 0) {
  console.error(`No CFD-formatted image filenames found under ${root}.`);
  console.error('Expected names like CFD-AF-200-228-N.jpg');
  process.exit(1);
}

// A model is usable if it has BOTH an angry and a happy image. Requiring both
// lets affect be assigned to identities per participant rather than baked in,
// so no specific face is tied to "positive" or "negative" for the whole sample.
const usable = [...models.entries()].filter(([, m]) => m.expressions.has('A') && (m.expressions.has('HC') || m.expressions.has('HO')));

console.log(`Scanned ${root}`);
console.log(`  models found:                    ${models.size}`);
console.log(`  with an angry image:             ${[...models.values()].filter((m) => m.expressions.has('A')).length}`);
console.log(`  with a happy image:              ${[...models.values()].filter((m) => m.expressions.has('HC') || m.expressions.has('HO')).length}`);
console.log(`  with BOTH angry and happy:       ${usable.length}`);
console.log();

const grid = {};
for (const [, m] of usable) {
  grid[m.ethnicity] = grid[m.ethnicity] || { F: 0, M: 0 };
  grid[m.ethnicity][m.gender]++;
}

console.log('Models with both expressions, by ethnicity x gender:');
console.log('  ethnicity          F      M   total');
const ethnicities = Object.keys(grid).sort();
for (const e of ethnicities) {
  const { F, M } = grid[e];
  console.log(`  ${(ETHNICITY[e] || e).padEnd(14)}${String(F).padStart(5)}${String(M).padStart(7)}${String(F + M).padStart(8)}`);
}
console.log();

// Feasibility, for whatever ethnicities actually have both expressions. This is
// computed from the data rather than assuming four groups: in CFD 3.0 the
// expression subset turns out to cover only two.
console.log(`Requirement: ${NEEDED} distinct models (${SESSIONS} sessions x ${CUES_PER_SESSION} cues), disjoint across sessions.`);
console.log();

if (ethnicities.length === 0) {
  console.log('No models with both expressions - nothing to balance.');
  process.exit(1);
}

const cells = ethnicities.length * 2; // x gender
const perCell = NEEDED / cells;
const shortfalls = ethnicities.filter((e) => grid[e].F < perCell || grid[e].M < perCell);

console.log(`Balancing across ${ethnicities.length} ethnicity group(s) x 2 genders = ${cells} cells`);
console.log(`  needed per cell: ${perCell} models`);
console.log(`  smallest cell available: ${Math.min(...ethnicities.flatMap((e) => [grid[e].F, grid[e].M]))}`);
console.log(`  ${shortfalls.length === 0 ? 'FEASIBLE' : 'SHORT in: ' + shortfalls.map((e) => ETHNICITY[e]).join(', ')}`);
console.log();

// Can the three-way (ethnicity x gender x affect) balance be exact per session?
const threeWay = CUES_PER_SESSION / (ethnicities.length * 2 * 2);
if (Number.isInteger(threeWay)) {
  console.log(`Three-way balance is EXACT: ${CUES_PER_SESSION} cues = ${ethnicities.length} eth x 2 gender x 2 affect x ${threeWay} models per session.`);
} else {
  console.log(`Three-way balance cannot be exact: ${CUES_PER_SESSION} / (${ethnicities.length} eth x 2 gender x 2 affect) = ${threeWay}.`);
  console.log('  Keep the gender, ethnicity and affect margins exact and rotate the');
  console.log('  uneven split across participants so it evens out at group level.');
}

// How many sessions could this support at the same balance?
const maxSessions = Math.floor(
  Math.min(...ethnicities.flatMap((e) => [grid[e].F, grid[e].M])) / (CUES_PER_SESSION / cells)
);
console.log();
console.log(`Headroom: this subset supports up to ${maxSessions} sessions of ${CUES_PER_SESSION} cues with disjoint identities at this balance.`);

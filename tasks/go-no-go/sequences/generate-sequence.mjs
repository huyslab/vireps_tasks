/**
 * Generates trial sequences for the valenced-faces go/no-go task.
 *
 * Run:  node tasks/go-no-go/sequences/generate-sequence.mjs [session ...]
 *       (no arguments regenerates every session listed in SESSIONS)
 *
 * ---------------------------------------------------------------------------
 * Provenance
 * ---------------------------------------------------------------------------
 * The trial ORDER comes from Sam Zorowitz's RobotFactory task (nivlab), file
 * app/static/js/pit-runsheets.js on branch study02-jspsych, vendored verbatim
 * beside this script as _zorowitz-runsheets.js. Nothing about the ordering is
 * re-derived here - the point of using it is that those runsheets were selected
 * for parameter recovery, and reproducing them exactly is what buys us that.
 *
 * Each runsheet is 30 quartets = 120 trials over 12 cues, with two properties
 * that matter:
 *
 *   1. Every cue belongs to exactly one 2x2 condition and appears 8-12 times.
 *   2. Cues are introduced in three staggered, OVERLAPPING waves of four
 *      (roughly trials 0-3, 32-51, 72-90). New learning is always starting
 *      while earlier cues are still being learned, which is what keeps
 *      participants engaged and spreads reliable variance across the block.
 *
 * Condition coding follows pit-experiment.js:
 *     valence = robot < 2  ? 'win' : 'lose'
 *     action  = robot % 2 == 0 ? 'go' : 'no-go'
 *   so 0=Go-to-Win, 1=NoGo-to-Win, 2=Go-to-Avoid-Loss, 3=NoGo-to-Avoid-Loss.
 *
 * ---------------------------------------------------------------------------
 * What this task adds: stimulus affect
 * ---------------------------------------------------------------------------
 * Cues are valenced faces, adding a third factor (negative/neutral/positive) to
 * the 2 (valence) x 2 (correct response) design. That is 12 cells - exactly the
 * 12 cues in a Zorowitz block, so each block is a full crossing with one cue per
 * cell, replacing his three arbitrary replicate cues per condition.
 *
 * Affect is assigned by RANK WITHIN CONDITION, not by wave: a condition's three
 * cues, ordered by when they are introduced, get affects
 *     (condition + rank + offset) % 3
 * which guarantees, for any runsheet:
 *   - every condition sees all three affect levels, so all 12 cells are filled
 *     with exactly one cue each;
 *   - each affect level gets exactly four cues per block;
 *   - affect is decorrelated from introduction order across conditions, because
 *     the rotation term shifts which affect comes first in each condition.
 *
 * An earlier version keyed affect on wave index instead. That silently breaks on
 * any sheet where one condition has two cues in the same wave - they collide on
 * the same affect, leaving a duplicate cell and a missing affect level. Only s13
 * is immune (12/12 in RUNSHEET_WAVE_BALANCE below; s00/s03/s14 score 10,
 * s19/s28 score 9), so the rank-based rule is used to keep sheet choice free.
 *
 * `offset` is chosen per block from {0,1,2} to minimise imbalance in the NUMBER
 * OF TRIALS per affect. Cues appear 8-12 times, so four cues per affect does not
 * by itself equalise trial counts, and unequal counts mean unequal power across
 * the affect levels this task exists to compare.
 *
 * s13 is still used for block 1 of every session because it is the only
 * perfectly staggered sheet; block 2 rotates across sessions so repeat visits
 * are not identical.
 *
 * ---------------------------------------------------------------------------
 * Feedback validity
 * ---------------------------------------------------------------------------
 * RobotFactory draws the 80% valid / 20% inverted ("sham") outcome per trial at
 * runtime with Math.random(). Here it is baked in and balanced WITHIN cue
 * instead: with only 8-12 presentations, an unlucky draw can leave one cue at
 * 60% or 100% valid, which adds noise exactly where the learning signal is
 * measured. Each cue gets round(n * 0.2) inverted trials at randomly chosen
 * positions, never on the cue's first presentation.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// Wave-balance score per runsheet: for each of the 4 conditions, how many
// distinct waves its 3 cues occupy (max 3 each, so 12 = perfectly staggered).
// Recomputed and asserted below so this comment cannot silently go stale.
const RUNSHEET_WAVE_BALANCE = { s13: 12, s00: 10, s03: 10, s14: 10, s19: 9, s28: 9 };

// Block 1 is always s13 (the only perfectly staggered sheet); block 2 rotates so
// that a participant returning for a later session does not get the same
// temporal structure twice.
const SESSIONS = {
  wk0: { sheets: ['s13', 's03'], seed: 20260727 },
  wk2: { sheets: ['s13', 's00'], seed: 20260728 },
  wk4: { sheets: ['s13', 's14'], seed: 20260729 },
  wk24: { sheets: ['s13', 's28'], seed: 20260730 },
  wk28: { sheets: ['s13', 's19'], seed: 20260731 },
};

const CONDITIONS = [
  { valence: 'win', correct_response: 'go' },
  { valence: 'win', correct_response: 'nogo' },
  { valence: 'avoid_loss', correct_response: 'go' },
  { valence: 'avoid_loss', correct_response: 'nogo' },
];

const AFFECTS = ['negative', 'neutral', 'positive'];

// Outcome magnitudes, following RobotFactory: win cues pay +10 (correct) or +1,
// loss cues cost -1 (correct) or -10. `sham` swaps them for that trial.
const OUTCOMES = {
  win: { correct: 10, incorrect: 1 },
  avoid_loss: { correct: -1, incorrect: -10 },
};

/** Deterministic RNG so a given session always regenerates byte-identically. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(array, rng) {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Loads the vendored runsheets without executing the file's trailing config
 * (upstream's own choice of which two sheets to run).
 *
 * The pattern is anchored to the start of a line. Unanchored, it also matches
 * the phrase inside the vendored file's provenance comment and silently
 * truncates every runsheet definition after it.
 */
function loadRunsheets() {
  const src = readFileSync(join(HERE, '_zorowitz-runsheets.js'), 'utf8').replace(/^var runsheets\b[\s\S]*$/m, '');
  const expose = '; ({s00:runsheet_s00,s03:runsheet_s03,s13:runsheet_s13,s14:runsheet_s14,s19:runsheet_s19,s28:runsheet_s28})';
  // eslint-disable-next-line no-eval
  return eval(src + expose);
}

/**
 * Describes one runsheet: which condition each cue belongs to, which wave it is
 * introduced in, and how many times it appears.
 */
function describeSheet(sheet) {
  const robots = sheet.robots.flat();
  const stimuli = sheet.stimuli.flat();

  const condition = {};
  const firstSeen = {};
  const nPresentations = {};

  stimuli.forEach((cue, i) => {
    if (firstSeen[cue] === undefined) firstSeen[cue] = i;
    if (condition[cue] === undefined) condition[cue] = robots[i];
    if (condition[cue] !== robots[i]) {
      throw new Error(`cue ${cue} maps to more than one condition - runsheet assumption broken`);
    }
    nPresentations[cue] = (nPresentations[cue] || 0) + 1;
  });

  // Waves are the introduction order in groups of four.
  const introOrder = Object.keys(firstSeen)
    .map(Number)
    .sort((a, b) => firstSeen[a] - firstSeen[b]);
  const wave = {};
  introOrder.forEach((cue, rank) => {
    wave[cue] = Math.floor(rank / 4);
  });

  return { robots, stimuli, condition, wave, nPresentations, introOrder };
}

/** Recomputes the wave-balance score asserted in RUNSHEET_WAVE_BALANCE. */
function waveBalance(sheet) {
  const { condition, wave, introOrder } = describeSheet(sheet);
  let score = 0;
  for (let c = 0; c < 4; c++) {
    const cues = introOrder.filter((cue) => condition[cue] === c);
    score += new Set(cues.map((cue) => wave[cue])).size;
  }
  return score;
}

/**
 * Chooses which presentations of each cue carry inverted feedback: round(n*0.2)
 * per cue, never the first presentation (a participant's very first exposure to
 * a cue should be honest, or the cue starts out actively misleading).
 */
function assignShamTrials(indicesByCue, rng) {
  const sham = new Set();
  for (const indices of Object.values(indicesByCue)) {
    const nSham = Math.round(indices.length * 0.2);
    const eligible = indices.slice(1); // skip first presentation
    shuffle(eligible, rng)
      .slice(0, nSham)
      .forEach((i) => sham.add(i));
  }
  return sham;
}

/**
 * Assigns an affect level to each cue: (condition + rank-within-condition +
 * offset) % 3, with offset chosen to even out the number of TRIALS per affect.
 * See the header for why rank rather than wave.
 */
function assignAffects(describe) {
  const { condition, nPresentations, introOrder } = describe;

  // Each condition gets its own rotation: its three cues, in introduction order,
  // take affects (rank + rotation) % 3. Any rotation still gives each condition
  // all three affects, so each affect always ends up with exactly four cues
  // (one per condition) - the rotations only change WHICH cues, and therefore
  // how many trials, land on each affect. All 3^4 combinations are searched
  // because a single global offset leaves only three candidates, and on some
  // runsheets none of those three balances the trial counts.
  const build = (rotations) => {
    const affectOfCue = {};
    for (let c = 0; c < 4; c++) {
      introOrder
        .filter((cue) => condition[cue] === c)
        .forEach((cue, rank) => {
          affectOfCue[cue] = (rank + rotations[c]) % 3;
        });
    }
    return affectOfCue;
  };

  const imbalance = (affectOfCue) => {
    const trials = [0, 0, 0];
    Object.entries(affectOfCue).forEach(([cue, affect]) => {
      trials[affect] += nPresentations[cue];
    });
    return Math.max(...trials) - Math.min(...trials);
  };

  let best = null;
  for (let r0 = 0; r0 < 3; r0++) {
    for (let r1 = 0; r1 < 3; r1++) {
      for (let r2 = 0; r2 < 3; r2++) {
        for (let r3 = 0; r3 < 3; r3++) {
          const rotations = [r0, r1, r2, r3];
          const affectOfCue = build(rotations);
          const spread = imbalance(affectOfCue);
          // Tie-break on rotation diversity: if every condition used the same
          // rotation, affect would be a pure function of introduction rank and
          // the first cue a participant meets would always be the same affect.
          const diversity = new Set(rotations).size;
          if (best === null || spread < best.spread || (spread === best.spread && diversity > best.diversity)) {
            best = { affectOfCue, spread, diversity };
          }
        }
      }
    }
  }
  return best.affectOfCue;
}

function buildBlock(sheet, blockNumber, rng) {
  const describe = describeSheet(sheet);
  const { condition, wave, nPresentations } = describe;

  const affectOfCue = assignAffects(describe);

  // Guard the two properties the design depends on, for whichever sheet is used.
  const cells = new Set();
  Object.keys(condition).forEach((cue) => cells.add(`${condition[cue]}|${affectOfCue[cue]}`));
  if (cells.size !== 12) {
    throw new Error(`block ${blockNumber}: affect assignment filled ${cells.size} of 12 design cells`);
  }
  const cuesPerAffect = [0, 0, 0];
  Object.values(affectOfCue).forEach((a) => cuesPerAffect[a]++);
  if (!cuesPerAffect.every((n) => n === 4)) {
    throw new Error(`block ${blockNumber}: cues per affect ${cuesPerAffect.join('/')}, expected 4/4/4`);
  }

  // Within-quartet order is shuffled at runtime in RobotFactory; baked in here so
  // the sequence is reproducible, consistent with every other task in this repo.
  const order = [];
  for (let q = 0; q < sheet.robots.length; q++) {
    shuffle([0, 1, 2, 3], rng).forEach((k) => order.push({ quartet: q, slot: k }));
  }

  const indicesByCue = {};
  order.forEach(({ quartet, slot }, trialIndex) => {
    const cue = sheet.stimuli[quartet][slot];
    (indicesByCue[cue] = indicesByCue[cue] || []).push(trialIndex);
  });
  const shamTrials = assignShamTrials(indicesByCue, rng);

  return order.map(({ quartet, slot }, trialIndex) => {
    const cue = sheet.stimuli[quartet][slot];
    const cond = sheet.robots[quartet][slot];
    const { valence, correct_response } = CONDITIONS[cond];
    const sham = shamTrials.has(trialIndex) ? 1 : 0;
    const outcome = OUTCOMES[valence];

    return {
      block: blockNumber,
      trial: trialIndex + 1,
      // Cue identity is scoped to the block: each block uses a fresh set of 12
      // faces, so cue 0 of block 1 and cue 0 of block 2 are different stimuli.
      cue: cue,
      cue_id: `b${blockNumber}_c${String(cue).padStart(2, '0')}`,
      condition: cond,
      valence: valence,
      correct_response: correct_response,
      affect: AFFECTS[affectOfCue[cue]],
      // Which of the three same-affect image sets to draw this cue's face from.
      // The task assigns actual image files per participant so face identity is
      // not fixed across the sample; affect level is fixed by design.
      affect_slot: affectOfCue[cue],
      wave: wave[cue],
      quartet: quartet + 1,
      n_presentations: nPresentations[cue],
      // Feedback: `sham` inverts the outcome for this trial only.
      sham: sham,
      outcome_correct: sham ? outcome.incorrect : outcome.correct,
      outcome_incorrect: sham ? outcome.correct : outcome.incorrect,
    };
  });
}

function generate(session) {
  const config = SESSIONS[session];
  if (!config) throw new Error(`unknown session "${session}" - known: ${Object.keys(SESSIONS).join(', ')}`);

  const runsheets = loadRunsheets();
  const rng = mulberry32(config.seed);

  const blocks = config.sheets.map((name, i) => {
    const sheet = runsheets[name];
    if (!sheet) throw new Error(`runsheet ${name} not found`);
    const score = waveBalance(sheet);
    if (score !== RUNSHEET_WAVE_BALANCE[name]) {
      throw new Error(`wave balance for ${name} is ${score}, but RUNSHEET_WAVE_BALANCE says ${RUNSHEET_WAVE_BALANCE[name]}`);
    }
    return buildBlock(sheet, i + 1, rng);
  });

  const header =
    `// GENERATED FILE - do not edit by hand.\n` +
    `// Regenerate with: node tasks/go-no-go/sequences/generate-sequence.mjs ${session}\n` +
    `//\n` +
    `// Session ${session}: blocks from Zorowitz runsheets ${config.sheets.join(' + ')} (seed ${config.seed}).\n` +
    `// Trial order is Sam Zorowitz's RobotFactory (nivlab, study02-jspsych); affect assignment,\n` +
    `// balanced feedback validity and the flattened trial records are added here. See\n` +
    `// generate-sequence.mjs for the full rationale.\n`;

  const path = join(HERE, `trial1_${session}.js`);
  writeFileSync(path, `${header}const GNG_json = '${JSON.stringify(blocks)}';\n`);
  return { path, blocks };
}

const requested = process.argv.slice(2);
const sessions = requested.length ? requested : Object.keys(SESSIONS);
for (const session of sessions) {
  const { path, blocks } = generate(session);
  const total = blocks.reduce((n, b) => n + b.length, 0);
  console.log(`wrote ${path.split('/').slice(-1)[0]}: ${blocks.length} blocks, ${total} trials`);
}

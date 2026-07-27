/**
 * Generates trial sequences for the valenced-faces go/no-go task.
 *
 * Run:  node tasks/go-no-go/sequences/generate-sequence.mjs
 *
 * Emits ONE sequence (trial1.js) used by every session. Sessions differ only in
 * which faces are shown - see tasks/go-no-go/README.md.
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
 * Cues are valenced faces, adding a third factor (negative/positive) to the
 * 2 (valence) x 2 (correct response) design: 8 cells.
 *
 * Neutral was dropped deliberately to buy statistical power. The 240 trials are
 * fixed by the runsheets, so cells divide it: 12 cells (with neutral) gives 20
 * trials per cell, 8 cells gives 30 - a 50% increase at identical task length.
 * Across the two blocks there are 24 cues and 8 cells, so every cell gets
 * exactly 3 cues. The 3-affect variant is in git history if neutral is ever
 * wanted back as a reference category.
 *
 * Each condition has 3 cues per block but only 2 affect levels, so one affect
 * gets 2 cues and the other 1. Which affect is "heavy" flips between block 1 and
 * block 2 for every condition, so over the session each cell receives 2 + 1 = 3
 * cues. Within a block, 2 of the 4 conditions are negative-heavy and 2 are
 * positive-heavy, keeping cue counts level at 6/6 per block.
 *
 * Which of a condition's cues takes which affect is searched over all
 * assignments, scored to equalise TRIALS per cell (cues appear 8-12 times, so
 * cue counts alone do not equalise trial counts) and to keep affect from
 * tracking introduction order - an affect that always arrived first would be
 * confounded with time on task.
 *
 * An earlier 3-affect version keyed affect on wave index. That silently breaks
 * on any sheet where one condition has two cues in the same wave - they collide
 * on the same affect, leaving a duplicate cell and a missing affect level. Only
 * s13 is immune (12/12 in RUNSHEET_WAVE_BALANCE below; s00/s03/s14 score 10,
 * s19/s28 score 9), which is why assignment is now driven by rank and search
 * rather than by wave.
 *
 * s13 is used for both blocks - see the SEQUENCE constant for why.
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

// ONE sequence, shared by every session. Sessions differ only in which faces are
// shown (see README.md); the trial structure is deliberately identical so that
// change across sessions cannot be an artefact of a different trial order.
//
// s13 is used for BOTH blocks: it is the only runsheet whose every condition has
// one cue per introduction wave (12/12 in RUNSHEET_WAVE_BALANCE; the rest score
// 9-10), and there is no cost to reusing it. The blocks show different faces, so
// the repeated timing is imperceptible, and it makes block 1 vs block 2 a
// parallel-forms comparison - same structure, different stimuli - which is a
// cleaner reliability estimate than two structurally different halves.
const SEQUENCE = { sheets: ['s13', 's13'], seed: 20260727 };

const CONDITIONS = [
  { valence: 'win', correct_response: 'go' },
  { valence: 'win', correct_response: 'nogo' },
  { valence: 'avoid_loss', correct_response: 'go' },
  { valence: 'avoid_loss', correct_response: 'nogo' },
];

const AFFECTS = ['negative', 'positive'];

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
/**
 * Assigns an affect level to every cue in one block.
 *
 * Each condition has 3 cues and there are 2 affects, so one affect takes 2 of
 * them and the other takes 1. `heavyAffect[c]` says which, and is flipped
 * between blocks by the caller so each cell ends the session with 2 + 1 = 3
 * cues. Within a condition, WHICH cues take the heavy affect is searched
 * exhaustively (3 ways to choose the single light cue), scored to equalise
 * trials per cell and to avoid affect tracking introduction order.
 *
 * @param {Object} describe - output of describeSheet
 * @param {number[]} heavyAffect - per condition, the affect index given 2 cues
 */
function assignAffects(describe, heavyAffect) {
  const { condition, nPresentations, introOrder } = describe;

  const cuesByCondition = [0, 1, 2, 3].map((c) => introOrder.filter((cue) => condition[cue] === c));

  // A candidate is, per condition, the RANK of the cue that gets the light
  // affect (0, 1 or 2). 3^4 = 81 candidates.
  const build = (lightRanks) => {
    const affectOfCue = {};
    cuesByCondition.forEach((cues, c) => {
      const light = 1 - heavyAffect[c];
      cues.forEach((cue, rank) => {
        affectOfCue[cue] = rank === lightRanks[c] ? light : heavyAffect[c];
      });
    });
    return affectOfCue;
  };

  // Trials per CELL (condition x affect), not merely per affect: the cells are
  // what the analysis compares, and a cell is what can end up underpowered.
  const cellSpread = (affectOfCue) => {
    const cells = {};
    Object.entries(affectOfCue).forEach(([cue, affect]) => {
      const key = `${condition[cue]}|${affect}`;
      cells[key] = (cells[key] || 0) + nPresentations[cue];
    });
    const counts = Object.values(cells);
    return Math.max(...counts) - Math.min(...counts);
  };

  // How lopsided the affect mix is within each introduction wave, summed. This
  // has to be scored explicitly: optimising trials-per-cell alone happily
  // produces assignments where a whole wave is one affect, which means the
  // participant sees only positive faces early and only negative in the middle -
  // affect confounded with time on task, the very thing the design must avoid.
  const waveImbalance = (affectOfCue) => {
    const perWave = {};
    Object.entries(affectOfCue).forEach(([cue, affect]) => {
      const w = describe.wave[cue];
      perWave[w] = perWave[w] || [0, 0];
      perWave[w][affect]++;
    });
    return Object.values(perWave).reduce((sum, [neg, pos]) => sum + Math.abs(neg - pos), 0);
  };

  // Penalise assignments where the light affect always sits at the same rank -
  // that would make affect a function of introduction order.
  const rankDiversity = (lightRanks) => new Set(lightRanks).size;

  // Lexicographic: balanced waves FIRST, then equal cell counts, then rank
  // diversity. The two objectives genuinely conflict on some runsheets, and wave
  // balance has to win: a few trials' difference between cells costs a sliver of
  // power, whereas a wave that is entirely one affect means every participant
  // meets one affect early and the other in the middle, which confounds affect
  // with time on task and with how much learning has already happened. Cell
  // counts stay within a trial or two of 30 either way - see validate-sequence.
  const better = (a, b) =>
    a.waves !== b.waves ? a.waves < b.waves
      : a.spread !== b.spread ? a.spread < b.spread
      : a.diversity > b.diversity;

  let best = null;
  for (let a = 0; a < 3; a++) {
    for (let b = 0; b < 3; b++) {
      for (let c = 0; c < 3; c++) {
        for (let d = 0; d < 3; d++) {
          const lightRanks = [a, b, c, d];
          const affectOfCue = build(lightRanks);
          const candidate = {
            affectOfCue,
            spread: cellSpread(affectOfCue),
            waves: waveImbalance(affectOfCue),
            diversity: rankDiversity(lightRanks),
          };
          if (best === null || better(candidate, best)) best = candidate;
        }
      }
    }
  }
  return best.affectOfCue;
}

function buildBlock(sheet, blockNumber, heavyAffect, rng) {
  const describe = describeSheet(sheet);
  const { condition, wave, nPresentations } = describe;

  const affectOfCue = assignAffects(describe, heavyAffect);

  // Guard the properties the design depends on, for whichever sheet is used.
  const cells = new Set();
  Object.keys(condition).forEach((cue) => cells.add(`${condition[cue]}|${affectOfCue[cue]}`));
  if (cells.size !== 8) {
    throw new Error(`block ${blockNumber}: affect assignment filled ${cells.size} of 8 design cells`);
  }
  const cuesPerAffect = [0, 0];
  Object.values(affectOfCue).forEach((a) => cuesPerAffect[a]++);
  if (!cuesPerAffect.every((n) => n === 6)) {
    throw new Error(`block ${blockNumber}: cues per affect ${cuesPerAffect.join('/')}, expected 6/6`);
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

function generate() {
  const config = SEQUENCE;

  const runsheets = loadRunsheets();
  const rng = mulberry32(config.seed);

  // Two conditions are negative-heavy and two positive-heavy in block 1, keeping
  // cue counts at 6/6 within the block; block 2 flips every condition so each
  // cell ends the session with 2 + 1 = 3 cues.
  const heavyBlock1 = [0, 0, 1, 1];
  const heavyBlock2 = heavyBlock1.map((a) => 1 - a);

  const blocks = config.sheets.map((name, i) => {
    const sheet = runsheets[name];
    if (!sheet) throw new Error(`runsheet ${name} not found`);
    const score = waveBalance(sheet);
    if (score !== RUNSHEET_WAVE_BALANCE[name]) {
      throw new Error(`wave balance for ${name} is ${score}, but RUNSHEET_WAVE_BALANCE says ${RUNSHEET_WAVE_BALANCE[name]}`);
    }
    return buildBlock(sheet, i + 1, i === 0 ? heavyBlock1 : heavyBlock2, rng);
  });

  const header =
    `// GENERATED FILE - do not edit by hand.\n` +
    `// Regenerate with: node tasks/go-no-go/sequences/generate-sequence.mjs\n` +
    `//\n` +
    `// ONE sequence for every session - sessions differ only in which faces are shown.\n` +
    `// Blocks from Zorowitz runsheets ${config.sheets.join(' + ')} (seed ${config.seed}).\n` +
    `// Trial order is Sam Zorowitz's RobotFactory (nivlab, study02-jspsych); affect assignment,\n` +
    `// balanced feedback validity and the flattened trial records are added here. See\n` +
    `// generate-sequence.mjs for the full rationale.\n`;

  const path = join(HERE, 'trial1.js');
  writeFileSync(path, `${header}const GNG_json = '${JSON.stringify(blocks)}';\n`);
  return { path, blocks };
}

const { path, blocks } = generate();
const total = blocks.reduce((n, b) => n + b.length, 0);
console.log(`wrote ${path.split('/').slice(-1)[0]}: ${blocks.length} blocks, ${total} trials (shared by all sessions)`);

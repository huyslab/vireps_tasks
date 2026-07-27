/**
 * Checks the generated go/no-go sequences against the design they are supposed
 * to implement. Run: node tasks/go-no-go/sequences/validate-sequence.mjs
 *
 * These are properties of the DESIGN, not of the code that wrote it: the 2x2x3
 * crossing being complete, each cue belonging to exactly one cell, affect being
 * balanced and not confounded with introduction order, and feedback validity
 * sitting near 80% for every cue rather than only on average. An earlier affect
 * rule passed a casual eyeball and failed several of these.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

let failures = 0;
function check(condition, message) {
  if (!condition) failures++;
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${message}`);
}

function loadSequence(file) {
  const src = readFileSync(join(HERE, file), 'utf8');
  const match = src.match(/const GNG_json = '(.*)';/s);
  if (!match) throw new Error(`${file}: no GNG_json found`);
  return JSON.parse(match[1]);
}

function validate(file) {
  console.log(`\n=== ${file} ===`);
  const blocks = loadSequence(file);

  check(blocks.length === 2, '2 blocks');
  check(blocks.every((b) => b.length === 120), 'every block has 120 trials');

  blocks.forEach((trials, index) => {
    const blockNumber = index + 1;

    // --- design cells -----------------------------------------------------
    const cellOfCue = {};
    let consistent = true;
    trials.forEach((t) => {
      const cell = `${t.valence}|${t.correct_response}|${t.affect}`;
      if (cellOfCue[t.cue] && cellOfCue[t.cue] !== cell) consistent = false;
      cellOfCue[t.cue] = cell;
    });
    check(Object.keys(cellOfCue).length === 12, `block ${blockNumber}: 12 distinct cues`);
    check(consistent, `block ${blockNumber}: each cue keeps one valence x response x affect cell`);
    check(
      new Set(Object.values(cellOfCue)).size === 8,
      `block ${blockNumber}: all 8 design cells filled`
    );

    // --- marginal balance -------------------------------------------------
    const count = (field) =>
      trials.reduce((acc, t) => ((acc[t[field]] = (acc[t[field]] || 0) + 1), acc), {});
    const valence = count('valence');
    const response = count('correct_response');
    check(
      valence.win === 60 && valence.avoid_loss === 60,
      `block ${blockNumber}: valence balanced 60/60 ${JSON.stringify(valence)}`
    );
    check(
      response.go === 60 && response.nogo === 60,
      `block ${blockNumber}: correct response balanced 60/60 ${JSON.stringify(response)}`
    );

    // Cues appear 8-12 times, so four cues per affect does not give exactly 80
    // trials each. Require the cue count to be exact and the trial count close.
    const cuesPerAffect = {};
    Object.entries(cellOfCue).forEach(([, cell]) => {
      const affect = cell.split('|')[2];
      cuesPerAffect[affect] = (cuesPerAffect[affect] || 0) + 1;
    });
    check(
      Object.values(cuesPerAffect).every((n) => n === 6),
      `block ${blockNumber}: 6 cues per affect ${JSON.stringify(cuesPerAffect)}`
    );
    const affectTrials = count('affect');
    const spread = Math.max(...Object.values(affectTrials)) - Math.min(...Object.values(affectTrials));
    check(
      spread <= 8,
      `block ${blockNumber}: affect trial counts within 8 of each other ${JSON.stringify(affectTrials)} (spread ${spread})`
    );

    // --- affect must not track introduction order -------------------------
    const conditionAffects = {};
    Object.entries(cellOfCue).forEach(([, cell]) => {
      const [v, r, a] = cell.split('|');
      (conditionAffects[`${v}|${r}`] = conditionAffects[`${v}|${r}`] || []).push(a);
    });
    check(
      Object.values(conditionAffects).every((a) => new Set(a).size === 2),
      `block ${blockNumber}: every condition sees both affect levels`
    );

    const waveOfCue = {};
    trials.forEach((t) => (waveOfCue[t.cue] = t.wave));
    const affectByWave = {};
    Object.entries(cellOfCue).forEach(([cue, cell]) => {
      const affect = cell.split('|')[2];
      (affectByWave[waveOfCue[cue]] = affectByWave[waveOfCue[cue]] || []).push(affect);
    });
    check(
      Object.values(affectByWave).every((a) => new Set(a).size >= 2),
      `block ${blockNumber}: no wave is a single affect level ${JSON.stringify(affectByWave)}`
    );

    // --- staggered introduction -------------------------------------------
    const firstTrialOfCue = {};
    trials.forEach((t, i) => {
      if (firstTrialOfCue[t.cue] === undefined) firstTrialOfCue[t.cue] = i;
    });
    const introductions = Object.values(firstTrialOfCue).sort((a, b) => a - b);
    check(
      introductions[introductions.length - 1] > 60,
      `block ${blockNumber}: last cue introduced past the halfway point (trial ${introductions[introductions.length - 1] + 1})`
    );
    check(
      new Set(Object.values(waveOfCue)).size === 3,
      `block ${blockNumber}: cues arrive in 3 waves`
    );

    // --- feedback validity --------------------------------------------------
    const shamByCue = {};
    const nByCue = {};
    trials.forEach((t) => {
      shamByCue[t.cue] = (shamByCue[t.cue] || 0) + t.sham;
      nByCue[t.cue] = (nByCue[t.cue] || 0) + 1;
    });
    const validity = Object.keys(nByCue).map((cue) => 1 - shamByCue[cue] / nByCue[cue]);
    check(
      Math.min(...validity) >= 0.75 && Math.max(...validity) <= 0.85,
      `block ${blockNumber}: per-cue feedback validity in 75-85% (min ${Math.min(...validity).toFixed(2)}, max ${Math.max(...validity).toFixed(2)})`
    );
    check(
      Object.keys(nByCue).every((cue) => trials.filter((t) => t.cue === Number(cue))[0].sham === 0),
      `block ${blockNumber}: no cue's first presentation carries inverted feedback`
    );

    // --- outcomes match valence and sham ------------------------------------
    const outcomesOk = trials.every((t) => {
      const win = t.valence === 'win';
      const correct = t.sham ? (win ? 1 : -10) : win ? 10 : -1;
      const incorrect = t.sham ? (win ? 10 : -1) : win ? 1 : -10;
      return t.outcome_correct === correct && t.outcome_incorrect === incorrect;
    });
    check(outcomesOk, `block ${blockNumber}: outcome magnitudes follow valence and sham`);
  });
}

function validateSession(file) {
  const blocks = loadSequence(file);
  const trials = blocks.flat();

  // The headline number: with neutral dropped there are 8 cells over 240 trials,
  // so the design targets 30 trials per cell. Cues appear 8-12 times, so exact
  // equality is not achievable; this asserts every cell lands close to 30.
  const perCell = {};
  const cuesPerCell = {};
  trials.forEach((t) => {
    const cell = `${t.valence}|${t.correct_response}|${t.affect}`;
    perCell[cell] = (perCell[cell] || 0) + 1;
    (cuesPerCell[cell] = cuesPerCell[cell] || new Set()).add(`b${t.block}c${t.cue}`);
  });

  const counts = Object.values(perCell);
  check(Object.keys(perCell).length === 8, `session: 8 design cells`);
  check(
    Object.values(cuesPerCell).every((s) => s.size === 3),
    `session: 3 cues per cell ${JSON.stringify(Object.fromEntries(Object.entries(cuesPerCell).map(([k, v]) => [k, v.size])))}`
  );
  check(
    counts.reduce((a, b) => a + b, 0) === 240,
    `session: 240 trials total`
  );
  console.log(`    trials per cell: ${JSON.stringify(perCell)}`);
  check(
    Math.min(...counts) >= 26 && Math.max(...counts) <= 34,
    `session: every cell within 26-34 trials (min ${Math.min(...counts)}, max ${Math.max(...counts)}, target 30)`
  );

  // Collapsing affect, each of the 4 core conditions should hold ~60 trials.
  const perCondition = {};
  trials.forEach((t) => {
    const key = `${t.valence}|${t.correct_response}`;
    perCondition[key] = (perCondition[key] || 0) + 1;
  });
  check(
    Object.values(perCondition).every((n) => n === 60),
    `session: 60 trials per 2x2 condition ${JSON.stringify(perCondition)}`
  );
}

const files = readdirSync(HERE).filter((f) => /^trial1(_.*)?\.js$/.test(f)).sort();
files.forEach((f) => {
  validate(f);
  console.log(`  -- session totals --`);
  validateSession(f);
});

console.log(failures ? `\n${failures} CHECK(S) FAILED` : `\nall checks passed across ${files.length} sequence files`);
process.exit(failures ? 1 : 0);

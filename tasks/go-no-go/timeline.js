/**
 * Builds the go/no-go timeline: sequence + face assignment + trials.
 *
 * The sequence (sequences/trial1.js, exposed as the global GNG_json) fixes each
 * cue's condition and affect but carries no image paths. This module binds faces
 * to cues, reading sequences/stimuli-manifest.json for the session's 24 faces.
 */

import {
  saveDataREDCap,
  updateState,
  createPreloadTrial,
  shuffleArray,
  kickOut,
  fullscreen_prompt,
} from '@utils/index.js';
import { prepareGoNoGoInstructions } from './instructions.js';

const FACES_PATH = './assets/images/go-no-go/faces/';
const MANIFEST_PATH = './tasks/go-no-go/sequences/stimuli-manifest.json';

const OUTCOME_SOUNDS = {
  10: './assets/sounds/go-no-go/win_large.mp3',
  1: './assets/sounds/go-no-go/win_small.mp3',
  '-1': './assets/sounds/go-no-go/loss_small.mp3',
  '-10': './assets/sounds/go-no-go/loss_large.mp3',
};

const COIN_IMAGES = {
  10: './assets/images/card-choosing/outcomes/1pound.png',
  1: './assets/images/card-choosing/outcomes/1penny.png',
  '-1': './assets/images/card-choosing/outcomes/1pennybroken.png',
  '-10': './assets/images/card-choosing/outcomes/1poundbroken.png',
};

/**
 * Maps each (block, cue) to a face image.
 *
 * A cue's AFFECT is fixed by the sequence and a face's affect is fixed by
 * selection, so a face can only fill a cue of matching affect. Which face fills
 * which cue is shuffled per participant: affect is already locked to identity by
 * the stimulus selection, but without this the same face would sit in the same
 * 2x2 condition for everyone, adding any idiosyncrasy of that face to the
 * condition's effect for the whole sample.
 *
 * Seeded by participant id so a resumed session rebuilds the same mapping.
 *
 * @param {Array<Array<Object>>} blocks - parsed sequence
 * @param {Object} manifestSession - one entry from stimuli-manifest.json
 * @param {string} seed - participant identifier
 * @returns {Map<string, Object>} key `${block}:${cue}` -> face record
 */
function assignFaces(blocks, manifestSession, seed) {
  const pools = { negative: [], positive: [] };
  for (const face of manifestSession.faces) pools[face.affect].push(face);

  const shuffled = {
    negative: shuffleArray(pools.negative, `${seed}_neg`),
    positive: shuffleArray(pools.positive, `${seed}_pos`),
  };
  const next = { negative: 0, positive: 0 };

  const mapping = new Map();
  blocks.forEach((trials, blockIndex) => {
    // Cues in order of first appearance, so the assignment is deterministic.
    const seen = new Set();
    for (const t of trials) {
      const key = `${blockIndex + 1}:${t.cue}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const face = shuffled[t.affect][next[t.affect]++];
      if (!face) {
        throw new Error(
          `ran out of ${t.affect} faces: the manifest session has ${pools[t.affect].length}, ` +
            `the sequence needs more. Regenerate with select-cfd-stimuli.mjs.`
        );
      }
      mapping.set(key, face);
    }
  });

  return mapping;
}

/**
 * Creates the go/no-go timeline.
 *
 * @param {Object} settings - merged task configuration
 * @returns {Promise<Array>} jsPsych timeline
 */
export async function createGoNoGoTimeline(settings) {
  const structure = typeof GNG_json !== 'undefined' ? JSON.parse(GNG_json) : null;
  if (!structure) {
    console.error('go/no-go: sequence not loaded (GNG_json undefined)');
    return [];
  }

  // The manifest is fetched rather than script-loaded: it is plain data, and
  // keeping it as JSON means the selection script can rewrite it without
  // touching any JS.
  let manifest;
  try {
    const response = await fetch(MANIFEST_PATH);
    manifest = await response.json();
  } catch (error) {
    console.error('go/no-go: could not load stimuli manifest. Run select-cfd-stimuli.mjs.', error);
    return [];
  }

  const sessionNumber = settings.stimulus_session ?? 1;
  const manifestSession = manifest.sessions.find((s) => s.session === sessionNumber);
  if (!manifestSession) {
    console.error(`go/no-go: no stimuli for session ${sessionNumber} in the manifest`);
    return [];
  }

  const participant = window.participantID || 'anonymous';
  const faceOfCue = assignFaces(structure, manifestSession, participant);

  const faceFiles = [...faceOfCue.values()].map((f) => FACES_PATH + f.file);

  // Practice uses its own four NEUTRAL faces, from models that appear nowhere
  // else in the study (see select-cfd-stimuli.mjs). Training on a real cue would
  // teach a cue-action mapping before the task starts and contaminate the very
  // first trials of that cue. The four are one per gender x ethnicity cell, so
  // 2 female / 2 male and 2 Black / 2 White.
  const practiceFiles = (manifestSession.practice ?? []).map((f) => FACES_PATH + f.file);
  if (settings.include_instructions !== false && practiceFiles.length === 0) {
    console.error(
      'go/no-go: no practice faces in the manifest for this session. ' +
        'Re-run select-cfd-stimuli.mjs to generate them.'
    );
  }

  const timeline = [
    createPreloadTrial(
      [...faceFiles, ...practiceFiles, ...Object.values(COIN_IMAGES)],
      'go_no_go',
      Object.values(OUTCOME_SOUNDS)
    ),
  ];

  if (settings.include_instructions !== false && practiceFiles.length > 0) {
    timeline.push(...prepareGoNoGoInstructions(settings, practiceFiles));
  }

  structure.forEach((trials, blockIndex) => {
    const blockNumber = blockIndex + 1;

    const timelineVariables = trials.map((t) => {
      const face = faceOfCue.get(`${blockNumber}:${t.cue}`);
      return {
        stimulus: FACES_PATH + face.file,
        correct_response: t.correct_response,
        outcome_correct: t.outcome_correct,
        outcome_incorrect: t.outcome_incorrect,
        // Carried into the data so every trial is analysable on its own.
        cue: t.cue,
        cue_id: t.cue_id,
        valence: t.valence,
        affect: t.affect,
        wave: t.wave,
        sham: t.sham,
        trial_in_block: t.trial,
        face_model: face.model,
        face_ethnicity: face.ethnicity,
        face_gender: face.gender,
      };
    });

    timeline.push({
      timeline: [
        kickOut(settings),
        fullscreen_prompt,
        {
          type: jsPsychGoNoGo,
          stimulus: jsPsych.timelineVariable('stimulus'),
          correct_response: jsPsych.timelineVariable('correct_response'),
          outcome_correct: jsPsych.timelineVariable('outcome_correct'),
          outcome_incorrect: jsPsych.timelineVariable('outcome_incorrect'),
          response_window: settings.response_window,
          resize_duration: settings.resize_duration,
          feedback_duration: settings.feedback_duration,
          iti: settings.iti,
          coin_images: COIN_IMAGES,
          outcome_sounds: OUTCOME_SOUNDS,
          data: {
            trialphase: 'go_no_go',
            block: blockNumber,
            trial: jsPsych.timelineVariable('trial_in_block'),
            cue: jsPsych.timelineVariable('cue'),
            cue_id: jsPsych.timelineVariable('cue_id'),
            valence: jsPsych.timelineVariable('valence'),
            affect: jsPsych.timelineVariable('affect'),
            wave: jsPsych.timelineVariable('wave'),
            sham: jsPsych.timelineVariable('sham'),
            // Both possible outcomes are recorded so the bonus can be computed
            // against the range that was actually available on each trial.
            outcome_correct: jsPsych.timelineVariable('outcome_correct'),
            outcome_incorrect: jsPsych.timelineVariable('outcome_incorrect'),
            face_model: jsPsych.timelineVariable('face_model'),
            face_ethnicity: jsPsych.timelineVariable('face_ethnicity'),
            face_gender: jsPsych.timelineVariable('face_gender'),
          },
          on_finish: (data) => {
            const n = jsPsych.data.get().filter({ trialphase: 'go_no_go' }).count();
            if (n % 40 === 0) saveDataREDCap(3);
          },
        },
      ],
      timeline_variables: timelineVariables,
      on_start: () => updateState(`go_no_go_block_${blockNumber}_start`),
    });
  });

  return timeline;
}

/**
 * Relative bonus for the go/no-go task: points earned against the range that was
 * available given the sequence's own sham trials.
 */
export const computeRelativeGoNoGoBonus = () => {
  const trials = jsPsych.data.get().filter({ trialphase: 'go_no_go' }).values();

  let earned = 0;
  let min = 0;
  let max = 0;
  for (const t of trials) {
    earned += t.outcome ?? 0;
    // On any trial the two possible outcomes are outcome_correct and
    // outcome_incorrect; which is larger depends on whether it was a sham trial.
    const options = [t.outcome_correct, t.outcome_incorrect].filter((v) => typeof v === 'number');
    if (options.length === 2) {
      max += Math.max(...options);
      min += Math.min(...options);
    }
  }

  return { earned, min, max };
};

export const TASKS = [
  { task: 'PILT', mainPhase: 'pilt' },
  { task: 'post_PILT_test', mainPhase: 'pilt_test' },
  { task: 'reversal', mainPhase: 'reversal' },
  { task: 'go_no_go', mainPhase: 'go_no_go' },
];

export const N_PARTICIPANTS = Number(process.env.SIM_N || 3);
export const ACCURACY = Number(process.env.SIM_ACCURACY || 0.75);
export const SESSION_NUMBER = 1;

if (!Number.isSafeInteger(N_PARTICIPANTS) || N_PARTICIPANTS < 1) {
  throw new Error('SIM_N must be a positive integer.');
}
if (!Number.isFinite(ACCURACY) || ACCURACY < 0 || ACCURACY > 1) {
  throw new Error('SIM_ACCURACY must be between 0 and 1.');
}

export function simDataFilename(task, participant) {
  return `${task}_sim${participant}.json`;
}

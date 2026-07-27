import { defineTaskJourneyTest } from './support/journey-check.js';
import { TASKS } from './support/task-config.js';

// Real taps/keypresses through one go trial and one no-go trial, checking the
// approach/withdrawal animation and the recorded response.
defineTaskJourneyTest('go_no_go', TASKS.go_no_go);

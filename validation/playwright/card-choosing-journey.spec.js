import { defineTaskJourneyTest } from './support/journey-check.js';
import { TASKS } from './support/task-config.js';

// Real-interaction walkthroughs for both card-choosing response geometries: WM's three
// response buttons (single card, no spatial mapping) and the two-card tap path, reached
// via the post-PILT test because its instruction sequence is one page rather than PILT's
// practice rounds plus comprehension quiz.
defineTaskJourneyTest('WM', TASKS.WM);
defineTaskJourneyTest('postPILTtest', TASKS.postPILTtest);

// PILT walks its full instruction path to reach the comprehension quiz, which is the one
// screen the other journeys never see.
defineTaskJourneyTest('PILT', TASKS.PILT);

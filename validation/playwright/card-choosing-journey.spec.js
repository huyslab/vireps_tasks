import { defineTaskJourneyTest } from './support/journey-check.js';
import { TASKS } from './support/task-config.js';

// Real-interaction walkthroughs for both card-choosing response geometries: WM's three
// response buttons (single card, no spatial mapping) and the two-card tap path, reached
// via the post-PILT test because its instruction sequence is one page rather than PILT's
// practice rounds plus comprehension quiz.
defineTaskJourneyTest('WM', TASKS.WM);
defineTaskJourneyTest('postPILTtest', TASKS.postPILTtest);

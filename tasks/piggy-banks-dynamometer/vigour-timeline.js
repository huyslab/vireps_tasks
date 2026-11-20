import {
    createDynVigourCoreTimeline,
    removePersistentCoinContainer,
    VIGOUR_PRELOAD_IMAGES
} from './vigour-utils.js';
import { createDynamometerVigourInstructions } from './vigour-instructions.js';
import { cleanUpGripTask } from '@utils/dynamometer.js';
import { gateGripGame } from '@utils/grip-session.js';
import { createPreloadTrial } from '@utils/index.js';

export function createDynamometerVigourTimeline(settings) {
    return gateGripGame({
        preloadTrial: createPreloadTrial(VIGOUR_PRELOAD_IMAGES, settings.task_name),
        game: [
            createDynamometerVigourInstructions(settings),
            ...createDynVigourCoreTimeline(settings)
        ],
        trialphasePrefix: 'dynamometer_vigour'
    });
}

export function cleanUpDynamometerVigourDemo(settings = {}) {
    cleanUpGripTask(settings);
    removePersistentCoinContainer();
}

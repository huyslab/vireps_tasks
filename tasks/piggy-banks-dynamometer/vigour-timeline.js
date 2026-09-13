import { createDynVigourCoreTimeline, VIGOUR_PRELOAD_IMAGES } from './vigour-utils.js';
import { dynamometer_vigour_instructions } from './vigour-instructions.js';
import { createPreloadTrial } from '@utils/index.js';

export function createDynamometerVigourTimeline(settings) {
    // Recover max force from sessionStorage if the page was reloaded between tasks
    if (!window.dynamometerMaxForce) {
        const stored = sessionStorage.getItem('dynamometerMaxForce');
        if (stored) window.dynamometerMaxForce = parseFloat(stored);
    }

    return [
        createPreloadTrial(VIGOUR_PRELOAD_IMAGES, settings.task_name),
        dynamometer_vigour_instructions,
        ...createDynVigourCoreTimeline(settings)
    ];
}

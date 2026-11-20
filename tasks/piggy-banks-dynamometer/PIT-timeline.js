import { createPITCoreTimeline, PITPreloadImages } from '@tasks/piggy-banks/PIT-utils.js';
import { PITInstructions } from '@tasks/piggy-banks/PIT-instructions.js';
import { cleanUpGripTask, listenForSqueezes, releaseGrip } from '@utils/dynamometer.js';
import { gateGripGame } from '@utils/grip-session.js';
import { createPreloadTrial } from '@utils/index.js';
import { renderDebugForceGraph, createDebugForceGraphUpdater } from './debug-graph.js';

// Lets the shared PIT trial take its presses from grip squeezes instead of taps.
function makeDynamometerInputAdapter(settings) {
    return {
        renderFeedback: renderDebugForceGraph,
        bind: onPress => listenForSqueezes(onPress, { onForce: createDebugForceGraphUpdater() }),
        finish: () => releaseGrip(settings)
    };
}

export function createDynamometerPITTimeline(settings) {
    const dynamometerSettings = { ...settings, inputMode: 'dynamometer' };
    dynamometerSettings.inputAdapter = makeDynamometerInputAdapter(dynamometerSettings);
    return gateGripGame({
        preloadTrial: createPreloadTrial(PITPreloadImages(dynamometerSettings), settings.task_name),
        game: [
            PITInstructions(dynamometerSettings),
            ...createPITCoreTimeline(dynamometerSettings)
        ],
        trialphasePrefix: 'dynamometer_pit'
    });
}

export const cleanUpDynamometerPITDemo = cleanUpGripTask;

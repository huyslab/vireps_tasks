// Live grip graph for participants whose ID contains "debug". It shows what the
// squeeze rule (createSqueezeTracker) is doing: the force trace, the level the
// trace must cross next (dashed), and a tick at every counted squeeze.
import { getGripCalibration } from '@utils/grip-session.js';

const WINDOW_MS = 5000;
const TOP_Y = 6;
const BOTTOM_Y = 94;

function isDebugParticipant() {
    return (window.participantID ?? '').includes('debug');
}

/** Graph markup for a trial stimulus; empty for non-debug participants. */
export function renderDebugForceGraph() {
    if (!isDebugParticipant()) return '';
    return `
        <div id="dynamometer-debug-graph">
            <div class="dynamometer-debug-readout">
                <span>Force: <strong id="dynamometer-debug-current">0.0 N</strong></span>
                <span>Squeezes: <strong id="dynamometer-debug-count">0</strong></span>
                <span id="dynamometer-debug-trigger"></span>
            </div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
                 aria-label="Live grip force; dashed line is the level that starts or ends the next squeeze">
                <polyline id="dynamometer-debug-trigger-line" points=""></polyline>
                <g id="dynamometer-debug-squeezes"></g>
                <polyline id="dynamometer-debug-trace" points=""></polyline>
            </svg>
        </div>
    `;
}

/**
 * Returns an `onForce(forceN, tracker)` callback for listenForSqueezes that
 * redraws the graph, or null when no graph is on screen.
 */
export function createDebugForceGraphUpdater() {
    const svg = document.querySelector('#dynamometer-debug-graph svg');
    if (!svg) return null;
    const trace = document.getElementById('dynamometer-debug-trace');
    const triggerLine = document.getElementById('dynamometer-debug-trigger-line');
    const squeezeTicks = document.getElementById('dynamometer-debug-squeezes');
    const current = document.getElementById('dynamometer-debug-current');
    const count = document.getElementById('dynamometer-debug-count');
    const triggerText = document.getElementById('dynamometer-debug-trigger');

    const samples = [];   // { time, force, trigger }
    const squeezes = [];  // times of counted squeezes
    let lastCount = 0;
    // Keep ordinary squeezes in view from the start; grow to fit harder ones.
    const floorN = Math.max(5, (getGripCalibration() ?? 0) * 1.5);

    return (forceN, tracker) => {
        const now = performance.now();
        const force = Math.max(0, Number(forceN) || 0);
        samples.push({ time: now, force, trigger: tracker.triggerN });
        if (tracker.count > lastCount) {
            lastCount = tracker.count;
            squeezes.push(now);
        }
        const windowStart = now - WINDOW_MS;
        while (samples.length > 1 && samples[0].time < windowStart) samples.shift();
        while (squeezes.length && squeezes[0] < windowStart) squeezes.shift();

        const maxN = Math.max(floorN, ...samples.map(s => Math.max(s.force, s.trigger ?? 0) * 1.15));
        const x = time => (100 - ((now - time) / WINDOW_MS) * 100).toFixed(2);
        const y = value => (BOTTOM_Y - Math.min(value / maxN, 1) * (BOTTOM_Y - TOP_Y)).toFixed(2);

        trace.setAttribute('points', samples.map(s => `${x(s.time)},${y(s.force)}`).join(' '));
        triggerLine.setAttribute('points', samples
            .filter(s => s.trigger !== null)
            .map(s => `${x(s.time)},${y(s.trigger)}`).join(' '));
        squeezeTicks.innerHTML = squeezes
            .map(time => `<line x1="${x(time)}" x2="${x(time)}" y1="0" y2="100"></line>`).join('');

        current.textContent = `${force.toFixed(1)} N`;
        count.textContent = String(tracker.count);
        const trigger = tracker.triggerN;
        triggerText.textContent = trigger === null ? ''
            : tracker.squeezing ? `Ends below ${trigger.toFixed(1)} N` : `Next above ${trigger.toFixed(1)} N`;
    };
}

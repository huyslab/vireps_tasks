import { updatePersistentCoinContainer, observeResizing, dropCoin } from './vigour-utils.js';
import { shakePiggy } from '@tasks/piggy-banks/utils.js';
import { updateState } from '@utils/index.js';
import { listenForSqueezes } from '@utils/dynamometer.js';

let stopInstructionListening = () => {};
let instructionResizeObs = null;

// ── Interactive demo trial ────────────────────────────────────────────────────

function makeInstructionPage(settings) {
    return {
        type: jsPsychHtmlKeyboardResponse,
        choices: 'NO_KEYS',
        trial_duration: null,
        data: { trialphase: 'dynamometer_vigour_instructions' },
        stimulus: function () {
            return `
                <div class="experiment-wrapper">
                    <div id="instruction-container">
                        <div id="instruction-text"></div>
                    </div>
                    <div id="experiment-container">
                        <div id="coin-container"></div>
                        <div id="piggy-container">
                            <img id="piggy-bank" src="./assets/images/piggy-banks/piggy-bank.png" alt="Piggy Bank">
                        </div>
                    </div>
                    <div id="bottom-container" style="visibility: hidden">
                        <p id="button-instruction" style="margin: 24px">
                            Tap <strong>Restart</strong> to try again, or <strong>Continue</strong> to go on.
                        </p>
                        <div id="button-container">
                            <button id="restart-button" class="jspsych-btn">Restart</button>
                            <button id="continue-button" class="jspsych-btn">Continue</button>
                        </div>
                    </div>
                </div>
            `;
        },
        on_load: function () {
            updatePersistentCoinContainer();
            instructionResizeObs = observeResizing('coin-container', updatePersistentCoinContainer);

            let squeezeCount = 0;
            const FR = 5;
            let timerStarted = false;
            let continueTimer;

            updateDemoText(squeezeCount);

            const bottomContainer     = document.getElementById('bottom-container');
            const experimentContainer = document.getElementById('experiment-container');
            const buttonInstruction   = document.getElementById('button-instruction');

            function handlePress() {
                squeezeCount++;
                shakePiggy();
                updateDemoText(squeezeCount);

                if (squeezeCount % FR === 0) dropCoin(0);

                if (squeezeCount === FR + 1 && !timerStarted) {
                    timerStarted = true;
                    bottomContainer.style.visibility = 'visible';
                    continueTimer = setTimeout(() => {
                        experimentContainer.style.visibility = 'hidden';
                        buttonInstruction.style.color = '#0066cc';
                    }, 10000);
                }
            }

            function startDetector() {
                stopInstructionListening();
                stopInstructionListening = listenForSqueezes(handlePress);
            }

            function restart() {
                squeezeCount = 0;
                timerStarted = false;
                clearTimeout(continueTimer);
                updateDemoText(squeezeCount);
                experimentContainer.style.visibility = 'visible';
                bottomContainer.style.visibility = 'hidden';
                buttonInstruction.style.color  = '';
                document.getElementById('coin-container').innerHTML = '';
                startDetector();
            }

            document.getElementById('restart-button').addEventListener('click', restart);
            document.getElementById('continue-button').addEventListener('click', () => jsPsych.finishTrial());

            startDetector();

            if (window.simulating) {
                for (let i = 0; i <= FR; i++) {
                    jsPsych.pluginAPI.setTimeout(handlePress, 80 * (i + 1));
                }
                jsPsych.pluginAPI.setTimeout(() => {
                    jsPsych.pluginAPI.clickTarget(document.getElementById('continue-button'));
                }, 80 * (FR + 2) + 100);
            }
        },
        on_finish: function () {
            stopInstructionListening();
            stopInstructionListening = () => {};
            if (instructionResizeObs) {
                instructionResizeObs.disconnect();
                instructionResizeObs = null;
            }
            jsPsych.pluginAPI.cancelAllKeyboardResponses();
        }
    };
}

function updateDemoText(squeezeCount) {
    const el = document.getElementById('instruction-text');
    if (!el) return;
    if (squeezeCount < 1) {
        el.innerHTML = `<p><strong>The piggy bank game</strong></p>
            <p><strong>Squeeze the grip</strong> to shake the piggy bank.</p>
            <p>Short, quick squeezes. You do not need to squeeze hard.</p>`;
    } else if (squeezeCount < 5) {
        el.innerHTML = `<p>Squeeze again and again, quickly, to keep it shaking.</p>`;
    } else {
        el.innerHTML = `<p><strong>Well done! You got a coin.</strong></p>
            <p><span class="highlight-txt">Keep squeezing quickly to get more coins.</span></p>`;
    }
}

// ── Rule pages ────────────────────────────────────────────────────────────────

const ruleInstruction = {
    type: jsPsychInstructions,
    data: { trialphase: 'dynamometer_vigour_instructions' },
    show_clickable_nav: true,
    pages: [
        `<div id="instruction-text">
            <p>Now you will play this game for a few minutes.</p>
            <p>The piggy banks look different from each other.</p>
        </div>`,
        // Stronger colour = lower ratio = fewer squeezes per coin (see updatePiggyTails).
        `<div id="instruction-text">
            <p><img src="./assets/images/piggy-banks/saturate-icon.png" style="height:1.3em; transform:translateY(0.2em)">
                <span class="highlight-txt">Stronger colour:</span> you need to squeeze fewer times to get a coin.</p>
        </div>`,
        `<div id="instruction-text">
            <p><img src="./assets/images/piggy-banks/tail-icon.png" style="height:1.3em; transform:translateY(0.2em)">
                <span class="highlight-txt">Longer tail:</span> the coins are worth more.</p>
        </div>`,
        `<div id="instruction-text">
            <p>You can win these coins:</p>
            <div class="instruct-coin-container">
                <div class="instruct-coin">
                    <img src="./assets/images/piggy-banks/1p-num.png" alt="1 Penny"><p>1 Penny</p>
                </div>
                <div class="instruct-coin">
                    <img src="./assets/images/piggy-banks/2p-num.png" alt="2 Pence"><p>2 Pence</p>
                </div>
                <div class="instruct-coin">
                    <img src="./assets/images/piggy-banks/5p-num.png" alt="5 Pence"><p>5 Pence</p>
                </div>
            </div>
            <p>Collect as many as you can.</p>
        </div>`
    ]
};

// ── Start confirmation ────────────────────────────────────────────────────────

function makeStartConfirmation(settings) {
    let stopListening = () => {};

    return {
        type: jsPsychHtmlKeyboardResponse,
        choices: 'NO_KEYS',
        stimulus: () => `
            <div class="experiment-wrapper">
                <div id="instruction-container">
                    <div id="instruction-text">
                        <p>The game takes about <strong>two minutes</strong>. There are no breaks.</p>
                        <p>Remember: quick squeezes, not hard ones.</p>
                        <p>Ready? <span class="highlight-txt">Squeeze the grip</span> to start.</p>
                    </div>
                </div>
                <div id="experiment-container">
                    <div id="piggy-container">
                        <img id="piggy-bank" src="./assets/images/piggy-banks/piggy-bank.png" alt="Piggy Bank">
                    </div>
                </div>
                <div id="bottom-container" style="visibility: visible;">
                    <button id="reread-button" class="jspsych-btn jspsych-btn-quiet">Re-read instructions</button>
                </div>
            </div>
        `,
        post_trial_gap: 300,
        data: { trialphase: 'dynamometer_vigour_instructions' },
        on_load: function () {
            let confirmed = false;
            const finishOnce = (response) => {
                if (confirmed) return;
                confirmed = true;
                stopListening();
                jsPsych.finishTrial({ response });
            };

            stopListening = listenForSqueezes(() => finishOnce('b'));

            document.getElementById('reread-button').addEventListener('click', () => finishOnce('r'));

            if (window.simulating) {
                jsPsych.pluginAPI.setTimeout(() => finishOnce('b'), 100);
            }
        },
        on_finish: function (data) {
            stopListening();
            stopListening = () => {};
            const seed = jsPsych.randomization.setSeed();
            data.rng_seed = seed;
        }
    };
}

// ── Exported timeline factory ─────────────────────────────────────────────────

export function createDynamometerVigourInstructions(settings) {
    return {
        timeline: [makeInstructionPage(settings), ruleInstruction, makeStartConfirmation(settings)],
        loop_function: function (data) {
            return jsPsych.pluginAPI.compareKeys(data.last(1).values()[0].response, 'r');
        },
        on_timeline_start: () => updateState('dynamometer_vigour_instructions_start')
    };
}

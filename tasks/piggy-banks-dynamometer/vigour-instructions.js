import { updatePersistentCoinContainer, observeResizing, dropCoin } from './vigour-utils.js';
import { shakePiggy } from '@tasks/piggy-banks/utils.js';
import { updateState } from '@utils/index.js';
import { setForceCallback, createPressDetector } from '@utils/dynamometer.js';

let instructionDetector  = null;
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
                            Press <strong>Restart</strong> to try again, or <strong>Continue</strong> to go on.
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
                instructionDetector?.reset();
                instructionDetector = createPressDetector(window.dynamometerMaxForce, {
                    thresholdFraction: settings.thresholdFraction,
                    holdDurationMs:    settings.holdDurationMs,
                    onPress: handlePress
                });
                setForceCallback(f => instructionDetector.update(f));
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
            instructionDetector?.reset();
            setForceCallback(() => {});
            instructionDetector = null;
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
        el.innerHTML = `<p>Welcome to the piggy bank game!</p>
            <p><strong>Squeeze the grip</strong> to shake the piggy bank.</p>`;
    } else if (squeezeCount < 5) {
        el.innerHTML = `<p>Squeeze the grip to shake the piggy bank.</p>
            <p>Squeeze again and again to collect coins!</p>`;
    } else {
        el.innerHTML = `<p>Well done — you just got a coin!</p>
            <p><span class="highlight-txt">Keep squeezing to get more coins.</span></p>`;
    }
}

// ── Rule pages ────────────────────────────────────────────────────────────────

const ruleInstruction = {
    type: jsPsychInstructions,
    data: { trialphase: 'dynamometer_vigour_instructions' },
    show_clickable_nav: true,
    pages: [
        `<div id="instruction-text">
            <p><strong>You will now play a few minutes of this game, collecting coins!</strong></p>
            <p>Throughout the game you will see different piggy banks:</p>
            <ul>
                <li><img src="./assets/images/piggy-banks/saturate-icon.png" style="height:1.3em; transform:translateY(0.2em)">
                    <span class="highlight-txt">Bright, strong colours</span>: you need to squeeze more times to get a coin.</li>
                <li><img src="./assets/images/piggy-banks/tail-icon.png" style="height:1.3em; transform:translateY(0.2em)">
                    <span class="highlight-txt">Long tail</span>: this piggy gives coins worth more.</li>
            </ul>
        </div>`,
        `<div id="instruction-text">
            <p>Types of coins you can win:</p>
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
            <p><span class="highlight-txt">Your goal</span>: collect as many coins as you can.</p>
        </div>`
    ]
};

// ── Start confirmation ────────────────────────────────────────────────────────

function makeStartConfirmation(settings) {
    let detector = null;

    return {
        type: jsPsychHtmlKeyboardResponse,
        choices: 'NO_KEYS',
        stimulus: () => `
            <div class="experiment-wrapper">
                <div id="instruction-container">
                    <div id="instruction-text">
                        <p>You will now play the piggy bank game without a break for about <strong>four minutes</strong>.</p>
                        <p>When you're ready, <span class="highlight-txt">squeeze the grip</span> to begin.</p>
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
                detector?.reset();
                setForceCallback(() => {});
                jsPsych.finishTrial({ response });
            };

            detector = createPressDetector(window.dynamometerMaxForce, {
                thresholdFraction: settings.thresholdFraction,
                holdDurationMs:    settings.holdDurationMs,
                onPress: () => finishOnce('b')
            });
            setForceCallback(f => detector.update(f));

            document.getElementById('reread-button').addEventListener('click', () => finishOnce('r'));

            if (window.simulating) {
                jsPsych.pluginAPI.setTimeout(() => finishOnce('b'), 100);
            }
        },
        on_finish: function (data) {
            detector?.reset();
            detector = null;
            setForceCallback(() => {});
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

import { updateState, pressVerb, setupTapListener, cleanupTapListener, simulateTap } from '@utils/index.js';

// Function to get each key press RT
function getDifferences(array) {
    return array.map((currentValue, index, arr) => {
        if (index === 0) return 0; // or null, or any default for last element
        return currentValue - arr[index - 1];
    }).slice(1); // remove first element if you don't want the 0/null
}

// Handles for whatever the live trial started, so on_finish can release them
// however the trial ends (countdown expiry, or the trial being cut short).
let maxPressTapListener = null;
let countdownInterval = null;
let animationFrameId = null;

// Trial to measure maximum press rate
const maxPressRateTrial = (settings) => {
    return {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: function() {
            return `
            <div id="instruction-container">
                <div id="instruction-text" class="max-press-live">
                    <h3 id="countdown">${pressVerb(true)} the circle below.<br>When you are ready, ${pressVerb()} it over and over as fast as you can!</h3>
                    <div id="press-counter">Presses: 0</div>
                    <div id="speed-display">Speed: 0.00 presses/sec</div>
                    <div id="speed-track">
                        <div id="speed-bar"></div>
                    </div>
                    <div id="max-press-pad" role="button" tabindex="-1" aria-label="${pressVerb(true)} as fast as you can">
                        <span id="max-press-pad-label">${pressVerb(true)}</span>
                    </div>
                </div>
            </div>
            `;
        },
        choices: 'NO_KEYS',
        data: {trialphase: 'max_press_rate'},
        on_start: function (trial) {
            if (window.simulating) {
                trial.trial_duration = 1000;
            }
        },
        on_load: function () {
            // Shared state for the run
            let pressCount = 0;
            let isStarted = false;
            let startTime;
            let timeLeft;
            let RTs = [];
            const trialStart = performance.now();
            const pad = document.getElementById('max-press-pad');

            const updateSpeed = () => {
                if (!isStarted) return;
                const currentTime = performance.now();
                const elapsedSeconds = (currentTime - startTime) / 1000;
                const speed = (pressCount - 1) / Math.min(elapsedSeconds, settings.duration/1000); // Subtract initial press
                const speedDisplay = document.getElementById('speed-display');
                const speedBar = document.getElementById('speed-bar');
                if (speedDisplay) {
                    speedDisplay.textContent = `Speed: ${speed.toFixed(2)} presses/sec`;
                    // Assume max speed is 10 presses/sec for 100% bar width
                    const barWidth = Math.min(speed * 10, 110);
                    speedBar.style.width = `${barWidth}%`;
                }
            };

            const handleTap = function () {
                if (!isStarted) {
                    // First press - start the countdown
                    isStarted = true;
                    startTime = performance.now();
                    timeLeft = settings.duration/1000;
                    updateState('max_press_rate_start');

                    // Start animation loop
                    animationFrameId = requestAnimationFrame(updateSpeed);

                    // Set trial duration from first press
                    jsPsych.pluginAPI.setTimeout(function() {
                        jsPsych.finishTrial({responseTime: getDifferences(RTs), trialPresses: pressCount - 1, avgSpeed: (pressCount - 1) / (settings.duration / 1000)});
                    }, settings.duration + 1000);

                    // Start countdown
                    countdownInterval = setInterval(() => {
                        timeLeft = timeLeft - 0.1;
                        const countdownElement = document.getElementById('countdown');
                        if (countdownElement) {
                            if (timeLeft >= 0) {
                                countdownElement.textContent = `${timeLeft.toFixed(1)} s left`;
                                updateSpeed();
                            } else {
                                clearInterval(countdownInterval);
                                countdownInterval = null;
                                cancelAnimationFrame(animationFrameId);
                                updateSpeed();
                                countdownElement.textContent = 'Time\'s up!';
                                cleanupTapListener(maxPressTapListener);
                                maxPressTapListener = null;
                                if (pad) pad.classList.add('max-press-pad-done');
                            }
                        }
                    }, 100);
                }

                pressCount++;
                // Time from trial onset, matching what the keyboard listener recorded;
                // getDifferences turns these into inter-press intervals.
                RTs.push(performance.now() - trialStart);
                if (pad) {
                    // Restart the press animation even on rapid repeat taps
                    pad.classList.remove('max-press-pad-hit');
                    void pad.offsetWidth;
                    pad.classList.add('max-press-pad-hit');
                }
                const pressCounter = document.getElementById('press-counter');
                if (pressCounter) {
                    pressCounter.textContent = `Presses: ${pressCount-1}`;
                }
            };

            maxPressTapListener = setupTapListener(pad, handleTap);

            if (window.simulating) {
                for (let i = 0; i < 5; i++) {
                    simulateTap(pad, 20 * i + 1);
                }
            }
        },
        on_finish: function (data) {
            cleanupTapListener(maxPressTapListener);
            maxPressTapListener = null;
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
            if (window.simulating) {
                data.avgSpeed = 5.0;
            }
        }
    };
}

// Instructions trial
const maxPressInstructions = {
    type: jsPsychHtmlButtonResponse,
    css_classes: ["instructions"],
    stimulus: () => `
    <div id="instruction-container">
        <div id="instruction-text">
            <p>First, a quick warm-up. We want to see how fast you can ${pressVerb()}.</p>
            <p>On the next screen you will see a circle. <span class="highlight-txt">${pressVerb(true)} it over and over, as fast as you can</span>, until the time runs out.</p>
        </div>
    </div>
    `,
    choices: ['Start']
};

const maxPressFeedback = {
    type: jsPsychHtmlButtonResponse,
    stimulus: function() {
        const avgSpeed = jsPsych.data.get().select("avgSpeed").values.reverse()[0];
        return `
        <div id="instruction-container">
            <div id="instruction-text">
                <h2><span class="highlight-txt">Well done!</span></h2>
                <p>Your speed was <strong>${avgSpeed.toFixed(2)} times per second</strong>.</p>
                <p>${pressVerb(true)} <strong>Continue</strong> to go on to the first game.</p>
            </div>
        </div>
        `;
    },
    post_trial_gap: 800,
    choices: ['Continue']
};

const maxPressRetakeMessage = (settings) => {
    return {
        timeline: [{
            type: jsPsychHtmlButtonResponse,
            stimulus: function () {
                const avgSpeed = jsPsych.data.get().select("avgSpeed").values.reverse()[0];
                return `
            <div id="instruction-container">
                <div id="instruction-text">
                    <p>Your speed was <strong>${avgSpeed.toFixed(2)} times per second</strong>.</p>
                    <p>Let's try that once more. <span class="highlight-txt">Please go as fast as you can this time.</span></p>
                    <p>${pressVerb(true)} <strong>Continue</strong> to try again.</p>
                </div>
            </div>
            `;
            },
            post_trial_gap: 800,
            choices: ['Continue']
        }],
        conditional_function: () => {
            const avgSpeed = jsPsych.data.get().select("avgSpeed").values.reverse()[0];
            const retakeCount = jsPsych.data.get().filter({trialphase: 'max_press_rate'}).count();
            if (avgSpeed < settings.minSpeed && retakeCount < 2) {
                return true;
            } else {
                return false;
            }
        }
    };
}

const maxPressRetakeLoop = (settings) => {
    return {
        timeline: [maxPressRateTrial(settings), maxPressRetakeMessage(settings)],
        loop_function: (data) => {
            const retakeCount = jsPsych.data.get().filter({trialphase: 'max_press_rate'}).count();
            if (data.select('avgSpeed').values.reverse()[0] < settings.minSpeed && retakeCount < 2) {
                return true;
            } else {
                updateState('max_press_rate_end');
                return false;
            }
        }
    };
}

// Define the timeline
export const createMaxPressTimeline = (settings) => {
    return [
        maxPressInstructions,
        maxPressRetakeLoop(settings),
        maxPressFeedback
    ];
};

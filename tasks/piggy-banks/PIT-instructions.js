import { updateState, pressVerb, simulateTap } from '@utils/index.js';

/**
 * Creates the main instruction pages for the PIT (Pavlovian-Instrumental Transfer) task
 * @param {Object} settings - Configuration object containing session information
 * @returns {Object} jsPsych instructions trial object
 */
function PITMainInstructions(settings) { 
  return {
    type: jsPsychInstructions,
    data: { trialphase: 'vigour_instructions' },
    show_clickable_nav: true,
    pages: [`
    <div id="instruction-text">
      <p><strong>Now you will play the same game again for a few minutes. The rules are the same:</strong></p>

      <ul>
          <li><img src="./assets/images/piggy-banks/saturate-icon.png" style="height:1.3em; transform: translateY(0.2em)"> <span class="highlight-txt">Bright, strong colours</span>: you need to shake this piggy faster to get a coin.</li>
          <li><img src="./assets/images/piggy-banks/tail-icon.png" style="height:1.3em; transform: translateY(0.2em)"> <span class="highlight-txt">Long tail</span>: this piggy gives coins that are worth more.</li>
      </ul>

      <p>These are the coins you can win:</p>
      <div class="instruct-coin-container">
          <div class="instruct-coin">
              <img src="./assets/images/piggy-banks/1p-num.png" alt="1 Penny">
              <p>1 Penny</p>
          </div>
          <div class="instruct-coin">
              <img src="./assets/images/piggy-banks/2p-num.png" alt="2 Pence">
              <p>2 Pence</p>
          </div>
          <div class="instruct-coin">
              <img src="./assets/images/piggy-banks/5p-num.png" alt="5 Pence">
              <p>5 Pence</p>
          </div>
      </div>
      </div>
      `,
      `<div id="instruction-text">
        <p><strong>This time you play in a cloudy place.</strong></p>
        <img src="./assets/images/piggy-banks/occluding_clouds.png" style="height:12em">
        <p><span class="highlight-txt">You still get coins in the same way.<br>But the clouds hide them, so you will not see them while you play.</span></p>
      </div>`,
      `
      <div id="instruction-text">
        <p><span class="highlight-txt">In the cloudy place the background changes from time to time.</span></p>
        <p>These are the backgrounds you will see. Each one either gives you <strong>one</strong> coin or takes <strong>one</strong> coin away.</p>

            <div class="pav-stimuli-container">
                  <div class="pit-pav-row">
                        <img src=${"./assets/images/pavlovian-stims/" + settings.session + "/PIT1.png"} class="pit-pav-icon">
                        <img src=${"./assets/images/pavlovian-stims/" + settings.session + "/PIT2.png"} class="pit-pav-icon">
                        <img src=${"./assets/images/pavlovian-stims/" + settings.session + "/PIT3.png"} class="pit-pav-icon">
                        <img src=${"./assets/images/pavlovian-stims/" + settings.session + "/PIT4.png"} class="pit-pav-icon">
                        <img src=${"./assets/images/pavlovian-stims/" + settings.session + "/PIT5.png"} class="pit-pav-icon">
                        <img src=${"./assets/images/pavlovian-stims/" + settings.session + "/PIT6.png"} class="pit-pav-icon">
                  </div>
            </div>
      </div>
      `, `
      <div id="instruction-text">
            <p><strong>Here is what each background does.</strong></p>
            <p>The ones on the left give you a coin. The ones on the right take a coin away.</p>

            <div class="pav-stimuli-container">
                  <div class="pit-pav-row">
                        <img src=${"./assets/images/pavlovian-stims/" + settings.session + "/PIT1.png"} class="pit-pav-icon">
                        <img src=${"./assets/images/pavlovian-stims/" + settings.session + "/PIT2.png"} class="pit-pav-icon">
                        <img src=${"./assets/images/pavlovian-stims/" + settings.session + "/PIT3.png"} class="pit-pav-icon">
                        <div class="vertical"></div>
                        <img src=${"./assets/images/pavlovian-stims/" + settings.session + "/PIT4.png"} class="pit-pav-icon">
                        <img src=${"./assets/images/pavlovian-stims/" + settings.session + "/PIT5.png"} class="pit-pav-icon">
                        <img src=${"./assets/images/pavlovian-stims/" + settings.session + "/PIT6.png"} class="pit-pav-icon">
                  </div>
                  <div class="pit-coin-row">
                        <img src="./assets/images/card-choosing/outcomes/1pound.png" class="pit-coin-icon">
                        <img src="./assets/images/card-choosing/outcomes/50pence.png" class="pit-coin-icon">
                        <img src="./assets/images/card-choosing/outcomes/1penny.png" class="pit-coin-icon">
                        <div class="vertical"></div>
                        <img src="./assets/images/card-choosing/outcomes/1pennybroken.png" class="pit-coin-icon">
                        <img src="./assets/images/card-choosing/outcomes/50pencebroken.png" class="pit-coin-icon">
                        <img src="./assets/images/card-choosing/outcomes/1poundbroken.png" class="pit-coin-icon">
                  </div>
            </div>
      </div>
      `]
  };
}

/**
 * Confirmation screen before starting the PIT task.
 *
 * Deliberately the same screen as the vigour task's, down to the piggy bank the
 * participant taps to start: PIT is the same game under cloud cover, and its own
 * instructions say so ("the rules remain the same"). It previously asked for the
 * B key and an index finger, which the study tablet cannot offer.
 */
const startPITconfirmation = {
  type: jsPsychHtmlKeyboardResponse,
  choices: 'NO_KEYS',
  stimulus: () => `
  <div class="experiment-wrapper">
    <div id="instruction-container">
      <div id="instruction-text">
        <p>You will now play the piggy-bank game in the clouds for about <strong>eight minutes</strong>.</p>
        <p>When you're ready, <span class="highlight-txt">${pressVerb()} the piggy bank</span> to begin.</p>
      </div>
    </div>
    <div id="experiment-container">
      <div id="piggy-container">
        <img id="piggy-bank" src="./assets/images/piggy-banks/piggy-bank.png"
             alt="${pressVerb(true)} the piggy bank to begin">
      </div>
    </div>
    <div id="bottom-container" style="visibility: visible;">
      <button id="reread-button" class="jspsych-btn">Re-read instructions</button>
    </div>
  </div>
    `,
  post_trial_gap: 300,
  data: { trialphase: 'pit_instructions' },
  simulation_options: { data: { response: 'b' } },
  on_load: function () {
    let confirmed = false;

    const finishOnce = function (response) {
      if (confirmed) return;
      confirmed = true;
      jsPsych.finishTrial({ response });
    };

    // Tap the piggy bank to begin
    const piggyContainer = document.getElementById('piggy-container');
    if (piggyContainer) {
      piggyContainer.addEventListener('pointerdown', function handler(event) {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        finishOnce('b');
        piggyContainer.removeEventListener('pointerdown', handler);
      });
    }

    // Button to re-read the rules; 'r' is what the loop_function below looks for.
    const rereadButton = document.getElementById('reread-button');
    if (rereadButton) {
      rereadButton.addEventListener('click', function () {
        finishOnce('r');
      });
    }

    // This trial has no timeout and ends only on a real tap, so an automated run
    // needs a synthetic one to get past it.
    if (window.simulating) {
      simulateTap(piggyContainer, 100);
    }
  }
}

/**
 * Main export function that creates the complete PIT instructions timeline
 * @param {Object} settings - Configuration object containing session information
 * @returns {Object} jsPsych timeline object with instruction pages and loop functionality
 */
export const PITInstructions = (settings) => {
  return {
    timeline: [PITMainInstructions(settings), startPITconfirmation],
    // Loop function to repeat instructions if user presses 'r'
    loop_function: function (data) {
      const last_iter = data.last(1).values()[0];
      // If user pressed 'r', repeat the instructions
      if (jsPsych.pluginAPI.compareKeys(last_iter.response, 'r')) {
        return true;
      } else {
        return false; // Continue to next part of experiment
      }
    },
    // Update experiment state when instructions begin
    on_timeline_start: () => {
      updateState(`pit_instructions_start`);
    }
  }
}

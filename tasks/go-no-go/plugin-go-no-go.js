/**
 * Orthogonalised go/no-go trial with valenced-face cues.
 *
 * Trial structure:
 *   1. The face appears mid-screen at full size, with no onset animation - unlike
 *      RobotFactory, which runs a 1500 ms scanner animation before opening the
 *      response window. The window opens immediately, so RT is measured from cue
 *      onset rather than from a delayed listener start.
 *   2. Response window (default 1800 ms). A tap on the face, or the spacebar,
 *      counts as GO. Letting the window elapse is NO-GO.
 *   3. The face resizes to signal what the participant did: it GROWS on a go
 *      response (approach) and SHRINKS when the window elapses (withdrawal).
 *      This runs on both correct and incorrect trials - it reflects the action
 *      taken, not whether it was right.
 *   4. A coin appears below the face: £1 for +10, broken £1 for -10, 1p for +1,
 *      broken 1p for -1.
 *
 * Go trials end their response phase as soon as the response arrives, so trial
 * length varies with RT - the same as RobotFactory. If fixed-length trials are
 * ever needed (for timing-sensitive analyses), hold the resize until the full
 * window has elapsed.
 */

var jsPsychGoNoGo = (function (jspsych) {
  'use strict';

  // Simulate-mode response window, and the ceiling on simulated RTs. The RT must
  // land inside the window or simulation only ever produces no-go trials.
  const SIMULATED_RESPONSE_WINDOW = 150;
  const SIMULATED_MAX_RT = 90;

  const info = {
    name: 'go-no-go',
    version: '1.0.0',
    parameters: {
      /** Path to the face image serving as this trial's cue */
      stimulus: { type: jspsych.ParameterType.IMAGE, default: undefined },
      /** 'go' or 'nogo' - the response that earns the good outcome */
      correct_response: { type: jspsych.ParameterType.STRING, default: 'go' },
      /** Outcome delivered for a correct response (10, 1, -1 or -10) */
      outcome_correct: { type: jspsych.ParameterType.INT, default: 10 },
      /** Outcome delivered for an incorrect response */
      outcome_incorrect: { type: jspsych.ParameterType.INT, default: 1 },
      /** How long the participant has to respond, from cue onset */
      response_window: { type: jspsych.ParameterType.INT, default: 1800 },
      /** Duration of the grow/shrink animation */
      resize_duration: { type: jspsych.ParameterType.INT, default: 300 },
      /** How long the coin stays on screen */
      feedback_duration: { type: jspsych.ParameterType.INT, default: 1000 },
      /** Blank gap after feedback */
      iti: { type: jspsych.ParameterType.INT, default: 400 },
      /** Scale factors for the approach / withdrawal animations */
      grow_scale: { type: jspsych.ParameterType.FLOAT, default: 1.25 },
      shrink_scale: { type: jspsych.ParameterType.FLOAT, default: 0.75 },
      /** Coin image per outcome value */
      coin_images: {
        type: jspsych.ParameterType.OBJECT,
        default: {
          10: './assets/images/card-choosing/outcomes/1pound.png',
          1: './assets/images/card-choosing/outcomes/1penny.png',
          '-1': './assets/images/card-choosing/outcomes/1pennybroken.png',
          '-10': './assets/images/card-choosing/outcomes/1poundbroken.png',
        },
      },
      /** Keys accepted as a go response on non-touch devices */
      choices: { type: jspsych.ParameterType.KEYS, default: [' '] },
    },
    data: {
      /** 'go' or 'nogo' - what the participant actually did */
      response: { type: jspsych.ParameterType.STRING },
      /** Time from cue onset to the go response; null on no-go trials */
      rt: { type: jspsych.ParameterType.INT },
      /** Whether the response matched correct_response */
      correct: { type: jspsych.ParameterType.BOOL },
      /** Points delivered on this trial */
      outcome: { type: jspsych.ParameterType.INT },
      /** Input modality of the go response (touch, mouse, pen, keyboard, null) */
      pointer_type: { type: jspsych.ParameterType.STRING },
      /** Presses made before the cue appeared or after the window closed */
      premature_presses: { type: jspsych.ParameterType.INT },
      /** Whether device was in the non-preferred orientation during the trial */
      wrong_orientation: { type: jspsych.ParameterType.BOOL },
      viewport_width: { type: jspsych.ParameterType.INT },
      viewport_height: { type: jspsych.ParameterType.INT },
      viewport_changed: { type: jspsych.ParameterType.BOOL },
    },
  };

  class GoNoGoPlugin {
    constructor(jsPsych) {
      this.jsPsych = jsPsych;
    }

    trial(display_element, trial) {
      const simulating = window.simulating || false;
      const touchCapable = navigator.maxTouchPoints > 0;
      const trialOnset = performance.now();

      // Viewport / orientation covariates, matching reversal and vigour.
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      let viewportChanged = false;
      const rotateOverlay = document.getElementById('rotate-overlay');
      const gateVisible = () => !!rotateOverlay && getComputedStyle(rotateOverlay).display !== 'none';
      let wrongOrientation = gateVisible();

      display_element.innerHTML = `
        <div class="gng-wrapper">
          <div class="gng-stimulus-slot">
            <img id="gng-stimulus" class="gng-stimulus" src="${trial.stimulus}" alt="">
          </div>
          <div class="gng-coin-slot">
            <img id="gng-coin" class="gng-coin" alt="">
          </div>
        </div>`;

      const stimulus = display_element.querySelector('#gng-stimulus');
      const coin = display_element.querySelector('#gng-coin');

      let responded = false;
      let cleaned = false;
      let prematurePresses = 0;
      let windowOpen = true;
      let deadlineTimer = null;
      let resizeHandler = null;
      let keyboardListener = null;
      let superListener = null;

      const suppressContextMenu = (e) => e.preventDefault();

      const pointerHandler = (event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        if (!windowOpen) {
          prematurePresses++;
          return;
        }
        respond('go', event.pointerType || 'unknown', Math.round(performance.now() - trialOnset));
      };

      const cleanupAll = () => {
        if (cleaned) return;
        cleaned = true;
        stimulus.removeEventListener('pointerdown', pointerHandler);
        stimulus.removeEventListener('contextmenu', suppressContextMenu);
        if (resizeHandler) {
          window.removeEventListener('resize', resizeHandler);
          window.removeEventListener('orientationchange', resizeHandler);
        }
        if (deadlineTimer) {
          clearTimeout(deadlineTimer);
          deadlineTimer = null;
        }
        this.jsPsych.pluginAPI.cancelAllKeyboardResponses();
      };

      const endTrial = () => {
        cleanupAll();
        this.jsPsych.pluginAPI.clearAllTimeouts();
        display_element.innerHTML = '';
        this.jsPsych.finishTrial(this.data);
      };

      /**
       * Resolves the trial. `action` is what the participant did, which drives the
       * animation; correctness is a separate question and drives the coin.
       */
      const respond = (action, pointerType, rt) => {
        if (responded) return;
        responded = true;
        windowOpen = false;
        cleanupAll();

        const correct = action === trial.correct_response;
        const outcome = correct ? trial.outcome_correct : trial.outcome_incorrect;

        this.data = {
          response: action,
          rt: rt,
          correct: correct,
          outcome: outcome,
          pointer_type: pointerType,
          premature_presses: prematurePresses,
          wrong_orientation: wrongOrientation,
          viewport_width: viewportWidth,
          viewport_height: viewportHeight,
          viewport_changed: viewportChanged,
        };

        // Approach on go, withdrawal on no-go.
        const scale = action === 'go' ? trial.grow_scale : trial.shrink_scale;
        const duration = simulating ? 20 : trial.resize_duration;
        const animation = stimulus.animate(
          [{ transform: 'scale(1)' }, { transform: `scale(${scale})` }],
          { duration: duration, iterations: 1, fill: 'forwards', easing: 'ease-out' }
        );

        animation.finished.then(() => {
          coin.src = trial.coin_images[String(outcome)] || trial.coin_images[outcome];
          coin.classList.add('gng-coin-visible');
          this.jsPsych.pluginAPI.setTimeout(() => {
            coin.classList.remove('gng-coin-visible');
            stimulus.style.visibility = 'hidden';
            this.jsPsych.pluginAPI.setTimeout(endTrial, simulating ? 20 : trial.iti);
          }, simulating ? 20 : trial.feedback_duration);
        });
      };

      // --- Response listeners -------------------------------------------------

      if (touchCapable) {
        stimulus.addEventListener('pointerdown', pointerHandler);
        stimulus.addEventListener('contextmenu', suppressContextMenu);
      }

      keyboardListener = this.jsPsych.pluginAPI.getKeyboardResponse({
        callback_function: (r) => respond('go', 'keyboard', Math.round(r.rt)),
        valid_responses: trial.choices,
        rt_method: 'performance',
        persist: false,
        allow_held_key: false,
      });

      // Counts presses that arrive after the window has closed, mirroring
      // RobotFactory's persistent listener. Anticipatory tapping is likelier on a
      // touchscreen than with a spacebar, so it is worth being able to see it.
      superListener = this.jsPsych.pluginAPI.getKeyboardResponse({
        callback_function: () => {
          if (!windowOpen) prematurePresses++;
        },
        valid_responses: trial.choices,
        rt_method: 'performance',
        persist: true,
        allow_held_key: false,
      });

      resizeHandler = () => {
        viewportChanged = true;
        if (gateVisible()) wrongOrientation = true;
      };
      window.addEventListener('resize', resizeHandler);
      window.addEventListener('orientationchange', resizeHandler);

      // --- Response deadline --------------------------------------------------

      // In simulate mode the window is shortened so the suite runs fast, but it
      // must still be longer than the RTs create_simulation_data generates or
      // every simulated trial times out as a no-go and the go path is never
      // exercised. Keep these two numbers in step.
      deadlineTimer = this.jsPsych.pluginAPI.setTimeout(() => {
        windowOpen = false;
        respond('nogo', null, null);
      }, simulating ? SIMULATED_RESPONSE_WINDOW : trial.response_window);
    }

    simulate(trial, simulation_mode, simulation_options, load_callback) {
      if (simulation_mode === 'data-only') {
        load_callback();
        this.jsPsych.finishTrial(this.create_simulation_data(trial, simulation_options));
      }
      if (simulation_mode === 'visual') {
        this.simulate_visual(trial, simulation_options, load_callback);
      }
    }

    create_simulation_data(trial, simulation_options) {
      // Go on roughly two thirds of simulated trials, so both the grow and shrink
      // paths get exercised by the rendering tests.
      const goes = Math.random() < 0.67;
      const rt = goes ? 20 + Math.floor(Math.random() * (SIMULATED_MAX_RT - 20)) : null;
      const correct = (goes ? 'go' : 'nogo') === trial.correct_response;

      const default_data = {
        response: goes ? 'go' : 'nogo',
        rt: rt,
        correct: correct,
        outcome: correct ? trial.outcome_correct : trial.outcome_incorrect,
        pointer_type: goes ? 'keyboard' : null,
        premature_presses: 0,
        wrong_orientation: false,
        viewport_width: window.innerWidth,
        viewport_height: window.innerHeight,
        viewport_changed: false,
      };

      const data = this.jsPsych.pluginAPI.mergeSimulationData(default_data, simulation_options);
      this.jsPsych.pluginAPI.ensureSimulationDataConsistency(trial, data);
      return data;
    }

    simulate_visual(trial, simulation_options, load_callback) {
      const data = this.create_simulation_data(trial, simulation_options);
      const display_element = this.jsPsych.getDisplayElement();
      this.trial(display_element, trial);
      load_callback();
      if (data.rt !== null) {
        this.jsPsych.pluginAPI.pressKey(' ', data.rt);
      }
    }
  }

  GoNoGoPlugin.info = info;
  return GoNoGoPlugin;
})(jsPsychModule);

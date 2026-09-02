/**
 * Orthogonalised go/no-go trial with valenced-face cues.
 *
 * Trial structure:
 *   1. The face appears mid-screen at full size, lit by a coloured rim light -
 *      blue where there is money to win, amber where there is money to lose.
 *      This is RobotFactory's scanner light in another form: it names the
 *      outcome domain before any choice is made. There is no onset animation,
 *      unlike RobotFactory's 1500 ms scanner sequence; the response window opens
 *      immediately, so RT is measured from cue onset rather than from a delayed
 *      listener start, and the light is up for the whole of it.
 *   2. Response window (default 1800 ms). A tap on the face, or the spacebar,
 *      counts as GO. Letting the window elapse is NO-GO.
 *   3. The face resizes to signal what the participant did: it GROWS on a go
 *      response (approach) and SHRINKS when the window elapses (withdrawal).
 *      This runs on both correct and incorrect trials - it reflects the action
 *      taken, not whether it was right.
 *   4. A distinct sound plays and the outcome flies out of the face to land on
 *      the chest: £1 for +10, broken £1 for -10, 1p for +1, broken 1p for -1,
 *      or the signed number in points mode. The rim light stays lit throughout.
 *
 * Correctness is deliberately NOT signalled by colour in the default
 * configuration. An earlier version washed the whole screen green or red at
 * feedback, which would have left hue meaning one thing at cue onset and a
 * different thing 300 ms later. The outcome already distinguishes all four cases
 * on its own - £1 and 1p only occur in the win domain, the broken coins only in
 * the loss domain, and in points mode the sign says it outright - and each has
 * its own sound, so dropping the wash costs no information. It remains available
 * via feedback_tint, which is worth having for the signal_valence: false
 * configuration, where nothing else is competing for colour.
 *
 * Three presentation choices are configuration rather than fixed, because they
 * trade against each other and the right combination is an empirical question:
 * signal_valence (colour at cue onset), feedback_tint (colour at feedback) and
 * play_sounds. outcome_display switches the outcome between coins and Sam's
 * point values.
 *
 * The coin sits ON the chest rather than below the face because the face is most
 * of the screen at arm's length, and a coin underneath it fell outside foveal
 * vision - participants had to choose between watching the face and watching the
 * outcome. Placing it on the chest (not the lower face, which would cover the
 * expression) removes the saccade, the fly-out motion draws the eye to it, and
 * the sound carries the outcome even if the coin is missed entirely.
 *
 * The rim light is why the face stimuli are transparent PNGs rather than CFD's
 * white-background JPEGs: it is a drop-shadow filter, which follows the alpha
 * channel, so on an opaque frame it would outline the rectangle rather than the
 * person.
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
      /** 'win' or 'avoid_loss' - which outcome domain this trial is in. Drives
       *  the rim light only; the outcomes themselves come from the two
       *  outcome_* parameters. Anything else leaves the face unlit. */
      valence: { type: jspsych.ParameterType.STRING, default: null },
      /** Whether to show the domain at cue onset at all. Turning this off
       *  restores the unsignalled design, where valence has to be learnt from
       *  the outcomes along with the action. */
      signal_valence: { type: jspsych.ParameterType.BOOL, default: true },
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
      /** How long the coin and background tint stay on screen */
      feedback_duration: { type: jspsych.ParameterType.INT, default: 1600 },
      /** Blank gap after feedback */
      iti: { type: jspsych.ParameterType.INT, default: 400 },
      /** Wash the whole screen green (correct) or red (incorrect) at feedback.
       *  Off by default: hue marks the outcome domain at cue onset instead, and
       *  the same dimension should not mean two things in one trial. */
      feedback_tint: { type: jspsych.ParameterType.BOOL, default: false },
      /** Whether the outcome sound plays. Off makes the task silent. */
      play_sounds: { type: jspsych.ParameterType.BOOL, default: true },
      /** 'coins' shows the £1 / 1p / broken-coin images; 'points' shows the
       *  signed value instead, as RobotFactory does (+10, +1, -1, -10). */
      outcome_display: { type: jspsych.ParameterType.STRING, default: 'coins' },
      /** Scale factors for the approach / withdrawal animations */
      grow_scale: { type: jspsych.ParameterType.FLOAT, default: 1.4 },
      shrink_scale: { type: jspsych.ParameterType.FLOAT, default: 0.65 },
      /** How far down the face the coin's TOP EDGE may reach, as a fraction of
       *  the face's displayed height. The coin hangs below this line rather than
       *  being centred on a fixed point, so the amount of face it covers does
       *  not change with scale - positioning by centre let it ride up over the
       *  mouth on no-go trials, where the face shrinks to 0.65x but the coin
       *  only to sqrt(0.65).
       *
       *  Set separately per response, because the coin occupies a much larger
       *  share of the smaller no-go face (about 48% of its height, against 33%
       *  on a go) and so has to sit lower to cover no more of it. */
      coin_clear_fraction: { type: jspsych.ParameterType.FLOAT, default: 0.94 },
      /** As coin_clear_fraction, for trials where no response was made. */
      coin_clear_fraction_nogo: { type: jspsych.ParameterType.FLOAT, default: 1.04 },
      /** Duration of the coin's fly-out from the face */
      coin_fly_duration: { type: jspsych.ParameterType.INT, default: 350 },
      /** Sound per outcome value; set to null to run silently */
      outcome_sounds: {
        type: jspsych.ParameterType.OBJECT,
        default: {
          10: './assets/sounds/go-no-go/win_large.mp3',
          1: './assets/sounds/go-no-go/win_small.mp3',
          '-1': './assets/sounds/go-no-go/loss_small.mp3',
          '-10': './assets/sounds/go-no-go/loss_large.mp3',
        },
      },
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
      /**
       * Make simulate mode answer CORRECTLY rather than at random. Used by the
       * practice loops, which need to reach their criterion deterministically.
       *
       * This exists because simulation_options cannot carry the answer when the
       * correct response varies per trial: jsPsych does not resolve
       * jsPsych.timelineVariable() inside simulation_options.data, so the plugin's
       * own random response silently stood and every no-go trial was scored wrong.
       */
      simulate_correct: { type: jspsych.ParameterType.BOOL, default: false },
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
      /** Whether the domain was shown by the rim light on this trial */
      valence_signalled: { type: jspsych.ParameterType.BOOL },
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

      // The rim light is applied from the first paint, not faded in: unlike
      // RobotFactory there is no pre-response animation to fade it during, and
      // the response window opens at once, so any ramp would eat into the time
      // the participant has to use it.
      const glowClass = { win: 'gng-glow-win', avoid_loss: 'gng-glow-avoid-loss' }[trial.valence];
      const signalled = trial.signal_valence && !!glowClass;

      // Points and coins share one element, one position and one fly-out, so
      // only the content differs between the two modes.
      const showPoints = trial.outcome_display === 'points';
      const outcomeMarkup = showPoints
        ? '<div id="gng-coin" class="gng-coin gng-points"></div>'
        : '<img id="gng-coin" class="gng-coin" alt="">';

      display_element.innerHTML = `
        ${trial.feedback_tint ? '<div class="gng-tint" id="gng-tint"></div>' : ''}
        <div class="gng-wrapper">
          <div class="gng-stimulus-slot">
            <div class="gng-glow${signalled ? ' ' + glowClass : ''}">
              <img id="gng-stimulus" class="gng-stimulus" src="${trial.stimulus}" alt="">
            </div>
            ${outcomeMarkup}
          </div>
        </div>`;

      const stimulus = display_element.querySelector('#gng-stimulus');
      const coin = display_element.querySelector('#gng-coin');
      const tint = display_element.querySelector('#gng-tint');

      let responded = false;
      let cleaned = false;
      let prematurePresses = 0;
      let windowOpen = true;
      let deadlineTimer = null;
      let playedPlayer = null;
      let resizeHandler = null;
      let keyboardListener = null;
      let superListener = null;

      // Both possible outcomes are prefetched now so the sound is ready the
      // instant feedback starts; the files are already preloaded, so this only
      // resolves the player.
      const audioPlayers = {};
      if (trial.outcome_sounds && trial.play_sounds && !simulating) {
        for (const value of [trial.outcome_correct, trial.outcome_incorrect]) {
          const src = trial.outcome_sounds[String(value)];
          if (!src || audioPlayers[value]) continue;
          audioPlayers[value] = this.jsPsych.pluginAPI
            .getAudioPlayer(src)
            .catch(() => null); // a missing sound must never block the trial
        }
      }

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
        // Reset the audio source node so the same sound can play on a later
        // trial. Safe here: the sounds are under half a second and feedback runs
        // for well over a second, so playback has finished by now.
        if (playedPlayer) {
          try {
            playedPlayer.stop();
          } catch (error) {
            /* already stopped, or never started - nothing to reset */
          }
          playedPlayer = null;
        }
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
          valence_signalled: signalled,
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
          // Optional correctness wash. Fades via a CSS transition rather than an
          // animation so it eases in gently.
          if (tint) tint.classList.add(correct ? 'gng-tint-correct' : 'gng-tint-incorrect');

          // Outcome sound. Independent of the coin, so the outcome still lands
          // even if the participant happens to be looking away.
          //
          // jsPsych caches one AudioPlayer per file and, under Web Audio, its
          // play() calls start() on an AudioBufferSourceNode - which may only be
          // started once. Reusing it on a later trial throws InvalidStateError
          // and the sound is silently never heard again. stop() recreates the
          // node, so the player is reset in endTrial once the sound has
          // finished, which is what makes it replayable.
          const player = audioPlayers[outcome];
          if (player) {
            player.then((p) => {
              if (!p) return;
              playedPlayer = p;
              try {
                p.play();
              } catch (error) {
                console.warn('go/no-go: could not play outcome sound', error);
              }
            });
          }

          // Place the coin on the chest of the face AS CURRENTLY DISPLAYED. The
          // face has just been scaled by a transform, so its rendered geometry -
          // not its layout box - is what the coin has to track; getBoundingClientRect
          // reflects the transform, so one read covers both the grown and shrunk
          // states without needing to know which happened.
          const faceRect = stimulus.getBoundingClientRect();
          const centreY = faceRect.top + faceRect.height / 2;

          if (showPoints) {
            coin.textContent = `${outcome > 0 ? '+' : ''}${outcome}`;
          } else {
            coin.src = trial.coin_images[String(outcome)] || trial.coin_images[outcome];
          }
          coin.classList.add('gng-coin-visible');

          // Position by the coin's TOP edge, not its centre: the coin is placed
          // just below coin_clear_fraction of the face so the mouth is never
          // covered. Its rendered height depends on the scale applied below, so
          // measure the element and account for that scale here.
          const coinScale = Math.sqrt(scale);
          const coinHeight = coin.getBoundingClientRect().height * coinScale;
          const clearFraction =
            action === 'go' ? trial.coin_clear_fraction : trial.coin_clear_fraction_nogo;
          const chestY = faceRect.top + faceRect.height * clearFraction + coinHeight / 2;
          coin.style.left = `${faceRect.left + faceRect.width / 2}px`;
          coin.style.top = `${chestY}px`;

          // Fly the coin out of the face: it starts small and centred on the
          // face, then drops to the chest. Transform-only, so it stays on the
          // compositor.
          //
          // The coin scales by the SQUARE ROOT of the face's scale. At constant
          // size it went from ~20% of the face's width on a go response to ~41%
          // on a no-go, because the face itself changes by 1.4x vs 0.65x - a
          // systematic perceptual difference between exactly the two conditions
          // the design contrasts. Scaling it fully with the face would instead
          // shrink the outcome on no-go trials, where it is the only thing to
          // read. The square root splits the difference: the relative-size gap
          // narrows from about 2.2x to 1.5x while the coin stays close to its
          // intended size in both cases.
          const dy = chestY - centreY;
          coin.animate(
            [
              { transform: `translate(-50%, -50%) translateY(${-dy}px) scale(${0.3 * coinScale})`, opacity: 0 },
              { transform: `translate(-50%, -50%) translateY(0) scale(${coinScale})`, opacity: 1 },
            ],
            {
              duration: simulating ? 20 : trial.coin_fly_duration,
              easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)',
              fill: 'forwards',
            }
          );

          this.jsPsych.pluginAPI.setTimeout(() => {
            // Fade the wash back out before the blank gap, so the ITI is neutral
            // and the next cue does not arrive on a coloured screen.
            if (tint) tint.classList.remove('gng-tint-correct', 'gng-tint-incorrect');
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
      // paths get exercised by the rendering tests - unless the caller asked for
      // correct answers, as the practice loops do.
      const goes = trial.simulate_correct ? trial.correct_response === 'go' : Math.random() < 0.67;
      const rt = goes ? 20 + Math.floor(Math.random() * (SIMULATED_MAX_RT - 20)) : null;
      const correct = (goes ? 'go' : 'nogo') === trial.correct_response;

      const default_data = {
        response: goes ? 'go' : 'nogo',
        rt: rt,
        correct: correct,
        outcome: correct ? trial.outcome_correct : trial.outcome_incorrect,
        valence_signalled:
          !!trial.signal_valence && (trial.valence === 'win' || trial.valence === 'avoid_loss'),
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

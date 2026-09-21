// api/task-registry.js
// This module defines a registry for tasks in the API, allowing for easy management and execution of tasks.

import { computeRelativeCardChoosingBonus, createCardChoosingTimeline, createPostLearningTestTimeline } from '@tasks/card-choosing/index.js';
import { createGoNoGoTimeline, computeRelativeGoNoGoBonus } from '@tasks/go-no-go/index.js';
import { createDelayDiscountingTimeline } from '@tasks/delay-discounting/index.js';
import { createMaxPressTimeline } from '@tasks/max-press-test/task.js';
import { createVigourTimeline, computeRelativePiggyTasksBonus, createPITTimeline, createVigourTestTimeline } from '@tasks/piggy-banks/index.js';
import { createPavlovianLotteryTimeline } from '@tasks/pavlovian-lottery/task.js';
import { createControlTimeline, computeRelativeControlBonus } from '@tasks/control/index.js';
import { createOpenTextTimeline } from '@tasks/open-text/index.js';
import { createDynamometerCalibrationTimeline } from '@tasks/dynamometer-calibration/task.js';
import { createDynamometerVigourTimeline, createDynamometerPITTimeline } from '@tasks/piggy-banks-dynamometer/index.js';
import { computeRelativePiggyTasksBonus as computeDynBonus } from '@tasks/piggy-banks/utils.js';
import { createReversalTimeline, computeRelativeReversalBonus } from '@tasks/reversal/index.js';
import { createAcceptabilityTimeline } from '@tasks/acceptability-judgment/index.js';
import { createSelfReportTimeline } from '@tasks/self-report/index.js';

export const TaskRegistry = {
  PILT: {
    name: 'PILT',
    description: 'A task measuring probabilistic instrumental learning in a card choosing scenario',
    createTimeline: createCardChoosingTimeline,
    computeBonus: computeRelativeCardChoosingBonus,
    defaultConfig: {
        task_name: "pilt",
        n_choices: 2,
        valence: "mixed",
        present_pavlovian: true,
        include_instructions: true,
        sequence: 'wk0',
        session: 'wk0',
        preferredOrientation: "landscape"
    },
    sequences: {
        screening: '@tasks/card-choosing/sequences/PILT/trial1_screening.js',
        wk0: '@tasks/card-choosing/sequences/PILT/trial1_wk0.js',
        wk2: '@tasks/card-choosing/sequences/PILT/trial1_wk2.js',
        wk4: '@tasks/card-choosing/sequences/PILT/trial1_wk4.js',
        wk24: '@tasks/card-choosing/sequences/PILT/trial1_wk24.js',
        wk28: '@tasks/card-choosing/sequences/PILT/trial1_wk28.js',
    },
    requirements: {
      css: ['@tasks/card-choosing/styles.css'],
    },
    resumptionRules: {
        enabled: true,
        granularity: 'block', // or 'trial' for finer control
        statePattern: (taskName) => `${taskName}_block_(\\d+)_start`,
        extractProgress: (lastState, taskName) => {
            const match = lastState.match(new RegExp(`${taskName}_block_(\\d+)_start`));
            return match ? parseInt(match[1]) : 0;
        }
    },
    configOptions: {
        task_name: "The name of the task being tested. Default is 'pilt'.",
        n_choices: "Number of choice options presented. Default is 2.",
        valence: "Valence of the stimuli - can be 'both' (includes both punishment and reward blocks), 'mixed' (includes mixed valence blocks), 'punishment', or 'reward'. Default is 'mixed'.",
        present_pavlovian: "Whether to present stimuli for pavlovian conditioning along with trial outcomes. Default is true.",
        include_instructions: "Whether to show instructions before the task. Default is true.",
        sequence: "The key for the sequence to use for the learning phase. Default is 'wk0'.",
        session: "Session identifier to govern session-specific behaviour. Default is 'wk0'. Should be deprecated, with settings exposed.",
        preferredOrientation: "Preferred device orientation on phones ('portrait' or 'landscape'). On a phone held in the other orientation, a 'please rotate' overlay blocks the task until it is rotated; tablets and desktop are exempt. Default is 'landscape' - the cards are laid out in a row, and the single-card layout keeps its three response buttons on one line.",
    }
  },
  WM: {
    name: 'WM',
    description: 'Anne Collins\'s RLWM task',
    createTimeline: createCardChoosingTimeline,
    computeBonus: computeRelativeCardChoosingBonus,
    defaultConfig: {
        task_name: "wm",
        n_choices: 3,
        valence: "reward",
        present_pavlovian: false,
        include_instructions: true,
        sequence: 'wk0',
        session: 'wk0',
        preferredOrientation: "landscape"
    },
    sequences: {
        wk0: '@tasks/card-choosing/sequences/WM/trial1_wk0.js',
        wk2: '@tasks/card-choosing/sequences/WM/trial1_wk2.js',
        wk4: '@tasks/card-choosing/sequences/WM/trial1_wk4.js',
        wk24: '@tasks/card-choosing/sequences/WM/trial1_wk24.js',
        wk28: '@tasks/card-choosing/sequences/WM/trial1_wk28.js',
    },
    requirements: {
      css: ['@tasks/card-choosing/styles.css'],
    },
    resumptionRules: {
        enabled: true,
        granularity: 'block', // or 'trial' for finer control
        statePattern: (taskName) => `${taskName}_block_(\\d+)_start`,
        extractProgress: (lastState, taskName) => {
            const match = lastState.match(new RegExp(`${taskName}_block_(\\d+)_start`));
            return match ? parseInt(match[1]) : 0;
        }
    },
    configOptions: {
        task_name: "The name of the task being tested. Default is 'pilt'.",
        n_choices: "Number of choice options presented. Default is 2.",
        valence: "Valence of the stimuli - can be 'both' (includes both punishment and reward blocks), 'mixed' (includes mixed valence blocks), 'punishment', or 'reward'. Default is 'mixed'.",
        present_pavlovian: "Whether to present stimuli for pavlovian conditioning along with trial outcomes. Default is true.",
        include_instructions: "Whether to show instructions before the task. Default is true.",
        sequence: "The key for the sequence to use for the learning phase. Default is 'wk0'.",
        session: "Session identifier to govern session-specific behaviour. Default is 'wk0'. Should be deprecated, with settings exposed.",
        preferredOrientation: "Preferred device orientation on phones ('portrait' or 'landscape'). On a phone held in the other orientation, a 'please rotate' overlay blocks the task until it is rotated; tablets and desktop are exempt. Default is 'landscape' - the cards are laid out in a row, and the single-card layout keeps its three response buttons on one line.",
    }
  },
  post_PILT_test: {
    name: 'Post PILT Test',
    description: 'A test phase that evaluates learning performance in notional extinction after completing the PILT task',
    createTimeline: createPostLearningTestTimeline,
    defaultConfig: {
        task_name: "pilt_test",
        test_confidence_every: 4,
        sequence: 'wk0',
        preferredOrientation: "landscape"
    },
    requirements: {
      css: ['@tasks/card-choosing/styles.css'],
    },
    sequences: {
      wk0: '@tasks/card-choosing/sequences/PILT-test/trial1_wk0.js',
      wk2: '@tasks/card-choosing/sequences/PILT-test/trial1_wk2.js',
      wk4: '@tasks/card-choosing/sequences/PILT-test/trial1_wk4.js',
      wk24: '@tasks/card-choosing/sequences/PILT-test/trial1_wk24.js',
      wk28: '@tasks/card-choosing/sequences/PILT-test/trial1_wk28.js',
    },
    resumptionRules: {
      enabled: true
    },
    configOptions: {
        task_name: "The name of the test phase - can be 'pilt_test' or 'wm_test'. Default is 'pilt_test'.",
        test_confidence_every: "How often (in trials) to elicit confidence ratings in the test phase. Default is every 4 trials.",
        sequence: "The key for the sequence to use for the test phase - should match the learning phase. Default is 'wk0'.",
        preferredOrientation: "Preferred device orientation on phones ('portrait' or 'landscape'). On a phone held in the other orientation, a 'please rotate' overlay blocks the task until it is rotated; tablets and desktop are exempt. Default is 'landscape' - the cards are laid out in a row, and the single-card layout keeps its three response buttons on one line.",
    }
  },
  post_WM_test: {
    name: 'Post WM Task Test',
    description: 'A test phase that evaluates learning performance in notional extinction after completing the RLWM task',
    createTimeline: createPostLearningTestTimeline,
    defaultConfig: {
        task_name: "wm_test",
        test_confidence_every: 4,
        sequence: 'wk0',
        preferredOrientation: "landscape"
    },
    requirements: {
      css: ['@tasks/card-choosing/styles.css'],
    },
    sequences: {
      wk0: '@tasks/card-choosing/sequences/WM-test/trial1_wk0.js',
      wk2: '@tasks/card-choosing/sequences/WM-test/trial1_wk2.js',
      wk4: '@tasks/card-choosing/sequences/WM-test/trial1_wk4.js',
      wk24: '@tasks/card-choosing/sequences/WM-test/trial1_wk24.js',
      wk28: '@tasks/card-choosing/sequences/WM-test/trial1_wk28.js',
    },
    resumptionRules: {
      enabled: true
    },
    configOptions: {
        task_name: "The name of the test phase - can be 'pilt_test' or 'wm_test'. Default is 'wm_test'.",
        test_confidence_every: "How often (in trials) to elicit confidence ratings in the test phase. Default is every 4 trials.",
        sequence: "The key for the sequence to use for the test phase - should match the learning phase. Default is 'wk0'.",
        preferredOrientation: "Preferred device orientation on phones ('portrait' or 'landscape'). On a phone held in the other orientation, a 'please rotate' overlay blocks the task until it is rotated; tablets and desktop are exempt. Default is 'landscape' - the cards are laid out in a row, and the single-card layout keeps its three response buttons on one line.",
    }
  },
  vigour_test: {
    name: 'Vigour Test',
    description: 'A test of knowledge of the stimulus-reward contingencies in the vigour task',
    createTimeline: createVigourTestTimeline,
    computeBonus: () => 0, // No bonus computation for this task
    defaultConfig: {
      preferredOrientation: "landscape",
    },
    requirements: {
      css: ['@tasks/piggy-banks/styles.css'],
    },
    resumptionRules: {
      enabled: true
    },
    configOptions: {
      preferredOrientation: "Preferred device orientation on phones ('portrait' or 'landscape'). Default is 'landscape': the two piggy banks being compared sit side by side, and each has to stay big enough to tap."
    }
  },
  go_no_go: {
    name: 'Go/No-Go with valenced faces',
    description: 'Orthogonalised go/no-go learning task: 2 (win/avoid loss) x 2 (go/no-go) x 2 (positive/negative face affect)',
    createTimeline: createGoNoGoTimeline,
    computeBonus: computeRelativeGoNoGoBonus,
    defaultConfig: {
      task_name: "go_no_go",
      sequence: 'trial1',
      session: 'wk0',
      stimulus_session: 1,
      include_instructions: true,
      signal_valence: false,
      feedback_tint: true,
      play_sounds: true,
      outcome_display: 'coins',
      response_window: 1800,
      resize_duration: 300,
      feedback_duration: 1600,
      iti: 400,
      preferredOrientation: "landscape"
    },
    sequences: {
      trial1: '@tasks/go-no-go/sequences/trial1.js',
      // Repeat sessions use new face sets with the same balanced trial schedule.
      wk0: '@tasks/go-no-go/sequences/trial1.js',
      wk2: '@tasks/go-no-go/sequences/trial1.js',
      wk4: '@tasks/go-no-go/sequences/trial1.js',
      wk24: '@tasks/go-no-go/sequences/trial1.js',
      wk28: '@tasks/go-no-go/sequences/trial1.js',
    },
    requirements: {
      css: ['@tasks/go-no-go/styles.css'],
    },
    resumptionRules: {
      enabled: true,
      granularity: 'block',
      statePattern: (taskName) => `${taskName}_block_(\\d+)_start`,
      extractProgress: (lastState, taskName) => {
        const match = lastState.match(new RegExp(`${taskName}_block_(\\d+)_start`));
        return match ? parseInt(match[1]) : 0;
      }
    },
    configOptions: {
      task_name: "Name of the task as it appears in the bonus object. Default is 'go_no_go'.",
      sequence: "Trial sequence key. One sequence serves every session - sessions differ only in which faces are shown. Default is 'trial1'.",
      session: "Session identifier for session-specific behaviour. Default is 'wk0'.",
      stimulus_session: "Which face set (1-5) from stimuli-manifest.json to use. Each is a disjoint set of 24 CFD models, so a returning participant never sees a face twice. Default is 1.",
      include_instructions: "Whether to run the people game instructions (the participant-facing name for this task), guided training, and short quiz before block 1. Default is true.",
      signal_valence: "Whether the cue is lit by outcome domain at onset - blue for money to win, amber for money to lose - as RobotFactory's scanner light does. Signalled, the task is action learning only; unsignalled, valence has to be learnt from the outcomes too. Default is false: valence is part of what the task measures here, and the instructions teach no colour code because none is shown.",
      response_window: "Time in ms from cue onset to respond. Default is 1800. RobotFactory uses 1300 but opens its window 1500ms after onset; here the window opens immediately.",
      resize_duration: "Duration in ms of the grow (go) / shrink (no-go) animation. Default is 300.",
      feedback_duration: "How long in ms the outcome coin is shown. Default is 1600.",
      feedback_tint: "Whether the whole screen washes green (correct) or red (incorrect) at feedback. Default is true: with signal_valence off, colour is free to carry correctness, and it is the only signal of it besides the coin. Turn it off if signal_valence is ever turned on, so colour does not mean two things in one trial.",
      play_sounds: "Whether the outcome sound plays. Default is true.",
      outcome_display: "'coins' shows the £1 / 1p / broken-coin images; 'points' shows Sam Zorowitz's values instead (+10, +1, -1, -10) and adapts the instructions to match. Default is 'coins', which is also what Reversal pays in - the two games sit next to each other in Module 1 and should not use different currencies.",
      iti: "Blank gap in ms after feedback. Default is 400.",
      preferredOrientation: "Preferred device orientation on touch devices ('portrait' or 'landscape'). Default is 'landscape'."
    }
  },
  reversal: {
    name: 'reversal',
    description: 'A task measuring probabilistic instrumental reversal learning, using a two squirrel cover story.',
    createTimeline: createReversalTimeline,
    computeBonus: computeRelativeReversalBonus,
    defaultConfig: {
      task_name: "reversal",
      n_trials: 150,
      sequence: 'wk0',
      session: 'wk0',
      preferredOrientation: "landscape"
    },
    sequences: {
        screening: '@tasks/reversal/sequences/trial1_screening.js',
        wk0: '@tasks/reversal/sequences/trial1_wk0.js',
        wk2: '@tasks/reversal/sequences/trial1_wk2.js',
        wk4: '@tasks/reversal/sequences/trial1_wk4.js',
        wk24: '@tasks/reversal/sequences/trial1_wk24.js',
        wk28: '@tasks/reversal/sequences/trial1_wk28.js',
    },
    requirements: {
      css: ['@tasks/reversal/styles.css'],
    },
    resumptionRules: {
        enabled: true
    },
    configOptions: {
        task_name: "The name of the task as it would appear in the bonus object. Default is 'reversal'.",
        n_trials: "Total number of trials in the reversal task. Default is 150.",
        sequence: "The key for the sequence to use for the reversal task. Default is 'wk0'.",
        session: "Session identifier to govern session-specific behaviour. Default is 'wk0'. Should be deprecated, with settings exposed.",
        preferredOrientation: "Preferred device orientation on phones ('portrait' or 'landscape'). On a phone held in the other orientation, a 'please rotate' overlay blocks the task until it is rotated; tablets and desktop are exempt. Default is 'landscape' for reversal."
    }
  },
  delay_discounting: {
    name: 'Delay Discounting Task',
    description: 'Measure preferences for smaller-sooner vs larger-later monetary rewards',
    createTimeline: createDelayDiscountingTimeline,
    computeBonus: () => 0, // No bonus computation for this task
    defaultConfig: {
      default_response_deadline: 4000,
      long_response_deadline: 6000,
    },
    requirements: {
      css: ['@tasks/delay-discounting/styles.css'],
    },
    resumptionRules: {
        enabled: true,
    },
    configOptions: {
        default_response_deadline: "Default response deadline in milliseconds. Default is 4000 (4 seconds).",
        long_response_deadline: "Extended response deadline in milliseconds for trials where no deadline warning is displayed. This allows a softer regime for participant populations who need it. Default is 6000 (6 seconds)."
    }
  },
  vigour: {
    name: 'Vigour Task',
    description: 'A task measuring instrumental action vigour as a function of reward rate',
    createTimeline: createVigourTimeline,
    computeBonus: () => computeRelativePiggyTasksBonus('vigour_trial'), 
    defaultConfig: {
      task_name: "vigour",
      preferredOrientation: "portrait",
    },
    configOptions: {
      task_name: "The name of the task as it would appear in the bonus object. Default is 'vigour'.",
      preferredOrientation: "Preferred device orientation on phones ('portrait' or 'landscape'). On a phone held in the other orientation, a 'please rotate' overlay blocks the task until it is rotated; tablets and desktop are exempt. Default is 'portrait' for vigour."
    },
    requirements: {
      css: ['@tasks/piggy-banks/styles.css'],
    },
    resumptionRules: {
        enabled: true,
    }
  },
  PIT: {
    name: 'Pavlovian-Instrumental Transfer Task',
    description: 'A task measuring instrumental action vigour in notional extinction, as a function of instrumental reward rate and Pavlovian cues',
    createTimeline: createPITTimeline,
    computeBonus: () => computeRelativePiggyTasksBonus('pit_trial'),
    defaultConfig: {
      task_name: "PIT",
      preferredOrientation: "portrait",
    },
    configOptions: {
      task_name: "The name of the task as it would appear in the bonus object. Default is 'PIT'.",
      preferredOrientation: "Preferred device orientation on phones ('portrait' or 'landscape'). Default is 'portrait', matching the vigour task - PIT presents the same piggy bank, tapped the same way."
    },
    requirements: {
      css: ['@tasks/piggy-banks/styles.css'],
    },
    resumptionRules: {
        enabled: true,
    }
  },
  control: {
    name: 'Control Task',
    description: 'Measure control-seeking, information-seeking, and reward-seeking behaviour',
    createTimeline: createControlTimeline,
    computeBonus: computeRelativeControlBonus,
    defaultConfig: {
      session: "wk0",
      max_instruction_fails: 3,
      default_response_deadline: 4000,
      long_response_deadline: 6000,
      task_name: "control",
      warning_expected_n_back: 2
    },
    requirements: {
      css: ['@tasks/control/styles.css'],
    },
    resumptionRules: {
        enabled: true,
    },
    configOptions: {
        session: "Session identifier to govern session-specific behaviour and select stimuli. Default is 'wk0'.",
        max_instruction_fails: "Maximum number of instruction quiz failures allowed before continuing to the task. Default is 3.",
        default_response_deadline: "Default response deadline in milliseconds. Default is 4000 (4 seconds).",
        long_response_deadline: "Extended response deadline in milliseconds for trials where no deadline warning is displayed. This allows a softer regime for participant populations who need it. Default is 6000 (6 seconds).",
        task_name: "The name of the task as it would appear in the bonus object, and for monitoring warnings. Default is 'control'.",
        warning_expected_n_back: "How many jsPsych trials back to check for the previous deadline warning. Default is 2."
    }
  },
  max_press_test: {
    name: 'Max Tap Test',
    description: 'A test of maximum tapping speed, calibrating the piggy-bank tasks',
    createTimeline: createMaxPressTimeline,
    computeBonus: () => 0, // No bonus computation for this task
    defaultConfig: {
      duration: 7000,  
      minSpeed: 3.0 
    },
    configOptions: {
        duration: "Duration of the max tap test in milliseconds. Default is 7000 (7 seconds).",
        // NOTE: 3.0 was the 5th percentile of pilots 7 & 8, which measured J-key presses.
        // The task now measures tapping - which is what vigour and PIT actually ask for -
        // so this threshold governs a different action from the one it was derived from
        // and should be re-piloted before it is trusted to trigger a retake.
        minSpeed: "Minimum speed in taps per second required to pass the test. Default is 3.0, inherited from keypress pilots 7 & 8 and pending re-piloting against tapping."
    },
    requirements: {
      css: ['@tasks/max-press-test/styles.css'],
    },
    resumptionRules: {
        enabled: true,
    }
  },
  pavlovian_lottery: {
    name: 'Pavlovian Conditioning Lottery',
    description: 'A lottery task for conditioning Pavlovian associations between visual cues and monetary rewards',
    createTimeline: createPavlovianLotteryTimeline,
    computeBonus: () => 0, // No bonus computation for this task
    defaultConfig: {
      initial_movement_delay: 50,
      reel_spin_duration: 1500,
      winning_highlight_delay: 450,
      max_result_display_time: 4000,
      continue_message_delay: 1500,
      session: "wk0"
    },
    configOptions: {
        initial_movement_delay: "Initial delay before the slot reel starts moving, in milliseconds. Default is 50.",
        reel_spin_duration: "Duration for which the slot reel spins, in milliseconds. Default is 1500.",
        winning_highlight_delay: "Delay before highlighting the winning outcome, in milliseconds. Default is 450.",
        max_result_display_time: "Maximum time to display the result before automatically continuing, in milliseconds. Default is 4000.",
        continue_message_delay: "Delay before showing the 'Press any key to continue' message, in milliseconds. Default is 1500.",
        session: "Session identifier to select the appropriate stimulus set. Default is 'wk0'.",
    },
    requirements: {
      css: ['@tasks/pavlovian-lottery/styles.css'],
    },
    resumptionRules: {
        enabled: true,
    }
  },
  open_text: {
    name: 'Open Text Questions',
    description: 'A task for answering open text questions',
    createTimeline: createOpenTextTimeline,
    computeBonus: () => 0, // No bonus computation for this task
    defaultConfig: {
      min_words: 30,
      prevent_paste: true,
      writing_time: 120,
      warning_time: 90,
      qs_read_time: 7,
      oq_timelimit_text: 'two minutes',
      no_skip: true,
      timeout_alert_duration: 4,
      max_timeout: 5,
      warning_text: `We missed that one. Moving on.`
    },
    configOptions: {
      min_words: "Minimum number of words required for each response. Default is 30.",
      prevent_paste: "Whether to prevent pasting text into the response box. Default is true.",
      writing_time: "Time in seconds allocated for writing each response. Default is 120 seconds.",
      warning_time: "Time in seconds before the end of writing time to display a warning. Default is 90 seconds.",
      qs_read_time: "Extra time in seconds allocated to read  the question before writing time starts. Default is 7 seconds.", 
      oq_timelimit_text: "Text to display indicating the time limit for answering each question. Default is 'two minutes'.",
      no_skip: "Whether to prevent skipping questions if no response is given or time runs out. Default is true.",
      timeout_alert_duration: "Duration in seconds of the timeout/empty response alert. Default is 4 seconds.",
      max_timeout: "Maximum number of timeouts or empty responses allowed before the participant is asked to return their submission. Default is 5.",
      warning_text: "Text to display when a response is not captured before moving on. Default is `We missed that one. Moving on.`"
    },
    requirements: {
      css: ['@tasks/open-text/styles.css'],
    },
    resumptionRules: {
        enabled: true,
    }
  },
  acceptability_judgment: {
    name: 'Acceptability Judgment',
    description: 'Measure participant acceptability of a preceding task',
    createTimeline: createAcceptabilityTimeline,
    computeBonus: () => 0, // No bonus computation for this task
    defaultConfig: {
      task_name: "task",
      game_description: "game you have just completed"
    },
    configOptions: {
      task_name: "Short identifier for the task (used in data field names). Default is 'task'.",
      game_description: "Human-readable description of the game/task. Default is 'game you have just completed'. Shown to the participant verbatim, so it must be what they were actually called in the game's own instructions."
    },
    requirements: {
      // Shares the questionnaire block's one-item-per-screen component, and so its styles.
      css: ['@tasks/self-report/styles.css'],
    },
    resumptionRules: {
        enabled: false,
    }
  },
  self_report: {
    name: 'Self-Report Questionnaires',
    description: 'Touch-friendly BIS, ARI, STAXI-2, and STAI questionnaires presented one item per screen, with a way back to correct an answer',
    createTimeline: createSelfReportTimeline,
    computeBonus: () => 0,
    defaultConfig: {
      questionnaires: ['BIS', 'ARI', 'STAXI2', 'STAI'],
      save_every: 5,
      transition_duration: 250,
      input_mode: 'auto'
    },
    configOptions: {
      questionnaires: "Questionnaires to present in order. Available: 'BIS', 'ARI', 'STAXI2', 'STAI'.",
      save_every: 'Save after this many items as well as at the end of each questionnaire. Default is 5.',
      transition_duration: 'Transition duration between item screens in milliseconds. Default is 250.',
      input_mode: "Input mode: 'touch', 'keyboard', or 'auto'. Default is 'auto'."
    },
    requirements: {
      css: ['@tasks/self-report/styles.css']
    },
    resumptionRules: {
      // Resuming by task would skip unanswered items and leave incomplete scales.
      enabled: false
    },
    /**
     * READING THE DATA. Each questionnaire runs as a loop with a cursor rather than a
     * flat list of trials, because a participant can step back and change an answer.
     * One screen still writes one row, so an item that was revisited has more than one:
     *
     *   navigation  'forward' for an answer, 'back' for a step backwards (response null)
     *   superseded  true on an answer that a later one replaced
     *   revisited   true when the screen already held an answer when it was shown
     *
     * The live answers are the rows where navigation === 'forward' and superseded is
     * falsy - exactly one per item_id. Corrections are kept rather than overwritten, so
     * a first tap and its correction can both be seen, but only one of them counts.
     */
    dataNotes: 'One row per screen. Live answers are navigation === "forward" && !superseded, one per item_id.'
  },
  dynamometer_calibration: {
    name: 'Dynamometer Calibration',
    description: 'Measures maximum squeeze force and squeeze speed using the Vernier Go Direct Hand Dynamometer over Bluetooth',
    createTimeline: createDynamometerCalibrationTimeline,
    computeBonus: () => 0,
    defaultConfig: {
      disconnectOnFinish: true,
      squeezeWaitTimeoutMs: 30000,
      thresholdFraction: 0.05,
      speedCalibrationDurationMs: 7000,
      speedBarMaxHz: 5
    },
    requirements: {
      css: ['@tasks/dynamometer-calibration/styles.css']
    },
    resumptionRules: { enabled: false },
    configOptions: {
      disconnectOnFinish: 'Whether to disconnect the dynamometer after calibration. Default is true; the combined dynamometer module sets this to false so vigour can reuse the connection.',
      squeezeWaitTimeoutMs: 'How long in milliseconds to wait for a squeeze during force calibration before reconnecting the dynamometer. Default is 30000.',
      thresholdFraction: 'Fraction of calibrated maximum force used to register squeezes during speed calibration. Default is 0.05 (5%), matching the dynamometer tasks.',
      speedCalibrationDurationMs: 'Duration of the dynamometer speed calibration in milliseconds. Default is 7000 (7 seconds).',
      speedBarMaxHz: 'Squeeze rate represented by a full speed bar. Default is 5 squeezes per second.'
    }
  },
  dynamometer_vigour: {
    name: 'Dynamometer Vigour Task',
    description: 'Piggy-bank vigour task driven by hand dynamometer squeezes instead of screen taps',
    createTimeline: createDynamometerVigourTimeline,
    computeBonus: () => computeDynBonus('dynamometer_vigour_trial', 5),
    defaultConfig: {
      task_name: 'dynamometer_vigour',
      thresholdFraction: 0.05,
      holdDurationMs: 0,
      disconnectOnFinish: true,
      preferredOrientation: 'portrait'
    },
    requirements: {
      css: ['@tasks/piggy-banks/styles.css']
    },
    resumptionRules: { enabled: true },
    configOptions: {
      thresholdFraction: 'Fraction of calibrated max force the participant must reach for a squeeze to count. Default is 0.05 (5%).',
      holdDurationMs: 'How long in milliseconds the squeeze must stay above threshold to count as one press. Default is 0, so it counts immediately on crossing the threshold.',
      disconnectOnFinish: 'Whether to disconnect the dynamometer after the task. Default is true; Module 2 keeps it connected for the following dynamometer PIT task.',
      preferredOrientation: "Preferred device orientation ('portrait' or 'landscape'). Default is 'portrait', matching the standard vigour task."
    }
  },
  dynamometer_PIT: {
    name: 'Dynamometer Pavlovian-Instrumental Transfer Task',
    description: 'PIT task driven by hand dynamometer squeezes instead of screen taps',
    createTimeline: createDynamometerPITTimeline,
    computeBonus: () => computeDynBonus('dynamometer_pit_trial', 5),
    defaultConfig: {
      task_name: 'dynamometer_PIT',
      thresholdFraction: 0.05,
      holdDurationMs: 0,
      disconnectOnFinish: true,
      preferredOrientation: 'portrait'
    },
    requirements: {
      css: ['@tasks/piggy-banks/styles.css']
    },
    resumptionRules: { enabled: true },
    configOptions: {
      thresholdFraction: 'Fraction of calibrated max force the participant must reach for a squeeze to count. Default is 0.05 (5%).',
      holdDurationMs: 'How long in milliseconds the squeeze must stay above threshold to count as one press. Default is 0, so it counts immediately on crossing the threshold.',
      disconnectOnFinish: 'Whether to disconnect the dynamometer after the task. Default is true.',
      preferredOrientation: "Preferred device orientation ('portrait' or 'landscape'). Default is 'portrait', matching the standard PIT task."
    }
  }
};

// Global settings that apply to all tasks unless overridden
export const globalConfig = {
    max_warnings_per_task: 3, 
    warning_expected_n_back: 1,
    default_response_deadline: 4000,
    long_response_deadline: 6000,
    interimWarning: 5,
    finalWarning: 15
}

export const globalConfigOptions = {
    max_warnings_per_task: "Maximum number of deadline warnings allowed per task. Default is 3.",
    warning_expected_n_back: "How many jsPsych trials back to check for the previous deadline warning. Default is 1.",
    default_response_deadline: "Default response deadline in milliseconds. Default is 4000.",
    long_response_deadline: "Long response deadline in milliseconds. Default is 6000.",
    interimWarning: "Show message about abiding by instructions after participant receives this many warnings in a task. Default is 5.",
    finalWarning: "Show message about abiding by instructions after participant receives this many warnings in a task. Default is 15."
}

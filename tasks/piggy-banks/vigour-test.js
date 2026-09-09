import { saveDataREDCap, updateState, kickOut, fullscreen_prompt, pressVerb, setupTapListener, cleanupTapListener, simulateTap } from '@utils/index.js';

// Trial plan for the vigour test task
const POST_VIGOUR_PAIRS =
  [{"left":{"magnitude":5,"ratio":1},"right":{"magnitude":1,"ratio":16}},
    {"left":{"magnitude":2,"ratio":1},"right":{"magnitude":1,"ratio":8}},
    {"left":{"magnitude":2,"ratio":16},"right":{"magnitude":5,"ratio":8}},
    {"left":{"magnitude":1,"ratio":16},"right":{"magnitude":5,"ratio":1}},
    {"left":{"magnitude":1,"ratio":1},"right":{"magnitude":5,"ratio":8}},
    {"left":{"magnitude":1,"ratio":8},"right":{"magnitude":2,"ratio":1}},
    {"left":{"magnitude":5,"ratio":16},"right":{"magnitude":2,"ratio":1}},
    {"left":{"magnitude":2,"ratio":8},"right":{"magnitude":1,"ratio":16}},
    {"left":{"magnitude":5,"ratio":8},"right":{"magnitude":2,"ratio":16}}];


// Unique values for magnitudes and ratios
const uniqueMagnitudes = [...new Set(POST_VIGOUR_PAIRS.flatMap(pair => [pair.left.magnitude, pair.right.magnitude]))].sort((a, b) => a - b);
const uniqueRatios = [...new Set(POST_VIGOUR_PAIRS.flatMap(pair => [pair.left.ratio, pair.right.ratio]))].sort((a, b) => b - a); // Descending


// Function to generate stimulus HTML for comparison task
function generateComparisonStimulus(left, right) {
  return `
    <div class="experiment-wrapper">
      <div id="experiment-container">
        <div id="piggy-container-left">
          ${generatePiggyHTML(left.magnitude, left.ratio, 'left')}
        </div>
        <div id="piggy-container-right">
          ${generatePiggyHTML(right.magnitude, right.ratio, 'right')}
        </div>
      </div>
    </div>
  `;
}

// Function to generate HTML for a single piggy bank
function generatePiggyHTML(magnitude, ratio, side) {
  const ratio_index = uniqueRatios.indexOf(ratio);
  const ratio_factor = ratio_index / (uniqueRatios.length - 1);
  const piggy_style = `filter: saturate(${50 * (400 / 50) ** ratio_factor}%) brightness(${115 * (90/115) ** ratio_factor}%);`;

  return `
      <img id="piggy-bank-${side}" src="./assets/images/piggy-banks/piggy-bank.png" alt="Piggy Bank" style="${piggy_style}">
  `;
}


// Function to generate HTML for piggy tails
function updateDualPiggyTails(magnitude, ratio, side) {
  const piggyContainer = document.getElementById(`piggy-container-${side}`);
  const piggyBank = document.getElementById(`piggy-bank-${side}`);

  const magnitude_index = uniqueMagnitudes.indexOf(magnitude);
  const ratio_index = uniqueRatios.indexOf(ratio);
  // Calculate saturation based on ratio
  const ratio_factor = ratio_index / (uniqueRatios.length - 1);

  // Remove existing tails
  document.querySelectorAll('.piggy-tail').forEach(tail => tail.remove());

  // Wait for the piggy bank image to load
  piggyBank.onload = () => {
    const piggyBankWidth = piggyBank.offsetWidth;
    const tailWidth = piggyBankWidth * 0.1; // Adjust this factor as needed
    const spacing = tailWidth * 0; // Adjust spacing between tails
    for (let i = 0; i < magnitude_index + 1; i++) {
      const tail = document.createElement('img');
      tail.src = './assets/images/piggy-banks/piggy-tail2.png';
      tail.alt = 'Piggy Tail';
      tail.className = 'piggy-tail';

      // Position each tail
      tail.style.left = `calc(50% + ${piggyBankWidth / 2 + (tailWidth + spacing) * i}px - ${tailWidth / 20}px)`;
      tail.style.width = `${tailWidth}px`;
      tail.style.filter = `saturate(${50 * (400 / 50) ** ratio_factor}%) brightness(${115 * (90/115) ** ratio_factor}%)`;

      piggyContainer.appendChild(tail);
    }
  };

  // Trigger onload if the image is already cached
  if (piggyBank.complete) {
    piggyBank.onload();
  }
}


// Comparison trial
let testTapListeners = [];

const postVigourTrial = {
  type: jsPsychHtmlKeyboardResponse,
  stimulus: function () {
    const pair = jsPsych.evaluateTimelineVariable('pair');
    return generateComparisonStimulus(pair.left, pair.right);
  },
  // Chosen by tapping a piggy bank; the arrow keys this used to read are not on
  // the study tablet, and the piggy banks were never tappable.
  choices: 'NO_KEYS',
  data: function () {
    const pair = jsPsych.evaluateTimelineVariable('pair');
    return {
      trialphase: 'vigour_test',
      left_magnitude: pair.left.magnitude,
      left_ratio: pair.left.ratio,
      right_magnitude: pair.right.magnitude,
      right_ratio: pair.right.ratio
    };
  },
  on_load: function () {
    const pair = jsPsych.evaluateTimelineVariable('pair');
    updateDualPiggyTails(pair.left.magnitude, pair.left.ratio, "left");
    updateDualPiggyTails(pair.right.magnitude, pair.right.ratio, "right");

    const trialStartTime = performance.now();
    let answered = false;

    // 'ArrowLeft'/'ArrowRight' are kept as the recorded response values so the
    // stored data and on_finish below are unchanged by the move to tapping.
    const choose = (side, event) => {
      if (answered) return;
      answered = true;
      jsPsych.finishTrial({
        response: side === 'left' ? 'ArrowLeft' : 'ArrowRight',
        rt: Math.round(performance.now() - trialStartTime),
        pointer_type: event?.pointerType || 'unknown'
      });
    };

    testTapListeners = ['left', 'right'].map((side) => setupTapListener(
      document.getElementById(`piggy-container-${side}`),
      (event) => choose(side, event)
    ));

    if (window.simulating) {
      const side = jsPsych.randomization.sampleWithoutReplacement(['left', 'right'], 1)[0];
      simulateTap(document.getElementById(`piggy-container-${side}`), 100);
    }
  },
  on_finish: function (data) {
    testTapListeners.forEach(cleanupTapListener);
    testTapListeners = [];
    const pair = jsPsych.evaluateTimelineVariable('pair');
    if (data.response === 'ArrowLeft') {
      data.chosen_magnitude = pair.left.magnitude;
      data.chosen_ratio = pair.left.ratio;
    } else if (data.response === 'ArrowRight') {
      data.chosen_magnitude = pair.right.magnitude;
      data.chosen_ratio = pair.right.ratio;
    }
    const n_trials = jsPsych.data.get().filter({ trialphase: "vigour_test" }).count()
    if (n_trials % 9 == 0) {
      saveDataREDCap();
    }
  },
  post_trial_gap: 400
};

// Instructions for comparison task
const postVigourInstructions = {
  type: jsPsychHtmlButtonResponse,
  css_classes: ['instructions'],
  stimulus: () => `
    <p><strong>You will now see two piggy banks at a time. You have seen them all before.</strong></p>
    <p><span class="highlight-txt">Pick the one you would rather play with next time.</span></p>
    <p>${pressVerb(true)} the piggy bank you choose.</p>
  `,
  choices: ["I'm ready"],
  simulation_options: { data: { response: 0 } },
  post_trial_gap: 400,
  on_start: () => {
    updateState(`vigour_test_instructions_start`);
  },
  on_finish: () => {
    updateState(`vigour_test_task_start`);
  }
};

export function createVigourTestTimeline(settings) {
  const postVigourTrials = [];
  POST_VIGOUR_PAIRS.forEach(pair => {
    postVigourTrials.push({
      timeline: [kickOut(settings), fullscreen_prompt, postVigourTrial],
      timeline_variables: [{ pair: pair }]
    });
  });

  return [postVigourInstructions, ...postVigourTrials];
}

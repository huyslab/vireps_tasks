// The orientation gate applies to every touch device in the wrong orientation, with no
// viewport-size condition - see expectedGate() in support/helpers.js. Phone vs tablet only
// changes the wording of the hint screen (api/utils.js), not whether the gate fires.

export const TASKS = {
  // readySelector must uniquely match the real per-trial stimulus - both tasks reuse markup
  // across instructions/ready/trial screens, so each selector below adds whatever DOM feature
  // only the real trial has (vigour: excludes the instructions wrapper; reversal: requires the
  // coin divs). Keep this in mind if a future task's readySelector needs the same treatment.
  vigour: {
    url: '/examples/vigour.html',
    preferredOrientation: 'portrait',
    rotateMessageSelector: '.rotate-msg-portrait',
    // #piggy-container also appears in the instructions demo (generateInstructStimulus)
    // and the "tap to begin" confirmation screen (startConfirmation) - both wrap it in
    // #instruction-container, which the real per-trial stimulus (generateTrialStimulus)
    // never has. Excluding that is required to land on the actual trial, not instructions.
    readySelector: '.experiment-wrapper:not(:has(#instruction-container)) #piggy-container',
  },
  // Both card-choosing entries below differ from vigour/reversal in one respect worth
  // knowing: the PILT/WM instruction sequences build REAL plugin trials for their practice
  // rounds (instructions.js -> buildCardChoosingTask), so #cardChoosingOptionBox legitimately
  // appears during instructions too. Unlike vigour's instructions demo, those are genuine
  // renders of the same plugin under test, so landing on one is a valid check rather than a
  // false match - no extra qualifier is needed to exclude them.
  PILT: {
    url: '/examples/PILT.html',
    preferredOrientation: 'landscape',
    rotateMessageSelector: '.rotate-msg-landscape',
    readySelector: '#cardChoosingOptionBox',
  },
  WM: {
    url: '/examples/WM.html',
    preferredOrientation: 'landscape',
    rotateMessageSelector: '.rotate-msg-landscape',
    readySelector: '#cardChoosingOptionBox',
  },
  // Used by the journey check only (not the rendering matrix): it reaches a real two-card
  // trial after a single instructions page, where PILT's own path runs through practice
  // rounds and a comprehension quiz first. Same plugin, same tap targets.
  postPILTtest: {
    url: '/examples/post-PILT-test.html',
    preferredOrientation: 'landscape',
    rotateMessageSelector: '.rotate-msg-landscape',
    readySelector: '#cardChoosingOptionBox',
  },
  go_no_go: {
    url: '/examples/go-no-go.html',
    preferredOrientation: 'landscape',
    rotateMessageSelector: '.rotate-msg-landscape',
    // The face is the whole stimulus and is present for the entire response
    // window, so no disambiguating qualifier is needed here.
    readySelector: '#gng-stimulus',
  },
  reversal: {
    url: '/examples/reversal.html',
    preferredOrientation: 'landscape',
    rotateMessageSelector: '.rotate-msg-landscape',
    // .reversal-stimuli also appears in the touch "tap either squirrel to begin" ready
    // screen (task.js touchReadyTrial re-uses the same squirrel markup) - only the real
    // per-trial stimulus (plugin-reversal.js create_stimuli) additionally renders the coin
    // divs, so requiring one of those is what actually pins this to a real trial.
    readySelector: '.reversal-stimuli:has(#rev-coin-left)',
  },
};

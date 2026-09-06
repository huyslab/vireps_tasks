# RELMED Task Battery

## Overview
This repository provides easy to customize code for the RELMED task battery. It offers a
standardized interface for creating and combining experimental timelines, so complete
experiments can be built from individual task components. It is built on jsPsych and
follows a modular architecture that promotes reuse and consistency across paradigms.

Tasks are increasingly touch-first: several now accept taps as well as keypresses, and
declare a preferred device orientation. See [Input modality and devices](#input-modality-and-devices).

## Available Tasks

Fifteen tasks are registered in `api/task-registry.js`. Registry keys are what
`createTaskTimeline()` and the launcher take.

### Card choosing (`tasks/card-choosing/`)
- **`PILT`** — Probabilistic Instrumental Learning Task: two-card probabilistic learning
- **`WM`** — Anne Collins's RLWM task: one card, three responses
- **`post_PILT_test`** / **`post_WM_test`** — extinction test phases after each

### Piggy banks (`tasks/piggy-banks/`)
- **`vigour`** — action vigour as a function of reward rate
- **`PIT`** — Pavlovian-Instrumental Transfer: vigour in extinction under Pavlovian cues
- **`vigour_test`** — knowledge test of the stimulus–reward contingencies

### Learning with faces (`tasks/go-no-go/`)
- **`go_no_go`** — orthogonalised go/no-go: 2 (win / avoid loss) × 2 (go / no-go) ×
  2 (positive / negative face affect). See `tasks/go-no-go/README.md`; **its face
  images are not in this repository** and must be generated before use.

### Other
- **`reversal`** — probabilistic reversal learning, two-squirrel cover story
- **`control`** — control-, information- and reward-seeking
- **`delay_discounting`** — smaller-sooner vs larger-later preferences
- **`max_press_test`** — maximum key-press speed, calibrates the effort tasks
- **`pavlovian_lottery`** — conditioning cue–reward associations
- **`open_text`** — open-ended text responses
- **`acceptability_judgment`** — post-task acceptability ratings

Two modules in `api/module-registry.js` combine these into sittings:
`full_battery` and `screening`.

## Input modality and devices

The battery is being moved from keyboard-only to touch. Tasks converted so far
accept a tap **and** keep the keyboard path, deciding at runtime on
`navigator.maxTouchPoints > 0`:

| Task | Touch input |
|---|---|
| `vigour` | tap the piggy bank |
| `reversal` | tap either squirrel |
| `PILT`, `WM`, `post_*_test` | tap a card; WM taps one of three response buttons |
| `go_no_go` | tap the face |

Not yet converted, and keyboard-only: `PIT`, `control`, `max_press_test`,
`pavlovian_lottery`, `vigour_test`. `delay_discounting`, `open_text` and
`acceptability_judgment` were already button- or form-based and work on touch.

Tasks may declare `preferredOrientation`. On a touch device held the wrong way a
rotate overlay blocks the task until it is turned; desktop is exempt. The overlay
markup lives in the entry HTML and is driven by
`<body data-preferred-orientation>`, set per task by `api/utils.js`.

Per-trial `pointer_type` is recorded wherever a task accepts both, so touch and
keyboard sessions can be told apart in analysis.

## Enrol a data-collection device

Only enrolled browsers save experiment data to REDCap. An unenrolled browser can still run
the experiment, but it runs in demo mode and does not save data. Enrol the same browser
profile that will be used for data collection; private/incognito windows do not retain the
device identity.

First deploy the current [REDCap relay](infrastructure/README.md) and this website. Then,
from the repository root, sign in to the UCL AWS account and install the administrator
dependencies (installation is needed only once):

```bash
aws sso login --profile ucl-sso

cd infrastructure/redcap-relay
python3 -m pip install -r requirements-admin.txt

export AWS_PROFILE=ucl-sso
export AWS_DEFAULT_REGION=eu-north-1
export DEVICE_AUTH_TABLE=$(aws cloudformation describe-stacks \
  --stack-name vireps-redcap-relay \
  --query 'Stacks[0].Outputs[?OutputKey==`DeviceAuthTableName`].OutputValue | [0]' \
  --output text)
```

Generate a single-use code for the device. Codes expire after 15 minutes by default:

```bash
python3 manage_devices.py create-enrollment \
  --label "Tablet 1" \
  --enrollment-page-url "https://huyslab.github.io/vireps_tasks/device-enrollment.html"
```

The command prints a QR code and a 12-character fallback code. On the device:

1. Scan the QR code and open it in the browser that will run the experiments.
2. Tap **Approve device**.
3. Tap **Start data collection** to open the
   [task launcher](https://huyslab.github.io/vireps_tasks/).

If QR scanning is unavailable, open the
[device-enrollment page](https://huyslab.github.io/vireps_tasks/device-enrollment.html) and
type the fallback code. Hyphens, spaces and letter case do not matter. Clearing the site's
browser data removes its device identity, in which case it must be enrolled again.

List enrolled devices or revoke one with:

```bash
python3 manage_devices.py list
python3 manage_devices.py revoke <device-id>
```

See the [relay documentation](infrastructure/redcap-relay/README.md#enrol-a-tablet) for
more detail about enrollment security, expiry and revocation.

## Repository Structure

```
vireps_tasks/
├── index.html                   # Launcher: participant id + task, redirects to experiment.html
├── experiment.html              # Single-task entry used in the field
├── api/                         # Task registry and unified interface
│   ├── index.js                 # Main API entry point
│   ├── task-registry.js         # Task definitions, defaults and config documentation
│   ├── module-registry.js       # Module definitions for multi-task sittings
│   ├── messages.js              # Instruction messages for modules
│   └── utils.js                 # createTaskTimeline, CSS/sequence loading, orientation gate
├── tasks/                       # One directory per task family
│   ├── card-choosing/           # PILT, WM and their test phases
│   ├── control/                 # Control task
│   ├── delay-discounting/
│   ├── go-no-go/                # Faces go/no-go (see its own README)
│   ├── max-press-test/
│   ├── open-text/
│   ├── pavlovian-lottery/
│   ├── acceptability-judgment/  # Post-task acceptability ratings
│   ├── piggy-banks/             # Vigour and PIT
│   └── reversal/
├── core/
│   ├── utils/                   # Shared helpers: data handling, validation, quiz, setup
│   └── jspsych/                 # jsPsych library and plugins
├── assets/
│   ├── images/                  # Task images
│   └── sounds/                  # Task audio
├── examples/                    # One runnable HTML page per task
└── validation/playwright/       # Device-matrix rendering, journey and data-invariant tests
```

## How to Build an Experiment

### Creating Experiments is Simple

**If you don't need to modify task behavior**, creating an experiment is straightforward - you just need to write an HTML file that loads the required dependencies and calls the API functions. The framework handles all the task logic, timing, and data collection automatically.

**You have two main approaches:**
1. **Individual Tasks**: Build experiments by combining individual tasks using `createTaskTimeline()`
2. **Modules**: Use collections of tasks using `createModuleTimeline()` 

### Approach 1: Individual Tasks

This approach gives you maximum flexibility to customize which tasks to include and their order.

#### Steps to Create an HTML Experiment File

1. **Set up HTML structure**: Create a basic HTML page with a display element for jsPsych

2. **Load dependencies in the `<head>`**:
   - jsPsych core library (`jspsych.js`)
   - Required jsPsych plugins (varies by task)
   - Task-specific plugin files (check task requirements)
   - Core utilities as ES6 modules
   - CSS files (jsPsych core + task-specific styles)

3. **Initialize jsPsych** with display settings and completion handlers

4. **Create experiment logic**:
   - Import API functions (`createTaskTimeline`, `getTaskInfo`, etc.)
   - Use `createTaskTimeline()` to generate task timelines with optional configuration
   - Combine multiple tasks by concatenating their timelines
   - Add experiment entry/exit (fullscreen, etc.)

5. **Run the experiment** using `jsPsych.run()`

#### Single vs Multiple Tasks

- **Single Task**: Call `createTaskTimeline()` once with your desired configuration
- **Multiple Tasks**: Call `createTaskTimeline()` for each task and combine the resulting arrays into one timeline
- **Task Order**: Simply arrange the timeline arrays in the order you want tasks to appear

### Approach 2: Predefined Modules

Modules are predefined collections of tasks designed to be completed in a single session. They include task sequencing, instruction messages, and standardized configurations.

#### Available Modules

- **`full_battery`**: Complete RELMED task battery with all tasks and questionnaires
- **`screening`**: Shortened version for participant screening with key tasks

#### Using Modules

```javascript
// Import module functions
import { createModuleTimeline, getModuleInfo, listModules } from '/api/index.js';

// Get information about available modules
console.log(listModules()); // ['full_battery', 'screening']
console.log(getModuleInfo('screening')); // Detailed module information

// Create timeline for a module
const timeline = await createModuleTimeline('screening', {
    session: 'screening',
    sequence: 'screening'
});

// Run the experiment
await jsPsych.run([enterExperiment, ...timeline, exitFullscreen]);
```

#### Module Configuration

Modules support three levels of configuration (in order of precedence):
1. **Module-level config**: Applied to all tasks in the module
2. **Element-level config**: Applied to specific tasks within the module 
3. **Runtime config**: Passed to `createModuleTimeline()`, overrides all others

```javascript
// Module definition example (from module-registry.js)
{
    name: "Screening Module",
    moduleConfig: {           // Applied to all tasks
        session: "screening",
        sequence: "screening"
    },
    elements: [
        { type: "task", name: "PILT", config: { present_pavlovian: false } }, // Task-specific config
        { type: "instructions", config: { text: "start_message" } }
    ]
}

// Runtime configuration overrides everything
const timeline = await createModuleTimeline('screening', {
    session: 'custom_session'  // This will override moduleConfig.session
});
```

#### Creating Custom Modules

You can define your own modules in `api/module-registry.js`:

```javascript
export const ModuleRegistry = {
    my_custom_module: {
        name: "My Custom Module",
        moduleConfig: {
            session: "custom",
            sequence: "wk0"
        },
        elements: [
            { type: "instructions", config: { text: "start_message" } },
            { type: "task", name: "PILT" },
            { type: "task", name: "control", config: { max_instruction_fails: 5 } },
            { type: "task", name: "open_text" },
            { type: "instructions", config: { text: "end_message" } }
        ]
    }
};
```

### Required Files and Dependencies

**For every experiment, you must include:**

1. **jsPsych core files**: Always load `jspsych.js` and required plugins
2. **Core utilities**: Load `/core/utils/index.js` as a module
3. **Task-specific files**: Check each task's requirements in the task registry
4. **CSS files**: Include `jspsych.css` and task-specific stylesheets

**Task-specific requirements** (check `api/task-registry.js` for complete details):
- **PILT/WM**: Requires `plugin-card-choosing.js` and `styles.css`
- **Control**: Requires multiple control plugins and `styles.css`
- **Vigour/PIT**: Requires piggy-banks plugins and `styles.css`
- **Delay Discounting**: Requires only core plugins and `styles.css`

### Task Configuration

Each task accepts a configuration object to customize behavior. If you don't need to change anything, you can use the default settings by passing an empty object `{}` or omitting the configuration entirely.

**Example configurations for different tasks:**

```javascript
// PILT with custom settings
const piltConfig = {
    task_name: "pilt",
    n_choices: 2,
    valence: "mixed",           // "mixed", "reward", "punishment", "both"
    present_pavlovian: true,
    sequence: 'wk0',
    include_instructions: true
};

// Control task with custom timing
const controlConfig = {
    session: "wk0",
    max_instruction_fails: 3,
    default_response_deadline: 4000,
    long_response_deadline: 6000
};

// Delay discounting with default settings (just pass empty object)
const ddConfig = {};
```

### Getting Task Information

Use `getTaskInfo()` to explore available configuration options:

```javascript
const taskInfo = getTaskInfo('PILT');
console.log(taskInfo.configOptions);  // Shows all available config options
console.log(taskInfo.defaultConfig);  // Shows default values
```

## API Reference

### Core Functions

#### Individual Tasks
- `createTaskTimeline(taskName, config)` - Creates a timeline for the specified task
- `getTaskInfo(taskName)` - Returns task information including configuration options
- `listTasks()` - Returns array of all available task names
- `getTask(taskName)` - Returns the complete task object from registry

#### Modules (Multi-Task Collections)
- `createModuleTimeline(moduleName, config)` - Creates a timeline for an entire module
- `getModuleInfo(moduleName)` - Returns module information including task sequence
- `listModules()` - Returns array of all available module names
- `getModule(moduleName)` - Returns the complete module object from registry

#### Messages and Instructions
- `getMessage(moduleName, messageKey, settings)` - Retrieves instruction messages for modules

### Utility Functions

- `enterExperiment` - Standard fullscreen entry point for experiments
- Various bonus calculation, data handling, and resumption utilities in `/core/utils/`

### Task Names

Use these exact strings when calling `createTaskTimeline()`:
- `'PILT'`, `'WM'`, `'post_learning_test'`, `'post_PILT_test'`, `'post_WM_test'`
- `'delay_discounting'`, `'vigour'`, `'vigour_test'`, `'PIT'` 
- `'control'`, `'max_press_test'`, `'pavlovian_lottery'`, `'open_text'`
- `'reversal'`, `'acceptability_judgment'`

### Module Names

Use these exact strings when calling `createModuleTimeline()`:
- `'full_battery'` - Complete RELMED task battery 
- `'screening'` - Shortened screening version

## Examples

Complete working examples are available in the `examples/` folder:

### Individual Task Examples
- `PILT.html` - Card choosing learning task
- `control.html` - Control-seeking task  
- `delay-discounting.html` - Intertemporal choice task
- `vigour.html` - Action vigour task
- And more...

Each example demonstrates proper file loading, API usage, and task configuration for that specific task type.

### Module Example
- `experiment.html` - Complete module-based experiment using `createModuleTimeline()`

This example shows how to:
- Load all required dependencies for multiple tasks
- Use URL parameters to select modules (`full_battery` vs `screening`)
- Handle module configuration and timeline creation
- Support simulation mode for testing

**Key features demonstrated:**
```javascript
// Module selection based on URL parameter
const module_name = session == "screening" ? 'screening' : 'full_battery';

// Module timeline creation
const timeline = await createModuleTimeline(module_name, settings);

// Complete experiment structure
const fullTimeline = [
    enterExperiment,
    ...timeline,
    exitFullscreen
];
```

## Testing

Cross-device checks live under `validation/playwright/`, in three parts:

- **Rendering matrix** (`*-rendering.spec.js`, `support/render-check.js`): runs each
  covered task from its `examples/` page under jsPsych's simulate mode across all 21
  device projects — common phones, tablets and desktop browsers — asserting it renders
  (no console errors, nothing collapsed or overflowing, the rotate gate showing only
  where expected). Covers vigour, reversal, PILT, WM and go/no-go.
- **Journey checks** (`*-journey.spec.js`, `support/journey-check.js`): a real,
  non-simulate run — actual clicks, taps and keypresses through the instructions — on a
  curated subset of 5 devices, reaching checkpoints simulate mode auto-advances past.
  These are slow by design and carry their own longer timeout.
- **Data invariants** (`data-*.spec.js`, plus `go-no-go-audio.spec.js`), on one
  desktop project: properties that are engine- and viewport-independent, such as the
  go/no-go stimulus manifest's balance guarantees, and that per-trial data columns are
  not clobbered by entry-time device logging.

Both of the first two save a screenshot per device/checkpoint to
`validation/playwright/screenshots/`.

```bash
npm install
npx playwright install        # first time only, downloads browser binaries
npm run test:e2e              # everything
npm run test:e2e:report       # last run's HTML report, including screenshots
```

Run a subset with `npx playwright test --project="iPhone 14"`,
`--project="iPhone 14 (journey)"` or `--project="data invariants"` (see
`playwright.config.js` for the device list).

Two things worth knowing before trusting a red run:

- The static server is `python3 -m http.server`. Under full parallelism it can be
  starved, and the failure surfaces as an unrelated task timing out. If something fails
  only in a full run, re-run it alone or with `--workers=4` before believing it.
- The go/no-go rendering test passes `skip_instructions=1`, because its instructions and
  practice take ~20 s to auto-advance under simulate. Its journey deliberately walks
  them instead.

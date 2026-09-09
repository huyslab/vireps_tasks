# Max Press Test Task

## Overview
The max press test task is a simple motor calibration tool that measures participants' maximum tapping rate. Participants repeatedly tap an on-screen pad as fast as possible for a fixed duration while receiving real-time feedback on their speed. It calibrates the effort tasks that follow: vigour and PIT are driven by tapping the piggy bank, so the baseline is measured with the same action. It previously read the 'J' key, which the study tablet does not have.

## File Structure

### Core Files

#### `index.js`
**Purpose**: Main entry point that centralizes all exports from the task module.
- Re-exports all functions from `task.js`
- Provides a single import point for accessing max press test functionality
- Maintains consistency with other task modules despite being a simple single-file task

#### `task.js`
**Purpose**: Contains all task logic, trial construction, and timeline management functions.

**Main Export Functions**:
- **`createMaxPressTimeline(settings)`**: Creates the complete timeline for the max press test
  - Handles instructions, main test trial, retake logic, and feedback
  - Returns array of jsPsych trial objects for the full assessment sequence

**Core Trial Functions**:
- **`maxPressRateTrial(settings)`**: Creates the main tapping trial
  - Implements press counting and speed calculation
  - Displays live feedback with progress bar and timer
  - Records detailed response time data and performance metrics
  - Handles first-tap trigger to start timing and countdown

**Instruction and Feedback Functions**:
- **`maxPressInstructions`**: Initial instruction screen with visual demonstration
  - Describes the tap pad shown on the next screen
  - Explains the task requirements clearly
  
- **`maxPressFeedback`**: Post-test feedback displaying performance results
  - Shows average pressing speed achieved
  - Provides positive reinforcement for task completion
  
- **`maxPressRetakeMessage(settings)`**: Conditional retake prompt for low performance
  - Displays current performance and explains retake rationale
  - Only shown if performance falls below minimum threshold

**Loop and Control Functions**:
- **`maxPressRetakeLoop(settings)`**: Manages retake logic and performance validation
  - Allows up to 2 attempts if performance is below minimum speed
  - Automatically proceeds once acceptable performance is achieved
  - Updates experiment state markers for data tracking

**Utility Functions**:
- **`getDifferences(array)`**: Calculates inter-press intervals from response time array
  - Converts absolute response times to relative intervals
  - Used for analyzing pressing rhythm and consistency

#### `styles.css`
**Purpose**: CSS styling for the max press test interface.
- Defines styling for the circular tap pad (`#max-press-pad`)
- Styles for highlighted text and important instructions
- Maintains visual consistency with other tasks in the battery
- Ensures clear readability of performance feedback elements

## Task Design

### Assessment Protocol
- **Duration**: Configurable test duration (typically 10 seconds)
- **Target**: A circular on-screen pad, sized well past the shared minimum tap target
- **Trigger**: First tap starts the countdown timer
- **Feedback**: Real-time display of press count, speed, and progress bar

### Performance Metrics
- **Press Count**: Total number of valid taps minus the initial trigger tap
- **Average Speed**: Presses per second over the test duration
- **Response Times**: Array of inter-press intervals for rhythm analysis
- **Progress Visualization**: Live speed bar showing performance relative to target

### Quality Control
- **Minimum Speed Threshold**: Configurable minimum performance requirement
- **Retake Logic**: Up to 2 attempts allowed if initial performance is insufficient
- **Multi-touch protection**: Secondary touches are ignored, so a second finger cannot inflate the count
- **Minimum Response Time**: 10ms minimum to filter out mechanical bouncing

### Real-time Feedback System
- **Live Counter**: Shows current press count
- **Speed Display**: Updates pressing rate in real-time (presses/sec)
- **Progress Bar**: Visual indicator scaling to maximum expected speed
- **Countdown Timer**: Shows remaining time with 0.1s precision

## Usage Example

```javascript
import { createMaxPressTimeline } from './tasks/max-press-test/index.js';

// Create max press test timeline
const settings = {
  duration: 10000,         // Test duration in milliseconds
  minSpeed: 2.0           // Minimum acceptable speed (presses/sec)
};

const maxPressTimeline = createMaxPressTimeline(settings);

// Add to jsPsych experiment
jsPsych.run(maxPressTimeline);
```

## Settings Configuration

### Required Parameters
- **`duration`**: Test duration in milliseconds (number)
- **`minSpeed`**: Minimum acceptable pressing speed in presses/second (number)

### Example Settings
```javascript
const defaultSettings = {
  duration: 10000,    // 10 seconds
  minSpeed: 2.0       // 2 presses/second minimum
};
```

## Dependencies
- Core utilities from `/core/utils/index.js`
- jsPsych framework and plugins (html-keyboard-response, html-button-response)
- `core/utils/touch.js` for the shared tap listener and device-matched wording
- Custom CSS styling for consistent visual presentation

## Data Output
The task records comprehensive performance data including:
- **Primary metrics**: Total presses, average speed (presses/sec)
- **Temporal data**: Array of inter-press intervals (responseTime)
- **Trial information**: Phase markers, attempt numbers, completion status
- **Quality indicators**: Whether retakes were required, final performance level

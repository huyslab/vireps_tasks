
/**
 * RELMED Task Battery - Messages Module
 * 
 * This module contains standardized messages and instructions displayed to participants
 * during different phases of the RELMED experiment sessions. It includes:
 * 
 * - Start and end messages for different session types (full_battery, screening)
 * - Formatted warning messages for response timeouts
 * - Dynamic content based on session settings (e.g., week 0 vs other weeks)
 * 
 * The messages support HTML formatting and can include optional fields passed on to the jsPsych instructions trial object.
 */

import { endExperiment } from '@utils/index.js';

// The example of the "we didn't catch that" message, shown in the opening instructions so
// the real one is recognised when it appears mid-task. Same class as the live toast the
// tasks raise (core/styles/theme.css), so the example cannot drift from the real thing.
const formatted_warning_msg = `
    <div id='vigour-warning-temp' class='rlm-toast rlm-toast-inline'>Didn't catch a response - moving on</div>
`;


export const messages = {
    module_1: {
        start_message: [
            `<p><b>Welcome to Module 1.</b></p>
            <p>In this module, you will complete the squirrel game and the people game.</p>
            <p>After each game, we will ask a few short questions about your experience of it.</p>`,
            `<p>The games are designed to measure quick, intuitive decisions, so please respond as promptly and accurately as you can. Making mistakes while you learn is completely expected.</p>
            <p>The experimenter is in the room. Please ask them if you need help at any point.</p>`
        ],
        end_message: {
            message: `<p><b>You have completed Module 1.</b></p>
                <p>Please call the experimenter.</p>
                <p>They will tell you when Module 2 will begin. This may be after a break today or on another day.</p>`,
            on_start: endExperiment
        }
    },
    module_2: {
        start_message: [
            `<p><b>Welcome to Module 2.</b></p>
            <p>This module contains a series of linked learning and effort tasks, followed by short tests of what you learned.</p>
            <p>After each task, we will ask a few short questions about your experience of it.</p>`,
            `<p>Please stay with the tasks until the end, and do not close this page.</p>
            <p>There are two short breaks along the way. If you need to stop at any other point, just ask.</p>
            <p>The experimenter is in the room. Please ask them if you need help at any point.</p>`
        ],
        end_message: {
            message: `<p><b>You have completed Module 2.</b></p>
                <p>Thank you for taking part. Please call the experimenter.</p>`,
            on_start: endExperiment
        },
        // Module 2 is the long one - seven tasks and seven sets of questions - and had
        // no pause anywhere in it. Deliberately NOT the full_battery break_message,
        // which advances on the 'c' key with its clickable nav switched off and so
        // cannot be dismissed on the study tablet at all.
        break_message: {
            message: `<p><b>Take a short break.</b></p>
                <p>Sit back for a moment. There is no rush.</p>
                <p>When you are ready, tap <b>Continue</b>.</p>
                <p>If you would like a longer break, ask the person running the study.</p>`,
            button_label_next: 'Continue',
            allow_backward: false
        }
    },
    questionnaires: {
        start_message: [
            `<p><b>Questionnaires</b></p>
            <p>Please follow the instructions shown before each questionnaire.</p>
            <p>The experimenter is in the room. Please ask them if you need help at any point.</p>`
        ],
        end_message: {
            message: `<p><b>You have completed the questionnaires.</b></p>
                <p>Please call the experimenter.</p>`,
            on_start: endExperiment
        }
    },
    full_battery: {
        start_message: (settings) => { 
            return [`<p><b>Thank you for taking part in this session!</b></p>
                <p>The purpose of this session is to examine how people learn from positive and negative feedback while playing games.</p>
                <p>You will play a few simple trial-and-error learning games. Your goal in each game is to win as many coins as possible.</p>
                <p>The games may feel a bit fast-paced because we're interested in your quick, intuitive decisions. Since they're designed around learning from experience, making mistakes is completely expected. Over time, you'll figure out better choices and improve your performance.</p>
                ` + (settings.session === "wk0" ?  `<b>Please read the instructions carefully. They may differ from the training session.</b>` : ""),
                `
                <p>If at some point you are taking too long to respond, you might see a message like this:</p><br>
                ${formatted_warning_msg}
                <br><p>It is perfectly natural to take a bit longer when you are learning something new. However, if you see this message a few times, it may be a sign that you are overthinking your choices.</p>
                <p>If at any point you feel like you need some assistance, you can find our contact details by pressing the question mark in the top right corner. We are happy to help.</p>`
            ];
        },
        end_message: {
            message: `<p>Thank you for completing this session!</p>
                <p>Please call the experimenter.</p>`,
            on_start: endExperiment
        },
        break_message: {
            message: `<p>You can now take a short break.</p><p>Please ring the bell when you are ready to continue.</p>`,
            key_forward: 'c',
            show_clickable_nav: false
        }
    },
    screening: {
        start_message: [
            `<p><b>Welcome to the first RELMED training session!</b></p>
            <p>Over the next twenty minutes, you will try out the main tasks comprising the home assessments in the RELMED study.
            <p>You will start by playing a few simple trial-and-error learning games. Your goal in each game is to win as many coins as possible.</p>
            <p>The games may feel a bit fast-paced because we're interested in your quick, intuitive decisions. Since they're designed around learning from experience, making mistakes is completely expected. Over time, you'll figure out better choices and improve your performance.</p>
            `,
            `
            <p>If at some point you are taking too long to respond, you might see a message like this:</p><br>
            ${formatted_warning_msg}
            <br><p>It is perfectly natural to take a bit longer when you are learning something new. However, if you see this message a few times, it may be a sign that you are overthinking your choices.</p>
            <p>If at any point you feel like you need some assistance, you can find our contact details by pressing the question mark in the top right corner. We are happy to help.</p>`
        ],
        end_message:  {
            message: 
                `<p>Thank you for completing this module!</p>
                <p>When you click next, your data will be uploaded to the secure server. This may take up to two minutes. Please don't close or refresh your browser at this time.</p>`,
            on_finish: endExperiment
        }
    }
}

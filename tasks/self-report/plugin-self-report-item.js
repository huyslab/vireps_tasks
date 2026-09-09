var jsPsychSelfReportItem = (function (jspsych) {
    "use strict";

    const info = {
        name: "self-report-item",
        version: "0.1.0",
        parameters: {
            question_type: { type: jspsych.ParameterType.STRING, default: "likert" },
            questionnaire: { type: jspsych.ParameterType.STRING, default: "" },
            context: { type: jspsych.ParameterType.HTML_STRING, default: "" },
            prompt: { type: jspsych.ParameterType.HTML_STRING, default: undefined },
            item_id: { type: jspsych.ParameterType.STRING, default: null },
            item_index: { type: jspsych.ParameterType.INT, default: null },
            n_items: { type: jspsych.ParameterType.INT, default: null },
            progress_label: { type: jspsych.ParameterType.STRING, default: "" },
            options: {
                type: jspsych.ParameterType.COMPLEX,
                array: true,
                default: [],
                nested: {
                    label: { type: jspsych.ParameterType.STRING, default: undefined },
                    value: { type: jspsych.ParameterType.INT, default: undefined }
                }
            },
            button_label: { type: jspsych.ParameterType.STRING, default: "Continue" },
            transition_duration: { type: jspsych.ParameterType.INT, default: 250 },
            input_mode: { type: jspsych.ParameterType.STRING, default: "auto" }
        },
        data: {
            questionnaire: { type: jspsych.ParameterType.STRING },
            item_id: { type: jspsych.ParameterType.STRING },
            item_index: { type: jspsych.ParameterType.INT },
            item_text: { type: jspsych.ParameterType.STRING },
            response: { type: jspsych.ParameterType.INT },
            response_label: { type: jspsych.ParameterType.STRING },
            input_mode: { type: jspsych.ParameterType.STRING },
            rt: { type: jspsych.ParameterType.INT }
        }
    };

    class SelfReportItemPlugin {
        constructor(jsPsych) {
            this.jsPsych = jsPsych;
        }

        trial(displayElement, trial) {
            const duration = window.simulating ? 0 : trial.transition_duration;
            const started = performance.now();
            const keyboardMode = this.usesKeyboard(trial);
            let finished = false;

            displayElement.innerHTML = this.buildFrame(trial);
            const screen = displayElement.querySelector('.srq-screen');
            const body = displayElement.querySelector('.srq-body');
            screen.style.setProperty('--srq-transition', `${duration}ms`);
            screen.classList.add(keyboardMode ? 'srq-keyboard' : 'srq-touch');
            requestAnimationFrame(() => screen.classList.add('srq-screen-in'));

            const endTrial = (response) => {
                if (finished) return;
                finished = true;
                document.removeEventListener('keydown', onKeyDown);
                body.querySelectorAll('button').forEach((button) => { button.disabled = true; });
                screen.classList.remove('srq-screen-in');
                screen.classList.add('srq-screen-out');

                const data = {
                    questionnaire: trial.questionnaire,
                    item_id: trial.item_id,
                    item_index: trial.item_index,
                    item_text: trial.prompt,
                    response: response.value,
                    response_label: response.label,
                    input_mode: keyboardMode ? 'keyboard' : 'touch',
                    rt: Math.round(performance.now() - started)
                };
                this.jsPsych.pluginAPI.setTimeout(() => this.jsPsych.finishTrial(data), duration);
            };

            if (trial.question_type === 'message') {
                body.innerHTML = `<button type="button" class="srq-btn srq-btn-primary">${trial.button_label}</button>`;
                body.querySelector('button').addEventListener('click', () => endTrial({ value: null, label: null }));
            } else if (trial.question_type === 'likert') {
                body.innerHTML = `<div class="srq-options">${trial.options.map((option, index) =>
                    `<button type="button" class="srq-btn srq-option" data-index="${index}">${option.label}</button>`
                ).join('')}</div>`;
                body.querySelectorAll('.srq-option').forEach((button) => {
                    button.addEventListener('click', () => {
                        const option = trial.options[Number(button.dataset.index)];
                        button.classList.add('srq-option-chosen');
                        endTrial(option);
                    });
                });
            } else {
                throw new Error(`Unknown self-report question type: ${trial.question_type}`);
            }

            const buttons = [...body.querySelectorAll('.srq-btn')];
            const onKeyDown = (event) => {
                if (!keyboardMode || event.repeat || event.defaultPrevented || finished) return;
                const current = buttons.indexOf(document.activeElement);
                if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                    event.preventDefault();
                    buttons[(current + 1) % buttons.length].focus();
                } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                    event.preventDefault();
                    buttons[current <= 0 ? buttons.length - 1 : current - 1].focus();
                } else if (/^[1-9]$/.test(event.key) && buttons[Number(event.key) - 1]) {
                    event.preventDefault();
                    buttons[Number(event.key) - 1].click();
                } else if (event.key === 'Enter' && current === -1 && buttons.length === 1) {
                    event.preventDefault();
                    buttons[0].click();
                }
            };
            document.addEventListener('keydown', onKeyDown);

            if (keyboardMode && trial.question_type === 'message') {
                buttons[0].focus({ preventScroll: true });
            }
        }

        usesKeyboard(trial) {
            if (trial.input_mode === 'keyboard') return true;
            if (trial.input_mode === 'touch') return false;
            const finePointer = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
            return !(window.isTouchDevice ? window.isTouchDevice() : navigator.maxTouchPoints > 0) || finePointer;
        }

        buildFrame(trial) {
            const proportion = trial.item_index !== null && trial.n_items
                ? (trial.item_index / trial.n_items) * 100
                : null;
            const progress = trial.progress_label || proportion !== null
                ? `<div class="srq-progress" aria-hidden="true">
                    ${trial.progress_label ? `<div class="srq-progress-label">${trial.progress_label}</div>` : ''}
                    ${proportion === null ? '' : `<div class="srq-progress-track"><div class="srq-progress-fill" style="width:${proportion}%"></div></div>`}
                </div>`
                : '';
            return `<div class="srq-screen">
                ${progress}
                <div class="srq-card">
                    ${trial.context ? `<div class="srq-context">${trial.context}</div>` : ''}
                    <div class="srq-prompt">${trial.prompt}</div>
                    <div class="srq-body"></div>
                </div>
            </div>`;
        }

        create_simulation_data(trial, simulationOptions) {
            const option = trial.options.length
                ? this.jsPsych.randomization.sampleWithoutReplacement(trial.options, 1)[0]
                : null;
            const defaults = {
                questionnaire: trial.questionnaire,
                item_id: trial.item_id,
                item_index: trial.item_index,
                item_text: trial.prompt,
                response: trial.question_type === 'message' ? null : option?.value,
                response_label: trial.question_type === 'message' ? null : option?.label,
                input_mode: this.usesKeyboard(trial) ? 'keyboard' : 'touch',
                rt: this.jsPsych.randomization.sampleExGaussian(1200, 300, 1 / 800, true)
            };
            return this.jsPsych.pluginAPI.mergeSimulationData(defaults, simulationOptions);
        }

        simulate(trial, mode, simulationOptions, loadCallback) {
            const data = this.create_simulation_data(trial, simulationOptions);
            if (mode === 'data-only') {
                loadCallback();
                this.jsPsych.finishTrial(data);
                return;
            }
            this.trial(this.jsPsych.getDisplayElement(), trial);
            loadCallback();
            this.jsPsych.pluginAPI.setTimeout(() => {
                const selector = trial.question_type === 'message'
                    ? '.srq-btn-primary'
                    : `.srq-option[data-index="${Math.max(0, trial.options.findIndex(({ value }) => value === data.response))}"]`;
                this.jsPsych.pluginAPI.clickTarget(this.jsPsych.getDisplayElement().querySelector(selector));
            }, data.rt);
        }
    }

    SelfReportItemPlugin.info = info;
    return SelfReportItemPlugin;
})(jsPsychModule);

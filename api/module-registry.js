// A module is a collection of tasks to be completed in a single sitting.
// Each module can contain one or more tasks, and each task can have its own configuration settings.

export const ModuleRegistry = {
    module_1: {
        name: "Module 1: Reversal and Faces Go/No-Go",
        moduleConfig: {
            session: "wk0",
            sequence: "wk0",
            stimulus_session: 1
        },
        elements: [
            { type: "instructions", config: { text: "start_message" } },
            { type: "task", name: "reversal" },
            { type: "task", name: "acceptability_judgment", config: { task_name: "reversal", game_description: "squirrel game" } },
            { type: "task", name: "go_no_go" },
            { type: "task", name: "acceptability_judgment", config: { task_name: "go_no_go", game_description: "Faces Game" } },
            { type: "instructions", config: { text: "end_message" } }
        ]
    },
    module_2: {
        name: "Module 2: Learning and Effort Tasks",
        moduleConfig: {
            session: "wk0",
            sequence: "wk0"
        },
        elements: [
            { type: "instructions", config: { text: "start_message" } },
            { type: "task", name: "max_press_test" },
            { type: "task", name: "acceptability_judgment", config: { task_name: "max_press_test", game_description: "tapping test" } },
            { type: "task", name: "pavlovian_lottery" },
            { type: "task", name: "acceptability_judgment", config: { task_name: "pavlovian_lottery", game_description: "lottery game" } },
            { type: "task", name: "PILT" },
            { type: "task", name: "acceptability_judgment", config: { task_name: "PILT", game_description: "card choosing game" } },
            { type: "task", name: "vigour" },
            { type: "task", name: "acceptability_judgment", config: { task_name: "vigour", game_description: "piggy-bank game" } },
            { type: "task", name: "PIT" },
            { type: "task", name: "acceptability_judgment", config: { task_name: "PIT", game_description: "piggy-bank game in cloudy space" } },
            { type: "task", name: "vigour_test" },
            { type: "task", name: "acceptability_judgment", config: { task_name: "vigour_test", game_description: "piggy-bank knowledge test" } },
            { type: "task", name: "post_PILT_test" },
            { type: "task", name: "acceptability_judgment", config: { task_name: "post_PILT_test", game_description: "card knowledge test" } },
            { type: "instructions", config: { text: "end_message" } }
        ]
    },
    questionnaires: {
        name: "Questionnaires",
        moduleConfig: {
            session: "wk0",
            sequence: "wk0"
        },
        elements: [
            { type: "instructions", config: { text: "start_message" } },
            // State anxiety is asked first, before the longer and more emotionally loaded
            // measures can influence it. STAXI-2 is last because it is the longest measure.
            { type: "task", name: "self_report", config: { questionnaires: ["STAI", "ARI", "BIS", "STAXI2"] } },
            { type: "instructions", config: { text: "end_message" } }
        ]
    },
    full_battery: {
        name: "Full RELEMD Task Battery",
        moduleConfig: { // Settings that apply to all tasks in the module unless overridden
            session: "wk0",
            sequence: "wk0"
        }, 
        elements: [
            { type: "instructions", config: { text: "start_message" } },
            { type: "task", name: "reversal"},
            { type: "task", name: "acceptability_judgment", config: { task_name: "reversal", game_description: "squirrel game" } },
            { type: "task", name: "max_press_test" },
            { type: "task", name: "pavlovian_lottery" },
            { type: "task", name: "PILT" },
            { type: "task", name: "acceptability_judgment", config: { task_name: "PILT", game_description: "card choosing game" } },
            { type: "task", name: "vigour" },
            { type: "task", name: "acceptability_judgment", config: { task_name: "vigour", game_description: "piggy-bank game" } },
            { type: "task", name: "PIT"},
            { type: "task", name: "acceptability_judgment", config: { task_name: "PIT", game_description: "piggy-bank game in cloudy space" } },
            { type: "task", name: "vigour_test"},
            { type: "task", name: "post_PILT_test"},
            { type: "instructions", config: { text: "break_message" } },
            { type: "task", name: "control"},
            { type: "task", name: "acceptability_judgment", config: { task_name: "control", game_description: "shipping game" } },
            { type: "instructions", config: { text: "break_message" } },
            { type: "task", name: "WM" },
            { type: "task", name: "post_WM_test"},
            { type: "task", name: "acceptability_judgment", config: { task_name: "wm", game_description: "one-card game you just completed" } },
            { type: "task", name: "open_text" },
            { type: "task", name: "delay_discounting" },
            { type: "bonus" },
            { type: "instructions", config: { text: "end_message" } },
        ],
        max_bonus: 5.0,
        min_prop_bonus: 0.6
    },
    screening: {
        name: "Screening Module",
        moduleConfig: { // Settings that apply to all tasks in the module unless overridden
            session: "screening",
            sequence: "screening"
        }, 
        elements: [
            { type: "instructions", config: { text: "start_message" } },
            { type: "task", name: "max_press_test" },
            { type: "task", name: "PILT", config: {present_pavlovian: false} },
            { type: "task", name: "acceptability_judgment", config: { task_name: "PILT", game_description: "card choosing game" } },
            { type: "task", name: "control" },
            { type: "task", name: "acceptability_judgment", config: { task_name: "control", game_description: "shipping game" } },
            { type: "task", name: "reversal", config: { n_trials: 50 } },
            { type: "task", name: "acceptability_judgment", config: { task_name: "reversal", game_description: "squirrel game" } },
            { type: "instructions", config: { text: "end_message" } }
        ]
    }
};

/**
 * Questionnaire wording and response codes transcribed from
 * VIREPS_DataDictionary_2026-09-07.csv. Wording is intentionally preserved, including
 * bracketed alternatives and repeated items.
 */

const makeItems = (entries) => entries.map(([id, text]) => ({ id, text }));

const bisScale = [
    { value: 1, label: '1 = Rarely/Never' },
    { value: 2, label: '2 = Occasionally' },
    { value: 3, label: '3 = Often' },
    { value: 4, label: '4 = Almost Always/Always' }
];

const ariScale = [
    { value: 1, label: 'Not true' },
    { value: 2, label: 'Somewhat true' },
    { value: 3, label: 'Certainly true' }
];

const staxiStateScale = [
    { value: 1, label: '1 Not at all' },
    { value: 2, label: '2 Somewhat' },
    { value: 3, label: '3 Moderately so' },
    { value: 4, label: '4 Very much so' }
];

const staxiGeneralScale = [
    { value: 1, label: '1 Almost never' },
    { value: 2, label: '2 Sometimes' },
    { value: 3, label: '3 Often' },
    { value: 4, label: '4 Almost always' }
];

const staiScale = [
    { value: 1, label: '1 Not at all' },
    { value: 2, label: '2 A little' },
    { value: 3, label: '3 Somewhat' },
    { value: 4, label: '4 Very Much So' }
];

export const Questionnaires = {
    BIS: {
        key: 'BIS',
        name: 'Barratt Impulsiveness Scale',
        scale: bisScale,
        sections: [{
            start: 0,
            context: '<em>frequently</em>',
            instructions: 'Please read each statement and mark the number that best describes how <em>frequently</em> the statement applies to you. Try to answer each question as honestly and quickly as possible'
        }],
        items: makeItems([
            ['bis_plan_task', 'I plan tasks carefully'],
            ['bis_do_sans_think', 'I do things without thinking'],
            ['bis_decide_quick', 'I make up my mind quickly'],
            ['bis_happy_go_lucky', 'I am happy-go-lucky'],
            ['bis_attention', 'I don’t pay attention'],
            ['bis_racing_thoughts', 'I have racing thoughts'],
            ['bis_plan_trips', 'I plan trips well ahead of time'],
            ['bis_plan_ahead', 'I plan trips well ahead of time'],
            ['bis_self_control', 'I am self-controlled'],
            ['bis_concentrate', 'I concentrate easily'],
            ['bis_save', 'I save regularly'],
            ['bis_squirm', 'I squirm at plays or lectures'],
            ['bis_thinker', 'I am a careful thinker'],
            ['bis_job_security', 'I plan for job security'],
            ['bis_blurt', 'I say things without thinking'],
            ['bis_complex_probs', 'I like to think about complex problems'],
            ['bis_change_jobs', 'I change jobs'],
            ['bis_impulsive_act', 'I act on impulse'],
            ['bis_bored', 'I get easily bored when solving thought problems'],
            ['bis_spur', 'I act on the spur of the moment'],
            ['bis_steady_thinker', 'I am a steady thinker'],
            ['bis_change_homes', 'I change where I live [I change residences].'],
            ['bis_impulsive_buy', 'I buy things on impulse'],
            ['bis_single_prob', 'I can only think about one problem at a time'],
            ['bis_hobbies', 'I change hobbies'],
            ['bis_spending', 'I spend more than I earn [I spend or ch‎arge more than I earn].'],
            ['bis_thoughts', 'I have outside thoughts when thinking [I often have extraneous thoughts when thinking].'],
            ['bis_present_orient', 'I am more interested in the present than the future'],
            ['bis_restless', 'I am restless at lectures or talks'],
            ['bis_puzzles', 'I like puzzles'],
            ['bis_future_orient', 'I plan for the future [I am future oriented].']
        ])
    },
    ARI: {
        key: 'ARI',
        name: 'Affective Reactivity Index',
        scale: ariScale,
        sections: [{
            start: 0,
            context: 'In the <em>last six months,</em>',
            instructions: 'In the <em>last six months,</em> how well does each of the following statements describe your behavior/feelings'
        }],
        items: makeItems([
            ['ari_annoyed', 'Gets easily annoyed by others'],
            ['ari_temper', 'Often loses temper'],
            ['ari_angry', 'Stays angry for a long time'],
            ['ari_angry_pervasive', 'Is angry most of the time'],
            ['ari_frequently_angry', 'Gets angry frequently'],
            ['ari_loses_temper', 'Loses temper easily'],
            ['ari_problems', 'Overall, irritability causes you problems']
        ])
    },
    STAXI2: {
        key: 'STAXI2',
        name: 'STAXI-2',
        sections: [
            {
                start: 0,
                context: 'HOW I FEEL RIGHT NOW',
                scale: staxiStateScale,
                instructions: `<p>HOW I FEEL RIGHT NOW</p><p>A number of statements that people use to describe themselves are given below. Read each statement and then select the option to indicate how you <em>feel right now</em>. There are no right or wrong answers. Do not spend too much time on any one statement. Select the answer that best describes your <em>present feelings</em>.</p>`
            },
            {
                start: 15,
                context: 'HOW I GENERALLY FEEL',
                scale: staxiGeneralScale,
                instructions: `<p>HOW I GENERALLY FEEL</p> <p>Read each of the following statements that people have used to describe themselves and then select the appropriate option to indicate how you <em>generally feel or react.</em> There are no right or wrong answers. Do not spend too much time on any one statement. Select the answer that best describes how you <em>generally feel or react.</em></p>`
            },
            {
                start: 25,
                context: 'HOW I GENERALLY REACT OR BEHAVE WHEN ANGRY OR FURIOUS',
                scale: staxiGeneralScale,
                instructions: `<p>HOW I GENERALLY REACT OR BEHAVE WHEN ANGRY OR FURIOUS</p><p>Everyone feels angry or furious from time to time but people differ in the ways that they react when they are angry. A number of statements are listed below which people use to describe their reactions when they feel <em>angry or furious.</em> Read each statement and then select the appropriate option to indicate how <em>often</em> you <em>generally</em> react or behave in the manner described when you are feeling angry or furious. There are no right or wrong answers. Do not spend too much time on any one statement</p>`
            }
        ],
        items: makeItems([
            ['staxi_furious', 'I am furious'],
            ['staxi_irritated', 'I feel irritated'],
            ['staxi_angry', 'I feel angry'],
            ['staxi_yell', 'I feel like yelling at someone'],
            ['staxi_break', 'I feel like breaking things'],
            ['staxi_mad', 'I am mad'],
            ['staxi_banging_table', 'I feel like banging on the table'],
            ['staxi_hitting', 'I feel like hitting someone'],
            ['staxi_swearing', 'I feel like swearing'],
            ['staxi_annoyed', 'I feel annoyed'],
            ['staxi_kicking', 'I feel like kicking someone'],
            ['staxi_cursing', 'I feel like cursing out loud'],
            ['staxi_screaming', 'I feel like screaming'],
            ['staxi_pounding', 'I feel like pounding somebody'],
            ['staxi_shout_loud', 'I feel like shouting out loud'],
            ['staxi_quick_temper', 'I am quick tempered'],
            ['staxi_fiery_temper', 'I have a fiery temper'],
            ['staxi_hotheaded', 'I am a hotheaded person'],
            ['staxi_anger_mistakes', "I get angry when I'm slowed down by other's mistakes"],
            ['staxi_annoyed_recognition', 'I feel annoyed when I am not given recognition for doing good work'],
            ['staxi_handle', 'I fly off the handle'],
            ['staxi_nasty_things', 'When I get mad I say nasty things'],
            ['staxi_criticized', 'It makes me furious when I am criticized in front of others'],
            ['staxi_hit_frustrated', 'When I get frustrated, I feel like hitting someone'],
            ['staxi_poor_evaluation', 'I feel infuriated when I do a good job and get a poor evaluation'],
            ['staxi_control_temper', 'I control temper'],
            ['staxi_anger', 'I express my anger'],
            ['staxi_breath_relax', 'I take a deep breath and relax'],
            ['staxi_keep_it_in', 'I keep things in'],
            ['staxi_patient', 'I am patient with others'],
            ['staxi_tell_feelings', "If someone annoys me, I'm apt to tell  him or her how I feel"],
            ['staxi_calm_asap', 'I try to calm myself as soon as possible'],
            ['staxi_pout', 'I pout or sulk'],
            ['staxi_control_urge', 'I control my urge to express my angry feelings'],
            ['staxi_lose_temper', 'I lose my temper'],
            ['staxi_simmer', 'I try to simmer down'],
            ['staxi_withdraw', 'I withdraw from people'],
            ['staxi_keep_cool', 'I keep my cool'],
            ['staxi_sarcasm', 'I make sarcastic remarks to others'],
            ['staxi_soothe_anger', 'I try to soothe my angry feelings'],
            ['staxi_boil', "I boil inside but I don't show it"],
            ['staxi_control_behaviour', 'I control my behaviour'],
            ['staxi_slam_door', 'I do things like slam doors'],
            ['staxi_endev_calm', 'I endeavor to be calm again'],
            ['staxi_harbor_grudges', "I tend to harbor grudges that I don't tell anyone about"],
            ['staxi_stop_temper', 'I can stop myself from losing my temper'],
            ['staxi_argue', 'I argue with others'],
            ['staxi_anger_asap', 'I reduce my anger as soon as possible'],
            ['staxi_secretly_critical', 'I am secretly quite critical of others'],
            ['staxi_tolerant', 'I try to be tolerant and understanding'],
            ['staxi_strike_out', 'I strike out at whatever infuriates me'],
            ['staxi_relaxing', 'I do something relaxing to calm down'],
            ['staxi_more_angry', 'I am angrier than I am willing to admit'],
            ['staxi_control_angry', 'I control my angry feelings'],
            ['staxi_nasty', 'I say nasty things'],
            ['staxi_try_relax', 'I try to relax'],
            ['staxi_more_irritated', "I'm irritated a great deal more than people are aware of"]
        ])
    },
    STAI: {
        key: 'STAI',
        name: 'State Trait Anxiety Inventory',
        scale: staiScale,
        sections: [{
            start: 0,
            context: '<em>right now</em>, that is, at this very moment.',
            instructions: 'Read each statement and select the appropriate response to indicate how you feel <em>right now</em>, that is, at this very moment. There are no right or wrong answers. Do not spend too much time on any one statement but give the answer which seems to describe your <em>present feelings</em> best.'
        }],
        items: makeItems([
            ['stai_calm', 'I feel calm'],
            ['stai_secure', 'I feel secure'],
            ['stai_tense', 'I feel tense'],
            ['stai_strained', 'I feel strained'],
            ['stai_ease', 'I feel at ease'],
            ['stai_upset', 'I feel upset'],
            ['stai_misfortunes', 'I am presently worrying over possible misfortunes'],
            ['stai_satisfied', 'I feel satisfied'],
            ['stai_frightened', 'I feel frightened'],
            ['stai_uncomfortable', 'I feel uncomfortable'],
            ['stai_self_confident', 'I feel self confident'],
            ['stai_nervous', 'I feel nervous'],
            ['stai_jittery', 'I feel jittery'],
            ['stai_indecisive', 'I feel indecisive'],
            ['stai_relaxed', 'I am relaxed'],
            ['stai_content', 'I feel content'],
            ['stai_worried', 'I am worried'],
            ['stai_confused', 'I feel confused'],
            ['stai_steady', 'I feel steady'],
            ['stai_pleasant', 'I feel pleasant']
        ])
    }
};

export function getQuestionnaire(key) {
    const questionnaire = Questionnaires[key];
    if (!questionnaire) {
        throw new Error(`Unknown questionnaire "${key}". Available: ${Object.keys(Questionnaires).join(', ')}.`);
    }
    return questionnaire;
}

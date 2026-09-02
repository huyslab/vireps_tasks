# Go/No-Go with valenced faces

Orthogonalised go/no-go learning task. Cues are emotional faces, so the design is
2 (reward valence: win / avoid loss) × 2 (correct response: go / no-go) ×
2 (face affect: positive / negative) = **8 cells**.

Trial order follows Sam Zorowitz's RobotFactory; the affect factor, the touch
interaction, the feedback presentation and the stimulus selection are ours.

## Running it

```
examples/go-no-go.html?participant_id=<id>
examples/go-no-go.html?participant_id=<id>&skip_instructions=1   # straight to trials
```

Also selectable from `index.html` (task: *Faces Go/No-Go*), which routes through
`experiment.html`.

**The face images are not in this repository** — see [Stimuli](#stimuli). Without
running the selection script first, the task will fail to load its images.

## The trial

1. A face appears mid-screen at full size, **no onset animation**, lit by a
   coloured **rim light**: blue where there is money to win, amber where there is
   money to lose. RobotFactory runs a 1500 ms scanner animation and only then
   opens its listener; here the response window opens at cue onset, so RT is
   measured from onset and the light is up for all of it.
2. **1800 ms** to respond. A tap on the face (touch) or the spacebar (desktop) is
   GO; letting the window elapse is NO-GO.
3. The face **grows** on a go response (1.4×) and **shrinks** on a no-go (0.65×),
   signalling approach vs withdrawal. This tracks the action taken, not whether
   it was correct, so it fires on error trials too.
4. Feedback, for **1600 ms**: a distinct sound plays and the outcome flies out of
   the face to land low on the torso — £1 for +10, broken £1 for −10, 1p for +1,
   broken 1p for −1, or the signed value in points mode. The rim light stays lit.
5. 400 ms blank ITI.

Go trials end their response phase as soon as the response arrives, so trial
length varies with RT, as in RobotFactory.

Timings are registry defaults (`api/task-registry.js`) and can be overridden per
task instance. Note that the registry value wins over the plugin's own default —
they were out of step for a while and feedback ran at 1000 ms rather than the
intended 1600 ms.

### Signalling the outcome domain

The rim light is RobotFactory's scanner light in another form. Sam's is a CSS
trapezoid over the robot in `mix-blend-mode: soft-light`, faded in over the last
10% of his intro animation; ours is a `drop-shadow` on the transparent cue, up
from the first paint.

Two decisions are worth recording, because both were made against alternatives:

- **Hue means exactly one thing.** Feedback used to wash the whole screen green
  or red; with the light added, colour would have meant the domain at onset and
  correctness 300 ms later, in the same trial. The wash is **off by default**
  (`feedback_tint`), and correctness is carried by the outcome, its fly-out and
  the sound — which already stated it, since £1 and 1p occur only in the win
  domain and the broken coins only in the loss domain. Turning `signal_valence`
  off and `feedback_tint` on restores the original, unsignalled design.
- **The light hugs the silhouette; it does not wash over the face.** The cues are
  angry and happy faces, and the colour is perfectly correlated with reward
  valence, so tinting the skin could shift how the expression reads — and that
  shift would be indistinguishable from a valence × affect interaction. Lighting
  the outline leaves every face pixel untouched.

Blue for win, amber for avoid-loss, **fixed for everyone** rather than
counterbalanced. Signalling the domain makes this an action-learning task, as in
Zorowitz's study02; `signal_valence: false` puts valence back into the problem.

Implementation note: the light is a filter on a `.gng-glow` wrapper, not on the
image. The image is masked at the bottom, masking is applied *after* filtering
and clips to the border box, so a drop-shadow on the image itself would be cut
off wherever it spread past the frame. The same mask also has to fade
*gradually* — the glow traces whatever edge the mask leaves, and an abrupt one
drew a lit horizontal bar under the shoulders, outlining the very cut-out edge
the mask exists to hide.

### Why the feedback looks the way it does

Each element earns its place, and several were added after testing on a tablet:

- **Coin on the body, not below the face.** At arm's length the face fills much
  of the screen; a coin underneath it fell outside foveal vision and forced a
  choice between watching the face and reading the outcome.
- **Positioned by its top edge**, below 0.94 of the face's displayed height on go
  trials and 1.04 on no-go — computed from the face's *rendered* geometry, since
  the scale transform has just changed it. Two values because the coin is about a
  third of the face's height on a go trial but nearly half on a no-go, so equal
  placement would cover far more of the smaller face.
- **Coin scales by the square root of the face's scale.** At constant size its
  size *relative to the cue* differed 2.2× between the two conditions the design
  contrasts; scaling it fully with the face would instead shrink the outcome on
  no-go trials, where it is the only thing to read. The square root halves the
  gap to 1.5×.
- **Sound** carries the outcome even if the coin is missed. Four synthesised
  tones in `assets/sounds/go-no-go/`, ours, ~2 KB each. `play_sounds: false` runs
  the task silently.
- **Points instead of coins.** `outcome_display: 'points'` replaces the coin
  images with Sam's values — +10, +1, −1, −10 — in the same place, at the same
  size, with the same fly-out, and adapts the instructions and the comprehension
  check to match (£1 → 10 points, 1p → 1 point, "a broken coin" → "a minus
  number").
- **Transparent stimuli** are what make the rim light work: `drop-shadow` follows
  the alpha channel, so on CFD's white-background frames it would outline the
  rectangle rather than the person.

## Sequence

One sequence, `sequences/trial1.js`, used by **every session**. Sessions differ
only in which faces are shown, so a change measured across sessions cannot be an
artefact of a different trial order.

| | |
|---|---|
| Blocks | 2 |
| Trials | 120 per block, **240 total** |
| Cues | 12 per block, 24 per session |
| Presentations per cue | 8–12 |
| Trials per cell | **30** |
| Trials per 2×2 condition | 60 |
| Feedback validity | 80% per cue |

Trial order comes from Zorowitz's runsheets (see
`sequences/generate-sequence.mjs` for provenance and everything added on top).
Cues arrive in three overlapping waves, so new learning always begins while
earlier cues are still being learned.

Both blocks run the same runsheet, so **condition labels are permuted in block 2**.
The order itself cannot be shuffled — the staggered introduction *is* the order —
but relabelling preserves every property while changing what the participant
meets at each trial position: 17% agreement on the 2×2 condition against ~25%
chance, and no trial repeats its full cell.

```
node tasks/go-no-go/sequences/generate-sequence.mjs   # regenerate
node tasks/go-no-go/sequences/validate-sequence.mjs   # check design properties
node tasks/go-no-go/sequences/plot-sequence.mjs       # character-grid view
```

## Stimuli

**5 sessions × 24 faces = 120 CFD models, each used exactly once**, plus 4
neutral practice faces per session from 20 further models used nowhere else.

Every session is exactly balanced: 2 ethnicities × 2 genders × 2 affects × 3
models. Practice faces are one per gender × ethnicity cell — 2 female / 2 male,
2 Black / 2 White — drawn preferentially from outside the both-expressions subset
so models capable of carrying angry and happy are not spent on training.

Angry uses the `A` image, happy the closed-mouth `HC` image; open-mouth shows
teeth, a high-contrast feature anger lacks, which would let "affect" partly track
a low-level image difference. Within each cell, models are ranked by
z(Threatening) − z(Trustworthy) and the top take angry, the bottom happy, with
sessions filled serpentine so scores match across them (angry Threatening
2.71–2.83; happy Trustworthy 3.72–3.81).

Faces are bound to cues per participant, seeded by participant id: affect is
fixed by selection, but which face fills which cue is shuffled so no identity
sits in the same 2×2 condition for everyone.

```
node tasks/go-no-go/sequences/check-cfd-stimuli.mjs --images "<path>/Images/CFD"
node tasks/go-no-go/sequences/select-cfd-stimuli.mjs --images "<path>/Images/CFD"
```

The second stages 500 px transparent WebP into `assets/images/go-no-go/faces/`
(2.6 MB) and writes `sequences/stimuli-manifest.json`. White backgrounds are
keyed out with ffmpeg at similarity 0.10 — an empirical ceiling, since the models
wear a light grey shirt (#b9bec2) that starts eroding at 0.16.

### Images are NOT in this repository

CFD's terms forbid redistribution ("shall not be re-distributed to third
parties") and publication, and **this repository is public**. Gitignored:

- `tasks/go-no-go/sequences/CFD*.xlsx` — the norming workbook
- `assets/images/go-no-go/faces/` — the staged images

Only `sequences/stimuli-manifest.json` is committed: filenames, model ids and
design roles, no image data. **Any deployment must run `select-cfd-stimuli.mjs`
against a local CFD copy.**

Two caveats for the write-up: the expression subset covers **only Black and White
models**, so any affect effect is established over those; and CFD norms each model
on their *neutral* image, so "high Threatening" means the person looks
threatening at rest, not that their angry photo is fierce.

## Tests

```
npx playwright test go-no-go        # rendering + journey
npx playwright test --project="data invariants"   # manifest + audio invariants
```

- `go-no-go-rendering.spec.js` — renders across the device matrix.
- `go-no-go-journey.spec.js` — real taps through a go and a no-go trial, checking
  the animation, coin placement, the square-root scaling and recorded data.
- `data-gng-stimuli.spec.js` — manifest balance, and that no practice face is
  ever reused as a cue.
- `go-no-go-audio.spec.js` — that sounds replay on *every* trial. jsPsych caches
  one AudioPlayer per file and a Web Audio source node can only be started once,
  so this failed silently once already: nothing on screen changes when the audio
  stops working.

## Open decisions

- **Length.** 240 trials is roughly 16 minutes including feedback and ITI, on top
  of an already long battery.
- **Coin legibility on no-go.** The square-root compromise leaves it at 83 px on
  a tablet; the exponent is a single number to adjust.
- **Session selection.** `stimulus_session` defaults to 1 and there is no UI for
  it, so repeat visits need it passing explicitly or every session shows set 1.

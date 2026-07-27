# Go/No-Go with valenced faces

Orthogonalised go/no-go learning task. Cues are emotional faces, so the design is
2 (reward valence: win / avoid loss) × 2 (correct response: go / no-go) ×
2 (face affect: positive / negative) = **8 cells**.

Trial sequence only at this stage — the task itself is not built yet.

## Sequence

One sequence, `sequences/trial1.js`, used by **every session**. Sessions differ
only in which faces are shown, so any change across sessions cannot be an
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

Trial order is Sam Zorowitz's RobotFactory runsheets (see
`sequences/generate-sequence.mjs` for provenance and for everything added on top).
Cues arrive in three overlapping waves so new learning always starts while
earlier cues are still being learned.

Inspect the sequence with:

```
node tasks/go-no-go/sequences/plot-sequence.mjs   # writes sequence-plot.txt
node tasks/go-no-go/sequences/validate-sequence.mjs
```

## Choosing the face stimuli

The sequence deliberately carries only `affect` (`negative` / `positive`), never
an image path. Everything below is about turning that into actual faces.

### What is needed

24 faces per session — 12 negative, 12 positive — with 12 used in each block.
Across 5 sessions (wk0, wk2, wk4, wk24, wk28) that is **120 faces**, and they
should be 120 *distinct identities*: a face reappearing in a later session
carries learned value with it, which is exactly the contamination repeated
sessions exist to avoid.

### Recommended set

**FACES** (Ebner, Riediger & Lindenberger, 2010) — 171 identities × 6
expressions, free for research. 171 identities covers 120 with margin, which no
other common set does: KDEF has 70, NimStim 43. The Chicago Face Database has far
more identities but expression coverage for only a subset.

Two decisions to confirm before selection:

1. **Which negative expression.** Recommend **anger** — it is the standard threat
   counterpart to happiness and gives a clean approach/avoid contrast. Fear is
   more ambiguous in valence attribution and its go/no-go effects are less
   consistent. Sadness is lower arousal, which would confound affect with arousal.
2. **Whether identities are disjoint across sessions.** Recommend yes. If the
   sample is small enough that reuse is acceptable, reuse should at minimum
   pair an identity with a *different* expression and a different cell.

### Selection procedure

1. **Filter** to frontal, direct-gaze images. Hold age band constant (FACES
   `young` alone is simplest) or balance it explicitly across cells — do not
   leave it to vary freely, since apparent age affects both salience and the
   social meaning of an expression.
2. **Normalise** the images: oval crop removing hair and background, equal pixel
   dimensions, matched mean luminance and RMS contrast. Cues must be
   discriminable from each other without differing in low-level salience by
   condition, or "affect" partly measures image energy.
3. **Draw 120 identities**, gender balanced (60 female / 60 male).
4. **Partition into 5 disjoint session pools of 24**, each 12 female / 12 male.
5. **Within a pool, split 12 negative / 12 positive**, gender balanced within
   each affect (6F / 6M). This is the point where affect gets locked to identity,
   so it is where gender confounds would enter.
6. **Assign faces to cues at runtime, per participant.** The sequence fixes each
   cue's affect; the specific face filling that cue is drawn randomly from the
   matching affect pool, seeded by participant ID so it survives a resumed
   session. Constrain the draw so each 2×2 condition receives a balanced gender
   mix.

Step 6 matters more than it looks. With a fixed face→cue assignment, any
idiosyncratic face — unusually distinctive, unusually ambiguous — is perfectly
confounded with its cell for every participant in the study, and no analysis can
separate the two. Randomising per participant turns that into noise. RobotFactory
does the same thing with its rune sets.

### Open decisions

- **Task length.** 240 trials is roughly 14 minutes, on top of an already long
  battery. Halving to one block would drop cells to 15 trials, which is thin.
- **Go response.** RobotFactory uses the spacebar. Everything else in this
  battery is now touch-first, so Go is presumably a tap — worth settling early,
  since go/no-go RT is a primary measure and tap latency is not keypress latency.

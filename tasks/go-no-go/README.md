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

Both blocks run the same runsheet, so **condition labels are permuted in block 2**
(`BLOCK2_CONDITION_MAP`). The trial order itself cannot be shuffled — the
staggered introduction *is* the order, and shuffling scatters the wave structure
the runsheets were chosen for. Relabelling is a permutation, so cue counts,
waves, presentations per cue and per-cell totals are preserved exactly, while the
condition a participant meets at any given trial position differs between blocks:
17% trial-by-trial agreement on the 2×2 condition against ~25% chance, and no
trial repeats its full cell. Without this the blocks would be near-identical and a
strategy formed in block 1 could carry over.

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
Over **2 sessions** that is **48 distinct identities**: a face reappearing in a
later session carries learned value with it, which is exactly the contamination
repeated sessions exist to avoid.

### Stimulus set: CFD

`sequences/CFD 3.0 Norming Data and Codebook.xlsx` is in this folder, but note
what it is *not*: every row is one model rated on their **neutral** image, so the
`Angry` and `Happy` columns are observers' impressions of a neutral face, not a
record of who was photographed with those expressions. Expression availability
lives only in the image directory. Check it with:

```
node tasks/go-no-go/sequences/check-cfd-stimuli.mjs <path-to-CFD-images>
```

Result for CFD 3.0 (main set, 597 models):

| | F | M | total |
|---|---|---|---|
| Black | 47 | 35 | 82 |
| White | 37 | 35 | 72 |

**154 models have both an angry and a happy image** — and they are *only Black
and White*. The CFD-MR (multiracial) and CFD-INDIA extension sets are
neutral-only, so Asian and Latino models, which are well represented in the
neutral set, drop out entirely once expressions are required.

**Verdict: comfortably feasible.** Two sessions need 48 models, 12 per
ethnicity × gender cell; the smallest available cell holds 35. The subset would
in fact support up to 5 sessions at this balance.

It also divides exactly: **24 cues = 2 ethnicities × 2 genders × 2 affects × 3
models**, so every participant gets a perfect three-way balance in each session —
which the 4-ethnicity version could not have delivered (24/16 = 1.5).

The constraint to be aware of is generalisability, not power: any affect effect
is established over Black and White faces only. That is a property of CFD, not of
this design, and it should be stated in the write-up. If broader coverage
matters more than CFD's norming, other sets carry expressions for more groups.

Requiring **both** expressions per model, rather than splitting models into an
angry pool and a happy pool, is what allows affect to be assigned to identities
per participant — see step 6 below.

### Selected stimuli

Selection is done: **5 sessions x 24 faces = 120 CFD models, each used exactly
once.** Regenerate with:

```
node tasks/go-no-go/sequences/select-cfd-stimuli.mjs \
  --images "<path>/CFD Version 3.0/Images/CFD"
```

Per session, per gender x ethnicity cell: 3 angry + 3 happy, so every session is
exactly balanced 2 ethnicities x 2 genders x 2 affects x 3 models.

Angry uses the `A` image, happy the closed-mouth `HC` image. Within each cell,
models are ranked by z(Threatening) - z(Trustworthy) and the top take angry, the
bottom happy. Because a model can hold only one role this is a joint assignment,
not two independent top-N lists. Sessions are then filled serpentine down each
ranked list so scores match across sessions:

| session | angry: Threatening | happy: Trustworthy |
|---|---|---|
| 1 | 2.83 | 3.76 |
| 2 | 2.73 | 3.81 |
| 3 | 2.72 | 3.76 |
| 4 | 2.81 | 3.72 |
| 5 | 2.71 | 3.73 |

Pooled separation: Threatening 2.76 (angry) vs 1.94 (happy); Trustworthy 3.17
vs 3.76.

**Read those ratings carefully.** CFD norms every model on their *neutral*
image, so "high Threatening" means the person looks threatening at rest, not
that their angry photo is especially fierce. Selecting this way stacks a
threatening-looking face with an angry expression, which should amplify the
manipulation - but the ratings are not of the images actually shown.

This also means affect is now fixed to identity by design, so it can no longer
be randomised per participant. Any idiosyncratic face effect sits inside the
affect contrast for the whole sample. That is the deliberate trade: a stronger
manipulation for a fixed face-to-affect mapping.

### Images are NOT in this repository

The CFD terms forbid redistribution ("shall not be re-distributed to third
parties") and publication ("shall not be published ... without written
consent"), and **this repository is public**. Gitignored accordingly:

- `tasks/go-no-go/sequences/CFD*.xlsx` — the norming workbook
- `assets/images/go-no-go/faces/` — the staged images

Committed instead is `sequences/stimuli-manifest.json`, which lists filenames,
model ids and design roles but contains no image data. Any deployment must run
`select-cfd-stimuli.mjs` against a local CFD copy to populate the images.

The staged set is 120 images at 512px wide, 3.6 MB total, downscaled from CFD's
2444x1718 originals (1.1 MB each, 354 MB for the full expression subset).

### Open decisions

- **Task length.** 240 trials is roughly 14 minutes, on top of an already long
  battery. Halving to one block would drop cells to 15 trials, which is thin.
- **Go response.** RobotFactory uses the spacebar. Everything else in this
  battery is now touch-first, so Go is presumably a tap — worth settling early,
  since go/no-go RT is a primary measure and tap latency is not keypress latency.

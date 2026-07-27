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

### Selection procedure

1. **Filter** to frontal, direct-gaze images. Hold age band constant (FACES
   `young` alone is simplest) or balance it explicitly across cells — do not
   leave it to vary freely, since apparent age affects both salience and the
   social meaning of an expression.
2. **Normalise** the images: oval crop removing hair and background, equal pixel
   dimensions, matched mean luminance and RMS contrast. Cues must be
   discriminable from each other without differing in low-level salience by
   condition, or "affect" partly measures image energy.
3. **Draw 48 identities** from the both-expressions subset: 12 per
   ethnicity × gender cell (Black F/M, White F/M).
4. **Partition into 2 disjoint session pools of 24**, each 6 per
   ethnicity × gender cell.
5. **Do not fix affect to identity.** Every model in the subset has both
   expressions, so which face appears angry and which happy is a per-participant
   draw: 3 per ethnicity × gender × affect cell, exactly balanced.
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

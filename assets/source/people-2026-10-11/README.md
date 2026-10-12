# People cast · issue 331

The nine-strip repair is prepared in [redo-workflow.md](redo-workflow.md).
Its first image call hit the built-in generator's usage limit; no new pose has
been painted yet. The original strips and all review/game-scale exports remain
unchanged. See `redo-state.json` for progress and the protected-file hashes.

28 painted RGBA strips for 10 people: the original passenger, five workers and
four additional passengers. Each person has front/back walk strips; lumberjack,
stone mason, farmer and pump hand also have front/back carry strips.

The author authorized smaller sources and additional identities after reviewing
the passenger pilot. Export canvas is now **768 × 512**, four **192 px** columns,
nominal figure height **360 px**, baseline **480**, nominal anchors
**(96,480), (288,480), (480,480), (672,480)**. Game review height is **9 px**.

Open `review/index.html` for animated native-size and magnified previews, filters,
phase selection and a **9 / 18 / 36 px** resolution selector (default: 36 px).
`review/resolution-comparison.png` compares all three sizes at 2× magnification.
`review/cast-overview.png` compares all ten identities;
`review/people-sheet-*.png` shows every strip's four phases reduced to 9 px.
Review backgrounds and labels are confined to the review artifacts.

## Game-scale exports

Every strip is also exported directly from the large painted source into
`game-scale/9px/`, `game-scale/18px/` and `game-scale/36px/`. These are actual
transparent PNG assets, not enlarged 9 px previews. There are 28 strips per size.
`game-scale/manifest.json` records canvas dimensions, columns, baseline and anchors.

| Figure height | Four-column canvas | Frame cell | Baseline | First anchor |
| ------------- | ------------------ | ---------- | -------- | ------------ |
| 9 px          | 64 × 16            | 16 × 16    | 14       | (8,14)       |
| 18 px         | 128 × 32           | 32 × 32    | 28       | (16,28)      |
| 36 px         | 256 × 64           | 64 × 64    | 56       | (32,56)      |

The 768 × 512 painted strips remain the source assets. Higher raster resolution
retains more painted detail but does not fix the animation draft issues below.

## Review status

These are **cast and animation drafts**, not production-approved cycles. Some
generated contact poses repeat the same thigh overlap rather than alternating
legs. The original passenger has proportion drift between replacement frames.
Variation packing centres the complete silhouette; asymmetric loads can offset
the body's centre from the nominal anchor. Wide front carry silhouettes are
compressed horizontally to fit their columns. Those points need refinement
before importing the strips into the game.

All strips were inspected at 9 px: hats, clothing clusters and broad loads remain
readable; fine face/clothing detail disappears. The automatic checks confirm
RGBA dimensions, transparent background, baseline, opaque foreground pixels and
clear frame margins. They do not validate anatomical phase alternation or camera
accuracy.

## Sources and repeatable export

`reference-passenger.png` is the unchanged style/character authority extracted
from the requested backup Git ref. `prompts.json` records the pilot, author
steering, export contract and review limitations. `generation-manifest.json`
records the additional built-in ImageGen prompts and corrections;
`variation-specs.json` describes the identities and loads. Selected variation
paintings are saved at 768 × 512 in `inputs/variations/`.

With Node.js and `sharp` available, run these scripts from this folder:

```text
node export-passenger.cjs
node export-variations.cjs
node export-game-scales.cjs
node build-review.cjs
node verify-exports.cjs
```

The export scripts perform mechanical alpha cleanup, extraction and packing;
character painting comes entirely from the built-in ImageGen tool.

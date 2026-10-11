# People cast · issue 331

28 painted RGBA strips for 10 people: the original passenger, five workers and
four additional passengers. Each person has front/back walk strips; lumberjack,
stone mason, farmer and pump hand also have front/back carry strips.

The author authorized smaller sources and additional identities after reviewing
the passenger pilot. Export canvas is now **768 × 512**, four **192 px** columns,
nominal figure height **360 px**, baseline **480**, nominal anchors
**(96,480), (288,480), (480,480), (672,480)**. Game review height is **9 px**.

Open `review/index.html` for animated native-size and magnified previews, filters
and phase selection. `review/cast-overview.png` compares all ten identities;
`review/people-sheet-*.png` shows every strip's four phases reduced to 9 px.
Review backgrounds and labels are confined to the review artifacts.

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
node build-review.cjs
node verify-exports.cjs
```

The export scripts perform mechanical alpha cleanup, extraction and packing;
character painting comes entirely from the built-in ImageGen tool.

# Asset generation checkpoint

## Base library complete — 2026-09-19

**147 of 147 base entries saved; zero missing or unmapped entries.** All 147 PNGs
pass the existing alpha validator. The gallery and coverage reports are current.
This continuation added 85 missing images using the built-in image generator;
existing images were preserved. Every queued image has its exact prompt recorded.
Seventeen older prompt records now also have explicit filenames. Seven pre-existing
images lack prompt records in the recovered manifest; these provenance gaps are
listed in `completion-report.json`, not filled with invented prompts.

All 52 railcraft have source images and integration specifications in `RAILCRAFT.md`
and `railcraft-specifications.json`. The user approved the existing image style and
requested documentation rather than regeneration. No railcraft image was replaced.

Remaining integration work: scale normalization, independent rigid-body and bogie
layers, anchors, facings/variants, animation and in-game track-motion verification.
There are 77 files with alpha edge warnings and six earlier terrain design flags;
the six candidate corrections remain in `corrections/` without being promoted.
Alpha validation does not certify mechanical or visual correctness. No images have
been integrated into the runtime atlas. This completes the requested base library.

Review `index.html`, `RAILCRAFT.md`, `coverage.json`, `alpha-report.json`, and
`completion-report.json` locally. Keep media and verbose reports out of chat.
The recovery sections below are historical checkpoints; their counts are superseded.

## Railcraft clarification — 2026-09-19

The user likes the existing images: **keep them unchanged**. Document mechanics
for every locomotive and wagon, including already-generated images, rather than
regenerating them. `RAILCRAFT.md` and `railcraft-specifications.json` now cover all
52 railcraft definitions, derived from the checked-in roster, body solver and
track compatibility functions. Regenerate those documents with
`node scratchpad/prepare-railcraft-assets.mjs`. They specify runtime scale, rigid
segments, fixed axles versus bogies, articulation, track classes and conversion
requirements. These are game definitions, not claims about historical prototypes.
Continue generating only missing base PNGs; use `coverage.json` for live totals.

## Recovery after request-size failure — 2026-09-19

Recovered the text-only history of **Review asset image changes**
(`01a0ba90-edf0-72e1-84f7-10ef04aed46f`) after its request exceeded
67,108,864 bytes (64 MiB). The exact source of the oversized payload is unconfirmed.
User preference: keep assets in this repository; no inline media or large content
dumps in chat. This preference is also recorded in the root AGENTS.md.

Confirmed scope: finish the generated image library using the art-direction guide
before runtime integration. Current inventory: **62 of 147 base entries present;
85 pending**. Coverage and the alpha gallery were refreshed successfully; edge
warnings remain. Six correction PNGs exist in `corrections/` but are not promoted
or marked resolved: cursor, hillcut, plains, rock, swamp, taiga. Review them before
promotion. No runtime integration has been performed.

Added `loco-rocket.png` using the built-in tool; alpha validation passed with a
1/255 bottom-edge warning. Visual review is pending. Exact prompt is saved in
`generation-prompts.json`. Next missing queue entry: `loco.adler`.
The user confirmed continuing to save all base assets. Continue with the built-in
generator and suppress image embeds in chat output. Read `coverage.json` for live
counts as each generation batch updates the gallery and reports. Continue in queue order and save each
result immediately. Keep status messages short and tool outputs bounded. Historical
counts below describe earlier checkpoints, not the current inventory.

Recovered on 2026-09-19 from the archived Codex task **Fix large locomotives on curves**
(`01a0960e-675f-7510-858f-90e0fc9d0317`). The task has been unarchived.

## Where we left off

The latest asset request in that task was: “What about 01 land and biomes (all assets)
and 02 natura and small objects”. Continue those categories using separate transparent
PNG source images in the existing pastoral railway style.

At recovery, 23 PNGs existed: oak, spruce, cottage, station, windmill, water tower,
warehouse, depot, civic townhouse, wood and stone bridges, kiln, grinder, refinery,
substation, farm, lumber, quarry, pump, power plant, hydro plant, coaling stage, signal.
All 23 passed the existing alpha validator; several have edge-touch warnings that
still need visual cleanup review.

## References and tracking

- `docs/art-direction/images/01-land-biomes.png`: terrain direction.
- `docs/art-direction/images/02-nature-objects.png`: nature direction.
- `docs/art-direction/images/03-theme-town-growth.png`: established shared style.
- `generation-prompts.json`: prompts and original generation paths.
- `coverage.json`: 147 base-family entries, including remaining variants.
- `alpha-report.json` and `index.html`: validation and preview gallery.

Generate with the built-in image tool, one asset per image. Preserve real alpha.
Save new images here, record their prompts, and add filename aliases to
`scratchpad/refresh-base-coverage.mjs` before refreshing coverage.

```sh
node scratchpad/verify-base-assets.mjs
node scratchpad/refresh-base-coverage.mjs
```

These are source images, not finished runtime sprites. Runtime integration, exact
tile geometry, anchors, rotations, levels, and animation variants remain pending.
No generated image has been integrated into `public/assets` yet. Terrain bases
must eventually fit the game's 64x32 diamond and shared tile edges.

## Resumed work

Added `terrain-grass.png` using the built-in image tool. Its prompt is recorded in
`generation-prompts.json`. The library now has 24 generated base images and 123
pending entries. The grass image passes the alpha validator, with top/left
edge-touch warnings; it still needs geometry and edge review before runtime use.
Continue with the remaining terrain and nature entries in `coverage.json`.

## Current scope and resumable queue

The user confirmed: **finish the generated image library first**, before runtime
integration. The guide matches the linked branch's commit
`d01ac5ed7dfa63430fddad5a81586a73dc4625ae`.

`generation-queue.json` now records a prompt, reference board, filename and status
for each of the 123 base entries missing when this continuation started. Use its
pending entries; do not regenerate finished images. `coverage.json` and
`alpha-report.json` carry current totals, superseding historical counts above.

Use `node scratchpad/import-generated-asset.mjs <coverage-id> <generated-png>` to
copy a built-in image result here and record its exact prompt. Existing files are
protected from overwrites. Then refresh coverage and validation as above.

`drafts/oil-seep-rejected-pump.png` is an incorrect natural-seep attempt containing
industrial machinery, excluded from accepted coverage. Its replacement must show
only a flat natural oil puddle. The gallery preserves image proportions and offers
light, dark and checker backgrounds plus filename search.

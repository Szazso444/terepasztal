# Mountain surface swatches

Five independent built-in ImageGen paintings, using the four required references on every call.
All requests asked for 1024x1024; all returns are opaque 1254x1254 PNGs. The original PNG bytes
are preserved without resizing, cropping, padding, filtering, mirroring or retouching.

`prompts.json` records every prompt, reference and actual returned dimensions. No rejected
attempts or retries were made. `make-swatch-guides.mjs` writes the scale card and geometry;
the card was never attached to ImageGen.

`review-swatches.mjs` creates separate 199x199 area-averaged inspection copies and a contact
sheet. Originals are untouched. Sheet order: snow, high rock, alpine ground, glacier ice,
moraine. At this scale, snow reads as soft blue-grey drifts; rock as fractured plates; alpine
ground as moss/turf, lichen and scree; ice as matte blue-grey ice with crevasses; moraine as
mixed loose rubble with dirty ice. Upper-left lighting and edge coverage are retained.

## Limitations

ImageGen did not enforce the requested colour ceiling exactly. The numerical check in
`review/validation.json` measures Rec.709 weighted RGB brightness against cursor #ECE4D0.
Snow has 124543 pixels at or above that brightness (about 7.9%); alpine ground has 37,
glacier ice 175, and moraine 105. High rock has none. Snow therefore needs the author's
attention before runtime integration. The other exceedances are sparse source highlights.
These are not palette-compliant final runtime materials. The brief permits retries only
for wrong material or non-flat swatches, and prohibits retouching, so the paintings are
preserved and the brightness limitation is disclosed instead of changing their pixels.

The request specified `art/<n>-mountain` without an issue number. No matching remote branch
existed. This work uses #353, the existing landscape material issue, as the branch identifier.
No renderer, packer, fallback tile, atlas or gameplay files were changed.

## Repository checks

Typecheck (both configurations), ESLint, Vite production build, changed-file Prettier,
Git whitespace check, and Art scope check passed. The build has the existing bundle-size warning.
The repository-wide Prettier check reports 374 untouched files; no formatting outside this
folder was changed.

The initial full test run reported 1947 passed, 14 failed and 11 pending out of 1972 assertions,
plus failed suite imports. Missing `python` on PATH caused the pipeline failures. Retrying all
failed suites with the bundled Node 24 and Python passed 26 of 29 assertions, with 2 pending.
Two untouched suites still fail: `tools/agents/ownership.test.mjs` cannot import ("Invalid or
unexpected token"); `tools/asset-pipeline/handbuilt/run.test.mjs` fails its path property at
seed 19, case 19. Compact results are in `review/checks.json`. The full test gate is not green.
The C: drive had zero free bytes, so test temporary files were redirected into the ignored
`review/.tmp/` folder on G:. No user files were deleted to free space.

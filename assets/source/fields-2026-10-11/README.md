# Wheat field painting material

Three independent edits of `guides/wheat.png`, using the built-in image tool and the four
references recorded with every prompt in `prompts.json`:

- `wheat-0.png`: ripe gold rows.
- `wheat-1.png`: ripe rows with greener ends toward the upper right.
- `wheat-2.png`: ripe rows interrupted by small flattened patches and a ragged corner.

These are unmodified painting material, not finished atlas sprites (`finished/` has those). Every returned PNG is kept
at its original dimensions and alpha. No original was fitted, cropped, warped, resized,
padded, mirrored or retouched. The tool was asked for 1024x1024 each time; actual dimensions
are read with pngjs into `prompts.json` and `review/measurements.json`.

The gold variant's first attempt was enlarged and is preserved in
`raw/wheat-0-attempt-1.png`. Its retry restored the lower framing. The accepted paintings
still have wider footprints than the guide (about 1.4 times), which the finishing step
corrects.

## Finishing: `tools/finish-fields.mjs`

`node tools/finish-fields.mjs` turns the three paintings into the frames `props/wheat_0..2` and
lays them over the generator in `public/assets/props.{png,json}` (`partial`, `resolution` 4). It
writes the finished frames to `finished/wheat_N.png`. pngjs only; the paintings are never
touched. Per painting, in order:

1. Scale about the tile centre (the anchor) by 0.72, 0.77 and 0.73 (the art review of
   2026-10-11), on top of the ratio between the painting's canvas and four texels per world px.
2. Recentre wheat-2, which sits about 2 world px high after scaling (3 before it), onto the other
   two's centre of mass.
3. Alpha from `geometry.json`: nothing outside the patch's bounds (0.42 tile, plus the 0.04 wander
   on the SE and SW sides).
4. Raise: the field is a low raised patch. Every footprint texel becomes a column of stalks 2.6 to
   3.5 world px high (the demo's heights; the furrows lie lower than the ridges, a ragged edge ends
   in lower stalks), the painting is the heads, the front shows under them darker toward the
   ground, lit on the lower left and turned from the light on the lower right. The ground
   footprint and the anchor do not move. `--raise 0` skips this for a painting that already
   stands up (`PROMPT.md` asks for those).
5. Highlight cap: no pixel reaches the selection amber `#E8AA48` or the cursor white `#ECE4D0` in
   all three channels; red is held under 226 with a soft knee, the hue kept.

The frames are packed in a row of their own under the frames `props.png` already has, which stay
byte for byte where they are, so run it after `tools/illustrated-sprites.mjs` (which writes
`props.png` without them). `node tools/finish-fields.mjs --check` exits 1 if the shipped atlas is
not what the script builds, and `tools/finish-fields.test.mjs` runs that check.

## Asking for the raised version: `PROMPT.md`

`PROMPT.md` is the prompt for an illustrated version that stands up on its own, edited from
`guides/wheat-raised.png` (`make-raised-guide.mjs` draws it: the flat guide's footprint with the top
face lifted 3 game px and the two fronts that face the viewer under it).

`make-guides.mjs` reads `FOOTPRINTS.t1`, draws the grey diamond/patch/rows with pngjs, and
writes the numerical contract to `geometry.json`. Run from the repository root:

```sh
node assets/source/fields-2026-10-11/make-guides.mjs
node assets/source/fields-2026-10-11/check-materials.mjs
```

`check-materials.mjs` verifies RGBA format, unique accepted painting hashes, and actual PNG
sizes. Only the separate `review/wheat-*.png` copies are downscaled, using area sampling to
a 128px-wide canvas (nominal tile width 64px), and composited on crop green for visual review.
The source images remain untouched.

## Validation

PNG sizes, RGBA format and distinct source hashes pass. At nominal 64px tile scale, each
painting retains readable rows and a soft edge. The guide and review scripts pass Node's
syntax check and this folder passes Prettier. Typecheck, lint and production build pass.

The repository-wide formatting check reports 374 existing files outside this folder. The
full test run initially failed because C: had no free space; rerunning with temporary files
on G: exposed unrelated Python pipeline failures (`spawnSync python ENOENT`). That rerun
was stopped while the slow building-queue suite was still running; a full passing test gate
is not claimed. Check logs remain locally under `review/gate-*.log` and are ignored.

The image tool could not save its later returns on the full C: drive. Their PNG data was
decoded directly to G:, preserving the returned bytes. No disk cleanup was performed.

# Wheat field painting material

Three independent edits of `guides/wheat.png`, using the built-in image tool and the four
references recorded with every prompt in `prompts.json`:

- `wheat-0.png`: ripe gold rows.
- `wheat-1.png`: ripe rows with greener ends toward the upper right.
- `wheat-2.png`: ripe rows interrupted by small flattened patches and a ragged corner.

These are unmodified painting material, not finished atlas sprites. Every returned PNG is kept
at its original dimensions and alpha. No original was fitted, cropped, warped, resized,
padded, mirrored or retouched. The tool was asked for 1024x1024 each time; actual dimensions
are read with pngjs into `prompts.json` and `review/measurements.json`.

The gold variant's first attempt was enlarged and is preserved in
`raw/wheat-0-attempt-1.png`. Its retry restored the lower framing. The accepted paintings
still have wider footprints than the guide, so the Art role's deterministic finishing step
must enforce the inset geometry and 16px ear allowance before packing `props/wheat_0..2`
at atlas resolution 4. No finishing script or atlas integration is included here.

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

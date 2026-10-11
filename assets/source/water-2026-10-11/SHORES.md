# Lake and sea shore source paintings

`lake-ring.png` and `beach-ring.png` are independent built-in ImageGen edits of
their grayscale guides. Both requested 1024×1024 and returned **1254×1254**, RGBA
PNG color type 6. The originals are copied byte for byte; no fitting, cropping,
warping, resizing, padding, recoloring or alpha cleanup was applied. Partial alpha
and faint edge fringes are retained for the later deterministic finishing step.
No rejected painting attempts were needed.

The lake has still teal water, a lighter shallow band and a narrow damp mud,
small pebble and moss margin. The beach has sea teal, soft concentric surf lines,
cooler wet sand and warmer dry beach sand. Only the lip changes with upper-left
lighting. There are no reeds or scenery props. These are material rings, not
finished shore tiles; the future finishing script owns exact edge geometry.

`make-shore-guides.mjs` reproduces the two grayscale guides, writes all specified
geometry to `shore-geometry.json`, and creates missing center hue crops without
overwriting existing references. The image tool received the guide as its edit
target followed by three references for each painting. Optional water/sand swatches
were unavailable when the corresponding reference lists were assembled.
Exact prompts, ordered references and actual returned dimensions are recorded in
the shared `prompts.json` list.

`check-shore-rings.mjs` records original hashes, dimensions and alpha counts in
`qa/shore-png-check.json`. Its only resized outputs are the separate 128×128
review copies in `qa/`: one guide tile becomes 64×32 game pixels. Visual review
confirmed continuous bands with consistent apparent radial width at the near,
far, left and right arcs. Small painted edge irregularities remain in the originals.

Validation: typecheck, lint and production Vite build pass. The existing large
bundle warning remains. The repository-wide formatting check reports 374 existing
files outside this task; they were left untouched. The shore scripts and JSON
pass their own Prettier check. `npm test` reported failures in unchanged suites
(including atlas packing and renderer suites) and then stalled without further
output; it was stopped after several minutes. The system C: drive was full during
verification (`npm` also reported ENOSPC). Complete test success is unverified.
The baseline source code is unchanged. Check logs are retained as `qa/shore-*.log`.

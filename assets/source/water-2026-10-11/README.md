# Water painting material

The pictures the approved water demo uses for rivers, waterfalls and the beach, picked by the author on
2026-10-30 (#343). This is unmodified painting material, not finished atlas frames. Nothing in the game
reads this folder yet: #365 draws rivers, waterfalls and beaches, and the finishing step belongs to it.

| Picture                                  | What it gives the demo                                  |
| ---------------------------------------- | ------------------------------------------------------- |
| `river-water.png`                        | River water, and the current that fades out at a mouth. |
| `river-strip-x.png`, `river-strip-y.png` | Straight river water. Only the water is used.           |
| `river-pool.png`                         | Open river water for the middle of a junction.          |
| `river-end.png`                          | Round river end at a source. Only the water is used.    |
| `river-bank.png`                         | Gravel and mud for the wet band beside the bank.        |
| `beach-sand.png`                         | Beach sand.                                             |
| `fall-sheet-lit.png`                     | Falling water on the sunny side.                        |
| `fall-sheet-shade.png`                   | Falling water on the shaded side.                       |

## What the finishing step has to do

- The stone rims on the strips and on `river-end.png` stay out of the game. The shore line is drawn, not
  painted.
- The fall sheets go brighter than the house limit in places. Cap them at `#E0DDD2`, the `whiteMaximum` in
  `fall-geometry.json`.
- The approved waterfall steps, wet rock, spray, winding bank and river mouth are not in these pictures. The
  demo's code draws them, and the only copy of that code is `index.html` in the art demo
  (https://claude.ai/artifact/4VZ9hkVryfLS2hpHAg94sb, v9.2, the v7 look with later notes). #365 has to port
  it.
- Lakes use the sea's water, so no separate lake picture is here.

## The other files

- `prompts.json` is the full painting record: every prompt and reference, in order. It also lists attempts
  and pictures that did not come here. Those are kept on the branch `art/343-water` (`raw/`, the rings,
  `lake-water.png`, the cliff, plunge foam and river mouth pictures, and `wet-sand.png`, which waits until
  #365 asks for it as a material).
- `swatch-geometry.json`, `river-geometry.json` and `fall-geometry.json` hold the measurements.
- `make-swatch-guides.mjs`, `make-river-guides.mjs` and `make-fall-guides.mjs` rebuild the guides, the
  geometry and `refs/`. They also write guides for pictures that are not here. Only the guides these
  pictures need are kept in `guides/`.

# Production terrain material

`rock-surface.png`: flat illustrated rock material generated with the built-in
ImageGen tool. Approved `base-v1/terrain-mountain.png` and `terrain-hill.png` were
style references. Exact request is in `rock-prompt.json`.

`foundation-reference.png`: user-provided red markup showing the narrow model-base
contact strip requested during implementation. Reference only; not a runtime asset.

The runtime pack is built by `npm run art:terrain`. The generated hill board remains
a separate concept in `../terrain-v4`; the game uses shared-corner geometry, texture
samples, and sparse original illustrated summit caps.

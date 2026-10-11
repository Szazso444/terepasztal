# Remaining building set

User-approved scope: 24 remaining static building types, four facings each.
Eight small services occupy one tile; sixteen larger buildings occupy two tiles.
The approved split is recorded in ../remaining-building-plan.json.

One built-in imagegen call per facing, using a repo-local 512px reference derived
from the corresponding original base-v1 image. Exact prompts are saved per building
as *.prompts.json. Original sources are unchanged. No mirrored front-view substitutes.

These are first-pass art candidates, not mechanically certified replacements.
Door size, machinery alignment, projection and detail continuity need per-asset
review. The generated source alone cannot guarantee physical dimensions or the
correct position of a depot gate, loading chute or pipe connection. None of those
functional connections are changed in the real game.

The POC keeps one/two-cell collision footprints independent of the images and
draws material-colored yards underneath, clipped to the footprint. Asset choice
survives POC save/load. Real-game saves, vehicle physics and production atlases
are unaffected. Vehicles, terrain, tracks, bridges, signals, overhead wires,
foliage, UI and effects are not part of this building batch.

Build local sprites: node scratchpad/building-poc/build-remaining.mjs --require-all
Verify: node scratchpad/building-poc/verify-library.mjs --require-all
Contact sheets: node scratchpad/building-poc/contact-library.mjs
Review: http://127.0.0.1:5173/scratchpad/building-poc/library.html

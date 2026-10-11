# Grid building placement POC

Illustrated assets are now the default. Toggle Illustrated assets to compare with
the geometry model. assets.html shows all eight facings on the same display scale.
Source PNGs and exact built-in imagegen prompts are in assets/source/building-poc-v1.
Run node scratchpad/building-poc/build-assets.mjs to rebuild the local sprite crops
and guide-derived anchors. These first-pass generated views still need visual approval.

Open index.html through Vite. House occupies one cell; station occupies two.
Four model views are rendered from geometry. Yards share the footprint and rotate
with the building. The same footprint module drives ghost, occupancy, picking,
rotation and demolition. Clicking either cell selects a two-cell building.

R rotates the placement preview. The rotate tool rotates an existing building;
an obstructed rotation leaves it unchanged. Track is a simple one-cell access
fixture, not the production track graph. Stations detect adjacent track on any
side; platform rules remain unchanged in the real game. No trains, production,
costs, routing, upgrade rules or real save migrations are implemented here.

Save/load uses the isolated localStorage key terepasztal-building-poc-v1.
The real game save and simulation are untouched. This is a mechanics POC with
simple geometry available for comparison; production integration remains separate
work. The approved shoreline study is preserved.

Tests: tools/building-footprint-study.test.mjs and tools/building-poc.test.mjs.

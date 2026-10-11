# Actual-game candidate QA

This fixture loads the original-Rocket reconstruction into **the real game**. It constructs `Game`, `AtlasRegistry`, `TrackGraph`, `Fleet`, `Train`, `WorldRenderer` and `TrainRenderer` from repository source. Simulation advances through `Fleet.tick(1/60, ...)`, including occupancy and traffic assignment. Tracks, people, buildings and the coupled coach are the game's own assets.

The fixture gives the train a deterministic test route using its internal `setPath` method. It does not test autonomous destination choice, economy, loading or station scheduling. This is a renderer/movement integration test, not a full gameplay regression suite.

## Run

From `C:/Users/Zso/terepasztal`:

```
node scratchpad/asset-qa/prepare.mjs
node scratchpad/asset-qa/serve.mjs
node scratchpad/asset-qa/verify.mjs
```

Open `http://127.0.0.1:5190/scratchpad/asset-qa/`. Run/pause, reverse, reset, change zoom, or toggle the procedural baseline at the identical simulation pose. The 5190 origin is isolated from the usual 5173 game. Automated tests also use a fresh browser context. No normal game save is loaded, and autosave is disabled. The candidate atlas stays in this fixture rather than `public/assets`.

The original game checkout is still on C:. G:/DEV/Terepasztal contains the image/3D pipeline, not a game Git checkout. Results and a copy of this fixture are delivered under G:/DEV/Terepasztal/poc/rocket-original-v1/runtime-qa.

## Automated checks

- All 25 drawn frames exist, contain nontransparent pixels, have transparent borders, and valid anchors.
- The candidate actually replaces the expected global frame keys; resolution 4 produces 96x96 logical frame canvases and the expected ground anchor.
- Real `TrainRenderer` sprites use the expected textures and mirror partner, with no body stretching.
- A complete forward and reverse run covers all 48 headings, straights, curves, a straight switch route and a diverging switch route.
- Every simulation sample has finite positions/angles; coupled vehicles stay in the actual consist.
- Reversal preserves the per-vehicle centre positions.
- A/B art switching changes textures without moving the vehicles.
- Screenshots, an actual game-canvas video, and a JSON report are recorded. Browser exceptions fail the run.

## Acceptance is deliberately split

`report.json` records runtime integration results separately from `visualAcceptance`. Passing motion tests does **not** mean the reconstructed wheels meet the rails. This candidate has prior uncalibrated wheel/gauge and colour-shift findings. The actual-game curve captures also show the fixed wheels need careful contact review.

Full automatic geometric acceptance needs authored model-space landmarks for wheel tread contacts, axle centres, couplers and the ground anchor. The checker can then transform those landmarks by the actual runtime sprite/rigid-body pose and compare them to the rendered rails, rather than guessing from the image silhouette. Until that metadata and a shared scale policy exist, production acceptance remains blocked. Human/building scale is shown in the real world, not declared correct by equal thumbnail sizes.

Only regular-track operation is covered here; no high-speed, bridges, grades, separate bogies or other vehicle types are certified by this Rocket test.

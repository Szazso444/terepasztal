# Curve and art verification

All evidence uses seed 4242 and procedural assets. `before` is commit `e5f338b`; `after` is this change.

| Evidence                                                  | Before                       | After                      |
| --------------------------------------------------------- | ---------------------------- | -------------------------- |
| Real depot-to-quarry rollout, zoom 4                      | [before](rollout-before.png) | [after](rollout-after.png) |
| Six models on reference curves, production Pixi rendering | [before](curves-before.png)  | [after](curves-after.png)  |
| Asset families                                            | [before](assets-before.png)  | [after](assets-after.png)  |
| Full compatibility measurements                           | [before](compat-before.json) | [after](compat-after.json) |
| GPU alpha containment                                     | [before](mask-before.json)   | [after](mask-after.json)   |
| Atlas generation and bounds                               | [before](assets-before.json) | [after](assets-after.json) |

The curve sheet labels the **rigid simulation angle**; the long visual halves have separate headings.
The rollout keeps the camera update frozen solely to retain zoom 4 during capture, fills the test
locomotive's fuel tanks, replaces the gate tile with high-speed rail, and advances the actual fleet
in 1/60-second steps until the lead segment reaches 40°. Its before/after pose JSON should match.

## Run

Start Vite at 127.0.0.1:5173. Use an installed Playwright runtime; this scratchpad adds no package
dependency. `runtime.mjs` supports `PLAYWRIGHT_MODULE` and `BROWSER_EXECUTABLE`; it also tries the
provided `/opt/node22/lib/node_modules/playwright/index.mjs` path, the usual local package and a
sibling scratch installation. Chromium launches headlessly with SwiftShader.

```sh
npm run dev -- --host 127.0.0.1
# In another terminal:
node scratchpad/verify-curves.mjs after
node scratchpad/rollout.mjs after
node scratchpad/verify-assets.mjs after
node scratchpad/gpu-check.mjs after
```

The GPU suite takes several minutes. It sweeps **all** medium and large definitions over each
allowed class's entire reference path in 0.05-tile increments, four rotations, left/right turns,
forward/reversed artwork and interpolation alpha 0.5 between poses 0.02 tiles apart. Body-only
and masked-bogie-only passes use the same frame and resolution in the real Pixi GPU extractor.
Every nonzero bogie alpha must land on a nonzero body alpha; no tolerance or alpha cutoff hides
stray pixels. Non-empty extraction is checked, too. The suite then disables the production masks
as a negative control and checks representative stock at 0.5×, 2× and 4× extraction resolutions.
Results go to `mask-after.json` and `mask-controls.json`; a containment failure exits nonzero.

For a fresh baseline, create a detached checkout at `e5f338b`, run its Vite on port 5174 and copy
`browser-check.js`, `gpu-masks.js` and `art-board.js` into its `scratchpad` directory. Run the same
commands with `before`. `BASE_URL` overrides either port. The baseline GPU test deliberately
asserts that the defect is present, while the after run requires zero escaping pixels.

`verify-assets.mjs` regenerates all nine atlas groups, records duration/dimensions/frame counts,
asserts every packed rectangle and anchor is valid, and captures a representative contact sheet.
`verify-curves.mjs` also asserts the required large-rigid compatibility verdicts.

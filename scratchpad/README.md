# Rigid bogies and congestion verification

Current acceptance follows the player's clarification: rigid casings and visibly independent
four- or six-wheel bogies. The old containment requirement is superseded; its archived tests and
images below explain the earlier result and are not the current regression gate.

| Current evidence                                                     | Files                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Actual depot rollout, same pose and zoom                             | [before](rollout-rigid-before.png), [after](rollout-rigid-after.png)            |
| Movement across a curve, two/three axle groups                       | [sequence](bogie-sequence.png)                                                  |
| Large rigid, Meyer, Garratt and medium stock                         | [curve sheet](curves-rigid-after.png), [compatibility](compat-rigid-after.json) |
| 52,128 rail-position, facing, part-count and alpha visibility checks | [report](bogie-motion-report.json)                                              |
| Procedural atlas generation and bounds                               | [report](assets-rigid-after.json)                                               |
| Both head-on trains have their escape blocked by a queue             | [before](traffic-before-4-blocked.json), [after](traffic-after-4-blocked.json)  |
| Twelve-train queue with passing sidings                              | [before](traffic-before-12.json), [after](traffic-after-12.json)                |

The rollout before image uses the merged first art pass at 046b060. Traffic baselines use the
unchanged earlier traffic implementation at e5f338b. All tests use fresh headless browser contexts,
seed 4242, the production Pixi renderer and procedural art. They do not modify a player's save.

## Current commands

Start Vite at 127.0.0.1:5173. The existing runtime helper finds the externally installed
Playwright and launches Chromium with SwiftShader; no package dependency is added. Set BASE_URL
or PLAYWRIGHT_MODULE if the server or test runtime lives elsewhere.

```sh
node scratchpad/verify-bogies.mjs
node scratchpad/verify-bogie-sequence.mjs
node scratchpad/verify-curves.mjs rigid-after
node scratchpad/rollout.mjs rigid-after
node scratchpad/verify-assets.mjs rigid-after
node scratchpad/verify-traffic.mjs after 4 blocked
node scratchpad/verify-traffic.mjs after 12
```

The bogie sweep samples every 0.1 tile over each permitted reference path, with four rotations,
both turn hands and both travel orientations. Body-only and bogie-only GPU alpha passes count
visible wheels; full containment is deliberately rejected. Sprite centres must equal rail
positions and each bogie must use its own facing, residual rotation and correct axle-group texture.
Every segment keeps its prescribed length and there are no extra visual body parts or masks.

Traffic fixtures advance the real Fleet at 20 steps per simulated second. One-shot virtual exits
remove arrived trains; a small fixture adapter resumes yielded trips using the real track graph
and occupancy/claims, so absent production stations do not cause artificial permanent jams.
The blocked-escape fixture stays jammed at the 240-second baseline cap and clears in 37.05 seconds
after the fix, with no overlaps or stuck/deadlock episodes. The 12-train queue clears safely in
83.95 seconds versus 71.3 seconds previously: exit reservations trade some throughput for avoiding
conflicting recovery. Neither test implies that a network without spare siding capacity can clear.
Use the same commands with 'before' and a baseline server on port 5174 to reproduce comparisons.

The debug panel shows current blocking groups and escape owners. The game's exported traffic log
includes wait-for edges and reserved corridors. During local development, /__traffic on the Vite
server exposes browser reports over loopback; reports expire after a minute, live only in memory,
and do not include saves. The original live browser was unavailable to this task; these reports
are from isolated regression worlds.

---

# Archived first art pass

All evidence uses seed 4242 and procedural assets. `before` is commit `e5f338b`; `after` is the rejected hinge/mask pass in commit `19da25f`.

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

# Terepasztal performance measurement, 2026-10-27

The measurement behind the Performance epic #45 and its tasks #552–#561. The tools named here
(`tools/cdp.mjs`, `tools/harness.js`, `tools/summarize.mjs`, `tools/scale.test.ts`) land under
`tools/perf/` in #553. The flame graphs (`flames/`) and raw profiles (`raw/`) are large and stay
outside the repository, in the author's notes folder `perf-2026-10-27/`.

Measured only; nothing was optimised. Code: `origin/develop` at
f095a1c9 in a detached worktree `G:\DEV\wt\perf-measure` (scratch files there: `vite.perf.config.ts`,
`public/__perf/`, `src/__perf__/`, none tracked).

## How it was measured

- **Browser**: Chrome 156 headless (new mode) on this machine, real GPU (ANGLE D3D11, RTX 5070 Ti),
  1904×985 at DPR 1, driven over the DevTools protocol (`tools/cdp.mjs`). The built-in browser pane
  was hidden for the whole session, which throttles `requestAnimationFrame`, so it could not give
  frame numbers. Headless Chrome is not vsync-capped, so it ran at 77–171 fps: read the per-frame
  **ms**, not the fps.
- **Production build** (`vite build` + `vite preview`) for all numbers; the dev server only for a
  comparison (same per-frame cost, slower boot).
- **Timers**: `tools/harness.js` wraps the game's own methods on `window.game` (update, SimStep.run,
  fleet.tick and its parts, Train.tick, Signals.ahead, drawFrame and its parts, Pixi
  `renderer.render`) with `performance.now()`. **CPU profiles**: V8 sampling profiler at 0.2 ms,
  minified frames resolved through the build's source maps (`tools/summarize.mjs`). **GC**: Chrome
  trace (`v8.gc` events).
- **Headless**: `tools/scale.test.ts` (vitest) for `Signals.ahead`, `findPath` and `SimStep.run`
  against size.

### Scenarios

| Id  | World                                                                                                                                                                         | Trains | Signals | Scene objects |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- | ------------- |
| S1  | new game, seed 4242, 160×160                                                                                                                                                  | 0      | 0       | 19,524        |
| S2  | the author's `engine-models-demo.json` save, 140×140 level                                                                                                                    | 40     | 0       | 31,649        |
| S3  | new game grown to 480×480 (tuning `mapSize` 480), 40 scripted lines with depot, quarry, warehouse and a semaphore every 10 tiles (absolute block), trains refuelled by script | 68     | 232     | 34,008        |

S3 is synthetic: straight single-track lines, many stray depots (249 stations), two trains on some
lines (they yield). It stresses trains, signals and traffic; it is not a played map.

## Numbers

### Per frame (production build)

| Scenario      | p50 frame | p95  | p99  | update (sim) | drawFrame | Pixi cull (est.)¹ | Pixi render | ≈ CPU per frame |
| ------------- | --------- | ---- | ---- | ------------ | --------- | ----------------- | ----------- | --------------- |
| S1 160², 1×   | 5.6 ms    | 14.0 | 24.9 | 0.02 ms      | 1.15 ms   | ~2.9 ms           | 1.11 ms     | ~5.2 ms         |
| S2 demo, 1×   | 8.4 ms    | 25.1 | 38.8 | 0.34 ms      | 2.67 ms   | ~4.1 ms           | 2.09 ms     | ~9.2 ms         |
| S2 demo, 3×   | 11.1 ms   | 30.7 | 41.7 | 0.77 ms      | 3.03 ms   | ~4.8 ms           | 2.40 ms     | ~11.0 ms        |
| S3 480², 1×   | 8.4 ms    | 27.8 | 44.4 | 0.95 ms      | 3.95 ms   | ~3.0 ms           | 1.36 ms     | ~9.3 ms         |
| S3 480², 3×   | 8.4 ms    | 36.0 | 55.6 | 2.93 ms      | 3.85 ms   | ~3.1 ms           | 1.41 ms     | ~11.3 ms        |
| S1 dev server | 5.5 ms    | 11.2 | 16.8 | 0.02 ms      | 0.99 ms   | –                 | 1.05 ms     | same as prod    |

¹ The culler runs inside Pixi's ticker before `renderer.render` and could not be wrapped; its
per-frame cost is the profile's cull/render ratio times the timed render.

The 60 Hz budget is 16.7 ms. The averages fit with room to spare; the **p95/p99 do not** on S2 and
S3 (25–56 ms): those frames carry a sim spike (one `SimStep.run` up to 36 ms, three of them in one
3× frame up to 66 ms) or the renderer's signal pass (up to 17–27 ms).

### Where the CPU goes (share of main-thread samples, 10 s profiles)

|                                                                | S1 small | S2 demo 3× | S3 large 3× |
| -------------------------------------------------------------- | -------- | ---------- | ----------- |
| Pixi `Culler.cull` (whole scene graph, every frame)            | **41%**  | **37%**    | **27%**     |
| Pixi `renderer.render` (instruction build, batching)           | 16%      | 19%        | 12%         |
| `drawFrame` (game's own per-frame JS)                          | 14%      | 23%        | 31%         |
| – of which `setAtmosphereTint`                                 | 8%       | 6%         | 2.5%        |
| – of which `GroundLights.update` (night only)                  | –        | –          | 9.6%        |
| – of which `trainRenderer.update`                              | –        | 6.4%       | 5.5%        |
| `SimStep.run` (all simulation)                                 | 0.5%     | 7%         | **25%**     |
| – of which train motion (`tickMove`, `updatePoses`, `body.ts`) | –        | 4%         | 15%         |
| – of which `traffic.assign`                                    | –        | <1%        | 3.5%        |
| – of which signals (`Signals.aspect`, sim and renderer)        | –        | –          | 3.3%        |
| Garbage collector                                              | 0.6%     | 0.6%       | 0.9%        |

Flame graphs (root on top, colour by area): `flames/1-small-160-frame.png`,
`flames/2-demo-40-trains-x3.png`, `flames/3-large-480-68-trains-x3.png`,
`flames/4-large-480-sim-only.png` (inside `SimStep.run`), `flames/5-boot-and-first-frames.png`.

### Per simulation tick (`SimStep.run`, one 0.05 s step)

| Scenario                    | mean       | max | fleet.tick | all Train.tick    | Signals.ahead  | pathTo (findPath) | occupancy rebuilds       |
| --------------------------- | ---------- | --- | ---------- | ----------------- | -------------- | ----------------- | ------------------------ |
| S1 (0 trains)               | 0.13 ms    | 1.0 | 0.03       | –                 | –              | –                 | –                        |
| S2 (40 trains)              | 1.0–1.5 ms | 25  | 0.9–1.4    | 0.45–0.61         | – (no signals) | 0.009             | 0.33                     |
| S3 (68 trains, 232 signals) | 3.8–4.2 ms | 36  | 3.5        | 2.4 (36 µs/train) | 0.24–0.36      | 0.04              | 0.26 + 0.14 reservations |

Headless scaling, Node 26 under vitest, `simWorld` grass map, straight lines of ~450 tiles
(160² map: ~130), one train per line shuttling quarry ↔ warehouse, every train moving, 600 warm-up
ticks then 600 timed ticks, **each case in its own process** (`raw/scale-case*.json`; running
them in one process inflated the later cases 2–3× through memory pressure):

| Map  | Trains | Signals                  | mean ms/tick | p95  | max  | µs per train |
| ---- | ------ | ------------------------ | ------------ | ---- | ---- | ------------ |
| 160² | 8      | 0                        | 0.43         | 0.63 | 14.7 | 54           |
| 480² | 8      | 0                        | 1.53         | 1.99 | 34.3 | 192          |
| 480² | 32     | 0                        | 3.82         | 4.60 | 5.3  | 119          |
| 480² | 64     | 0                        | 10.9         | 13.0 | 16.4 | 171          |
| 480² | 100    | 0                        | 35.1         | 54.3 | 120  | 351          |
| 480² | 64     | 2,752 (one per 10 tiles) | 39.8         | 63.5 | 106  | 622          |
| 480² | 100    | 4,300                    | 61.7         | 96.4 | 159  | 617          |

What this shows:

- **Per-train cost grows with route length.** The same 8 trains cost 54 µs each on 130-tile
  lines (160² map) and 192 µs on 450-tile lines (480² map); the profile attributes the difference
  to the route scans below, though the map size differs too. A grown map means longer routes, so the sim gets slower per
  train as the world grows, not just with more trains.
- **Superlinear in trains**: 32 → 64 → 100 trains on separate lines costs ×2.9 and then ×3.2. The
  in-process profile of the 64-train case (`raw/headless-64.cpuprofile`) puts 26% of the tick in
  `Train.pathAhead`, 35% in `Traffic.assign`, 14% in poses. `pathAhead` (`src/sim/trains.ts:1718`)
  walks the route's polyline from index 0 on every call and allocates an object for every remaining
  tile, and it is called 3–4 times per train per tick (`traffic.ts:214` and `:266`,
  `trains.ts:2023` for signals, `:2123`, `crossings.ts:233`). `Traffic.assign` builds a key set of
  the whole remaining route for every moving train each tick. The superlinear part was not pinned
  to one loop; growing maps and sets (claims ∝ trains × route) and GC are the likely cause.
- **Signals** on long routes add 29 ms per tick for 64 trains (`Signals.ahead` per signal on the
  remaining route, each doing `path.findIndex` and a block walk): the quadratic term the audit
  named, and it shows once routes are long and signalled densely.
- The browser's S3 (68 trains, shorter lines, a signal every 10 tiles) ran 3.8 ms per tick: a
  played large map sits between these two cases.

- `Signals.ahead`, one train, all signals clear: 100-tile path 0.023 ms, 200 → 0.041, 400 → 0.077,
  800 → 0.19, 1,600 → 0.50 ms. At a fixed 400-tile path it stays 0.07 ms for 10 to 80 signals.
- `findPath` along one line: 158 tiles 0.12 ms, 478 → 0.27, 958 → 0.56 ms (linear).

### Boot and bundle

|                                       |                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main bundle `index-*.js`              | **1,338 kB** raw, 422 kB gzip, 350 kB brotli (sourcemap 5.5 MB)                                                                                                                                                                                                                                                                                                                                               |
| Its make-up (source-map attribution)  | pixi.js 280 kB, `src/render` 240, `src/sim` 219, `src/ui` 177, `src/art` 107, `src/world` 101, `game.ts` 55, `strings.ts` 50; `src/art/buildingGround.json` (205 kB pretty JSON) is inlined                                                                                                                                                                                                                   |
| Other JS                              | WebGL renderer 72 kB, RenderTargetSystem 52, WebGPU 46 (lazy), landscape worker 34                                                                                                                                                                                                                                                                                                                            |
| `dist/`                               | 41 MB: 14 PNG atlases 14 MB (structures 5.3 MB, terrain-surfaces 2.8, terrain 1.6, loading screens 0.9 each), audio 20 MB                                                                                                                                                                                                                                                                                     |
| Boot to playable, new 160² game, prod | **6.4–7.3 s** (DOMContentLoaded 0.7–1.1 s)                                                                                                                                                                                                                                                                                                                                                                    |
| Boot, new 480² game, prod             | **13.3 s**                                                                                                                                                                                                                                                                                                                                                                                                    |
| Boot, 40-train save, prod             | 7.6 s                                                                                                                                                                                                                                                                                                                                                                                                         |
| Boot, dev server                      | 11.3 s (250 module requests)                                                                                                                                                                                                                                                                                                                                                                                  |
| Where boot time goes                  | building atlases on the main thread: `AtlasRegistry.loadGroup` 41% of the boot profile, the procedural track art (`art/trackIllustrated.ts`) alone 22% (~2.4 s), `AtlasBuilder.add` trimming every sprite pixel by pixel plus `getImageData` ~3 s. All ten atlas groups run their generator at boot, including the six that ship a PNG (`png+procedural`). The bundle's download and parse are well under 1 s |

## The 2026-10-09 audit claims (CORE.md, roadmap item 1)

| Claim                                           | Today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Verdict                                                                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A full-map scan in the render loop every 0.12 s | `WorldRenderer.animate` (`src/render/worldRenderer.ts:976-1003`) walks every tile of the map for water ripples every 0.12 s and only then tests the view. 2.3 ms per pass on 480² (≈19 ms/s); ~0.25 ms on 160²; it grows with map area (≈10 ms at the 1024² world bound).                                                                                                                                                                                                                                                                                | **Holds.** Not the largest cost: the per-frame Pixi cull walk and `setAtmosphereTint` are full-scene passes every frame. |
| Quadratic per-tick signal evaluation            | `Signals.ahead` calls `aspect` → `blockBeyond` for each signal on the path, and `blockBeyond` does `path.findIndex` from the start each time (O(signals × path)) plus a `tiles.some` dedupe. One train: 16× longer path → 22× cost. In the browser S3 it is 0.24–0.36 ms per tick for 68 trains; headless with 450-tile routes and a signal every 10 tiles it adds 29 ms per tick for 64 trains. The renderer evaluates every semaphore again every 0.1 s (`Game.updateSignals`, `src/game.ts:1647`): 2.3 ms per pass with 232 signals, spikes to 17 ms. | **Holds.** Small on short routes, the largest sim cost once routes are long and densely signalled.                       |
| A 939 kB main bundle                            | 1,338 kB (422 kB gzip).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **Outdated: 42% larger now.** Its effect on boot is small next to atlas generation.                                      |

## Top five costs, and what would help

| #   | Cost                                                                                                                                                                                                                                                                                                                                            | Where                                                                                                       | Share                                                                                                                                                | Rust/WASM core helps?                                                                                                                                                                                                                    | TypeScript fix                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Pixi culling walks the whole scene graph every frame, computing global bounds for each of ~20–35k sprites in flat `cullableChildren` containers                                                                                                                                                                                                 | `CullerPlugin` (`src/game.ts:862`), containers in `src/render/worldRenderer.ts:354-360`, `landscape.ts:187` | 27–41%                                                                                                                                               | **No**: it is the renderer's scene graph in JS                                                                                                                                                                                           | chunk the world into containers with a fixed `cullArea` so a chunk is accepted or rejected with one test; cull only when the camera moved or the chunk changed; or drop the plugin and toggle chunk visibility from the camera rectangle |
| 2   | Game's own per-frame JS that rescans everything with no dirty check: `setAtmosphereTint` loops over every object and allocates per object every frame; `GroundLights.update` rebuilds string keys for 5×5 tiles round every station every night frame; the water-ripple full-map scan; `updateSignals` re-evaluates every semaphore every 0.1 s | `worldRenderer.ts:2240`, `render/fx.ts:155`, `worldRenderer.ts:976`, `game.ts:1647`                         | 10–20%                                                                                                                                               | **No**                                                                                                                                                                                                                                   | recompute only when the tint/night value or the station set changes; scan only the visible tile range; read the aspects the sim already computed this tick                                                                               |
| 3   | The sim per train: whole-route rescans each tick (`pathAhead` 3–4× per train, `Traffic.assign` route key sets, `Signals.ahead` per signal) plus car poses (`updatePoses`, `body.ts`)                                                                                                                                                            | `src/sim/trains.ts:1478,1718,1983`, `src/sim/traffic.ts:252`, `src/sim/signals.ts:133`, `src/sim/body.ts`   | 25% at S3 3×; headless it grows with route length and superlinearly with trains (64 trains on 450-tile routes: 11 ms/tick, 40 ms with dense signals) | **Partly.** Poses are a numeric loop a port would speed up, but only behind flat arrays (per-tick marshalling across the JS/WASM boundary eats the gain). The route rescans are algorithmic: a port would copy them and stay superlinear | walk the route once per tick from a kept cursor, bounded by the claim horizon, and share it between traffic, signals, look-ahead and crossings; cache car specs; pose only trains that moved                                             |
| 4   | Pixi render itself (instruction build, sorting the flat `objects` container every frame, batching)                                                                                                                                                                                                                                              | Pixi, `sortableChildren` containers                                                                         | 12–19%                                                                                                                                               | **No**                                                                                                                                                                                                                                   | fewer, chunked display objects; render groups for static layers; sort only when something moved                                                                                                                                          |
| 5   | Boot builds atlases on the main thread: procedural track art, rolling stock facings, pixel-by-pixel trimming plus `getImageData`                                                                                                                                                                                                                | `src/engine/atlas.ts:155-190`, `src/art/trackIllustrated.ts`                                                | 4–5 s of a 6.4 s boot                                                                                                                                | **No** (could be a worker in any language)                                                                                                                                                                                               | ship the generated atlases as files (the `pack-atlas` tool exists), or build them in a worker / cache them in IndexedDB keyed by content version                                                                                         |

Also measured and small today: pathfinding (`pathTo` 0.04 ms per tick on S3), GC (≤1% of CPU,
scavenges up to 12 ms), the DOM HUD (`hud.update` 0.1–0.16 ms per frame; style and layout
recalculation 2–3% of the trace on S1).

## What this says about Rust/WASM and a desktop build

- The simulation is 0.5% of CPU on a fresh map, 7% with 40 trains, 25% in the 68-train stress case
  at 3×. Everything else is rendering and the game's per-frame JS, which a Rust core does not touch.
- The sim is the part that will **grow**: headless it gets slower per train as routes lengthen and
  superlinearly with the number of trains (100 trains on long routes: 35 ms per tick, more than
  the 50 ms a 0.05 s step allows at 3× once rendering is added). The causes found are algorithmic
  (whole routes rescanned and reallocated several times per train per tick, per-signal path
  searches). A Rust port of the same algorithms would be a constant factor faster and still grow
  the same way; fixing the algorithms in TypeScript changes the growth.
- The frame-time spikes come from sim outliers (36 ms ticks) and the renderer's signal pass, both
  worth tracing in TypeScript first.
- A desktop wrapper (Electron, or Tauri, which uses WebView2 = Chromium on Windows) runs the same
  JS in the same engine: it would not change any number here. Its gains would be packaging, file
  access and no browser chrome, not speed.
- Order suggested by the data: (1) culling and scene structure, (2) dirty checks in the per-frame
  passes, (3) route look-ahead once per tick (it decides how the sim scales on grown maps),
  (4) boot atlases, (5) then profile the sim spikes; only if train motion is still the
  ceiling after that, port `body.ts`/poses to WASM behind flat arrays, using `SimStep.run` and
  `docs/process/verification.md` as the spec.

## Tasks

Filed on 2026-10-27 under #45, in this order: #552 groundwork, #553 harness, #554 culling, #555
render passes, #556 drawn signals, #557 route walk, #558 atlas boot, then #559 sim spikes, #560
signals, #561 poses (the WASM decision point).

## Caveats

- One machine with a strong GPU (RTX 5070 Ti); a laptop iGPU will shift weight towards Pixi render
  and fill rate, which this report does not measure.
- Headless Chrome, no vsync, DPR 1. A 4K/DPR 2 screen raises the GPU side, not the JS side.
- S3 is a scripted network (straight lines, 249 stations, many depots); a played large map will
  have curves, junctions and longer paths, which raise the signal and path costs above these.
- The method wrappers add ~2.6% (`harness.js` in the flame graphs).

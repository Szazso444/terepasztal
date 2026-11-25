# Performance measurement tools

The tools behind the 2026-10-27 measurement
(`docs/superpowers/plans/2026-10-27-performance-measurement.md`, the Performance epic #45), so that
each performance task measures its before and after the same way. They measure; they change nothing
in the game. Nothing here is part of `npm test` or the build.

| File                    | What it is                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `vite.perf.config.ts`   | the base vite config plus `/__perf/*.mjs` (served from `page/`) and the `Document-Policy: js-profiling` header, for dev and preview |
| `page/harness.mjs`      | the in-page harness: method timers on `window.game`, frame recording, the boot probe, the scene census, the S3 network builder      |
| `cdp.mjs`               | drives a headless Chrome over the DevTools protocol: navigate, boot probe, record, CPU profile, GC trace, screenshot, eval          |
| `brief.mjs`             | the headline numbers of a saved recording                                                                                           |
| `summarize.mjs`         | a CPU profile's self/total time per function, minified frames resolved through `dist/*.js.map`; writes a `.folded` file             |
| `flame.mjs`             | a `.folded` file as an icicle flame graph (static HTML/SVG)                                                                         |
| `mapsize.mjs`           | a bundle's bytes by source area, through its source map                                                                             |
| `scale.perf.mjs`        | the headless scale benchmark (vitest): `Signals.ahead`, `findPath` and `SimStep.run` against size                                   |
| `vitest.perf.config.ts` | the benchmark's own vitest config, so `npm test` never runs it                                                                      |

Commands run from the repository root. Keep outputs (profiles, recordings, flame graphs) outside
the repository or under `dist/`; they are not committed.

## The headless scale benchmark

```
npx vitest run --config tools/perf/vitest.perf.config.ts
```

It builds `simWorld` grass maps (`src/testing/simWorld.ts`) with straight single-track lines, one
train per line shuttling quarry to warehouse, runs 600 warm-up ticks and times 600 more, and prints
three tables:

- `Signals.ahead`: ms per call against path length (100 to 1,600 tiles) and signal spacing;
- `findPath` along one straight line: ms per call against its length (158 to 958 tiles);
- `SimStep.run`: per case `meanMs`, `p95Ms` and `maxMs` per tick, `perTrainUs` and the trains'
  states (all should be `moving` once warm). A line per case is printed as it finishes.

The default cases are 8, 64 and 100 trains on 130- and 450-tile routes, all on a 480² map, so only
the route length and the train count vary. A run takes two to four minutes. Environment variables:

| Variable     | Effect                                                                                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PERF_CASES` | case ids, comma separated, or `all`: the defaults `r130-t8` … `r450-t100`, and `m160-r130-t8` (the report's small map), `r450-t32`, `r450-t64-sig`, `r450-t100-sig` (a signal every 10 tiles) |
| `PERF_TICKS` | timed ticks per case, a positive integer (default 600, after as many warm-up ticks)                                                                                                           |
| `PERF_ONLY`  | `sim` skips the `Signals.ahead` and `findPath` tables                                                                                                                                         |
| `PERF_OUT`   | writes all tables as JSON to this path                                                                                                                                                        |
| `PERF_PROF`  | writes a V8 CPU profile of the timed ticks to this path (`summarize.mjs` reads it)                                                                                                            |

In PowerShell set them first (`$env:PERF_CASES = 'r450-t64'`), in Git Bash prefix them
(`PERF_CASES=r450-t64 npx vitest run --config tools/perf/vitest.perf.config.ts`).

The cases run one after another in one worker, with a forced garbage collection between them (the
config starts the worker with `--expose-gc`). The 2026-10-27 report ran each case in its own
process. The numbers of the long-route cases move a lot with the machine's load and with what ran
before them in the process: on 2026-10-28, `r450-t64` gave 11.2 ms per tick in one full run, 19.9
alone in its own process and 23.9 in a full run while other work loaded the CPU. Compare a before
and an after run the same way (the same command, the same cases) on an otherwise idle machine, two
or three runs each.

The file is `.mjs`, not `.ts`, because `tsconfig.node.json` type-checks `tools/**/*.ts` without the
DOM library and the simulation it imports reaches `src/engine/audio.ts`. Its name keeps it out of
the regular test run, whose include is `src/**/*.test.ts` and `tools/**/*.test.mjs`.

## The browser harness

### 1. Build and serve the production build

```
npx vite build
npx vite preview --config tools/perf/vite.perf.config.ts --port 4173 --strictPort
```

`vite build` is the plain production build (the same as `npm run build` without its type check).
The preview serves `dist/` with the perf config, which adds `/__perf/harness.mjs` and the
`Document-Policy` header. The dev server works the same way
(`npx vite --config tools/perf/vite.perf.config.ts`), but its boot is slower; the per-frame numbers
are about the same.

### 2. Start a headless Chrome

The measurement used Chrome 156 (`C:\Program Files\Google\Chrome\Application\chrome.exe` on the
author's machine) in the new headless mode with the real GPU. From PowerShell:

```
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList '--headless=new',
  '--remote-debugging-port=9333', '--user-data-dir=G:\DEV\wt\perf-chrome', '--window-size=1920,1080',
  '--enable-precise-memory-info', '--no-first-run', '--no-default-browser-check', 'about:blank'
```

`Start-Process` returns at once and Chrome keeps running in the background. (Do not run
`chrome.exe --version` on Windows to check the version: it hands the call to a running desktop
Chrome. `http://127.0.0.1:9333/json/version` says which Chrome answers.)

- `--user-data-dir` must be a folder of its own (a fresh one has no save and no stored
  settings; keep it off the small C: drive). Without it Chrome joins the running desktop browser.
- `--window-size=1920,1080` gives the 1904×985 viewport at DPR 1 the report used (headless
  Chrome keeps 16×95 px of the window for itself); the probe and each recording print the
  `screen` they ran at.
- `--enable-precise-memory-info` makes the heap numbers exact rather than bucketed.
- Headless Chrome is not capped at 60 fps (it ran at 150–340 fps on the author's machine), and
  frame intervals come in steps of about 2.8 ms there, so p50/p95 often land on 2.8 or 5.6:
  compare ms per frame and the per-frame costs, not fps.
- `PERF_CDP` points `cdp.mjs` at another address (default `http://127.0.0.1:9333`).

Stop it when done. `Stop-Process -Name chrome` would close a desktop Chrome too; stop only the
processes started with the debugging port:

```
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like '*remote-debugging-port=9333*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
```

A vite server started from Git Bash in the background can outlive its shell on Windows: check the
port (`Get-NetTCPConnection -LocalPort 4173 -State Listen`) and stop its owning process.

### 3. Measure

```
node tools/perf/cdp.mjs ready "http://localhost:4173/#seed=4242&new"
node tools/perf/cdp.mjs rec 10000 --speed 1 --out dist/s1.json
```

`ready` loads the page afresh (through `about:blank`: the game drops its hash at boot, so the
same address again would not reload), loads the harness and waits for the boot.
`#seed=…&new` starts a new game with that seed (`src/main.ts` reads the legacy hash). It
prints, in ms since navigation start, `loopMs` (the game loop reports a frame rate, after its
first half second of frames: the report's "boot to playable"), `loadedMs` (the loading screen
has finished and shows "Click to begin") and `readyMs` (the later of the two), then
`domContentLoadedMs`, resources and their transfer size, the map, the GPU and the screen. Then it
clicks "Click to begin" with a real mouse event, as a player would, and adds `begunMs` when the
reveal has finished and the loading screen is gone; `--stay` leaves the screen up. The game runs
under the screen, but the screen costs frame time while it is up (the 2026-10-27 numbers below
were recorded with it up), so a before and an after must both click or both `--stay`. A new game
starts paused, so `rec` needs `--speed`.

`rec` wraps the game's methods with timers (`__perf.instrument`: `Game.update`, `SimStep.run`,
`Fleet.tick` and its parts, `Train.tick`, `Signals.ahead`, `Game.drawFrame` and its passes, Pixi's
`renderer.render`; Train methods are wrapped once a train exists), waits `--settle` ms (1500), then
records for the given ms and prints the headline (`brief.mjs`):

- `frameMs` p50/p95/p99/max: the time between `requestAnimationFrame` callbacks;
- `perFrameMs`: `update` (the simulation steps of a frame), `drawFrame` (the game's own per-frame
  JS) and `pixiRender` (Pixi's `renderer.render`), each as ms per drawn frame;
- `perTickMs`: `SimStep.run` per tick and its worst, `fleet.tick`, all `Train.tick` calls of a
  tick, `Signals.ahead`, `pathTo`;
- `topPerFrame`: the five most expensive drawFrame passes; `heap`: used MB and churn.

`--out` keeps the whole recording (every timer: ms per second, calls per second, ms per call, max);
`node tools/perf/brief.mjs <file>` prints its headline again. `--speed <index>` sets the game speed
first (an index into `SPEEDS` of `src/sim/time.ts`; 1 is 1×; an index past its end is an error and
leaves the speed as it was). A flag without its value, or a length, `--speed` or `--settle` that is
not a whole number, stops `rec` with a message; so does a recording in which the page drew no
frame (a hidden or throttled tab). The timers add about 2.6% (the
wrappers show in a flame graph). Pixi's culler runs before `renderer.render` inside Pixi's ticker
and is not timed; the CPU profile shows it.

A member a later change renames is reported on stderr as not wrapped; adapt `instrument()` in
`page/harness.mjs`.

### CPU profile, flame graph, GC

```
node tools/perf/cdp.mjs profile 10000 dist/s1
node tools/perf/summarize.mjs dist/s1.cpuprofile dist
node tools/perf/flame.mjs dist/s1.folded dist/s1-flame.html "S1 160², 1×"
node tools/perf/cdp.mjs trace 10000 dist/s1
```

`profile` samples V8 every 0.2 ms over the given ms. `summarize.mjs` resolves the bundle's frames
through `dist/assets/*.js.map` and prints self time per function (`--total`, `--areas` for the
other views, `--n` rows, `--from`/`--to` ms for a window); it writes `<stem>.resolved.json` and
`<stem>.folded`. `flame.mjs` draws the folded stacks, coloured by area, optionally rooted at a
frame (`"run sim/step.ts"` for the simulation only). `trace` records a Chrome trace and prints the
garbage collector's events and the main timeline totals (`<prefix>.trace.json`).

For a boot profile, start `profile` and navigate while it runs (two shells), or profile from the
dev server.

### Other commands

```
node tools/perf/cdp.mjs scene                       # scene objects, visible, culled; world counts
node tools/perf/cdp.mjs shot dist/view.png          # a screenshot of the viewport
node tools/perf/cdp.mjs eval "game.fleet.trains.length"
node tools/perf/mapsize.mjs dist/assets/index-<hash>.js
```

`eval` runs source text or a file (`@file.js`) in the page, with the harness loaded, `await`
allowed. Source that parses as one expression is run as one and its value is printed, whatever
words it contains (`"'please return ' + game.map.w"` prints the string). Anything else
(statements, `const`, `;`-separated steps) runs as the body of an async function, and what it
`return`s is printed (nothing returned prints nothing). Chrome compiles the expression form first,
without running it, to choose; a syntax error in the body form is printed as the error.

## Scenarios

**S1**: a new game, seed 4242, 160×160 (the default `mapSize`), no trains, at 1×: steps 1 to 3
above. The 2026-10-27 report recorded it with the loading screen up, showing "Click to begin":
its scratch `ready` waited for the game loop's frame rate and never clicked. To reproduce the
report's state use `ready --stay`; plain `ready` gives the game as a player sees it after the
click, which is a different, cheaper state (see the numbers below).

**S2**: the author's `engine-models-demo.json` save (140×140 level, 40 trains). It is not in the
repository: load it through the game's own load screen, then `rec`.

**S3**: a new game grown to 480×480 with a scripted network. A new game's tuning is staged in
sessionStorage (`terepasztal.newGameTuning`, taken once by the next page load:
`src/sim/rules.ts`), so stage the map size on the game's origin (the page must be there already,
for example after an S1 `ready`), then start the game and build:

```
node tools/perf/cdp.mjs eval "sessionStorage.setItem('terepasztal.newGameTuning', JSON.stringify({ mapSize: 480 }))"
node tools/perf/cdp.mjs ready "http://localhost:4173/#seed=4242&new"
node tools/perf/cdp.mjs eval "__perf.buildLines({ lines: 40, trainsPerLine: 1, signalEvery: 10, level: 'absolute_block' })"
node tools/perf/cdp.mjs eval "__perf.buildLines({ lines: 40, trainsPerLine: 1, y0: 24, level: 'absolute_block' })"
node tools/perf/cdp.mjs eval "game.clock.setSpeed(3)"
node tools/perf/cdp.mjs eval "__perf.addTrainPerLine({ limit: 28 })"
node tools/perf/cdp.mjs eval "__perf.refuel()"
node tools/perf/cdp.mjs rec 10000 --speed 3 --out dist/s3.json
```

`buildLines` lays straight single-track lines (`lines`, `maxLen` tiles, one per `dy` rows from
`y0`), each with a depot, a quarry and a warehouse, a signal every `signalEvery` tiles and
`trainsPerLine` trains, and returns what it made and what failed. `addTrainPerLine` adds one more
train on the line of each of the first `limit` trains (they yield to each other); it fails with
"a train stands on it" while the first trains still stand at their depots, so let the clock run a
few seconds first. The trains burn coal and water; `refuel()` tops them up between recordings.
The 2026-10-27 S3 ended with 68 trains, 232 signals and 249 stations. One `buildLines` call fits about 14 lines on seed 4242 (a
row whose line the terrain cuts short is skipped and listed in `fails`); call it again with
another `y0` for more. The counts depend on the terrain, so compare a before and after on the
same build of the scenario, not against the report's counts.

## The 2026-10-27 numbers

The report has every number; these are its headline per-frame numbers.

| Scenario    | p50 frame | p95  | p99  | update  | drawFrame | Pixi render |
| ----------- | --------- | ---- | ---- | ------- | --------- | ----------- |
| S1 160², 1× | 5.6 ms    | 14.0 | 24.9 | 0.02 ms | 1.15 ms   | 1.11 ms     |
| S2 demo, 1× | 8.4 ms    | 25.1 | 38.8 | 0.34 ms | 2.67 ms   | 2.09 ms     |
| S3 480², 3× | 8.4 ms    | 36.0 | 55.6 | 2.93 ms | 3.85 ms   | 1.41 ms     |

The report's S1 was recorded with the loading screen up (its tools never clicked "Click to
begin"; see Scenarios). Its S3 was set up the same way, with no click anywhere in its tools, so
it most likely had the screen up too; S2 went through the game's load screen, and the report does
not say whether its "Click to begin" was clicked.

The report's own commit, f095a1c9, has the same "Click to begin" as today's code: `bootPlan` gives
a `#seed=…&new` game `clickToBegin: true`, and `src/main.ts`, `src/engine/boot.ts`,
`src/ui/loadingScreen.ts` and `src/ui/loadingMath.ts` are identical between f095a1c9 and the
commit that added these tools. So the fair comparison with the report is screen up against screen
up. On 2026-10-28, in one Chrome session, alternating the report's build of f095a1c9 and a build
of the then-current develop, three recordings of each (10 s at 1×), S1 gave:

| S1, 2026-10-28                       | p50 frame  | p95      | p99       | update         | drawFrame    | Pixi render  |
| ------------------------------------ | ---------- | -------- | --------- | -------------- | ------------ | ------------ |
| f095a1c9, `ready --stay` (screen up) | 5.4–5.5 ms | 8.3–8.4  | 11.2–13.8 | 0.012–0.015 ms | 0.81–0.97 ms | 0.91–1.06 ms |
| develop, `ready --stay` (screen up)  | 5.5–5.6 ms | 8.3–11.1 | 11.1–16.6 | 0.012–0.017 ms | 0.85–1.01 ms | 0.92–1.14 ms |
| f095a1c9, `ready` (clicked)          | 2.8–5.5 ms | 8.3–8.4  | 11.1–13.9 | 0.010–0.013 ms | 0.80–0.88 ms | 0.79–0.92 ms |
| develop, `ready` (clicked)           | 2.8–2.9 ms | 5.7–8.3  | 8.4–11.2  | 0.010–0.011 ms | 0.79–0.85 ms | 0.75–0.85 ms |

With the screen up the two commits agree, and the frame time matches the report's S1 (p50
5.6 ms; its drawFrame 1.15 and render 1.11 are a little higher). Clicked, Pixi's render is a
little cheaper and the p50 frame fell to 2.8 ms in four of the six runs; the other two, both
f095a1c9, stayed at 5.5 ms with per-frame costs in the range of the rest; what held them there is
not established, so record each side three times or more.

"develop" is 1586dc42, the code under these tools. The recordings are
`s1-fix1/{f095,head}-{stay,click}{1,2,3}.json` (with `.ready.json` beside each, the `ready`
output) in the author's scratch folder `G:\DEV\wt\engine-553-scratch`, not committed. The
f095a1c9 build is the report's own `dist/` from `G:\DEV\wt\perf-measure`, served with this
folder's `vite.perf.config.ts` and `--outDir`. Earlier 2026-10-28 recordings in `s1/` there
compared f095a1c9 with the screen up (`f095-stay*.json`) against develop clicked (`final*.json`),
in separate Chrome sessions; they are not used here.

So do not compare a new number with these tables; measure the before and the after yourself, in
one session, in the same state (both `ready` or both `ready --stay`).

Frame-time percentiles move between runs (the p99 of a 10 s recording rests on a few dozen frames):
record each side two or three times and compare the medians. Measure before and after on the same
machine, build mode, window size and Chrome, with nothing else loading the CPU or the GPU.

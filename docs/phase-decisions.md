# Current phase: decisions taken while building

Record of the choices the spec left open (`FABLE DECIDES`) and of the places where a decided
item had to bend to fit the code. Section numbers refer to `current-phase-spec.md`, R-numbers to
the conflict resolutions.

## Track classes (§1, R25, R26)

- **Geometry derives from `n`.** `CLASS_N` in `src/world/track.ts`; radius `n − 0.5`; a curve or
  switch of class `n > 1` spans `n × n` tiles. The 2×2 high-speed curve and switch are generated
  in `src/world/trackGeom.ts` (`unitDef`): each route is sampled densely and clipped to the tiles
  it crosses, so every member tile carries its own polyline and edge pair. The tile graph stays
  tile-based; pathfinding and traffic did not have to change their state model.
- **Switch throat.** In a 2×2 switch the entry tile is crossed by both routes with the same edge
  pair. `TrackGraph.resolveRoutes` picks the route a path actually takes from the neighbouring
  segments, so the throat draws the arc when the path diverges and the straight otherwise.
- **Transition (R26):** a 1×1 straight-only piece that joins any class. No transition is needed
  at a mixed crossing (neither route changes class). The class speed ceiling is a curve effect
  only (§4 has no per-class straight constant), so the transition tile itself runs at straight
  speed; the "ceiling along its whole length" clause has nothing to apply to.
- **Class adjacency** is enforced at placement: an open edge meeting track of the other class is
  refused unless one side is a transition. Legacy mismatches would simply not connect.
- **Curve speed (R28):** a factor, `min(1, k·sqrt(R))`, expressed through the existing tuning
  value: `k = curveSpeed / sqrt(0.5)`, so regular curves keep 0.55 and high-speed curves get 0.95.
  Switch diverging legs use the same factor as the curve of their radius (the old, never applied
  `switchSpeed` is gone).
- **Costs (R39):** the ratio matrix lives in `src/data/track.json`; `pieceCost` multiplies by
  `classCostMul` (`n × 1.5` above regular) and `rules.trackCostScale`. Both scales default to 1
  (see Economy below).
- **High-speed unlock (R22):** until the age system lands the class is buildable from the start.

## Vehicles (§2, §3, R8, R9)

- **Sizes:** 1 / 2 / 3 tiles. Existing stock was re-laid: 4-4-0s, tank engines, shunters and the
  Kandó V40 are small; express engines (as engine + tender), road diesels and box electrics are
  medium; Big Boy (Meyer plan), DDA40X and GG1 (rigid, three bogies) and the Crocodile (Garratt
  plan) are large. New models: J94 shunter, Black Five, 9F, GMAM Garratt, TGV Sud-Est, ICE 1.
- **Plans:** `rigid`, `tender` (a two-segment medium steam engine: the joint gives the engine a
  1.25-tile body and a 0.75-tile tender; not in the spec, added because a rigid two-tile steam
  body looked wrong and the segment model made it free), `garratt`, `meyer`. Nothing at runtime
  asks which large plan it is holding; the size rule is the only gate.
- **Posing** (`src/sim/body.ts`) follows §3 exactly: outer bogies define the axis, seven body
  stations measure the signed gap to the nearest track point, the body shifts by the clamped
  midpoint, bogies slide to their path positions. The trail buffer (R27) is the polyline.
- **Rendering:** 48 facings, 25 drawn (the rest are horizontal mirrors, which in this projection
  is the reflection `tx ↔ ty` and keeps the light direction within 8° of the original), plus a
  runtime rotation of half the residual projected angle (`ROTATION_SHARE`), so a flattened
  sprite never leans more than a couple of degrees. Bogies are a shared sprite set (`bogie` two
  axles, `bogie3` three axles for Co-Co stock via `bogieAxles`, `engine_unit` for the Meyer
  frame), drawn under medium and large bodies only. Locomotive art in one atlas, wagons in a
  second; generation takes about 0.9 s at boot.
- **Bogies on screen.** The geometry keeps every bogie on the rail; the sprite is drawn on its
  socket's line along the body, held within `BOGIE_DRAW_PLAY` (0.05 tiles) of the socket across
  it. A three-tile body on the 1.5-radius curve would otherwise show its middle bogie 0.2 tiles
  outside the body and its end bogies 0.2 tiles out the other way. Large bodies keep their
  pivots at 0.58 of the length (`LARGE_PIVOT`; 0.7 for the rest) and centre on the mean gap over
  the body rather than the min/max midpoint, which sits the body out over the arc where the middle
  bogie runs. The tolerance verdicts are unchanged: large rigid passes high-speed (centre bogie
  0.28 off its socket, limit 0.35) and fails regular (0.56).
- **Sheds:** a consist rolls out of the depot from a virtual straight run inside the shed; cars
  still inside the footprint are hidden.

## Tolerances and bans (§4, §5)

- The table (`src/sim/compat.ts`) is built at boot from a straight–quarter-arc–straight reference
  path per class. Verdicts, per model and class, feed `vehicleAccess`.
- **Calibration.** With the spec's figures a rigid two-tile body on the 0.5-radius curve measures
  a 0.29 residual gap, over the 0.25 limit, which would have barred nearly every medium model
  from regular track; and the centre bogie of a three-bogie large body on the 1.5-radius curve
  keeps a 0.31 residual (the spec's worked example assumed the centring shift absorbs the whole
  0.37, which the seven-station midpoint rule does not do on a composite path). Two calibrations
  make the spec's intended verdicts hold: the gap limit scales with body length (0.25 per tile of
  body), and `maxLateralPlay` defaults to 0.35. Result: small and medium pass both classes; large
  rigid passes high-speed (0.31 < 0.35) and fails regular (0.58) on geometry, and is barred from
  regular by rule anyway. Per-model overrides stay available in the data.
- **Enforcement:** the consist's usable classes (`Train.access`) filter every path search; the
  depot gate check (`Fleet.gateReport`) requires a usable class at the gate, an onward tile and a
  run at least as long as the consist before the first blocking feature (no track, unusable
  class, a standing train, a dead end: R29); the picker greys barred models with the reason; a
  refused roll-out names the vehicle and the first tile it cannot pass.

## Depot (R10)

- Four interchangeable gates. Plain pieces may be laid through the shed footprint and count as
  platforms, so trains can traverse, stop inside and unload into the pool there.

## Economy (R19, R39)

- Field boulders (desert sand) are gone from generation; hill boulders and small rocks stay.
- Starting wood, stone and iron derive from the cost matrix: 50 straights, 6 curves, 1 switch
  plus a crafting allowance, times `rules.startingResourceScale`. With both scales at 1 the
  opening holds 155 wood, 131 stone, 96 iron: enough for the first line and the first consist,
  not for blanketing the map (a straight costs 1 iron; iron income is the grinder's 20 per day or
  the market at 70 each).

## Signals (R16)

- The `signal` decor keeps its id (saves) and becomes a semaphore: home arm (red, white stripe)
  and distant arm (yellow fishtail), 4 × 4 arm-position frames animated one step per 70 ms.
  Danger: home arm level. Caution: home raised, distant level. Clear: both raised.

## Consist physics, locomotive modes, refuelling carts

- **Physics** (`consistPhysics` in `src/sim/trains.ts`, constants in `track.json` → `physics`):
  effort = haul rating × `effortPerTonne` (0.75) summed over the pulling units, × 0.82 when any
  of them works double-headed; acceleration = effort / mass, clamped to `maxAccel` (0.9 tiles/s²,
  floor 0.05); top speed = the slowest vehicle (a wagon without `vmax` counts 2.6). Braking keeps
  the old constant. The haul rating stays a hard cap (creation refuses, `overweight` at
  departure) and the old load factor stays as the speed penalty.
- **Modes.** The first unit leads; a unit of the leader's control class runs in multiple; every
  other unit (and any steam engine) is double-headed; the player may set a non-leading unit to
  standby. Runtime engagement is recomputed every tick: a working unit pulls while it has usable
  power (fuel and water, oil, the wire with power in the stockpile, or a charged battery cart);
  when none has, the first standby unit with usable power steps in, and steps back when a
  working unit recovers. A dormant unit still adds mass and, as it is on duty, still counts in
  the haul cap; a standby unit counts in the cap only while it pulls.
- **Tanks are pooled per fuel type over every unit** (a standby unit's tank is filled at stops
  and never burns from); only the pulling units burn. Per-unit tanks would have meant a new
  save shape and per-unit refuelling for a distinction the player never sees.
- **Carts** extend the pool of the matching engine type (`serviceCap`: coal 120, oil 120,
  power 60) and cut that fuel's use by 10% each (cap 30%); a coal cart is inert while the tanks
  hold wood; a cart with no matching engine is dead weight and the pickers say so. A battery
  cart charges at 2 per tile on live track (and at a refuelling stop) and carries the electric
  past the end of the wire. A tank wagon of water tops the boiler up below half a tank.
- Save format v10: locomotive modes and the battery charge; older saves get the default modes.

## Signalling (§9, R16, R17)

- **Levels** (Settings → Signalling): Automatic keeps today's claims only; Token; Absolute block;
  CTC; In-cab. Track with no semaphores under Automatic behaves exactly as before. Semaphores act
  under every level above Token. Existing saves load at Automatic.
- **Headway in tiles (R17):** absolute block 10, CTC 6, in-cab 3 (an unequipped train under
  In-cab keeps the absolute-block 10). The following train holds that many tiles behind the one
  ahead; the occupancy scan reaches `LOOKAHEAD + headway`. Seconds were dropped: a day is 240 s.
- **Aspects** (`src/sim/signals.ts`): a post guards the tile in front of it; its block runs to the
  next post facing the same way (along the train's own path when a path is known, otherwise
  straight on). Red: a train in the block. Yellow: the block clear, the next one taken; the train
  approaches at a speed from which it can stop at the next post (`sqrt(2·DECEL·d)`). Green
  otherwise. Semaphore arms animate between the three.
- **Token:** under the Token level a plain section (between switches, platforms and dead ends,
  as `traffic.ts` cuts them) admits one train at a time in either direction; a second waits
  outside until the first has left. Literal: the deadlocks are the point.
- **CTC and in-cab** shorten the headway only; colour-light art is left for a later phase.
- **In-cab equipment (§8):** the one hard block of high-speed track. Large stock and the
  high-speed sets carry it in their data; any other locomotive can be fitted in the Roster for
  `rules.inCabCost` ($6 000). Without it a consist may not enter high-speed track at all.
- **Tolls (§8):** stock that is not a high-speed type pays a ×3 route cost on high-speed tiles
  (`Train.tollOf`), so it keeps to regular lines when it can; every train pays
  `rules.hsAccessCharge` ($2) per high-speed tile run. No wear model (R22/R32).

## Electrification (§7, R12, R31)

- Three supplies over track: third rail (ceiling 1.2 tiles/s), catenary (1.9), HV catenary (no
  ceiling). Collectors: shoe ↔ third rail; pantograph ↔ catenary; HV pantograph ↔ catenary at the
  catenary ceiling or HV wire at full speed; multi-system ↔ anything. The consist's ceiling is the
  best any of its electric units can draw from the wire under the head.
- Substations are pole-grid nodes; wire within Chebyshev 6 of a powered one is live. Draw is
  `powerPerTile` per tile, ×3 while accelerating; each substation smooths the draw under it and,
  above its throughput (units per second, 3 by default), scales every train there by
  `throughput / load`. Braking returns 30 % of the tile draw to the stockpile while on the wire.
- With no substation anywhere, pole-powered wire counts as live so saves from before keep running.

## Curve rendering and procedural art after the first playtest

Historical first pass, superseded by the rigid-body correction below. Its evidence remains in
the scratchpad to explain the rejected appearance; containment is no longer an acceptance rule.

- **Chosen outcome: option 2, a visual hinge.** The single three-tile casings of DDA40X, GG1 and
  Big Boy draw as two fixed 1.5-tile halves. Each half points from the centre pivot towards its
  outer bogie, with a small overlap over the joint. Three-bogie stock uses the actual middle
  bogie; the Meyer frame uses the sampled vehicle centre as its virtual hinge. Garratt units
  keep their existing articulation. Reversal swaps the front/rear artwork as well as the facing.
  The half frames clip the procedural primitives in body coordinates before projection, so the
  cab, chimney and boiler remain in their original places. This is a deliberate miniature-art
  convention: the simulation still treats the original long frame as rigid.
- `src/render/vehicleVisual.ts` derives these drawing poses from `VehiclePose`. Neither
  `vehicleSpec`, `poseSegment`, track access nor the tolerance table uses the visual halves.
  Keeping the old chord (option 1) would preserve the visual complaint even if the bogies were
  hidden. Curvature-bucket atlases (option 3) add unnecessary frame combinations when two halves
  already follow the arc.
- **Containment is a rendering invariant.** A clamped bogie centre does not constrain the
  corners of a rotated two- or three-axle sprite. Each bogie therefore uses its own body's
  transformed alpha silhouette as a Pixi sprite mask, and the undercarriage sorts beneath all
  of its vehicle's body parts. Masks use the alpha channel, not the paint's red channel. A
  one-source-pixel inset prevents filter-bound rounding from exposing single edge pixels.
  The mask follows interpolation, reversal, facing mirrors and depot visibility. This applies
  to medium stock, Garratt engine units and the long hinged frames. Exposed pixels in an
  **unmasked** bogie are intentionally clipped; the passing test compares the body alpha with
  the bogie alpha actually produced by the production GPU mask, rather than assuming a clamp
  proves containment. The casing includes a continuous sill and axle-box detail so the
  miniature still has a legible chassis.
- **Unchanged compatibility measurements**, in tiles:

  | Model     | High-speed verdict | High-speed centre offset | Regular geometry verdict     | Regular access |
  | --------- | ------------------ | ------------------------ | ---------------------------- | -------------- |
  | DDA40X    | pass               | 0.284381                 | fail, 0.562396 centre offset | barred         |
  | GG1       | pass               | 0.284381                 | fail, 0.562396 centre offset | barred         |
  | Big Boy   | pass               | 0                        | pass                         | barred by size |
  | Crocodile | pass               | 0                        | pass                         | barred by size |
  | GMAM      | pass               | 0                        | pass                         | barred by size |

  The centre-bogie limit remains 0.35, large rigid pivot ratio 0.58 and medium pivot ratio 0.7.
  The full before/after verdict records in the scratchpad are identical, including all residual
  gaps, fore/aft slide and lateral shifts. A geometric pass for an articulated model on regular
  curves does not override the large-stock access rule.

- **Evidence.** `scratchpad/gpu-check.mjs` renders body-only and bogie-only passes through the
  real `TrainRenderer` and Pixi/WebGL extractor. The sweep visits all 24 medium/large models,
  every permitted class, the entire `compat.referencePath` at 0.05-tile steps, both turn hands,
  four rotations, both travel orientations, and an interpolated pose. It checks every alpha
  pixel, with no allowed spill threshold: 104,256 samples, zero outside pixels and non-empty
  bogie passes throughout. Additional zoom checks and a control with masks disabled are saved
  beside the main report. `rollout.mjs` also builds the real high-speed gate, straight and 2×2
  curve from depot 1 to a quarry in seed 4242; both screenshots pause at the same ~40° rigid
  pose with zoom fixed at 4. The six-model contact sheet uses the production renderer too.
- **Art direction.** A small, inhabited railway diorama: moss and teal landscapes, terracotta
  and timber buildings, cool steel, warm lamps and brass, restrained enamel liveries. Material
  noise is reduced so silhouettes and working parts read first. Shared polygon faces gain
  projected bevels and closed triangular gables; shared contours inherit some material colour.
  Ground rims soften, vegetation keeps distinct silhouettes, cargo icons share the material
  palette, crew gain lit shoulders/buttons, and smoke/fog use warm/cool atmosphere colours.
  Rolling stock is 30% wider across its local frame, without changing its length or simulation
  pivots. This brings casings above the rail gauge and leaves room for readable underframes.
  Sleeper spacing derives from arc distance rather than the number of polyline samples.
- **Budget.** Transparent margins are trimmed before packing, with matching anchor offsets;
  inset masks are generated only for bodies with separate bogies. The locomotive atlas is
  4096×2048 and the wagon atlas 4096×512, including masks, compared with 4096×4096 and
  4096×2048 before. A local headless Chromium measurement took 0.950 s for locomotive art,
  0.197 s for wagons and 1.215 s for all nine atlas groups. These are local generation timings,
  not a cross-device guarantee. Every generated frame was checked against its atlas bounds.
  All art stays procedural and the runtime dependency list is unchanged.
- **Delivery.** Continue PR #9 by pushing `HEAD` to `claude/isometric-train-game-k6rk1a`.
  Use the existing `Co-Authored-By` commit-trailer convention; contributor/session metadata
  belongs in Git metadata, not in source or design prose. Changes are recorded under
  “After the first playtest”; the release remains v0.8.0.

## Rigid bogies and coordinated congestion recovery

The player's follow-up supersedes the earlier visual-hinge and alpha-containment choice, and
explicitly rejects the subsequently proposed sliced-body drawing. The attached rigid-body
illustrations guide the result; their historical facing counts and tolerance numbers do not
replace the calibrated simulation. `docs/bogie-model.md` records the corrected target.

- **Body and wheels.** Render the simulation's actual rigid segments, with independent bogies
  at their rail coordinates and tangent angles. Remove the artificial hinge, the 0.05-tile
  drawing clamp, silhouette masks, and baked axle-box strip. Raised chassis beams expose
  four- and six-wheel groups; existing cosmetic axle assignments are retained. The art refresh,
  rigid pivot ratios, geometry, tolerance table and large-stock access rule remain unchanged.
  The DDA40X/GG1 high-speed centre offset is still 0.284381 tiles against the 0.35 limit.
- **Acceptance.** Full body-alpha containment concealed the requested moving parts. It is
  replaced by explicit rail-position, independent-facing, rigid-length and visible-wheel checks.
  The new GPU sweep passes 52,128 poses across all 24 medium/large definitions, every permitted
  class, both hands, four rotations and both travel orientations. The motion sheet shows F7
  four-wheel bogies, SD40 six-wheel bogies, and the three-bogie DDA40X. The six-model curve sheet
  includes Garratt and Meyer stock. Before/after depot screenshots use the identical rigid pose.
- **Budget.** No slices or mask frames remain. The locomotive atlas has 1,250 frames in
  4096x1024; the wagon/bogie atlas has 675 in 4096x512. The recorded local generation times are
  0.461 s and 0.221 s respectively, about 0.75 s across all nine procedural atlas groups. All
  packed frames and anchors pass bounds checks. No runtime dependency was added.
- **Why recovery failed.** Independent per-train retreats could select conflicting routes;
  pulling-aside trains skipped claims; only the immediate blocker's route was considered;
  queues behind a cycle were omitted until they stopped; chain traversal stopped after eight
  members; short sidings could leave the rear on the main line. A failed reversal could also
  leave the consist facing the other way. Incremental movement never closed stuck episodes
  because each individual step was below the old half-tile threshold.
- **Coordination.** Build complete connected wait-for groups and distinguish their directed
  cycles from feeder queues. Prefer a cycle member that can escape; otherwise move a feeder
  blocking that escape. Compare complete plans, with yielding history and escape distance as
  tie-breakers. Reserve the chosen route atomically before changing a train or platform, with
  at most one escape per group and no corridor shared by independent recoveries. Waiting group
  members may surrender future claims, but physical occupancy is never overridden. Failed
  searches are retried after four simulated seconds, rather than every frame.
- **Refuge capacity.** Search directed track with clear arc length as part of the search state.
  The complete consist length includes coupler gaps, plus a half-tile margin; the final tile
  only contributes the distance to its centre. Switches, platforms and all other group routes
  reset the available parking length. The search respects track access and other reservations,
  rejects repeated tiles, and is bounded to 12,000 explored states. Both directions are previewed
  from the correct front or rear trail before any mutation.
- **Prevention and lifecycle.** Stamp every train's occupancy before assigning forward claims.
  Reserve a junction's exit before entering; compare following direction at the contested tile.
  Two trains already inside a section cannot advance into the same unclaimed gap. Recovery
  trains obey claims too; their route releases behind the rear and cancels safely after a track
  edit, removal, fuel failure or 30 seconds without progress. Scheduled rerouting does not
  replace an active retreat. Waiting trains include reservation owners in their blocking reports.
- **Evidence and limits.** In the four-train fixture with both escape directions obstructed by
  queues, the earlier traffic code remains blocked at 240 simulated seconds (four stuck
  episodes, eight deadlock reports). The corrected system passes the oncoming train in 37.05 s
  after three coordinated retreats, with no overlaps, stuck episodes or deadlocks. The broader
  12-train fixture also clears without overlaps or deadlocks, in 83.95 s; the earlier permissive
  controller clears that unconstrained fixture in 71.3 s. Exit protection has a throughput cost:
  this is a fix for conflicting and obstructed recovery, not a claim that every layout runs
  faster. A layout without a reachable siding long enough for the train still needs more track.
  Fixtures use one-shot virtual exits and restore yielded trips to isolate traffic from station
  production; they do not measure a complete economy or guarantee recovery of every network.
- **Diagnostics.** The debug panel shows blocking-group count and active escape owners. Exported
  traffic reports include wait-for edges, owner, corridor tiles and progress times, plus recovery
  completion/replan events. `http://localhost:5173/__traffic` exposes recent local browser reports
  from Vite's existing connection; reports expire after one minute and are kept only in memory.
  It contains no saves, adds no remote-command channel, is readable only over loopback, and is
  absent from production. The pre-existing live browser could not be attached in this task;
  regression evidence comes from isolated headless worlds on the running dev server.

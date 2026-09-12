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

# Current phase spec: fit against the codebase

Review of `current-phase-spec.md` (sections numbered as in the spec) against the repository at
commit `7872306`. Items are numbered R1… so answers can refer to them. Nothing below has been
implemented; the spec asks for this list first. The traffic write-up the spec requires before
signalling (§9) is `docs/traffic-current.md`.

## A. Already in place

- **R1 (§17 Saves)**: implemented in v0.7.0. `src/sim/save.ts` has `SAVE_VERSION = 8`, the
  `MIGRATIONS` chain with per-step notes, loading never refuses, the warning names the mismatch
  and what was defaulted, unknown keys round-trip through `saveExtra`, text export/import and
  named slots. Gap: "age progress" has nothing to serialise yet. Generated worlds store the seed
  and generator parameters and re-derive terrain and props (`src/sim/save.ts:10-12`); only levels
  store packed terrain (`src/world/level.ts:19,63`). Decision: keep seed-based map storage, or
  serialise every tile.
- **R2 (§19 step 2, arc-length path)**: already the model. `Train.setPath` flattens the route into
  samples with cumulative distance (`src/sim/trains.ts:808-848`), the head is the scalar `pathPos`,
  cars are sampled at fixed offsets along a trail buffer (`src/sim/trains.ts:584-594, 659-710`).
  Missing is only the body/bogie posing of §3.
- **R3 (§1 curve geometry)**: the REGULAR curve is already a quarter circle of radius 0.5 centred on
  the tile corner, arc length π/4 (`src/world/trackGeom.ts:4-46`); one piece per tile, cardinal
  links (`src/world/track.ts:6-37`). Crossing REGULAR × REGULAR exists (`src/data/track.json:30`).
- **R4 (§12 water)**: tankers carry the whole `liquid` class, water included
  (`src/data/wagons.json`, classes in `src/sim/cargo.ts:20`). Only the range effect is new.
- **R5 (§13 deny before accept)**: declining an offer already costs nothing
  (`src/sim/contracts.ts:160-163`). A single global auto-accept toggle exists
  (`Settings.autoContracts`, `src/sim/save.ts:77`); per-rarity policy is new.
- **R6 (§14 steam buildings)**: water tower and coaling stage exist as decor
  (`src/data/decor.json:13-41`); the depot is the engine shed (`src/data/stations.json:128-139`).
- **R7 (§9, §10 statistics)**: track sections, per-train blocked/yield/stuck/deadlock statistics
  and stuck notices exist (`src/sim/traffic.ts`, `src/sim/notices.ts:62-70`). Documented in
  `docs/traffic-current.md`.

## B. Conflicts with the code

- **R8 (§3 body model vs rendering)**: every car is one pre-rendered 72×64 sprite in 8 fixed
  headings, no rotation, no bogies (`src/render/trainRenderer.ts:79-126`,
  `src/art/rolling.ts:6-9, 91-114, 962-972`). "Draw body as a rectangle: centre C, axis ax" cannot
  be shown with 8 headings; the track-centring shift and bogie slide would be invisible. Options:
  (a) keep sprites, use §3 for positions only and snap the facing (acceptance tests pass in
  numbers, not on screen); (b) draw bodies and bogies at runtime as rotatable isometric polygons
  (new art path, replaces `src/art/rolling.ts`); (c) 16 or 32 facings (larger atlas, still snaps).
  Decision required before build-order step 3.
- **R9 (§2 sizes)**: current lengths are 0.62 tile per locomotive, 0.56 per wagon, gap 0.05
  (`src/sim/trains.ts:116-118`); body art runs 0.5–0.78 tile. `SMALL = 1 tile` makes every existing
  consist about 1.7× longer: 16 wagons become 17 tiles (`MAX_WAGONS`, `src/sim/fleet.ts:27-28`),
  the 72×64 canvas cannot hold a 2- or 3-tile body. Decision: existing stock is re-laid at 1 tile,
  or SMALL keeps about 0.6 tile and the size table is scaled.
- **R10 (§5 depot gates)**: the depot has four interchangeable gates on two opposite sides
  (`src/sim/stations.ts:137-152`), no entry/exit distinction; the start depot gets straight track on
  all four (`src/game.ts:1084-1140`); roll-out tries every free gate (`src/sim/fleet.ts:125-150`).
  Spec: two entry and two exit gates. Decision: which side is which for rot 0 and rot 1, and what
  happens to saved depots whose trains now leave through "entry" gates. Also: room behind the gate
  is never checked today; `spawnAt` walks the trail back without testing that the tiles exist or
  are free (`src/sim/trains.ts:609-632`).
- **R11 (§6 consist physics)**: `power` is a haul capacity in tonnes with a load factor
  (`src/sim/trains.ts:408-428`), not a tractive effort; acceleration is the constant `ACCEL 0.7`
  (`src/sim/trains.ts:119`); wagons have no speed rating; creation is refused when empty weight
  exceeds power (`src/sim/fleet.ts:216-217`). Decision: replace the load factor and the overweight
  lock with `a = TE / mass`, or keep the lock as a hard cap under the new model; a `v_max` field is
  needed on wagons (`src/data/content.ts:48-61`).
- **R12 (§7 electrification)**: power is a stockpile resource with a battery cap
  (`src/sim/stockpile.ts:27`, `rules.powerCap`), made by the power plant
  (`src/data/buildings.json:64-92`) and carried by pole decor linked within Chebyshev 2
  (`src/sim/power.ts:37-71`); an electric locomotive needs its head tile within one tile of a live
  node and draws `power` per tile (`src/sim/trains.ts:502-506, 1193-1196`). No track is
  electrified. Spec: per-tile supply classes, substations with MW capacity and radius, electricity
  flowing not stored, regenerative braking. Decision: replace the pole grid and the `power`
  resource, or keep poles and the plant as the feed for substations. Saves and the plant recipe
  depend on `power`.
- **R13 (§14 chains)**: coal comes from the charcoal kiln (2 wood → 1 coal), iron from the stone
  grinder (10 stone → 1 iron), oil from the refinery (3 coal + 2 water → 1 oil)
  (`src/data/buildings.json`); diesel locomotives burn `oil` (`src/sim/trains.ts:533, 567, 1191`);
  the power plant takes oil as its alternative input. No colliery, ironworks, derrick, sand, copper,
  wire or diesel cargo exists (`src/data/cargo.json`, `src/data/buildings.json`). Decision: kiln and
  grinder stay beside the new buildings or go; whether `oil` becomes crude and a new `diesel` cargo
  is what locomotives burn (touches every diesel entry, the refinery and the plant).
- **R14 (§14 reputation)**: reputation gates buildings and decor (`src/sim/build.ts:270-271,
422-423`), station level caps (`src/sim/stations.ts:18`), map regions
  (`src/world/regions.ts:33-42`), gacha banners and contract templates (`minTier` in
  `src/data/contracts.json`); contracts pay money, reputation and tickets
  (`src/sim/contracts.ts:217-226`). "Remove the reputation gate" leaves those gates and the reward
  currency undefined. Decision: reputation removed entirely (age gates replace every tier gate) or
  kept as a score with no gating.
- **R15 (§11 gacha)**: tickets are the gacha currency, granted by contracts, once a day and on
  tier-up (`src/sim/contracts.ts:224`, `src/game.ts:1545`, `src/sim/economy.ts:43`). The inventory
  holds at most one item per model: a duplicate pull becomes an upgrade level (+8 % per level,
  cap 5, `src/gacha/inventory.ts:14-39`), so "one of each" is a side effect of dedupe, not a rule.
  Decision: what a craft costs (tickets, iron per §16, or both), whether item levels survive now
  that copies are allowed, and whether N/R/SR/SSR keeps any meaning.
- **R16 (§9 signals)**: a `signal` decor exists, cosmetic only (`src/data/decor.json:3-11`; aspect
  set in `src/game.ts:988-1009`, never read by any train), and existing saves contain it. "Existing
  saves have no signals" is false. Decision: old signal decor becomes an ABSOLUTE_BLOCK signal
  (changes the behaviour of loaded saves) or stays cosmetic under a new id.
- **R17 (§9 headways)**: a day is 240 s (`src/sim/rules.ts:84`) and trains run 0.8–2.3 tiles/s;
  a 300 s headway is 1.25 days, longer than most trips. Decision: divide by ten (30/18/9 s) or
  express headway in tiles.
- **R18 (§14 turntables)**: none exist, and every locomotive reverses today
  (`reverseConsist`, `src/sim/trains.ts:771-806`; steam included). "Turntables become obsolete"
  needs steam to be unidirectional first. Decision: add turntables and the steam restriction
  (a large change to dispatch and depots), or drop the item.
- **R19 (§18 boulders)**: boulders are procedural map props, never saved, regenerated from the seed
  (`src/world/mapgen.ts:439-442`, `src/art/props.ts:444-491`) and never block building. Small
  `rock` props are a separate kind; Rock terrain blocks building and is what quarries need. Decision:
  remove `boulder` props only, or the small rock props too.
- **R20 (§15 townhouse)**: 6 residents, no levels, player-placed from the Stations category
  (`src/data/decor.json:56-68`, `src/ui/toolbar.ts:138`); population is crew plus residents and
  never grows (`src/game.ts:1516-1517`). Decor has no level or construction state. Decision:
  townhouse becomes a building type with levels and build stages (new entity, migration of
  existing decor), or decor gains those fields.
- **R21 (§13 assignment and penalty)**: no contract–train binding exists; roaming trains only
  divert a delivery through `Fleet.contractDest` (`src/sim/fleet.ts:564`). Active contracts cannot
  be cancelled; failure costs 60 % of the reputation reward and no money
  (`src/sim/contracts.ts:191-198`). Decision: the penalty currency once reputation goes; whether
  Schedule (static) trains are eligible for assignment; what a suspended Schedule train does with
  its dwell rules.
- **R22 (§1 unlock)**: high-speed is "unlocked late in the Electric Age", but ages arrive at
  build-order step 12 while track classes are step 1. Decision: interim gate (reputation tier 2,
  or free until the age system lands).
- **R23 (§14 diesel range)**: diesel range is already long (fuel caps 56–280 at 0.11–0.3 per tile:
  500–930 tiles; `src/data/locomotives.json`), steam 160–460 tiles. "Long enough that stops are a
  planning problem" is met or exceeded; only water stops are short. No change implied unless the
  numbers are meant to shrink.

## C. Unclear or undefined

- **R24**: `deferred-later-phase.md` was not supplied. Hills exist as a visual lift with a 0.85
  speed factor and 1.8× track cost (`src/sim/trains.ts:822`, `src/data/track.json:49`), bridges
  over water exist. Whether both stay untouched.
- **R25 (§1 HIGH_SPEED switch 3×2)**: tile layout undefined: where the through line runs, on which
  tile the diverging arc (radius 1.5) leaves the footprint, and the rotation count. For the 2×2
  curve the derived layout is: arc centred on the outer corner, entry and exit at the edge midpoints
  of the two outer tiles, the inner corner tile blocked but untouched. Confirm.
- **R26 (§1 transition)**: a 1×1 straight only, or curves too; whether a REGULAR × HIGH_SPEED
  crossing needs transitions on its fast axis; whether "along its whole length" means the
  transition tile only.
- **R27 (§3 trail)**: the trail buffer (§R2) exists so cars keep positions after re-dispatch and
  reversal. It is equivalent to fixed arc offsets behind `s_head`. Confirm it may remain the
  sampling source.
- **R28 (§4 curve speed)**: with `curveSpeed 0.55` at R = 0.5 the implied `k` is 0.78 as a
  multiplier of engine speed. Whether `v_max_curve` is absolute (tiles/s) or a factor.
- **R29 (§5 room)**: "first blocking feature" is a switch, a station tile, a dead end, another
  train, or all of them.
- **R30 (§6 modes)**: STANDBY promotion triggers on losing the wire only, or also on empty tanks;
  the DOUBLE_HEADED loss applies to tractive effort or to fuel; crew cost is wheat per crew
  (`rules.wheatPerCrew`, `src/sim/rules.ts:93`), not money, so "second crew cost" means doubled
  wheat unless a wage is introduced.
- **R31 (§7 grid)**: units for substation capacity versus train draw; regenerative recovery
  fraction; hydro placement rule (river or lake tiles).
- **R32 (§8 in-cab equipment)**: how it is fitted (a craft option, a purchase per vehicle, per
  model) and its cost; access charge and class toll amounts; wear rate and maintenance model (no
  maintenance exists anywhere).
- **R33 (§10 junction area)**: "12-tile area" as a radius, a 12×12 window, or switches within 12
  tiles of each other; the rolling window length.
- **R34 (§11 crafting)**: craft cost and failure chance ("a successful craft"); whether the three
  cards may include owned models or repeat a model (the pool has 6 electric locomotives); wagon
  tiers (wagons have no era or tier field, `src/data/content.ts:48-61`); whether crafted copies can
  be scrapped or sold.
- **R35 (§12 carts)**: battery cart semantics for electrics (range off the wire, or capacity
  only); the fuel cart holds `oil` or the new diesel; the coal cart with wood-burning steam (wood
  burns at half value, `src/sim/trains.ts:520, 556`).
- **R36 (§13 rarity)**: mapping of the five existing templates (local, bulk, rush, charter,
  standing; `src/data/contracts.json:5-66`) onto the five rarities, or rarity as a multiplier on
  top of templates.
- **R37 (§14 goals)**: Electric goals proposal: network goal, three founded towns connected by rail
  to a depot; economic goal, $250 000 earned from contracts. Diesel's "1000 population" is 34
  townhouses at 30 each, 167 at today's 6.
- **R38 (§15 growth)**: growth rate, event bonuses, construction duration and the "traffic through
  the town" metric (passengers delivered, trains stopping, or both) are numbers to set.
- **R39 (§16 costs)**: proposal: straight 2 wood / 2 stone / 1 iron; curve 2 / 3 / 2; switch
  3 / 3 / 4; crossing 0 / 4 / 4; transition as a straight; HIGH_SPEED pieces ×n then +50 %.
  Starting iron = one locomotive craft + four wagon crafts + 50 straights, which needs R34's craft
  cost first.

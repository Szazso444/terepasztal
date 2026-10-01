# Rail system: 2×2 regular track, high-speed line speed, narrow gauge

Status: design approved in conversation 2026-09-30 / 2026-10-01; this spec awaits review.
Branch: `rails/narrow-gauge` from `origin/main`. Reference spike (not merged): `spike/curve-sizes`.

## Goal

Regular trains can no longer turn on 1×1 track, so regular curves and switches become 2×2 like high
speed. The 1×1 pieces stay in the game as a new narrow gauge with its own small trains and depot.

Out of scope (the locomotive design chat owns them): the size ladder, the six narrow locomotives
that have no game data yet, per-train running gear, wagon lengths for regular stock.

## 1. Track classes

| Class        | Curves and switches | Joins                  | Line speed cap (tiles/s) | Rules                                          |
| ------------ | ------------------- | ---------------------- | ------------------------ | ---------------------------------------------- |
| `regular`    | 2×2 (radius 1.5)    | regular, transition    | 2.0                      | any regular-gauge stock, large included        |
| `high_speed` | 2×2 (radius 1.5)    | high speed, transition | none                     | in-cab signalling and the per-tile charge stay |
| `narrow`     | 1×1 (radius 0.5)    | narrow only            | 1.2                      | narrow stock only                              |

- `CLASS_N = { regular: 2, high_speed: 2, narrow: 1 }`. The caps are rules values (`rules.ts`), tunable.
- Removed: the Electric Age high-speed quest (`HS_QUEST`, `hsUnlocked` build gate and toolbar hiding),
  the toolbar's late tier for high speed and transitions, and the rule barring large stock from
  regular track (`compat.ts`). The route detour for slow trains on high speed stays.
- Line speed: a train's speed limit on a tile is `min(vmax, cap of the tile's class)`, braking ahead
  like the bridge limit.
- Transitions join regular and high speed only; their `any` port never matches narrow.

## 2. Pieces

- Narrow: straight, curve, switch (both hands), bridge, crossing narrow × narrow, crossing
  narrow × regular. No transition between gauges.
- Crossings of two different classes get two rotations (rotation 1 swaps which axis has which class);
  this also fixes regular × high speed, which today only exists one way round.
- Narrow pieces follow the regular slope and bridge rules.
- Cost: narrow pieces cost the regular ratio × 0.6 (`classCostMul`).

## 3. Track art (both in `trackIllustrated.ts`, the generator the game uses)

- Multi-tile pieces: every member tile draws the whole piece and is clipped to its own tile, so rails
  and ballast run on across tile edges. The gravel square on the empty inner tile goes (shown on the
  track review page, 2026-10-01).
- Narrow: rails at ±0.08 tile (half of today's ±0.16), sleepers half as long, ballast shoulder 0.18;
  regular timber colours. One constant per class so the gauge can be tuned later.

## 4. S-shaped switch (regular and high speed)

A 2×2 switch has two forms, chosen by the track around it:

- `turn` (today): the diverging lane is a quarter circle leaving through the side of the block.
- `parallel`: the diverging lane is an S-curve (two reverse arcs, radius 1.25) leaving through the
  far end of the block, one track over, parallel to the main line.

Rule: the switch is `parallel` when the tile just past the block at the S-lane's exit holds track
that opens towards the block and is joinable (same class or a transition), and the turn exit has no
connected track; otherwise `turn`. Re-evaluated when the switch is placed and whenever a piece next
to a switch block is placed or removed. The main line's continuation does not matter.

- Stored on the piece (`form`) and saved; `unitDef` is keyed by form.
- The S-lane runs through the block's centre corner; route clipping takes one axis first there, so
  the graph stays edge to edge.
- Trains whose paths used the changed lane re-path as on any track change.

## 5. Vehicles and access

- `gauge?: 'narrow'` on locomotive and wagon definitions; default regular.
- Narrow stock may use only `narrow`; regular-gauge stock only `regular` and `high_speed`.
- A consist must be one gauge; assembling a mixed one is refused with a message.
- Stephenson's Rocket and the MÁV Mk48 become narrow gauge (their existing stats stay).
- New narrow wagons, drawn by the game (`rolling.ts`), one per cargo class:

| id             | Name              | Carries | Length (tiles) |
| -------------- | ----------------- | ------- | -------------- |
| `mine_tub`     | Mine Tub          | mineral | 0.5            |
| `narrow_tank`  | Narrow Tank Wagon | liquid  | 1              |
| `narrow_box`   | Narrow Box Wagon  | bulk    | 1              |
| `narrow_coach` | Narrow Coach      | people  | 1              |

Capacity / weight: mine tub 10 / 3, tank 8 / 2, box 9 / 3, coach 10 / 3 (about half the
smallest regular wagon of each class; tunable). One starter copy of each. The 0.5-tile length is a
new size key used only by narrow stock until the size ladder lands.

## 6. Narrow depot

- Station `narrow_depot`: 1×2 tiles, one track running through it lengthwise, a gate at each end;
  two orientations. Drawn by the game (`structures.ts`).
- Same mechanics as the depot (stockpile cap per depot, fuel, water, unloading at the gates).
- Its own cap: as many narrow depots as regular depots are allowed (1 + 1 per 9 owned chunks),
  counted separately.
- Deploys only narrow trains; the regular depot never deploys them. Creating a narrow train picks a
  narrow depot automatically; with none, the message says to build one.
- Available from the start (for testing). A `rules.narrowUnlocked` flag is the hook for a later
  unlock rule.
- Tooltip: "Narrow-gauge engine shed. One track through. Builds and refuels narrow trains, which
  turn on 1×1 curves: for tight spaces, and the mines to come."
- Not counted in the age goal "depots" (assumption, to confirm).

## 7. Saves

- `SAVE_VERSION` 13: every regular `curve` and `switch` without a multi-tile unit (1×1) becomes
  `narrow`. Lines get gauge breaks to redesign; trains on converted pieces report no route.
- Narrow pieces, switch forms and narrow depots save and load.

## 8. Proof

- Unit tests: narrow geometry, S-switch routes and form switching, class joins, access by gauge,
  narrow depot gates and cap, crossing rotations, save migration, line speed caps.
- Game renders on a review page: every piece of all three classes, both switch forms, both depots,
  trains of each gauge running through curves, switches, crossings and transitions; an old save
  before and after conversion.
- A save JSON with a regular 2×2 loop, a high-speed line, a narrow line with its depot and narrow
  trains, loadable through Settings → Import save.
- Typecheck, lint, tests, build and prettier --check before every push.

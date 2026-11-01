# Track wear and maintenance trains

Author: Zsolt, with Claude. Date: 2026-10-30. Status: draft for the author's review. It changes no
code.

## 1. Goal and non-goals

Track becomes something to look after. Every piece has health, loses it with time and traffic, and
fails when neglected. The player repairs it by hand or runs maintenance trains. A player who pays
attention never sees the network stop; one who ignores the track gets a slower network, then a
broken one.

Wear runs from the first day of every game with no gate. The numbers keep it quiet in Steam, and it
first shows around Diesel, sooner when the player overloads a line.

Not in this design:

- Maglev Guideway and Hyperloop Tube do not wear, for now.
- Tunnels have their own spec. How a tunnel wears is settled there, once both designs exist.
- No derailments, no weather or biome effect on wear, no overhead wire damage.
- Repair materials are not carried on the train.
- Whether goods should be one global pool is a question for the balance work. This design keeps
  all repair payment behind one function (section 8), so a change there lands in one place.

## 2. Health

Each piece has one HP value. A multi-tile curve or switch is one piece, and so is a crossing: trains
on both axes wear the same HP. A switch has one HP whichever route a train takes.

| State    | HP          | Effect                                               |
| -------- | ----------- | ---------------------------------------------------- |
| Healthy  | 30 % to 100 | none                                                 |
| Degraded | under 30 %  | trains slow down on it, it wears twice as fast       |
| Unusable | 0           | no train may enter; a train on it crawls off (sec 4) |

A healthy piece under 45 % counts as close to degraded: maintenance trains look after it (section
6), and players see nothing different on it.

Which pieces wear:

- Every piece of Narrow Gauge, Branch, Main and Trunk Line, bridge rails and platform track
  included. A bridge's platform and capacity do not wear, only the rail on it.
- Depot gates never wear, so a depot can always let a train out.
- Maglev Guideway and Hyperloop Tube never wear.
- In the level editor and in `Builder.free` nothing wears.

A new piece starts full. Demolishing and rebuilding is a free choice of the player: the refund does
not change, and the rebuilt piece is full. It is hand work, and it stops being worthwhile on a
complicated junction. The Upgrade tool lays a new piece, so an upgraded piece starts full on its new
line.

A crossing takes its maximum HP from its bigger line, as `pieceCost` takes its price. A hit uses the
wear multiplier of the axis the train runs on (`portClass`).

## 3. Numbers

All of these are entries in `src/sim/rules.ts` with labels and ranges, so they can be dragged in
Game tuning and travel with the save.

| Line   | Max HP | Wear multiplier |
| ------ | ------ | --------------- |
| Narrow | 600    | 1.0             |
| Branch | 1000   | 1.0             |
| Main   | 2000   | 1.3             |
| Trunk  | 3500   | 1.6             |

| Rule               | Value                                              |
| ------------------ | -------------------------------------------------- |
| Wear per train     | total mass in tonnes / 100 x 1.5 x line multiplier |
| Time wear          | 0.4 % of max HP per game day                       |
| Degraded threshold | 30 %                                               |
| Close to degraded  | 45 %                                               |
| Degraded speed     | 0.6 x the train's top speed                        |
| Degraded wear      | x 2, on both train and time wear                   |
| Crawl speed        | 0.25 tiles/s                                       |
| Train repair price | 40 % of the piece's build cost for 100 % of its HP |
| Train repair time  | 25 game seconds for 100 % of its HP                |
| Hand repair price  | 2 x the train repair price                         |
| `trackWearMul`     | 1, multiplies all wear; 0 turns wear off           |

What these give at 1x, where a game day is 4 minutes and Diesel arrives after about an hour:

- A 150 t train takes 2.25 HP from a Branch piece. A busy platform piece with 300 passes an hour
  is degraded after about an hour. An ordinary line piece with 120 passes an hour takes about 2.6
  hours. An overloaded piece with 600 passes takes about half an hour.
- Once degraded, a piece at 300 passes an hour fails in about 13 minutes. That is the time the
  player has after the first alert, and the step most in need of a playtest.
- A line with no traffic is degraded after about 12 hours.
- A 400 t train on Trunk takes 9.6 HP, so a Trunk piece lasts about 255 such passes.

The figures are a starting point. The implementation plan runs them through a headless simulation
and reports when the first piece degrades on a network of the size the balance model reaches at
Diesel (six trains).

## 4. Failure and trains

Trains slow for a degraded piece ahead as they do for a slower line: the cap joins the line-speed
loop in `tickMove` and they brake on the approach.

When a piece turns unusable:

- **A train on it** runs on at crawl speed until its last vehicle is off. If the next piece is
  unusable too it crawls over that as well, and stops only on sound track.
- **Other trains** cannot enter from sound track. Pathfinding skips the piece, and a train with
  the piece on its path looks for another way.
- **A train with no other way** stops on the last sound piece in today's `noRoute` state, gets its
  usual notice and tries again every few seconds. It leaves by itself after the repair.
- **A split network or an unreachable depot** has no special rule. Trains wait as above, and hand
  repair works anywhere, so the player can always get out of it.

A train standing at a platform when its piece fails finishes loading, then crawls off. A piece
under a stopped train can still be repaired.

## 5. Warnings and map

Two warnings come once per game, kept in the save:

- **First degraded piece:** a notice with a target on the piece. It says the track is wearing out
  and what can be done: hand repair, or a maintenance wagon from the depot. The game keeps running.
- **First unusable piece:** the game pauses, the camera goes to the piece and a window says what
  happened and what traffic now does. Two buttons: Repair picks the tool, Depot opens the depot on
  the maintenance wagon. Closing it resumes at the earlier speed.

After that there are plain notices: one per unusable piece, gathered into a single notice with a
count when there are more than three, and the existing `noRoute` notice on each held train.

On the map a degraded and an unusable piece each have their own painted look (section 9). Unusable
also carries a small warning mark and shows on the minimap. The tile tooltip gives HP in percent and
the state.

## 6. Maintenance wagons and trains

Two wagons, available from Steam: a Narrow one (Corvette) and a Branch one (Frigate). The Branch
wagon reaches Main and Trunk too, because a class runs on its own line and every bigger one.

The wagon goes behind any locomotive of its network. A train with the wagon may choose the routing
mode **Maintenance** alongside schedule, freight, transport and contract. Without the wagon the
button is greyed out and says why: it needs a maintenance wagon. If the wagon is taken off, the
train leaves the mode. The wagon alone does nothing in other modes.

Two yellow maintenance locomotives, available from Diesel: one Narrow, one Branch. They are ordinary
slow, cheap locomotives with no special rule. The mode depends only on the wagon.

A maintenance train is a normal train in every other way: it burns fuel, pays its crew and wears
the track. It calls at no station, so the crew settles at the nearest store, however far, when it
finishes a job, when it reaches its waiting place and as it waits there.

**Choosing work.** A train picks a job when it starts or finishes one, never per frame. It works
one piece at a time and always to 100 %: it keeps the job and its claim until then, and takes no
other meanwhile. It lets a job go only when the piece is gone, when it leaves the mode, or when it is
stopped (below).
It looks in three tiers: unusable, then degraded, then close to degraded. One `findPath` per tier
with every job of that tier as a target gives the nearest reachable one, so a pick costs at most
three searches. A claimed piece is left to the train that claimed it. A train that stops in
`noFuel`, `noPower` or `stranded` drops its claim, so another can take the job. With no work the
train returns to its nearest depot and looks again every 30 game seconds. It waits clear of the
gate, and a train rolling out does not count it as a blocking feature: it moves off for that train.

**Reaching the piece.** Its target for an unusable piece is the sound tile next to an open end,
since it cannot enter; a broken stretch gets repaired from its near end inward. For any other piece
it drives on and stands there.

**A train in the way.** Section 4 stops a train on the last sound piece and this section sends the
worker to that same tile, so on a single line both want one place. A train with no way on (`noRoute`,
`stranded`, `noFuel` or `noPower`) holds only its own tiles, not its whole section, so a worker,
like any train, can close up behind it. A worker on an urgent job (see Priority) held behind such a
train, which stands on or short of its job's tile on the same line, starts work where it stands: the
crew walks the rest. With a way round the train it takes that instead. The repair runs as usual, and
the stopped train is not backed off: it leaves by its own retry once the piece carries it.

**Working.** It stands still and HP rises at the rate in section 3, paid as it goes. The result
stays if it pulls aside or is taken off the mode: repair is gradual. It stops at 100 %, and a piece
it pulled away from is finished however far it has come. If no store can pay it waits, with a
notice, and while it waits unpaid its job is not urgent: it gives way as on a degraded piece.

**Priority.** Heading for or working on an unusable piece, it goes before every other train. On a
degraded or close to degraded piece it goes after every other train: when a train has been held by
it for 5 seconds it pulls aside by the existing refuge search, keeping the job, the claim and what
it owes. It comes back as soon as the way is free, at the latest after 30 game seconds, when it
sets off and leaves the rest to traffic control. With no way back it stands, looks again every few
seconds and jams nothing.

## 7. Hand repair

A Repair tool with a hammer icon sits beside Demolish on the build bar (UI requirement sent to the
UI session on 2026-10-30). It works as a stroke, like the Upgrade tool: whole pieces outlined with
their price. Repair is instant, available from Steam, and works under traffic. It works on any
piece and from any distance.

## 8. How it is built

- **HP lives on the piece.** `TrackPiece` gets `wear`, one small object shared by every member tile
  of a multi-tile piece, holding the health as a share from 0 to 1, so `Train.canUse` reads it
  without going through the anchor, and a changed max HP in tuning does not move a piece's state.
  Deleting a piece deletes its health and `place` starts it full, with no second table to keep in
  step. `refreshSwitchForms` carries `wear` across, as it does `bridgeCapacity`.
- **`src/sim/wear.ts`** (new): max HP, state, the train hit, the daily scan, repair. Pure functions
  over `TrackGraph` where possible.
- **The hit.** When the head enters a new piece, once per pass, so a 5x5 curve takes one hit.
- **The daily scan** covers every piece once a game day. Measured at 0.16 ms for 50,000 pieces, and
  17 ns a hit.
- **Unusable** joins `Train.canUse`, so `findPath`, `pathStillValid`, refuge searches and
  `statesReaching` all see it. `track.version` goes up only when a piece enters or leaves the
  unusable state, at most once a tick, so a batch of failures costs one round of path checks.
- **Running off.** A train on an unusable piece keeps its path as far as the first sound piece, then
  dispatches from there. `findPath` never checks the start tile, so a train there may set off.
  Crawl speed applies while any vehicle stands on an unusable piece; that check runs only while
  unusable pieces exist.
- **`src/sim/maintenance.ts`** (new): job choice and claims. The `maintenance` route mode joins
  `RouteMode`, and `Fleet.setMode` refuses it without a wagon. `src/ui/trainScreen.ts` greys its
  button with the reason.
- **Priority** extends the rank `Traffic` reads from `classRank`.
- **Payment** is one function: the nearest store that can pay, with no reach limit, unlike building
  (`buildReach`). Train repair sums the fraction owed and pays whole units.
- **Saves.** `SAVE_VERSION` 25. `TrackTuple` gains an optional HP, and a new top-level field holds
  the two once-per-game flags, in `KNOWN_SAVE_KEYS`. The migration step fills nothing: an old
  save's track is full.

## 9. Art

The illustrated track is built at start from painted one-tile material strips
(`public/assets/track-materials`, `src/art/trackMaterials.ts`), so the wear looks are two more
material sets per line: four lines, two states. Codex paints them after `specs/codex-track-fit.txt`
is done, on top of that work. The look is approved on renders from the running game.

Tripling the generated frames costs memory and start time. Worn frames are generated the first time
a line and state are needed, not at start. The plan measures it.

Until then the tint in `WorldRenderer.trackColour` stands in, so steps 1 and 2 can be played.

Models, all downloaded and true to scale in `models3d`:

- Branch locomotive: `mow_loco` (CKD 701, 7.2 m), repainted yellow.
- Narrow locomotive: `narrow_work_loco` (BN 30, 2.9 m), repainted yellow.
- Branch wagon: `std_ballast_hopper` (6.9 m), repainted yellow.
- Narrow wagon: no such model exists. It is built from a Corvette wagon already in the game,
  repainted, and shown for approval with the rest.

The yellow `tamper` (1067 mm gauge, Vale logo) and `ballast_regulator` (metre gauge) stay out: their
wheels do not fit, and models are not reshaped. A search of 3D Warehouse and Sketchfab on
2026-10-30 found nothing better. Each model used goes in `src/data/credits.json`.

## 10. Order of work

One pull request each, into `develop`:

1. **Wear and repair:** HP, wear, slowing, failure, warnings, tooltip, tint, saves, hand repair.
   The Repair button goes on the build bar, so this step follows the merge of `uiux/build-bar`.
2. **Maintenance:** wagons, locomotive data, route mode, job choice, priority.
3. **Art:** painted looks, lazy frames, the four yellow models.

The change crosses World, Gameplay, Rendering, UI/UX and Art, so each pull request needs Core's
`scope:cross`.

## 11. Testing

Deterministic tests, headless:

- Wear: one hit per pass on a multi-tile piece; both axes of a crossing share HP; the gate and
  Maglev pieces stay full; thresholds and the x 2 rate.
- Failure: a train on a failed piece gets off and stops only on sound track, in a stretch of two
  broken pieces too; a train with another way takes it; one without waits and leaves after repair;
  no train enters from sound track.
- A batch of failures in one tick raises `track.version` once.
- Maintenance: tiers in order; two trains never claim one piece; a broken piece is repaired from the
  neighbouring tile; the train gives way on degraded track and goes first on unusable track; the
  mode is refused without a wagon.
- Payment: reaches a store past `buildReach`; waits with a notice when none can pay.
- Saves: a v24 save loads with full track; HP and the flags survive a round trip.
- Tuning: `trackWearMul` 0 leaves every piece full.
- The numbers: the headless run of section 3 reports the first degraded piece on a six-train
  Steam network.

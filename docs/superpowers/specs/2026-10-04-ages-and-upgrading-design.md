# Ages and upgrading

Status: design agreed in conversation 2026-10-04; this spec awaits review.
Branch: `buildings/ages-upgrading` from `main`. Sub-project 3 of the building work
(`2026-10-02-building-eras-art-package-design.md` lists all four).

## Goal

Everything that can be upgraded gets one level per age, and an upgrade swaps the building for the
model of the next age. An upgrade takes game time, during which the building is closed; the
depot's is instant. A halo marks every finished upgrade, like a level-up.

What the user asked for, in their words: every age gives one more upgrade level, for the depot and
for everything that can be upgraded; what cannot be upgraded keeps one level; an upgrade takes
time, measured in game time and set by feel, during which the building neither produces nor
consumes; the depot's upgrade is instant, the one exception; a halo plays over whatever was
upgraded.

## 1. Six ages

`src/data/ages.json` gains three ages after Steam, Diesel and Electric.

| Age      | Reached when                         |
| -------- | ------------------------------------ |
| Diesel   | 3 depots and 1,000 people (as today) |
| Electric | 100,000 earned (as today)            |
| Nuclear  | 1 substation under power             |
| Magnetic | 150,000 earned                       |
| Hyper    | 500,000 earned                       |

The three new goals are easy on purpose (the user's choice), so that all six ages can be walked
through quickly while the buildings are tried out. They are values in the data file.

For now a new age only raises the level cap of buildings (the user's decision; locomotives, wagons
and track for the new ages are a separate piece of work). So everything else that reads the age
number stays at its Electric value in the three new ages: contract kinds, amounts and payouts,
crafting pools and prices, the banner list, and the ring of land a level starts with. Entering an
age still gives its tickets and its notice.

## 2. One level per age

- A building's highest level is `current age - the age it appears in + 1`: 6 for a building of the
  Steam age, 5 for one of the Diesel age (refinery, power plant), 4 for one of the Electric age
  (substation, hydro plant, copper mine).
- This holds for stations (with the town hall, the warehouse and both depots), works and houses.
  Water tower and fuel stop have one level, as today. Bridges keep their own four levels (they are
  strengthened, not rebuilt), and signals and power lines have none.
- **In the Steam age nothing can be upgraded;** the first upgrade opens with the Diesel age
  (confirmed by the user). Today a station reaches level 3 in the Steam age, and works and houses
  reach level 4 in any age. Saved games keep the levels they have.
- Level `n` shows the model of age `first + n - 1`. Until the new pictures are in the game
  (sub-project 4) today's pictures stand in, the highest of them for the levels above it.

The tables grow to six values:

| Stations        | 1   | 2   | 3   | 4   | 5   | 6   |
| --------------- | --- | --- | --- | --- | --- | --- |
| capacity        | 60  | 120 | 200 | 320 | 500 | 750 |
| load rate       | 4   | 6   | 9   | 13  | 18  | 24  |
| trains at once  | 1   | 1   | 2   | 2   | 3   | 3   |
| production/week | 30  | 50  | 80  | 120 | 170 | 230 |
| crew            | 2   | 3   | 5   | 8   | 12  | 16  |
| cost multiplier | -   | 0.8 | 1.2 | 1.8 | 2.6 | 3.6 |

Works keep their formulas (output `1 + 0.5 x (level - 1)`, cost `level x 1.5`), now up to level 6.
Houses hold 20, 60, 140, 300, 520 and 800 people; the two new steps cost stone 420 and iron 180,
then stone 640 and iron 320.

## 3. An upgrade takes time

Pressing Upgrade pays the cost and starts the work. The level rises when the work is done.

| To level      | 2   | 3   | 4   | 5   | 6   |
| ------------- | --- | --- | --- | --- | --- |
| Game hours    | 6   | 9   | 12  | 18  | 24  |
| Minutes at 1x | 1   | 1.5 | 2   | 3   | 4   |

A game day is four minutes at normal speed. One tuning value in the rules panel scales the times;
at 0 every upgrade is instant.

While a building is being upgraded:

- **Works** process nothing: no inputs taken, no outputs made, no crew to feed. A power plant gives
  no power and a substation feeds no wire.
- **Stations** make nothing and have no crew to feed. **Trains still stop there** (the user's
  choice): they may load what is in storage, but the station accepts no deliveries, so a train
  with goods or passengers for it keeps them until the work is done. A warehouse gives out what it
  holds and takes nothing in.
- **Houses** take no new residents. The people who live there stay and are counted.
- The panel shows a bar and the time left, and a small bar stands over the building in the world.
  The building keeps its old model until the work is done.
- An upgrade cannot be cancelled.

**The depot is the exception:** its upgrade is instant and free, as today.

## 4. The halo

When an upgrade finishes (the depot's at once) a halo plays over the building: a golden ring rises
from the ground around it, a column of light and a few sparks go up, and a chime sounds. About a
second and a half of real time, drawn in the world over the building, at every game speed.

The Upgrade tool for track plays a small version on each converted piece, so a stroke along a line
leaves a brief golden shimmer behind it.

The effect is drawn by code (no new picture files, no new dependency). It is shown as stills and a
film from the game on a review page before it is locked in.

## 5. What the player sees

- Upgrade button: the new level, the cost and the time, for example
  `Upgrade to level 3 · 60 wood, 40 stone · 9 h`.
- At the age's cap: the button is off and says which age opens the next level
  (`Level 3 opens in the Electric Age`).
- During the work: `Upgrading to level 3 · 4 h left` with a bar, in the panel and in the hover text.
- When done: the halo, the chime and a line in the notices (`Farm is now level 3`).

## 6. Saved games

The save format gains the work under way on stations, works and houses (target level, time left).
Older saves load as they are; a building above the new cap keeps its level and cannot be upgraded
further until its age comes.

## 7. Out of scope

New locomotives, wagons and track for the new ages; the new building pictures and turning buildings
(sub-project 4); bridge levels; cancelling an upgrade; upgrading buildings by dragging a tool over
them (the track tool stays a track tool).

## 8. Proof

- Unit tests: the level cap by age and by the age a building appears in; the six-value tables; an
  upgrade that takes its time and raises the level at the end; a station, a works and a house that
  do nothing while upgraded, and a train that loads at an upgrading station but cannot deliver; the
  depot's instant upgrade; the rules value at 0; save and load in the middle of an upgrade; an old
  save above the cap.
- In the running game: an upgrade from the panel with its bar and its halo, a stroke of the track
  tool with its shimmer, shown as stills and a film on a review page.
- Typecheck, lint, tests, build and formatting pass before every push.

# Tunnels, step 1: one floor inside the mountain

Author: Zsolt, with Claude. Date: 2026-10-30.
Status: draft for the author's review. It changes no code.

Review page of the trial, with renders from the running game:
https://claude.ai/artifact/T3BTbtA83QTM3R8aR1hUgQ. The trial is throwaway code in
`G:\DEV\wt\tunnel-trial`; everything below marked "proved" ran there.

## 1. Goal and non-goals

**Goal.** The player digs through a mountain and lays track inside it, with switches, crossings
and several tunnels in one mountain, so a junction can sit inside a mountain. Trains are seen going
in and out. Ground height becomes something the player can change.

Step 1 delivers:

- Raise and Lower, for ground height, in the build menu.
- The Drill, which digs tiles inside the mountain and turns every mountain on the map to glass
  while it is on.
- Portals that make themselves where a dug line leaves a slope.
- The highest ground level goes from 4 to 16.
- Mountains that generate up to that top, not just reach it by raising. See section 3a.

**Non-goals, each with a spec of its own later.**

- Stacked floors and ramps between them. Step 1 digs at rail level 0 only, and stores the floor on
  each dug tile so that step 2 starts from saved data. The review page shows how step 2 could look.
- Ore veins, mines and works inside a mountain.
- Wear in tunnels. It is settled when this spec and the track wear spec both exist.
- Prices. The figures here are placeholders; the author prices them later.

## 2. How it stays one graph

Tunnels are not a layer. A tunnel is ordinary track in the one `TrackGraph`: one piece per tile,
with multi-tile pieces storing one member per tile. Pathfinding, signals and traffic see nothing
new (proved: trains ran through a crossing and two switches inside a mountain with no change there).

The consequence: track above a tunnel on the same tile cannot exist. A dug tile takes nothing on
the surface above it.

## 3. Ground height

**Today** a tile's level is derived from its terrain and its neighbours; nothing is stored, and no
player tool changes it. `levelTarget` in `src/world/elevation.ts` is the single place it starts.

**New plane.** The map gains a stored plane of ground levels, `groundLevel`, with 255 for "as
generated". `levelTarget` returns the stored value where one is set; `tileLevels` and `levelAt`
keep their clamp, so neighbours still differ by at most one level. The plane travels in the save
and needs a `SAVE_VERSION` step that fills in nothing (absent means as generated). It holds the
player's changes only; generated levels are section 3a (proved with a floor plane: relief and paint
workers need no change).

**Raise and Lower.** Two arrows in the build menu, Utility group. A click or a drag acts tile by
tile, one level a step.

| Rule          | Value                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where         | Any land tile with nothing built on it. Water, track, roads, buildings and deposits refuse.                                                                                     |
| Top           | Level 16 (`MAX_LEVEL`).                                                                                                                                                         |
| Bottom        | Level 0, sea level, for now.                                                                                                                                                    |
| Over a tunnel | Ground over a dug tile stays at rail level + 3 or higher; refused tiles show red.                                                                                               |
| Beside water  | Lower refuses a tile touching water, on a side or a corner, so a raised lake cannot run out.                                                                                    |
| Slopes        | Neighbours differ by at most one level, so a raise lifts the tiles around it and a lower takes them down. The ghost shows every tile that moves and the price before the click. |
| Price         | Money, per tile per level, the same both ways: `$100` placeholder, a tuning slider.                                                                                             |

A refusal covers the whole action: nothing moves if any tile it would move refuses.

**Terrain.** Raising keeps the tile's terrain. Lowering stone to level 0 turns it to Grass, so a
lowered mountain is flat ground that can be built on (the author accepted this).

**The top goes to 16.** `MAX_LEVEL` in `src/world/elevation.ts` becomes 16, `Mountain` targets it,
and four things that lean on it stay as they are or follow it:

- Water stays at 0 to 4: `MAX_DROP` in `src/world/waterfalls.ts` and the chunk codec's limit of 4
  on a water side get their own constant, or map generation moves.
- `RELIEF_MAX` in `src/render/terrainRelief.ts` goes from 90 to 200, which adds about 8% to a chunk
  canvas.
- `snowLevel` in `src/data/biomes.json` goes to 14 (plains and most climates), 16 where it was 5
  and 12 where it was 3: snow is for the last levels under the top. Low mountains lose their snow.
- `heightLight` keeps its 6% a level up to level 4 and adds 0.9% a level above, in the painter
  and for the peak pictures. At the old rate a tall mountain paints nearly twice as bright.

## 3a. Generated mountains

Shapes are on the review page, section "Hegyek". The author picked A as the common one, B now and
then, and D rarely; C is not used.

**The mix.** About 70% of mountains are A, the model-railway hill: a gentle wooded foot and a steep
rocky core. About 20% are B, long ridges. About 10% are D, rock towers. The shares are a tuning
value. A low-frequency noise over world coordinates picks the shape, so a mountain keeps its shape
across chunks and the map grows the same way whatever order chunks are made in.

**The limit goes.** Today a level comes from terrain and the one-level rule, and rock fields are too
small to rise: generated mountain tiles stand at levels 1 to 3. So generation decides levels itself
and stores them, with a new chunk plane, `generatedLevel`. `levelTarget` reads `groundLevel` first,
then this plane. Every seed makes a new map and the golden hashes move once; saved games keep the
chunks they hold.

**Steeper than one level.** Generated neighbours may differ by up to 4. `tileLevels` and `levelAt`
stop clamping generated ground; Raise and Lower keep their one level a tile. Rail still takes one
level a tile, so a link across an edge with a bigger step refuses, unless a tile of that edge is dug
or cut. Rail may run along a cliff.

**Softer slopes.** Above level 3 a bank runs the whole tile, not half of it, so a tall slope is a
slope and not a staircase. Level 2 and under keep the approved terraces. `terraceHeight` picks the
width per cell, and cells still meet exactly.

**What stands on it.** Trees low down, grass, then rock, with a cliff rock at any height. Forest
ground is painted for the flat and breaks on a slope, so a raised forest tile paints as grass under
the forest's trees; its terrain stays Forest. Peak pictures stand only on true tops.

**What it leaves alone.** Water, the map border, and what is built: a mountain falls away toward
them. Rivers that start in mountains are this work's open design point; the trial sculpts over a
finished map, so it did not touch them.

## 4. The Drill

A tool in the Track menu, from the Diesel Age, for Narrow Gauge, Branch Line, Main Line and Trunk
Line. Maglev and Hyperloop come later.

**Glass.** While the Drill is on, every mountain on the map is glass, off again when it is off:
every tile above level 0 with its banks, the peaks and props on it hidden. Trains, on the surface
or inside, always draw over it, so they stay visible in the glass (proved). A portal shows as an
outline. Dug tiles show as rooms with a floor and see-through walls along their own edge.

**Digging.** A drag digs tiles at floor 0. The dug tiles live in a store of their own,
`Underground`, in `src/sim`, by tile, with the floor (0 in this step) and saved with the game.

| Rule          | Value                                                                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Low ground    | A tile under rail + 3 between dug tiles is raised by Raise's rules, at Raise's price, shown in the ghost. So a tunnel crosses a low saddle, and the ridge it makes is Rock. A tile that leads down to open ground is a cut. |
| Water         | A tile touching water, on a side or a corner, refuses. No digging under water.                                                                                               |
| Above         | A dug tile takes no track, road or building on the surface.                                                                                                                  |
| Stone         | Each dug tile adds stone to the stock: `2` placeholder.                                                                                                                      |
| Price         | Money per tile: `$500` placeholder, a tuning slider.                                                                                                                         |
| Back-fill     | Remove fills a dug tile with no track and refunds half.                                                                                                                      |
| Track removed | A tile stays dug when its track goes.                                                                                                                                        |

**Track inside.** With the Drill on, the track tools lay on dug tiles only, at rail level 0:
straight, curve, switch, crossing, signal. A piece needs its whole footprint dug, member tiles
without a rail included. So walls never cut through a curve or a switch (proved). Stations, depots
and buildings are refused inside. Inside the mountain the rail is level.

**Rail height.** A dug tile's rail bed is a flat bed with `bridge: true` in `railProfile`, the
inverse of a bridge deck: the ground keeps its own shape over it (proved). Unit pieces get the same
flat bed. Their tiles ask no ground (`Builder.groundCheck`), as they stand under it.

## 5. Portals

A portal makes itself when a dug line breaks out onto a slope, and goes when the line is back-filled.

- **Where.** On the first tile at rail + 3 or higher going in from the open side. A portal is free of
  the tile count and costs `$2,000`, a placeholder.
- **Cutting.** From the portal out to the foot of the bank the rail runs in a cutting: a flat bed
  without `bridge`. The relief carves the ground under it with no new code (proved). `railProfile`
  reads a cut or dug tile at its bed level, so the line does not start climbing on the first tile
  past the foot of the bank, which draws as a kink (proved).
- **Which faces.** The four sides. Faces on +x and +y look at the camera and are drawn. Faces on
  -x and -y look away: no art, the train drops behind the hill.
- **The opening.** Half width 0.46 tile, crown 34 px over the rail, at level 3.5.

**Fit.** The portal picture is cut to the ground at run time from the surface heights, so a bank in
front of the plane hides it where it should and the end of the cutting is the only face seen
(proved; this is what stopped it looking stuck on). `frontArt` in the trial is the reference.

**Going in.** Three parts, each proved:

- The back picture draws under the train: its depth is on the `depthKey` scale, and a car near a
  portal never sorts below it, so the picture never covers a car.
- Each car is masked to the outside of the near jamb, with a soft edge.
- A dark copy of the car, masked to the opening, shows the part inside.

A car inside with no part at a portal is hidden, as `hideAt` hides trains in a depot. Rails inside
are hidden too. On a rear face the mask is the line of the hill top, which also cuts the track
sprites in the cutting.

Masks apply only to cars within about four tiles of a portal, so batching is broken only there.

## 6. Parts

| Unit                               | Role      | Does                                                             |
| ---------------------------------- | --------- | ---------------------------------------------------------------- |
| `groundLevel` plane, `levelTarget` | World     | stored levels, `MAX_LEVEL` 16, water limit split                 |
| `railProfile`                      | World     | tunnel and cutting beds, read from `Underground`                 |
| `src/sim/underground.ts`           | Gameplay  | dug tiles, portals, the raise a dig needs                        |
| `Builder`                          | Gameplay  | rules and prices for Raise, Lower, Drill, track inside           |
| `src/sim/save.ts`                  | Gameplay  | migration, `underground` and the level plane                     |
| Portal, mask and glass renderers   | Rendering | sections 4 and 5, new files beside `worldRenderer`               |
| Toolbar, ghost, refusals           | UI/UX     | arrows, Drill toggle, strings                                    |
| Placeholder art                    | Art       | a generator in `src/art`, then Codex (`specs/codex-tunnels.txt`) |

`Underground` decides what is dug; nothing else writes it. Rendering reads it and the portals list.
`game.ts` gets wiring only.

## 7. Errors and edge cases

- **A save with no plane or store** loads as today.
- **Map expansion.** New chunks have no stored levels. A chunk grown beside a raised tile clamps as
  any neighbour does, and `levelTarget` keeps the stored value.
- **Refused digs** leave nothing dug and take no money, as a refused line of track does.
- **A train inside when track is removed** behaves as on the surface.
- **Load repair.** `repairBuiltTiles` keeps rock and mountain under pieces today; it must also keep
  the ground over dug tiles.
- **The editor** paints terrain only; painting a tile clears its stored level and dug state.

## 8. Testing

Deterministic tests, on invariants:

- Stored levels: `tileLevels` and `levelAt` agree; generated neighbours differ by at most 4, and
  the player's tools never step more than one.
- Golden hashes move once, for the new generation, and no generated water stands above 4.
- A raise or a lower that would break any rule moves nothing and charges nothing.
- Ground over a dug tile never drops under rail + 3, whatever order the tools run in.
- A piece lays inside only on a whole dug footprint; no dug tile touches water.
- Save round trip with both new stores, and the migration step.
- A train crosses a tunnel on the same path and time as the same line on flat ground.

Each visual ships through a review page of in-game renders before it is locked.

## 9. Build order

1. Stored levels and `MAX_LEVEL` 16, with the snow line and the light.
2. Generated mountains. Review real maps.
3. Raise and Lower.
4. `Underground`, the Drill and glass.
5. Track inside and rail beds.
6. Portals, cuttings and masks, with placeholder art.
7. Codex paints the final art.

## 10. Decisions so far

- One graph, no underground layer in step 1. (author, 2026-10-30)
- Glass view A, the whole mountain, not a cut slab. (author)
- Raise and Lower in the build menu, for money, with a top, to sea level for now. (author)
- A Drill that turns every mountain to glass while on. (author)
- A piece needs its whole footprint dug, and walls follow dug tiles. (accepted by the author)
- Portals come by themselves. (author)
- Floors step every 4 levels when step 2 comes: one floor is a cube, a train fits with no slab
  between. (accepted by the author, step 2)
- Top level about 16. (author)
- Tiles touching water cannot be dug. (author)
- Prices later. (author)
- Generated mountains lose their limit and may be steep, with variety. (author, 2026-10-31)
- The snow line sits near the top. (author, 2026-10-31)
- Floors and ores as shown are approved for step 2. (author, 2026-10-31)
- Mountain shapes: A most often, B sometimes, D rarely, no C. (author, 2026-10-31)

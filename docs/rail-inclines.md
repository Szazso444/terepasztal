# Rail inclines

How straight rail climbs between terrace levels. Levels come from terrain and from the level of
the water on a water tile (`levelTarget` in `src/world/elevation.ts`; a river on high ground
stands at level 1 or 2); the profile is computed in `src/world/railProfile.ts` and shared by the
terrain painter (rail bed), the track renderer (piece meshes), the train renderer and the
simulation (grade speed). It is recomputed from the whole track on every track or bridge change,
so pieces conform automatically as neighbours are laid or removed.

## Placement

- Straights, crossings and class transitions may be placed on slopes and inclines.
- Curves and switches, regular and high speed alike, need smooth tiles: no bank reaches into any
  tile of their footprint.
- The ground's side of this rule needs no renderer: `groundAllowsAt(map, levels, x, y, need)` in
  `src/world/slope.ts` answers it over `tileLevels` (`groundAllowsOn(map, x, y, need)` does the
  same from the terrain for a few tiles, with no levels to keep). `need` is `'straight'` for
  pieces that may climb and `'level'` for the rest. A straight fits every tile on the map, because
  neighbouring levels differ by at most one; a level piece fits a tile whose four sides (not the
  diagonals) stand at the tile's own level, a side off the map counting as level 0, so a tile on
  the map border fits only at level 0. Off the map nothing fits. The renderer's `groundAllows`
  gives the same answer for every tile (`src/world/slope.test.ts` compares them on seeded maps).
- Exception: a curve or switch whose tiles are not all smooth needs a bridge platform under
  every tile it covers (all four of a high-speed curve). It sits at the deck: the level of the
  rails it meets off the bridge, or its highest tile when every neighbour is on a platform too.
  It is refused when those rails sit at different levels, or when the deck would be below the
  ground under one of its tiles. It counts as a one-tile span of its platform's material.

## Bridges over land

Bridge platforms stand on water or land. Over land the deck carries the rail's level on piers
drawn by the renderer and cut to the ground under each one: two masonry piers per stone tile, a
braced timber trestle per wood tile, and a pier per corner under the square pad of a supported
curve or switch. Over water the deck sits at the waterline: stone spans hang an arch wall under each long edge,
timber spans a truss, and timber posts stand in the water with their feet faded out. A deck never
stands below the water it crosses: over raised water it rises to the water's level, even where
both abutments are lower, and the rail climbs onto it.

The pieces are the illustrated bridge kit (`assets/source/bridges-v1`), packed by
`node tools/bridge-kit.mjs` into the `bridges` atlas group, with the measured deck thickness,
wall heights and shaft lengths in `src/render/bridgeKit.json`. Pier shafts are cut per drop with a
V-shaped foot on the ground. Without the packed atlas the procedural spans are used.

A crossing on a climb holds both lines level at its centre, so the two rails meet.

## Raised decks

A bridge can be raised, one height a click, to level 4 (`Builder.raiseSpan`). The whole connected
bridge rises, and each platform stores its deck height as an absolute level (`Building.deck`).
A deck with no stored height stays automatic, as every bridge of an older save does. A new
platform beside a raised one carries the bridge on at that height.

A stored deck stands at its height, never below the ground or the water under it, and curves and
switches on it stand there too. The rail ramps up to it by itself, one level per tile, over
ground that lies lower: the ramp is rail on its own ground, so the painter lifts the ground under
it into an embankment, and the land around it keeps its shape. A curve, switch, crossing, level
crossing or station must stay level, so `rampReach` reports it and the raise is refused, as is
laying such a piece where a ramp climbs. A road on a bridge has no ramps and keeps the bridge at
its banks' height.

## Tile types along a line

| Type                                    | Where                                                 | Rail                                               |
| --------------------------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| Smooth                                  | a level change on neither edge                        | level, unchanged from before                       |
| Incline transition / decline transition | a level change on one or both edges                   | bends slightly (vertical curve)                    |
| Incline / decline                       | a level tile between two transitions of one staircase | straight grade, no bend                            |
| Bridge                                  | a bridge platform under the rail                      | carries the higher abutment's level across the dip |

A run of transitions and inclines climbs from the level before it to the level after it: a
vertical curve over the first and last tile, a constant grade between. A crest or dip inside a run
levels out on the tile that turns. Grades never exceed one level per tile on a monotonic climb.

Bridges are the only way across a drop the rail should not follow: build bridge platforms (on
water or land), then lay straight track over them.

## Worked example

Levels 0 0 0 0 0 0 1 1 1 2 2 2 1 2 2 1 0 0, bridge platforms on the 12th to 14th tiles:

- tiles 1-5 smooth at 0; tile 6 (level 0) and tile 7 (level 1) incline transitions;
- tile 8 (level 1) incline: between two transitions of the same climb;
- tiles 9 (level 1) and 10 (level 2) incline transitions; tile 11 smooth at 2;
- tiles 12-14 bridge at level 2 over the level-1 dip;
- tiles 15 (level 2), 16 (level 1), 17 (level 0) decline transitions; tile 18 smooth at 0.

`src/world/railProfile.test.ts` pins this example and the invariants (continuity, level track on
smooth tiles, at most one level per tile).

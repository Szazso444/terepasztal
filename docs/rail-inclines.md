# Rail inclines

How straight rail climbs between terrace levels. Levels come from terrain
(`src/world/elevation.ts`); the profile is computed in `src/world/railProfile.ts` and shared by the
terrain painter (rail bed), the track renderer (piece meshes), the train renderer and the
simulation (grade speed). It is recomputed from the whole track on every track or bridge change,
so pieces conform automatically as neighbours are laid or removed.

Only straight pieces along a tile axis climb. Every other piece needs a tile no bank reaches into.

## Tile types along a line

| Type | Where | Rail |
| --- | --- | --- |
| Smooth | a level change on neither edge | level, unchanged from before |
| Incline transition / decline transition | a level change on one or both edges | bends slightly (vertical curve) |
| Incline / decline | a level tile between two transitions of one staircase | straight grade, no bend |
| Bridge | a bridge platform under the rail | carries the higher abutment's level across the dip |

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

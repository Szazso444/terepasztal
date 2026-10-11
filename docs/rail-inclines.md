# Rail inclines

How straight rail climbs between terrace levels. Levels come from terrain
(`src/world/elevation.ts`) and, on a bridge, from its deck; the profile is computed in
`src/world/railProfile.ts` and shared by the terrain painter (rail bed), the track renderer (piece
meshes), the bridge renderer (decks), the train renderer and the simulation (grade speed). It is
recomputed from the whole track on every track or bridge change, so pieces conform automatically
as neighbours are laid or removed.

## Placement

- Straights, crossings and class transitions may be placed on slopes and inclines.
- Curves and switches, regular and high speed alike, need smooth tiles: no bank reaches into any
  tile of their footprint.
- Exception: a curve or switch whose tiles are not all smooth, or that lies over a deck set by
  hand, needs a bridge platform under every tile it covers (all four of a high-speed curve). It
  sits at the deck: the height set under it, else the level of the rails it meets (on the ground
  or on a deck set by hand; automatic decks adapt to it), else its highest tile. It is refused
  when its own decks or those rails disagree, or when the deck would be below the ground under
  one of its tiles. It counts as a one-tile span of its platform's material.
- Where a deck set by hand is involved the rails have to meet: straight rail is refused when it
  would step more than one level to the rail beside it, and a curve or switch is refused beside
  rail that stands at another height than its own.

A crossing on a climb holds both lines level at its centre, so the two rails meet.

## Bridges

A bridge is built of platforms, one tile each, on water or on land (wood or stone; either may
stand beside the other). Straight track laid over them is carried by the deck. A platform has a
deck height, an absolute level like the terrain's: 0 is the water and the lowest ground, 4 the
highest.

- **Automatic** (every platform as it is placed, and every bridge of an older save): the deck
  takes the level of the rail laid over it, which is the level of the higher bank. A run of
  automatic platforms carries that level across the dip. Without track it lies on the ground.
- **Set by hand**: with a bridge tool held (wood or stone, on either material), a click on a
  placed platform raises its deck by one height, a right click lowers it by one. This works on
  land and over water, with or without rail on the deck. The profile then treats the deck as the
  tile's level, exactly like a terrace: the rail climbs onto a raised bridge from flat land, half
  of each step on the tile either side of it, and a row of decks one height apart is a ramp.

What a click may do (`Builder.checkDeck` in `src/sim/build.ts`):

- A deck stands no lower than the ground under it (the waterline over water) and no higher
  than level 4.
- Rail on the deck stays within one level of the rail beside it, and at the height of a curve or
  switch beside it.
- A deck under a curve, switch or crossing stays where the piece was laid; so does one whose rail
  is a station platform. Set the height first, then lay the piece.
- Nothing moves under a train, nor on the tiles either side of one.
- The first click on a bridge fixes every platform of it that carries rail at the height it
  already has: an automatic deck follows the rail beside it, so otherwise the whole bridge would
  move with the one tile. Platforms without track stay automatic. One that is lowered back onto
  the ground before any rail lies on it is automatic again.
- A new platform beside a deck set by hand continues at that height.
- Raising and lowering cost nothing.

A right click on a deck that rests on the ground says so and removes nothing while the deck was
moved a moment ago; after that it removes as everywhere else (rail first, then the platform).
Other tools, the Remove tool and Delete are unchanged.

The deck height is saved with the platform (sixth element of a `buildings` entry, save version
14; absent means automatic) and in editor levels (fourth element).

### How bridges are drawn

Bridges are geometry in the game's own projection, clothed in flat material swatches:

- `src/render/bridgeGeometry.ts` (no Pixi) builds each platform from absolute tile coordinates
  and from the rail profile its track rides: the deck top is the rail height (a curved strip
  where the rail climbs), a 5 px slab, parapets on the edges that neither carry track nor continue
  as one deck onto the next platform, and under every edge with no platform as high beside it an
  arch wall (stone) or truss (timber) on half piers or posts at the tile joints, timber cross
  braces between the posts. The ends of a bridge are closed the same way. Every wall ends on the
  ground sampled under it. Neighbouring tiles compute their shared vertices from the same
  formula, so spans meet without a step at any height and on both axes.
- Over water the supports go on below the bank plane; that part is drawn over water tiles only,
  so arches and posts stand in the water and end behind the bank.
- The swatches are cut from the illustrated kit (`assets/source/bridges-v1`, faces listed in its
  `materials.json`) by `node tools/bridge-kit.mjs` into the `bridges` atlas group; their names
  and sizes are `src/art/bridgeSwatches.json`. Without the packed file `src/art/bridges.ts`
  draws plain swatches of the same names for the same geometry.
- Decks, their track and the trains on them sort with the scenery around them
  (`src/render/bridgeDepth.ts`): a deck covers what stands behind it and is covered by what
  stands in front, whatever order things were built in. A vehicle on straight track over a deck
  is drawn in slices, one per tile under it, each sorted with its own tile: a long engine is
  never under the deck its front is on, nor over the parapet or the tree beside its tail.
- The terrain painter raises an embankment under rail that climbs over level ground, so the bank
  meets a raised deck.

## Tile types along a line

| Type                                    | Where                                                 | Rail                                                                                         |
| --------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Smooth                                  | a level change on neither edge                        | level, unchanged from before                                                                 |
| Incline transition / decline transition | a level change on one or both edges                   | bends slightly (vertical curve)                                                              |
| Incline / decline                       | a level tile between two transitions of one staircase | straight grade, no bend                                                                      |
| Bridge                                  | a bridge platform under the rail                      | carries the higher abutment's level across the dip, or stands at the deck height set by hand |

A run of transitions and inclines climbs from the level before it to the level after it: a
vertical curve over the first and last tile, a constant grade between. A crest or dip inside a run
levels out on the tile that turns. Grades never exceed one level per tile on a monotonic climb.

Bridges are the only way across a drop the rail should not follow: build bridge platforms (on
water or land), then lay straight track over them. A deck set by hand counts as its tile's level
in all of the above.

## Worked example

Levels 0 0 0 0 0 0 1 1 1 2 2 2 1 2 2 1 0 0, bridge platforms on the 12th to 14th tiles:

- tiles 1-5 smooth at 0; tile 6 (level 0) and tile 7 (level 1) incline transitions;
- tile 8 (level 1) incline: between two transitions of the same climb;
- tiles 9 (level 1) and 10 (level 2) incline transitions; tile 11 smooth at 2;
- tiles 12-14 bridge at level 2 over the level-1 dip;
- tiles 15 (level 2), 16 (level 1), 17 (level 0) decline transitions; tile 18 smooth at 0.

`src/world/railProfile.test.ts` pins this example and the invariants (continuity, level track on
smooth tiles, at most one level per tile).

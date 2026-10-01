# Bridge kit v2: generation prompts

v1 did not snap together. Each piece was drawn freehand, so each came out at its own scale, its
own angle and its own position in the frame, and the cut ends carried end caps and posts that
break a continuous wall. v2 fixes this by painting over exact guides.

`guides/` holds one block-out per piece. Each block-out is drawn in the game's own projection:
- the ground runs at exactly 26.57 degrees, 2 px across for every 1 px down;
- verticals stay vertical;
- the scale is 8 canvas px per game px.

All 18 guides share one 1024 x 1024 canvas with the tile centre at the same pixel. A piece
painted inside its guide's outline therefore lines up with every other piece, and
`node tools/bridge-kit.mjs assets/source/bridges-v2` fits it back onto the guide without
guessing. `guides/assembled-*.png` shows how the pieces stack on one tile, with the tile outline
in blue. They are for reference only; don't generate them.

## How to use

One image per piece, 18 images. For each one:

1. Start an image edit, not a new image. Attach `guides/<file>.png` as the image to edit.
2. Attach `docs/art-direction/images/03-theme-town-growth.png` as the style reference. Once the
   first piece of a material is approved, attach it too.
3. Paste the shared block, then the piece line.
4. Save the result as `assets/source/bridges-v2/<file>.png`, the same name as its guide.

Before saving, lay the result over its guide at 50% opacity. Every outer edge must sit on the
guide's edge within about 4 px, and the two cut ends must be straight lines where the guide's
ends are. If an edge drifts, run the edit again; don't correct it by hand.

## Shared block (every image)

```
Repaint the attached grey block-out as a finished game sprite in the style of the reference:
the pastoral railway style, crisp pixel-art-inspired clustered shading, three or four shades per
material, upper-left lighting. Keep the block-out's geometry exactly. Every outer edge, every
face and every angle stays where it is in the block-out, within a few pixels. Do not rotate,
move, scale, tilt or re-project anything. Edges running across the image keep their exact
2:1 slope (two pixels across for each pixel down); vertical edges stay vertical. The light
grey face is lit from above, the mid grey face faces the lower left, the dark grey face faces
the lower right. Keep that lighting. Same 1024 x 1024 canvas, same position. Only the object:
REAL RGBA transparent PNG, background alpha zero, solid surfaces opaque. No text, rails,
sleepers, water, ground, scenery, glow or cast shadow. No outline around the whole object.
Cut ends: where the block-out ends in a flat vertical cut, the painting ends in the same flat
cut, with no end cap, end post, end block, border or rounding. The next tile continues right
there, so any pattern (stone courses, coping stones, planks, rails, diagonals) must run
straight through the cut at the same height on both ends.
```

## Pieces

| File | Piece (append to the shared block) |
| --- | --- |
| `stone-deck-x.png` | Cream limestone bridge deck: the slab is dressed stone flags, and the low wall on the far edge is a limestone parapet with a flat coping. Stone courses and coping run through both cut ends. |
| `stone-deck-y.png` | The same limestone deck and far parapet, for this guide. |
| `stone-rail-x.png` | The near limestone parapet only: coursed blocks under a flat coping, running through both cut ends. |
| `stone-rail-y.png` | The same near limestone parapet, for this guide. |
| `stone-pad.png` | A square dressed limestone slab of flags, no walls. Its edges are finished (it stands alone). |
| `stone-pier.png` | A square limestone masonry pier shaft of coursed blocks. The top is a flat face. The courses repeat evenly all the way down, so the shaft can be cut at any height. No base or plinth. |
| `stone-arch-x.png` | A limestone arch wall: voussoirs around the opening, coursed blocks elsewhere. At each cut end there is half a pier, so two tiles side by side form one full pier. Courses run through both cut ends. |
| `stone-arch-y.png` | The same limestone arch wall, for this guide. |
| `wood-deck-x.png` | Timber bridge deck: the slab is planks laid across the track, and the low wall on the far edge is a solid timber kerb beam, not a railing. Plank lines and the beam run through both cut ends. |
| `wood-deck-y.png` | The same timber deck and far kerb beam, for this guide. |
| `wood-rail-x.png` | The near timber railing: a top rail and a mid rail on posts. There is exactly one post, at the upper cut end; the other cut end has no post, so a row of tiles gets evenly spaced posts. Both rails run through both cut ends. |
| `wood-rail-y.png` | The same near timber railing, for this guide. Its one post is at the upper cut end. |
| `wood-pad.png` | A square timber deck of planks, no railing. Its edges are finished (it stands alone). |
| `wood-post.png` | A square timber trestle post. The top is a flat end-grain face. The wood grain runs straight all the way down, so the post can be cut at any height. No base. |
| `wood-brace-x.png` | Two timber planks crossing in an X, exactly on the two bars of the block-out, with a bolt at the crossing. Nothing else. |
| `wood-brace-y.png` | The same timber X brace, for this guide. |
| `wood-truss-x.png` | A timber truss: a top chord and a bottom chord running straight through both cut ends, and diagonals exactly on the block-out's diagonals, meeting the chords at the same points. Iron plates at the joints. |
| `wood-truss-y.png` | The same timber truss, for this guide. |

## Why the guides look like this

- Piers and posts are drawn tall. The game cuts them to the drop under each deck, so they have
  no base and a pattern that repeats all the way down.
- Railings and parapets are low: 5 game px of stone and 7 of timber. The near one is drawn in
  front of the trains, so a tall one would hide the wheels.
- The far wall of the deck is a solid kerb on timber decks. The railing only needs to be seen
  from the near side.
- Both directions are separate pieces instead of mirror images, so the upper-left light stays
  right.

## After generation

Commit the 18 PNGs next to `guides/`, then run:

```
node tools/bridge-kit.mjs assets/source/bridges-v2
```

It fits each piece onto its guide and rewrites `public/assets/bridges.*` and
`src/render/bridgeKit.json`. Regenerate the guides with `node tools/bridge-kit-guides.mjs` if the
kit geometry in that file ever changes.

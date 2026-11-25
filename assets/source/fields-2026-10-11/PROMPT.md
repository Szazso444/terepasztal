# Wheat fields, raised: the illustrated version's prompt

The author's feedback of 2026-10-12 on the wheat field: "Raise it a little so it has some texture
(height): now it looks like something barren." The three paintings in this folder (`wheat-0..2.png`)
are flat crop-row patches. `tools/finish-fields.mjs` lifts them deterministically today, so the
game already shows a raised field; this prompt asks for pictures that stand up on their own, which
would replace the lifted ones and be finished with `--raise 0`.

A wheat field is a low raised patch: rows of stalks standing 2.6 to 3.5 game px over the ground,
lit from the upper left, with a darker front where the stalks end on the lower left and lower right.
The random, irregular outline stays, and so do the three variants.

## How to use

One image per variant, 3 images. For each one:

1. Start an image edit, not a new image. Attach `guides/wheat-raised.png` as the image to edit
   (`node assets/source/fields-2026-10-11/make-raised-guide.mjs` redraws it).
2. Attach `docs/art-direction/images/03-theme-town-growth.png` as the style reference, and
   `assets/source/base-v1/farm.png`, `assets/source/base-v1/cargo-wheat.png` for hue and scale.
3. Paste the shared block, then the variant line.
4. Save the result as `assets/source/fields-2026-10-11/raised/wheat-0.png`, `wheat-1.png` or
   `wheat-2.png`. Do not overwrite the flat paintings next to them.

Before saving, lay the result over its guide at 50% opacity. The ground corners and the four
top-face corners below must sit within about 8 canvas px of the guide's. If an edge drifts, run the
edit again; do not correct it by hand. The framing is measured and corrected by the finishing step,
so the size and position of the field are never a reason to paint it again; its height, its rows
and its edge are.

## Shared block (every image)

```text
Edit image 1, the grey raised wheat guide, into ONE raised wheat field sprite. Use case:
precise-object-edit. Request output 1024x1024 pixels, RGBA PNG, transparent background. Keep the
full guide canvas and exact framing: large empty upper area; the field stays near the bottom, NOT
centred in the canvas and NOT enlarged to fill it. Image 2 theme-town-growth is the style reference
for pastoral industry, folk warmth and quiet ambition. Images 3 farm and 4 cargo-wheat are hue,
scale and finish references only; do not copy their blocky pixel edges or any objects from them.

GEOMETRY: 2:1 orthographic isometric, 64x32 game px per tile, 8 canvas px per game px. Tile
centre/anchor (512,832). Tile diamond top (512,704), right (768,832), bottom (512,960), left
(256,832). Point at tile offset (x,y) = (512+256*(x-y), 832+128*(x+y)). Tile x runs NW to SE and
tile y NE to SW. The patch lies within abs(x)<=0.42 and abs(y)<=0.42 on the ground: ground corners
(512,724), (727,832), (512,940), (297,832). The stalks stand 3 game px = 24 canvas px over the
ground, so the top face has the corners (512,700), (727,808), (512,916), (297,808). Between the
ground and the top face on the two sides that face the viewer, the lower-left front from (297,808)
to (512,916) and the lower-right front from (512,916) to (727,808), is the front of the stalks,
24 canvas px tall (they vary between 21 and 28 across the field in slow swells, a little lower at
the very edge). NOTHING outside the tile diamond. Soft irregular edge: the SE and SW edges wander
inward and outward by up to 0.04 tile, the NE and NW edges only inward by up to 0.04 tile, so
neighbouring patches never touch. Replace the grey faces and row lines with painted material and
REMOVE the diamond outline and every guide mark.

ROWS: about nine parallel crop rows, following the guide's diagonal lines along tile y, rising to
the upper right (from (256,832) toward (512,704)), parallel to the NW and SE edges. A row is a
ridge of stalks 4 game px wide in every 6; the furrow between two ridges is 2 game px wide and its
floor lies about 1 game px (8 to 10 canvas px) lower than the stalks, so the lower-right front shows
the rows as a notched, shaded edge. The stalks are low and grouped, with tiny ear hints; never tall
individual stalks, never a thick slab or a platform. The sides are stalks, not planks or timber.

LIGHT: one light, from the upper left. Row tops are lightest; the lower-left front is a mid tone,
the lower-right front the darkest, and both fronts darken toward the ground, in warm brown (the
blue drops fastest, never grey or black). Broad colour clusters, only three or four shades per
material, smooth painted contours, restrained game-sprite finish, no per-pixel noise, no
stair-stepped pixel edges.

PALETTE: ripe wheat #CEA850 base, #DAB65C lit, #AA863E shade; the front of the stalks #7C5C32 at
the ground to #B08A44 under the top face; furrow earth #8A7044. Green wheat (variant 1 only)
#709246, #80A252, #5A7A38. Supporting palette forest #294638, moss #78804C, oat #E4D5B5, limestone
#BCA98B, slate #626B6C, water #477B82, copper #A36B42. No highlight at or above the cursor white
#ECE4D0 or the selection amber #E8AA48: the red of the brightest ear stays under 226.

EXCLUDE fences, barn, standing sheaves, haystacks, people, animals, vehicles, shadows on the
ground, grass or ground outside the patch, text, borders, glow. Fully transparent alpha 0 outside
the field, a soft partial-alpha fringe allowed. Deliver one picture only.

FRAMING IS CRITICAL: exactly match the guide's SMALL patch. The ground footprint spans ONLY 42% of
the canvas width. Its leftmost point is 29% across and 81.25% down; rightmost 71% across and 81.25%
down; ground bottom 50% across and 91.8% down. The back corner of the top face is 50% across and
68.4% down. The ENTIRE upper 67% of the canvas must be empty transparent. Do not enlarge the patch.
Keep a lower margin of 8% of the canvas. Retain this normalized framing even if the output size
differs from 1024x1024.
```

## Variants (append to the shared block)

| File      | Variant line                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wheat-0` | VARIANT wheat-0: all ripe gold, distinct gently uneven crop clusters, a soft irregular perimeter. Paint this single asset independently.                                                                                                                                                                                                                                           |
| `wheat-1` | VARIANT wheat-1: mostly ripe gold, with a restrained greener band toward the upper-right end of the rows, crossing several row ends and turning into ripe gold. Paint this single asset independently; do not mirror or reuse another painting.                                                                                                                                    |
| `wheat-2` | VARIANT wheat-2: ripe gold, with a few small irregular flattened patches of wheat laid down inside the rows (smooth gold clusters standing only about 1 game px, 8 canvas px, over the ground, interrupting two or three rows locally) and one ragged lower-left corner. Keep most of the nine rows readable and continuous. Distinct asymmetrical perimeter; paint independently. |

## Check (before saving, per picture)

- The top face and the fronts read as stalks standing over the ground, 21 to 28 canvas px tall
  at the front, not as a flat patch and not as a slab.
- Light from the upper left; the lower-right front is the darkest; no highlight at or above
  `#ECE4D0` or `#E8AA48`.
- The rows are the guide's rows, about nine, ridges with lower furrows.
- An irregular outline that differs between the three pictures; nothing outside the tile diamond.
- Fully transparent outside the field; no guide marks, no shadows, no text.

## Finishing

The pictures go through `tools/finish-fields.mjs` as the flat ones do: scale about the anchor to
the tile (the factors in `VARIANTS` are the flat paintings' and are measured again for these),
recentre, alpha from `geometry.json`, the highlight cap. With the raise already in the painting the
lifting step is left out:

```sh
node tools/finish-fields.mjs --paintings assets/source/fields-2026-10-11/raised --raise 0
```

The geometry (`geometry.json`) and the flat guide (`guides/wheat.png`) are the Codex review's and
stay as they are; `make-raised-guide.mjs` adds only the lift.

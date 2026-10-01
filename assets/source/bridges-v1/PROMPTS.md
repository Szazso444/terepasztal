# Bridge kit v1: generation prompts

Modular bridge pieces for water and land, in stone and wood. The game builds every bridge from
these pieces: decks and railings one tile long, piers stretched or repeated to the exact drop
under each deck, square pads under curves and switches. One piece per image, 18 images.

Save each result as `assets/source/bridges-v1/<file>.png` (names in the table). Keep the
originals; the pipeline trims, smooths and resamples them (`tools/illustrated-sprites.mjs`).

## How to use

Paste the shared block, then the piece line, as one prompt per image. Attach the style
reference `docs/art-direction/images/03-theme-town-growth.png` and, for consistency, the first
approved piece of the same material once you have it.

## Shared block (every image)

```
Create exactly one isolated game object in the reference's pastoral railway style, crisp
pixel-art-inspired clustered shading, three or four shades per material, upper-left lighting,
orthographic 2:1 isometric view (camera 30 degrees above the horizon, rotated 45 degrees, no
perspective: parallel edges stay parallel). The ground grid is a 2:1 rhombus tile, twice as wide
as it is tall. Entire object centered with a 10% empty margin. REAL RGBA transparent PNG, empty
background alpha zero, solid surfaces opaque. No text, rails, sleepers, water, ground, scenery,
glow or cast shadow. One object per image. Hard, clean silhouette; no detached parts.
```

## Pieces

"Lower right" and "lower left" are screen directions: a piece "running toward the lower right"
lies along the tile edge that goes from upper left to lower right.

| File | Piece (append to the shared block) |
| --- | --- |
| `stone-deck-x.png` | One flat cream limestone bridge deck slab exactly one tile long, running toward the lower right, its top face exactly one 2:1 rhombus tile, slab about one tenth of the tile width thick, with a low stone parapet along its far (upper) long edge only. The near long edge has no parapet. Square cut ends, as if cut from a longer deck. |
| `stone-deck-y.png` | The same limestone deck slab and far parapet, running toward the lower left. |
| `stone-rail-x.png` | Only the near low limestone parapet wall of that deck, exactly one tile long, running toward the lower right, with square cut ends. No slab. |
| `stone-rail-y.png` | The same near limestone parapet, running toward the lower left. |
| `stone-pad.png` | One square flat limestone deck slab, top face exactly one 2:1 rhombus tile, slab about one tenth of the tile width thick, no parapets. |
| `stone-pier.png` | One tall rectangular limestone masonry pier shaft, seen from the same camera, five times as tall as it is wide, with flat top and flat bottom, coursed blocks that repeat seamlessly from top to bottom. No cap, no base, no arch. |
| `stone-arch-x.png` | One limestone arch wall exactly one tile long, running toward the lower right: a single segmental arch between two pier faces, the arch crown touching the top edge, flat top edge, square cut ends. Wall only, no deck. |
| `stone-arch-y.png` | The same limestone arch wall, running toward the lower left. |
| `wood-deck-x.png` | One flat timber bridge deck of planks across its width, exactly one tile long, running toward the lower right, top face exactly one 2:1 rhombus tile, about one tenth of the tile width thick, with a simple post-and-rail timber railing along its far (upper) long edge only. Square cut ends. |
| `wood-deck-y.png` | The same timber deck and far railing, running toward the lower left. |
| `wood-rail-x.png` | Only the near timber post-and-rail railing of that deck, exactly one tile long, running toward the lower right, with square cut ends. No deck. |
| `wood-rail-y.png` | The same near railing, running toward the lower left. |
| `wood-pad.png` | One square flat timber plank deck, top face exactly one 2:1 rhombus tile, about one tenth of the tile width thick, no railing. |
| `wood-post.png` | One tall square timber trestle post, seen from the same camera, ten times as tall as it is wide, flat top and flat bottom, wood grain that repeats seamlessly from top to bottom. |
| `wood-brace-x.png` | One timber X-brace panel between two posts, exactly one tile long, running toward the lower right, as tall as it is long on screen, two diagonal planks crossing, no posts. |
| `wood-brace-y.png` | The same X-brace panel, running toward the lower left. |
| `wood-truss-x.png` | One timber truss side panel exactly one tile long, running toward the lower right: top and bottom chords with triangular (Warren) bracing, square cut ends so neighbours join into one continuous truss. |
| `wood-truss-y.png` | The same truss panel, running toward the lower left. |

## Scale and fit (for review, not for the prompt)

- In the game a tile is 64 x 32 px; the illustrated atlas stores it at 4x (256 x 128 px).
- One elevation level is a quarter of a tile side: 9.8 px in game, about 39 px in the atlas.
- Decks sit 4 px (in game) thick below the rail; piers run from the deck underside to the ground,
  so their shafts are stretched or repeated to length, never drawn at a fixed height.
- Both directions are asked for, instead of mirroring one, so the upper-left light stays right.

## After generation

Commit the PNGs here. The cloud session then maps them in `tools/illustrated-sprites.mjs`, cuts
piers to the drop under each deck in `src/render/worldRenderer.ts`, uses arches and trusses over
water, and shows the result in game renders next to the current procedural bridges.

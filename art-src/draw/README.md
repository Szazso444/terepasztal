# art-src/draw: assets drawn in code

A fourth route into the atlas, beside an asset program rendered in Blender, an imported mesh, and
a crop taken from a concept board. These are **drawn**: no camera, no light solve, every pixel
placed deliberately.

```sh
node art-src/draw/broadleaf.mjs out.png [seed] [variant]
node art-src/draw/conifer.mjs   out.png [seed] [variant]
```

They exist because two things a tree needs are what a rendered volume destroys. The canopy is a
mosaic of leaf clumps with daylight between them, so its edge is ragged at the scale of a clump
rather than smooth at the scale of a sphere. And the branches are real: the bole divides, divides
again, and the limbs show through the gaps. Both are placement decisions, and placement is what
drawing is.

Output goes into `art-src/ref/` like any other reference, and `tools/bake-refs.mjs` takes it from
there, so a drawn asset lands in the atlas through exactly the path a board crop does.

## Where each one stands

- **broadleaf.mjs** works. At sprite size it reads as an oak and sits beside the board's own.
- **conifer.mjs** does not, yet. The tiers read as stacked chevrons where a fir's should be a
  comb of fine needles, and the silhouette is the giveaway. The needle primitive is the thing to
  change: ticks stepping down and out are closer than the vertical stacks it started with, but
  still too coarse, and the tiers want to interleave rather than sit in rows.

## What drawing buys and costs

It is slower to arrive at than asking a model for a picture, and the first attempt at any subject
is worse. Against that: it is deterministic, it takes a seed and a variant, and it produces as
many trees as the game asks for rather than the one that was generated. A board gave two specimens
per family and the third had to be a mirror; this gives fifty.

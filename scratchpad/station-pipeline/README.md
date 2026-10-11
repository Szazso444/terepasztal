# Regenerated station pipeline

The active source is `assets/source/base-v1/station-isometric-v4.png`, generated with the built-in image-generation tool. The original `station.png` is untouched. Attempts v2 and v3 are retained as rejected projection studies; they are not game assets.

The selected attempt used the original station as a design/material reference and `projection-guide.png` as a camera/geometry reference. The exact final prompt is in `generation-prompt.txt`; the guide is reproducible with `node scratchpad/station-projection-guide.mjs`.

No affine correction, split-face warp or nonuniform resize is applied. The build script removes faint alpha glow, trims transparent margins and resamples uniformly to a four-texel-per-world-pixel sprite. The source roof therefore remains intact. Exact 2:1 alignment is not certified: image generation still deviates from the geometric guide, particularly on the end-wall direction. This is a review candidate, not an approved production atlas.

Run `node scratchpad/build-station-demo.mjs` and `node scratchpad/verify-station-demo.mjs`. The page shows the original, regenerated image, transparent cutout, sprite, and neighbouring tile scene. Switch to original proportions or the earlier contracted candidate for comparison. Production atlases are not changed.

Gold marks the current one-tile gameplay footprint; cyan marks the ground anchor. Neighbour mode is a rendering stress test, not a build-rule simulation. Original procedural rails and grass are loaded directly.

## V5: guide-first regeneration

Active source: `assets/source/base-v1/station-isometric-v5.png`. Generated with the built-in image-generation tool using only the geometric guide as its image input, to avoid inheriting the original illustration's shallow camera angle. Prompt: `generation-v5-prompt.txt`. V4 remains preserved.

Manual approximate pixel landmarks in the 1387×1134 source: front wall base (160,555) to (928,924), slope +0.4805, angle 25.66°; end wall base (946,933) to (1274,780), slope −0.4665, angle −25.01°. Target ±26.565°. These are visual estimates with several pixels of endpoint uncertainty, not an automated projection certification. The residual is approximately 0.9–1.6°. Ridge and wall edges appear straight; no geometry warp is applied.

Projection terminology: mathematical isometric has equal axis scales and horizontal directions at ±30°. This game's 64×32 grid is 2:1 dimetric, with directions ±26.565°. The asset targets the existing game grid. Reference: https://en.wikipedia.org/wiki/Isometric_projection

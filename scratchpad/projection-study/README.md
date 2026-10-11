# Three camera comparison

Open http://127.0.0.1:5173/scratchpad/projection-study/index.html with Vite running.
This isolated study does not change the running game's art.

| Camera         | Azimuth | Elevation above horizontal | Screen ground edges |   Tile W:H |
| -------------- | ------: | -------------------------: | ------------------: | ---------: |
| Lower dimetric |     45° |                 15.542268° |                ±15° | 3.732051:1 |
| Current 2:1    |     45° |                        30° |         ±26.565051° |        2:1 |
| True isometric |     45° |                 35.264390° |                ±30° | 1.732051:1 |

With horizontal half-tile scale S and elevation e, all study geometry uses:

```
screenX = originX + S * (x - y)
screenY = originY + S * sin(e) * (x + y) - S * sqrt(2) * cos(e) * z
```

X/Y/Z use equal world units. The current game defines a 64x32 ground grid and
10-pixel terrain elevation steps, not a physical 3D camera. A 30° camera is the
orthographic interpretation of its ground projection at 45° azimuth. 26.565°
describes the screen edge angle, not the camera elevation.

## Accurate geometry

Ground, rigid roofs/walls, yards, rail gauge, sleepers and rail directions share
one projection per scene. Geometry, world scale and horizontal zoom are identical
across scenes. Each building occupies an integer anchored one- or two-cell
footprint and rotates geometry and yard together. Doors share 0.28-unit height.
People are 0.225 units tall (1.8m at an illustrative 8m/tile). That physical scale
is not a production decision. The eight-heading rail fan is not a playable switch.
The lower camera matches the reference's 105°/105°/150° axis separation.

## Approximate artwork

PNGs do not contain hidden surfaces or world-space depth. The scenes use simplified
geometry for eight completed building families, with wall/roof/door palettes
sampled from their generated facing-0 sprites. These are not reconstructed or
finished production assets. They cannot establish exact facade detail or silhouette
at a different elevation.

The separate original-art audit loads the existing four PNG facings at their
saved dimensions and anchors on the current 2:1 grid. There is no angle correction
or nonuniform stretching; existing angle/scale drift remains visible intentionally.
Source images are untouched.

Image generation returned usage_limit_reached during the preceding batch. Faithful
new art views are blocked until it is available. No paid API fallback was invoked.
After a camera choice, use fixed geometry guides and verify every asset before
accepting more production sprites. Prompt angles alone are insufficient. Do not
restart the remaining 18 building sets before the projection decision is resolved.

Reference: https://en.wikipedia.org/wiki/Isometric_video_game_graphics
Previous prompts: ../../assets/source/building-poc-v1/remaining/*.prompts.json
Run `node scratchpad/projection-study/verify.mjs` for geometry/browser checks and
repo-local screenshots under `review/`. Nothing is embedded in chat.

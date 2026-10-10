# Generated 128 × 128 world · blending revision v2

Six 1920×1200 still captures of **one actual game world**, with a whole-map view,
regional view, town station, industrial district, farm halt and track close-up.
Open `gallery.html`; delivery copy: `G:/DEV/Terepasztal/renders/generated-world-v2`.

The normal `generateMap(7412, { w: 128, h: 128 })` creates the landscape. All other
generator parameters retain their defaults. The seed naturally includes all six
biomes, lakes, forests, hills and mountains. Terrain, biome and variant hashes
before and after scene setup match exactly. The real Game loads that generated
terrain through its level loader; the generated prop arrangement is restored
before construction. Only construction clears occupied vegetation. This is not
the previous set of manually filled single-biome maps.

## Requested visual changes

- Large rectangular yards and connecting paved strips are removed. Each building
  gets two or three seeded irregular scuffs, with ellipse radii of 0.11–0.28 tiles,
  at most 50% material opacity and soft uneven edges. The report measures their
  maximum distance from their building anchor (under 0.95 tile including edge
  variation). Original ground stays visible. Built-in plinths already present in
  source building art, such as the substation's concrete footing, are retained.
- Ballast inherits 48% of its colour from the local terrain sample. Four translucent
  shoulder bands progressively expose the ground, while steel and timber remain
  legible. Steel receives a subtle 12% terrain colour contribution. Frames use the
  original `linkPoints`, rotations and ±0.16-tile rails; the gauge remains 0.32 tile.
- A viewport-sized world-coordinate material field renders the actual generated
  tiles, with narrow blends at their boundaries. Hills and mountains retain their
  existing elevated sprites. Terrain classifications, buildability, geometry and
  elevation rules are unchanged.

The illustrative buildings, props, Rocket and 11-pixel adult use the same assets
as v1. No new image generation was necessary. Construction uses the real Builder;
114 connected rail pieces join three areas with 20 buildings/decor placements.

## Validation

`renders/report.json` contains generated-plane hashes, terrain/biome counts,
placements, every rail's local material and gauge, patch bounds and camera views.
Capture fails on browser exceptions. Runtime checks also enforce map identity,
no unbridged track on water, route connectivity, the 11-pixel person texture and
an unstretched Rocket sprite. Six final captures were visually inspected.

Existing map-generation test suite: **9 tests pass**. No golden hashes were changed.
Formatting check covers this fixture. No production source, atlas, save or runtime
dependency was changed during this revision. The geometry uncertainties recorded
for the original Rocket reconstruction still apply; screenshots do not certify
wheel contact.

## Reproduce

With the existing QA Vite server on port 5190:

```sh
node scratchpad/generated-world-v2/capture.mjs
node scratchpad/generated-world-v2/publish.mjs
```

Start that server if needed with `node scratchpad/asset-qa/serve.mjs`.
The fixture imports game code, v1's people atlas and the Rocket QA atlas from the
C: checkout. G: holds the static deliverables and a copy of these scripts.
The CPU material renderer is a static-review implementation, not a performance-
tested production renderer for continuously moving cameras.

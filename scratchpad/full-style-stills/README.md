# Full-style in-game stills · v1

Seven 1920×1200 PNG screenshots: village, station close-up, industry, countryside,
desert, taiga and wetlands. Open `gallery.html` for the static image gallery.
The primary delivery copy is `G:/DEV/Terepasztal/renders/full-style-v1`.

These are screenshots of the real Game, WorldRenderer, TrainRenderer and
PeopleRenderer with assets loaded in Pixi. They are not AI-generated scene
paintovers. The game is paused and no animation or video is delivered.

## Consistent scene treatment

- Existing approved illustrated source art supplies buildings, trees, rocks,
  vegetation, soil, paving and water. Original source PNGs are preserved.
- The Rocket uses the original-image reconstruction and 25-facing atlas already
  tested in `../asset-qa`. It remains rigid and uses the existing track geometry.
- The continuous ground field extends `../art-world/landscape.js` and samples
  approved material interiors. It suppresses repeated lit tile borders, blends
  yards and shores, and keeps foreground rails readable. This is a fixture-only
  ground renderer for these flat districts, not a production terrain rollout.
- Existing `../art-world/lots.js` door-based estimates give buildings a shared
  human reference. These visual scale adjustments affect only the fixture;
  gameplay footprints and content definitions are unchanged.
- One new transparent passenger sprite was generated with the built-in imagegen
  tool, using the passenger inside `people-walker.png` as the art reference.
  The misleadingly named original is a whole station illustration, not a usable
  isolated person. The new static sprite is packed at 4× density and 11 logical
  pixels tall. Its prompt is in `passenger-prompt.md`. This is one standing pose,
  not a completed walking or directional character set.

## Verification and limits

`renders/report.json` records successful placements, camera geometry, visual scale
profiles, person texture selection and size, unstretched train body, zero track
tiles on water, and browser exceptions. The capture script fails on browser errors.
Rail corridors and the preview yards are cleared of prop trunks. Captures were
visually reviewed after rendering.

This is a preview of the style across asset families and biomes, not a claim that
every production asset, building upgrade or train facing has been revamped.
The Rocket's previously recorded wheel/gauge uncertainty remains unresolved.
The standing person's camera and the existing building projections are visually
matched, not metrically certified 3D reconstructions. No new physical scale
contract is asserted. Normal game saves and production atlases were not changed.

## Reproduce

From the game checkout, with the existing QA server running on port 5190:

```sh
node scratchpad/asset-qa/serve.mjs
node scratchpad/full-style-stills/prepare-person.mjs
node scratchpad/full-style-stills/capture.mjs
node scratchpad/full-style-stills/publish.mjs
```

The source passenger is retained in `assets/`, so subsequent packing does not
require the original generated-image cache or another generation call.
`index.html?scene=village` runs the isolated scene; `gallery.html` shows only PNGs.
The C: checkout is required to rerun the fixture. G: contains the delivery copy.

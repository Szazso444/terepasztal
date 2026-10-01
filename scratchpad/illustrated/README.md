# Illustrated studies through the sprite pipeline

The 147 source studies Codex generated in `assets/source/base-v1` (main at `1ef0f32`), run
through the game's own sprite pipeline: halo cut, trim, downsample into each runtime frame's pixel
box, anchor carried over from the procedural frame, packed with `tools/pack-atlas.mjs`. Nothing in
`src` changed; `public/assets` was only used during the screenshots and is clean again.

| What                                             | Where                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| Override atlases the game loads as-is            | `atlas/<group>.png` + `.json` (copy into `public/assets/` to try) |
| Per-study mapping, unmapped studies, conflicts   | `import-report.json`                                             |
| Contact sheets, procedural (current game)        | `shots/before/*.png`                                             |
| Contact sheets, illustrated                      | `shots/after/*.png`                                              |
| In-world: play, close, far, night, overview, UI  | `shots/after/{play,close,far,night,overview,build-stations,craft}.png` |
| Built scene on seed 4242 (village, bridge, train) | `shots/scene/*.png`                                              |

```sh
npm run dev -- --host 127.0.0.1
node scratchpad/dump-atlases.mjs /tmp/atlas-dump        # the live atlases, every frame
node scratchpad/import-base-sprites.mjs /tmp/atlas-dump scratchpad/illustrated/atlas
cp scratchpad/illustrated/atlas/* public/assets/        # try it in the game; remove to revert
```

## Numbers

| Group      | Frames | Illustrated | Notes                                                     |
| ---------- | -----: | ----------: | --------------------------------------------------------- |
| terrain    |     71 |          70 | `fog` stays procedural                                    |
| props      |     43 |          43 | complete                                                  |
| track      |     81 |          81 | one picture per piece, reused for every rotation          |
| structures |    673 |         109 | 512 bridge span pieces, 16 semaphore states, catenary, note/alert/warn stay procedural |
| rolling    |   1250 |         650 | body/engine/frame/cradle part only, all 25 facings share one picture |
| wagons     |    675 |         400 | wagon bodies only; bogies, loads and engine units stay procedural |
| fx         |     10 |          10 |                                                           |
| icons      |     18 |          18 | complete                                                  |
| people     |     18 |          18 |                                                           |

143 of 147 studies mapped to a frame family. Unmapped: `stations-full-mine`, `-sand-pit`,
`-copper-mine` (the game draws all three with the quarry frames, `art: "quarry"`) and
`track-bridge` (bridge decks are structure spans, not track frames). Ten studies lost to a frame
family already taken by another study, because the game shares one sprite family between
definitions: drg01, black_five and nine_f draw as mav424; taurus and re460 as v63; j94 as mav375;
bulkhead_flat and heavy_flat as bolster_flat; pressure_tank as welded_tank; dump_hopper as
steel_hopper.

## What the pictures show

Works at sprite scale, no further art needed to judge it: structures (station, depot, works,
houses, windmill, kiln, bridges as build icons), props, cargo icons, the vehicle roster at facing 0.

Breaks, by construction of "one picture per family":

- **Track.** Every rotation of a piece shows the same drawing, so three of four curves, seven of
  eight switches and one of two straights point the wrong way. Track needs one drawing per
  rotation, or a rotatable source.
- **Rolling stock.** All 25 drawn facings share the facing-0 picture; on a curve the train does
  not turn. Tender, Garratt and Meyer locos show the study (engine + tender in one picture) in the
  engine part while the procedural tender or engine units still draw beside it. Bogies stay
  procedural under illustrated bodies.
- **Terrain.** The studies draw a bevelled slab with a dark rim, so every tile shows its edge and
  the ground reads as a grid (`shots/scene/village.png`, `shots/after/play.png`). Forest tiles
  are much darker than grass; hillcut is orange. Shared tile edges need the rim removed and the
  four variants need to differ.
- **Levels and variants.** All five station levels, all four works levels, all three or four
  terrain variants and both walker frames are identical.

Source-content problems, visible only once scaled:

- `fx-fog`, `fx-glow`, `fx-light-tile` and `terrain-cursor` are pictures of buildings, so fog,
  lamp glow, the tile highlight and the build cursor/ghost/select frames all render as a house
  (`shots/after/icons.png`, `shots/after/terrain.png`). A `corrections/terrain-cursor-v2.png`
  exists but was never promoted.
- `fx-rain` is nearly empty after the halo cut.
- `people-walker` is a group scene squeezed into an 18 px frame; unreadable.
- Icons average down to roughly 12 px and lose their silhouette (food, iron, oil, power).

The halo: every study carries a soft glow of alpha 1–60 around a hard-edged object. The importer
cuts alpha below 128 and hardens the rest, which is what the 77 "alpha edge warnings" in Codex's
report were pointing at.

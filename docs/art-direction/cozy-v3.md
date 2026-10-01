# Cozy landscape and scale integration · 2026-09-25

## Runtime art and terrain

`WorldRenderer` now uses a worker-painted continuous surface over the generated
map. Sources remain the approved illustrated assets and their pastoral palette.
Noise and grain are anchored to world coordinates, not restarted per tile. Coherent
edge displacement breaks up material boundaries; a narrow blend keeps the centre
of each logical tile readable. Seasonal colour follows the same material weights,
so water stays blue without creating square colour discontinuities along banks.
Small translucent ripples animate separately without rerasterizing terrain.

Hill/mountain neighbourhood density raises a shared continuous height field.
Dense hill groups become larger masses with rocky cores. Slope bounds prevent
projected surfaces folding over themselves. This is visual relief: terrain types,
map-generation seeds, build costs, rail geometry and train physics are unchanged.
Rail excavation lowers the surface and rebuilds only nearby cached chunks. Terrain
is cached in 8×8 chunks at 2 logical pixels per sample; camera motion does no raster
work. The original ground remains a startup fallback until the worker finishes.

Two small seeded scuffs stay close to each structure. A 1.25 px lower-contour band
softens actual building contact edges; walls and roofs are preserved. Windmill
blades are excluded. Rail ballast has translucent shoulders; its underlying terrain
contributes colour without changing rail gauge or path geometry.

## Generated variants

`assets/source/cozy-v3/prompts.json` records the exact imagegen prompts. Three new
round/oak/spruce variants and a taller water tower reference the approved originals.
`tools/illustrated-sprites.mjs` packs these into production `public/assets` atlases.
Original tree variants stay available. Trees render at 1.5× with the same ground
anchor; tree collision/placement cells do not expand. The tower uses width-based
packing so its tank does not shrink to accommodate taller supports. Kiln scale is
0.7×. Original source images are retained.

## Scale contract

`src/render/assetScale.ts` is the shared runtime contract for placed assets and
construction ghosts. A 1.75 m human is 11 logical pixels; a standard 2.1 m door is
13.2 px. This is the game's compressed visual scale, not a claim of physically
accurate tile dimensions or a new rail gauge.

Station, civic townhouse, cottage, warehouse, farm and windmill door apertures
were measured on the packed illustrated frames. Their door-to-frame-height ratios
normalize scale across levels. Lumber and grinder use older approximate door
measurements. Outdoor equipment has explicit estimated scale entries; these still
need real dimensions or a person/ladder reference for physical calibration.

The asset-scale tests require every packed illustrated structure family to have a
registered reference or declared estimate. A newly added family cannot silently
fall through to an arbitrary scale. They also enforce the human-to-door ratio
across the calibrated atlas frames. New source art for an existing family must
update its measured door fraction and reviewed window regions if its geometry
changes. Automated tests cannot infer a correct doorway from arbitrary artwork.

## Cozy atmosphere and music

The existing rain, mist and day/night cycle are integrated with quiet procedural
wind, rain, bird calls and evening crickets. Nature/weather has its own saved
volume slider (default 35%); master mute applies. Audio waits for a real gesture,
and ambience fades to silence when the document is hidden. Existing saves gain
this optional setting through normal default merging; no save-version bump.

Warm building masks use reviewed glass regions, excluding roofs, open bays and
equipment. Vehicle masks use explicitly authored amber window/lamplight pixels
in the procedural train frames. Masks follow owner position, heading, mirroring,
scale, visibility and depth. Objects are darkened before emissive masks; terrain
retains its multiply lighting pass. The reconstructed Rocket candidate remains
QA-only and has not been declared physically calibrated.

The original Pastoral Pulse opens each page session. Genshin style, Chillstep and
Liquid dnb are then shuffled; later shuffled bags include all four arrangements.
No immediate repeats occur. Missing/undecodable tracks are skipped, with the
existing synth loop as fallback if all fail. MP3 copies match source SHA-256 hashes.

## Verification and delivery

`scratchpad/cozy-v3/gallery.html` contains ten actual game views of normally generated
128×128 seed 7412, plus a screenshot of the production build's normal play screen.
The review uses actual Builder placements (114 connected rails, 20 structures),
all six natural biomes and production renderers with no preview atlas/material/
rail/scale overrides. Terrain, biome and variant planes are unchanged.

`renders/verification.json` covers decoded music, ended-event advance, gesture
restriction, mute, all-files-failed fallback, copied-file hashes, lights and local
excavation. Moving the camera for 60 frames caused zero additional chunk paints.
Measured median CPU submission was about 9.3 ms in headless Chromium/SwiftShader;
this is not a hardware frame-rate guarantee. One excavation repainted 6 of 256
chunks. `motion.json` records 8,304 real Fleet ticks, all 48 headings, curves,
switches and reversal with zero centre displacement and no page errors.

`production.json` verifies the built JS worker and public atlases under Vite preview,
with the normal game flow in an isolated browser context. The normal expansion
policy starts that play session at 160×160; the staged review map remains 128×128.
No real user save was changed. Full suite: 164 tests; typecheck/build, lint and
Prettier checks pass. Build retains the existing large-bundle advisory.

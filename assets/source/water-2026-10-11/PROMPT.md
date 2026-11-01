# Prompts for the water pictures

Each picture here came from one prompt of the Codex prompts page
(https://claude.ai/artifact/EEr4ow3SevqTmnngUn4c5n, cards C7 to C10). `prompts.json` holds every call word
for word, so a repaint starts from there. The cards were pasted one at a time, with `<issue>` replaced by
343, in the format of `assets/source/buildings-v2/PROMPT.md`:

- **Geometry.** A swatch is a flat top-down material with no tile, edge or horizon in it. A strip or a sheet
  uses the numbers of `river-geometry.json` and `fall-geometry.json`: 2:1 isometric, a game tile of 64 x 32
  px, a level of 9.8 px.
- **Canvas.** 1024 x 1024 asked, opaque. The image tool returns 1254 x 1254, which is kept as it came.
- **Palette.** The references in `refs/`, light from the upper left. Nothing is brighter than `#E0DDD2`, under
  the cursor white `#ECE4D0` and the selection amber.
- **Never.** No stone rim or bank in a material, no cliff (the author's decision of 2026-10-11: a waterfall is
  white water down the rounded bank), no lake or beach ring, no text or scale card.

What the game takes from each picture is in `README.md`. `tools/wild-surfaces.mjs` finishes the swatches and
packs them. What is drawn by code, not painted: the waterfall's steps, the wet rock, the spray, the wandering
waterline and the river's mouth (`src/render/waterPaint.ts`).

# Loading-screen paintings (issue #287)

Three 1536x1024 paintings from the built-in image tool (prompt C6 and its redo R9), kept as
returned. `prompts.json` has every prompt, the references, the returned sizes and which picture
was chosen.

- `loading-1.png`: spring morning, Steam age. As delivered (its pre-edit versions were not kept).
- `loading-3.png`: autumn dusk. As delivered.
- `raw/loading-2-attempt-1.png`: summer midday, Diesel age, the first painting. The water tower's
  spout and the coaling chute are not over the track and a pipe joins them, but the foreground is
  complete.
- `raw/loading-2-attempt-2.png`, `-3.png`, `-4.png`: the service-building edit (R9). Attempt 3
  has the corrected buildings but calmed the whole foreground; attempts 2 and 4 are not used.

## Finishing: `tools/loading-pictures.mjs`

`node tools/loading-pictures.mjs` writes `public/assets/loading-1.png`, `-2.png` and `-3.png`;
`--check` builds in memory and fails if a shipped file differs. pngjs and node's zlib only; the
paintings are never touched. Per picture, in order:

1. loading-2 only: attempt 3 above the line from (0, 285) to (1536, 965), attempt 1 below it,
   over a 16 px feather. The two are pixel-aligned, so the original's river, stones, reeds, trees
   and hut come back without repainting.
2. Crop y 80..944 to 1536x864 (16:9), the frame the game shows.
3. Highlight cap: no pixel at or above the cursor white `#ECE4D0` (luma about 228.3). A soft knee
   above luma 196 scales the three channels together.
4. Amber cap: no yellow or orange (hue 20 to 70 degrees) with chroma at or above the selection
   amber `#E8AA48` (160). A soft knee above chroma 112 pulls the colour towards its own grey,
   hue and luma kept.
5. A dark gradient over the bottom 30%, a smooth ramp to 55% of a dark forest `#101C16`, where
   the progress bar and the tip line are drawn.
6. Quantise to 256 colours (median cut and four k-means steps, no dithering), clamp the palette
   to the two caps once more and write an 8-bit indexed PNG (about 0.9 MB each).

`tools/loading-pictures.test.mjs` pins the output: each shipped file is rebuilt from these
paintings and compared pixel for pixel, is under 1.5 MB, indexed, opaque and 1536x864, and has no
pixel at or above either cap.

Not kept from Codex's branch `art/287-loading`: the duplicate `loading-2.png` (byte-identical to attempt 1 in
the first delivery and to attempt 3 in the second) and the `review/` crops of attempts 2 to 4.

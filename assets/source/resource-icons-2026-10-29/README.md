# Resource icons, ChatGPT sheets of 2026-10-29

The painted set behind the HUD redesign: one icon for each resource, used everywhere the game shows
one. The author generated the sheets with ChatGPT from a prompt that fixed the twelve subjects, their
order and colours, and one style: bold silhouette, thin dark outline, light from the upper left,
readable at 16 px, no text.

| File           | Holds                                                                              |
| -------------- | ---------------------------------------------------------------------------------- |
| `icons-1.webp` | money, wood, stone, iron, large                                                    |
| `icons-2.webp` | coal, water, oil, power, large                                                     |
| `icons-3.webp` | all twelve in a row, drawn for the small sizes                                     |
| `icons-4.webp` | wheat, food, passengers, population, large                                         |
| `icons-3.png`  | `icons-3.webp` decoded, which `tools/resource-icons.mjs` reads (pngjs has no WebP) |

All four are 2000 x 667 at chat compression, on real transparency: the solid areas stand at alpha
253, and the rim is soft for a few pixels. Nothing has to be keyed out and no sheet carries a label
or a caption.

**Sheet 3 is the source.** It has every icon and the author chose it for the small sizes, so all
twelve come from it, 164 to 207 px on their longest side. The other three are kept for anything
larger; their icons differ in detail, so do not mix them into one set.

`icons-3.png` is `icons-3.webp` drawn on a canvas in Chrome (sRGB) and read back with `getImageData`.
Decode it the same way if the sheet is ever replaced.

## Finishing

`node tools/resource-icons.mjs` cuts the icons out and lays them into `public/assets/icons.{png,json}`
under their old keys, as 64 x 64 texel frames (16 world px at the atlas's four texels per world
pixel). The steps are in the tool's header. Run it after `tools/illustrated-sprites.mjs`, which
writes `icons.png` from its older pictures; `tools/resource-icons.test.mjs` fails until it has.

## Still missing

The six icons of the full production chain have no painting: `sand`, `iron_ore`, `copper_ore`,
`wire`, `crude` and `diesel`. Their frames in `icons.png` stay the older pictures of
`assets/source/base-v1`, which are not square, so the square icon slots stretch them a little. The
prompt lists them for a later round: a pale sand heap, rust-red ore lumps, green-orange ore lumps, a
copper coil, a black drop, a red fuel can.

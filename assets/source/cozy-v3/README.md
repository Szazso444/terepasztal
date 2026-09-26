# Generated cozy variants · 2026-09-25

Generated with the built-in imagegen tool using approved reference PNGs from
`../base-v1/`. Exact prompts are in `prompts.json`.

| Output | Reference |
| --- | --- |
| tree-round-v2.png | tree-round.png |
| tree-oak-v2.png | tree-oak.png |
| tree-spruce-v2.png | tree-spruce.png |
| water-tower-tall-v2.png | water-tower.png |

Raw generated PNGs retain their source resolution. `tools/illustrated-sprites.mjs`
trims alpha halos and packs variants into the runtime atlases. Tree enlargement
(1.5×) and kiln reduction (0.7×) happen in the runtime scale contract. Water-tower
packing preserves width and allows additional height from the taller supports.

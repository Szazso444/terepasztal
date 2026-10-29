# The buildings drawn from their 3D models

Codex's paintings of the buildings' 3D models at the game camera (2026-10-28: painted over the
bare model, the textured model as the start picture, the original art for the style), one
picture per building, packed into `public/assets/structures.*` by `tools/illustrated-sprites.mjs`
(`MODELS`). They replaced the plain renders of the same models (2026-10-27) on 2026-10-29, but
for the depot: its painted views' walls ran at other angles than the tiles' lines, so it keeps
its render until Codex repaints it.

Sizes: each building at its real size measured against the walker (9 px = 1.75 m, so a tile is
about 7.6 m), except the power plant (fitted to 3 x 2), the ironworks and the substation (today's
size, one tile) and the wire mill (fitted to 2 x 2). On 2026-10-29 the author asked for every
picture to sit on its tiles ("ne nagyon lógjanak le róluk és ha lehet töltsék ki azt a teret",
10-15% at most): each size is that real size times one factor of 0.85 to 1.15 (`fit` in
`models.json`), so that the ground plan fills the tiles and the whole plan (eaves, cranes)
overhangs them by 10% at most.

- Each picture is at the atlas density (4 texels per world px) and its building's size: it is
  drawn at scale 1 (`MODEL_FAMILIES` in `src/render/assetScale.ts`).
- Its anchor (`ax`, `ay` in `models.json`, texels) is where the footprint's centre is on the
  ground, where the game stands every station and works: the middle of the model's plan, moved
  towards the middle of its ground plan by 15% of the span at most.
- Every level of a building shows the same picture (`frames`). The depot has a picture per
  rotation (`depot-r0` to `depot-r3`); no other building turns for now, though every building
  has its four painted views outside the repository.
- `scale` is the factor on the model's own tile units (`fit` included); `span` the footprint the
  author chose.

Made outside the repository by
`renders/building-models/tools/game_frames.py <out> --painted --fit --render depot`
from the painted views `views/<building>/game/<building>-r<k>.png` (placed on the game canvas by
`tools/bm_views.py place`) and `logs/final_sizes.json`.

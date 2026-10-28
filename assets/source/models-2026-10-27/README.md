# 3D model frames, 2026-10-27

The game-camera renders of the buildings' 3D models (Codex's painted sheets baked on), one picture
per building, packed into `public/assets/structures.*` by `tools/illustrated-sprites.mjs`
(`MODELS`). The author chose them over the paintings on 2026-10-27, at their real size measured
against the walker (9 px = 1.75 m, so a tile is about 7.6 m), except the power plant (fitted to
3 x 2), the ironworks and the substation (today's size, one tile) and the wire mill (fitted to
2 x 2).

- Each picture is at the atlas density (4 texels per world px) and its building's size: it is
  drawn at scale 1 (`MODEL_FAMILIES` in `src/render/assetScale.ts`).
- Its anchor (`ax`, `ay` in `models.json`, texels) is the middle of the model's ground plan: the
  footprint's centre on the ground, where the game stands every station and works.
- Every level of a building shows the same picture (`frames`). The depot has a picture per
  rotation (`depot-r0` to `depot-r3`); no other building turns for now.
- `scale` is the factor on the model's own tile units; `span` the footprint the author chose.

Made outside the repository by `renders/building-models/tools/game_frames.py` from the renders
`<building>/out/sheet-r<k>.png` and `logs/final_sizes.json`.

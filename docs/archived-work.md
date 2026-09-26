# Archived work

Branches whose work never reached `main`, kept as tags so nothing is lost. Each tag points at the
branch's last commit, so the work also stays reachable by hash:

| Tag | Commit |
| --- | --- |
| `archive/quirky-ride-ovv7uq` | `55544df93e57ad3ac5b7965c5f85904d4ac90c8c` |
| `archive/nifty-bohr-vu1pko` | `201f7ed6c434ea613d3d3b1bf4d8d30bab8b9da0` |
| `v0.1.0` | `83a4c6843f66da862c30b3d4ae9db1b2e519f567` |

Check one out with `git fetch origin tag <tag>` and `git switch --detach <tag>`, and take pieces from it with
`git checkout <tag> -- <path>`. None of it is live: the game and the asset pipeline do not read it.

## `archive/quirky-ride-ovv7uq`

26 commits of 2026-09-15 to 09-17, made after PR #17 merged the first half of that branch.

| Piece | Where on the tag | State |
| --- | --- | --- |
| Whole-world art scale 2: `ART_SCALE` in `src/engine/iso.ts`, `TILE_W` 128, every `src/art` generator converted | `src/engine/iso.ts`, `src/art/*.ts` | done on its own base; conflicts with everything `main` changed in `src/art` since |
| Parametric 3D asset programs (Blender Python): nine trees and stones, seven buildings, the shared kit | `art-src/kit.py`, `art-src/props/`, `art-src/structures/`, `art-src/render_asset.py`, `tools/render-assets.mjs` | rendered at 128 px per tile |
| Plan of that route, with the headless-Blender measurements | `docs/art-pipeline.md`, `scratchpad/art-routes.html` | a plan, not a record |
| Pixel-medium conversion: a Blender render rebuilt as the generators' pixel art (material shades from an index pass, clustered edges, contour, ground shadow) | `tools/pixelate.mjs` | needs the material index pass its programs render |
| Concept-board crops baked straight into sprite frames | `tools/bake-refs.mjs`, `scratchpad/extract-refs.mjs` | one picture per frame, like the illustrated import below |
| Live 3D rendering through three.js | `src/render3d/` | adds `three` as a runtime dependency, which `CLAUDE.md` rules out without the author's decision |
| Its own per-frame atlas overlay ("mixed" groups) | `src/engine/atlas.ts` | superseded by `"partial": true` on `main` |

Worth taking again when the game moves to 128 px per tile: the art-scale conversion, and the
tree and stone programs, which cover scenery a photo pipeline cannot. The asset pipeline follows
`TILE_W` on its own, and `tools/asset-pipeline/game_rules.test.mjs` fails until `tile_px` matches.

## `archive/nifty-bohr-vu1pko`

One commit of 2026-09-19: the 147 illustrated studies in `assets/source/base-v1` imported directly
as sprites, one picture per frame family, packed into override atlases with before-and-after
screenshots (about 6 MB, under `scratchpad/illustrated/`).

What it established, and what the photo-to-3D pipeline in `tools/asset-pipeline` answers:

- One picture cannot serve 25 facings or four track rotations: the train does not turn on a curve.
  The pipeline renders every facing from a model.
- Prototypes that share a body/size/paint sprite could not each have their own. The game now looks
  up `rolling/loco_<id>_…` and `rolling/wagon_<id>_…` first.
- Illustrated bodies sat over procedural bogies. Bogie styles per prototype and part now exist.
- Every study carries a soft alpha halo (1-60) around a hard object; the importer cut alpha below
  128. Its findings on terrain rims, station levels and icon legibility are in
  `scratchpad/illustrated/README.md` on the tag.

## `v0.1.0`

Was a branch at the v0.1.0 merge (PR #6); it is now the tag `v0.1.0` on the same commit.

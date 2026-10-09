# Archived work

Work that never reached `main` is kept as a tag, `archive/<branch>`, at the branch's last commit, so
nothing is lost and none of it sits among the live branches. The tags are created by the
`Ref hygiene` workflow from `.github/ref-archive.json`, which also deletes branches whose tips are
already in `main`. A branch with unmerged work is never deleted by it: the branches below keep
existing alongside their tags until the author decides, through a triage issue, to merge, keep or
drop each one.

| Tag | Commit | Branch | Ahead of `main` | Last commit |
| --- | --- | --- | --- | --- |
| `archive/art/rear-views-v1` | `5d8ad39` | kept | 14 | 2026-09-27 |
| `archive/buildings/ages-upgrading` | `6f02c30` | kept | 2 | 2026-10-04 |
| `archive/buildings/art-package` | `688e20a` | kept | 39 | 2026-10-08 |
| `archive/claude/charming-ramanujan-i16mhm` | `edc1d9a` | kept (base of pull request #21) | 1 | 2026-10-01 |
| `archive/claude/nifty-bohr-vu1pko` | `201f7ed` | deleted (commit is in `main`'s history; its import was not kept, see below) | 0 | 2026-09-19 |
| `archive/claude/quirky-ride-ovv7uq` | `55544df` | kept | 26 | 2026-09-17 |
| `archive/claude/retire-adler-john-bull` | `2a9d6fa` | kept | 1 | 2026-10-01 |
| `archive/claude/train-slope-pitch` | `4ae3045` | kept | 1 | 2026-10-01 |
| `archive/local/train-models` | `48d828b` | kept (head of pull request #21) | 15 | 2026-09-27 |
| `archive/locomotive-render-v1` | `2c7e0fc` | kept | 13 | 2026-09-27 |
| `v0.1.0` | `83a4c68` | was a branch; now only the tag | 0 | 2026-09-08 |

Branches whose work is fully in `main` and that the workflow deletes: `claude/isometric-train-game-k6rk1a`,
`claude/modest-shannon-d9ik1e`, `claude/nifty-bohr-vu1pko`, `claude/peaceful-lamport-82qoqd`,
`claude/youthful-hawking-2gejks`, `codex/illustrated-sprite-quality`, `rails/narrow-gauge`, `ui/track-toolbar`
and the branch `v0.1.0`.

Check a tag out with `git fetch origin tag <tag>` and `git switch --detach <tag>`, take pieces from it with
`git checkout <tag> -- <path>`, or bring a branch back with `git push origin <tag>^{commit}:refs/heads/<branch>`.
None of it is live: the game and the asset pipeline do not read it.

## `archive/claude/quirky-ride-ovv7uq`

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

## `archive/claude/nifty-bohr-vu1pko`

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

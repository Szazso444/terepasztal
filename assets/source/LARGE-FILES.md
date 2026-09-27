# Large 3D files (kept out of git)

Meshes and Blender scenes (`.blend`, `.glb`, `.gltf`, `.fbx`, `.obj`) are large binary files. They are
not committed to this repository. Git keeps source images, prompts, scripts and small JSON metadata only.

**Where they live.** They stay in the Google Drive asset workspace `G:\DEV\Terepasztal` (a synced
mirror). Asset-pipeline output goes to `tools/asset-pipeline/assets_out/models_raw/<id>.glb`, which
`tools/asset-pipeline/.gitignore` already ignores. No other directory ignores these extensions, so do
not drop meshes into `assets/source/` or elsewhere in the checkout.

**How to restore.**
1. Re-sync the file from Google Drive at the path below. Verify it with `sha256sum` against the
   prefix in the table.
2. Or regenerate it:
   - `raw.glb` comes from `reconstruct-proof.py` (same folder). It runs the local ComfyUI Pixal3D
     workflow in `workflow-api.json` on `assets/source/base-v1/loco-rocket.png`. The prompt id is in
     `reconstruction.json`.
   - `rocket-poc.blend` comes from `render-proof.py` run in Blender. It imports `raw.glb`, aligns and
     renders the facings, then saves the scene.
   - Regenerated meshes will not be byte-identical. Pixal3D output is not deterministic.

Inventory taken 2026-09-26 across `G:\DEV\Terepasztal`, `C:\Users\Zso\terepasztal` and
`C:\Users\Zso\terepasztal-local`. Neither checkout contained any such files.

| Path | Size | sha256 (first 12) | What it is |
|---|---|---|---|
| `G:\DEV\Terepasztal\poc\rocket-original-v1\raw.glb` | 20,164,780 B (19.2 MiB) | `1ac2628ee304` | Rocket Pixal3D reconstruction: raw ComfyUI mesh of the unchanged original `loco-rocket.png`. Diagnostic PoC, not production-accepted |
| `G:\DEV\Terepasztal\poc\rocket-original-v1\rocket-poc.blend` | 19,891,637 B (19.0 MiB) | `c5094ece6196` | Blender scene for the Rocket PoC: `raw.glb` imported, aligned and set up for the 25 game-facing renders (written by `render-proof.py`) |

## Train model pipeline outputs

`tools/asset-pipeline/run.py --out G:/DEV/Terepasztal/pipeline-out` keeps every stage output outside git: `models_raw/`
(GLB, the conditioning crop `.source.png`, its `.mask.png` and the exact `.prompt.json`), `meta/` (render metadata and
the source-coloured `<id>_texture.png`), `sprites/`, `previews/`, `debug/`, `logs/`. Regenerate a GLB with
`run.py --only <id> --stages comfy --force`; the blender, post and game stages rebuild everything after it.

| Path | Size | sha256 (first 12) | What it is |
|---|---|---|---|
| `G:\DEV\Terepasztal\pipeline-out\models_raw\f7.glb` | 18824624 B | `5465e45ab4ac` | Pixal3D reconstruction of `assets/source/base-v1/loco-f7.png` (source crop, mask and prompt beside it) |
| `G:\DEV\Terepasztal\pipeline-out\models_raw\flying_scotsman.glb` | 18425668 B | `03db362e193d` | Pixal3D reconstruction of `assets/source/base-v1/loco-flying-scotsman.png` (source crop, mask and prompt beside it) |
| `G:\DEV\Terepasztal\pipeline-out\models_raw\rocket.glb` | 20150588 B | `f96f6f84aed5` | Pixal3D reconstruction of `assets/source/base-v1/loco-rocket.png` (source crop, mask and prompt beside it) |
| `G:\DEV\Terepasztal\pipeline-out\models_raw\sd40.glb` | 16380884 B | `f93211582e2b` | Pixal3D reconstruction of `assets/source/base-v1/loco-sd40.png` (source crop, mask and prompt beside it) |

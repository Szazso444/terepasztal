# Train game asset pipeline

Photo -> ComfyUI (Pixal3D / TRELLIS.2) -> GLB -> Blender (align, real scale, tile fit, 2:1 renders) -> sprites + atlas.

## Run
- `python run.py` : all assets in `assets.csv`, stages comfy -> blender -> post. Stops at the first error, exit code 1.
- `python run.py --only id1,id2 --stages blender,post --force` : redo selected stages.
- Finished stages are skipped on rerun (raw GLB / meta JSON exist) unless `--force`.
- Requirements: Python 3.11+, `pip install pillow numpy`, Blender 4.2+ (tested 5.0), ComfyUI running with the API workflow.

## Files
| Path | Role |
|---|---|
| `pipeline.toml` | all settings: paths, ComfyUI URL, grid, render, class rules |
| `assets.csv` | one row per asset: id, image, category (vehicle/building), size_tiles, length_m, width_m, height_m, align (auto/none), yaw_offset_deg |
| `workflows/image_to_3d_api.json` | ComfyUI workflow in API format (ComfyUI: Workflow -> Export (API)). UI-format JSON is rejected. |
| `run.py` | orchestrator, CSV validation, logging, summary |
| `comfy_client.py` | ComfyUI HTTP API: upload, patch graph, queue, poll history, download GLB |
| `blender_stage.py` | runs inside Blender via `blender -b --factory-startup --python-exit-code 1 -P blender_stage.py -- job.json` |
| `postprocess.py` | premultiplied box downsample, optional hard alpha / palette, atlas + JSON, preview sheet |

Outputs under `assets_out/`: `models_raw/<id>.glb`, `jobs/<id>.json`, `meta/<id>.json`, `sprites_raw/`, `sprites/<id>/<id>_d<i>.png`, `atlas/<id>.png|json`, `previews/<id>.png`, `debug/`, `logs/run_*.log`, `logs/<id>_blender.log`, `reports/summary.json`.

## Inspecting state (do this after every run)
1. `reports/summary.json` : status, error, tiles, dims, compression, warnings per asset.
2. `previews/<id>.png` : read the image. Top row: every direction on a checkerboard with the tile footprint (yellow) and anchor (red cross). Bottom row: raw_front (pose as generated), aligned_front (-Y), aligned_side (+X), aligned_top.
   Check: upright, long axis on X, object inside its footprint, shadow inside canvas.
3. `logs/<id>_blender.log` : full Blender output; `[blender]` lines carry align angles, scale, tiles.
4. ComfyUI live state (default http://127.0.0.1:8188):
   - `curl -s $URL/queue` running/pending prompts
   - `curl -s $URL/history/<prompt_id>` status, outputs, `execution_error` with node id/type/message
   - `curl -s $URL/object_info/<NodeClass>` input names and allowed values for a node
   - `curl -s $URL/system_stats` versions, VRAM
   - `curl -s -X POST $URL/interrupt` stop the running prompt
   - ComfyUI console log holds Python tracebacks the API truncates.
5. Blender interactive (optional): open `models_raw/<id>.glb`, viewport shading must be Material Preview or Rendered; Solid mode shows white.

## Conventions
- Blender world: Z up, 1 unit = 1 m. Asset front: vehicle nose toward +X, building long side toward -Y. `length_m` is always the X extent.
- Raw Pixal3D meshes are in the input photo's camera frame (camera at -Y, +Z up), so they carry the photo's tilt and yaw; the Manhattan alignment removes it. TRELLIS.2 meshes are near-canonical.
- Alignment ambiguity: the long axis goes to X; the remaining 180-degree flip is guessed from the photo view. Wrong flip -> `yaw_offset_deg = 180`. Non-boxy mesh (score < `align.min_score`) -> `align = none` and set `yaw_offset_deg` by hand.
- Camera: orthographic, elevation 30, azimuth 45 (rotation 60, 0, 45). World +X projects to screen lower-right, +Y upper-right.
- Pixel density `px_per_m = tile_px / (tile_m * sqrt(2))` is identical for every asset.
- Direction i = heading i*360/dirs degrees counter-clockwise from +X seen from above. Vehicles 8 dirs, buildings 4. `screen_heading` in the atlas JSON gives the on-screen unit vector of the nose.
- Anchor: ground center of the footprint, continuous pixel coords from the sprite's top-left.
- Vehicles: cross-section at real scale, length compressed into `size_tiles * tile_m - coupler_gap_m`; factor outside `compress_range` is an error.
- Buildings: height real, footprint compressed uniformly and snapped to whole tiles (`footprint_factor`, `footprint_range`, `fill`).

## Rules for edits
- Never write into `models_raw/` by hand; rerun the comfy stage.
- Keep stage boundaries: comfy produces GLB, blender produces meta + raw renders, post produces final sprites. Each stage must fail loudly (non-zero exit / exception) rather than skip.
- Change behaviour through `pipeline.toml` first; code changes second.
- Workflow input overrides go in `[comfy.set]` as `"<node_id>.<input>" = value`; verify names with `/object_info`.

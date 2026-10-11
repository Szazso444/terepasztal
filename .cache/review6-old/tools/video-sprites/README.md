# Video turntable -> game sprites

Turns an AI turntable video of a vehicle (flat background, ~30 degree elevation, full rotation)
into the game's 25 drawn facings, keeping the video's painted look. Written for the MÁV Mk48.

Python 3.11 venv with: `bpy numpy pillow opencv-python-headless scipy`. Run from one working dir:

1. `ffmpeg -i video.mp4 vf/%03d.png`  (every frame)
2. `NOSHADOW=1 ALLFAC=1 SAMPLES=4 python silhouette_model.py sil 4`  renders a crude box model of the
   vehicle at all 48 facings with the game camera (docs/mcp-setup.md 6.3), 384 px canvas. The model
   is only a protractor: its silhouettes are matched against the video, none of its pixels are used.
   Its dimensions are measured from one side-on video frame (constants at the top, in video px).
3. `python match.py`  searches the video-to-canvas scale `S` (0.24 for the Mk48); set `S` in
   `assign.py` and `build.py` to the best value it prints.
4. `python assign.py`  scores every frame, and its mirror, against the 48 silhouettes -> `score.npy`.
5. `python build.py`  picks the best frame per drawn facing, removes the background, scales by `S`,
   places it by silhouette bounding-box centre so the anchor matches the model's, and writes
   `final2/game` (96 px) and `final2/x4` (384 px).
6. Copy `final2/game/mk48_f<N>.png` to `art-src/rolling/loco_<id>_body_f<N>.png`, write
   `art-src/rolling/atlas.json` as `{"partial": true, "anchor": {"ax": 48, "ay": 56}}`, then
   `npm run pack-atlas -- rolling`.

Limits: heading error up to ~4 degrees (video frames are not on the 7.5 degree grid); one global
scale; no baked ground shadow; the body only (the game draws bogies separately).

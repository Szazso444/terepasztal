# Spike: assets as programs, rendered headless

Evidence for `docs/art-pipeline.md`. Not part of the build; nothing here ships.

```sh
pip install bpy                     # Blender 5.0.1 as a Python module, no app, no display
python3 iso_calib.py 256 calib.png CYCLES
node measure.mjs calib.png
P_WALL=0.46 P_RIDGE=0.08 P_SUN=-70 P_ELEV=34 P_FILL=0.18 python3 station.py 192 station.png
```

- `iso_calib.py` renders one 1x1 unit plane through the camera in `docs/mcp-setup.md` section 6.3.
  The opaque area measures exactly 64 px by 32 px, centred: the documented rig is correct.
- `station.py` is a station written as a parametric program, palette-locked to `src/art/palette.ts`,
  lit by one key and a sky fill, rendered by Cycles on CPU. Every proportion and the whole light rig
  are environment variables, which is what lets a loop tune them without editing the file.
- `measure.mjs` scores a render: how much of the building silhouette is wall versus roof, and the
  contrast between the two visible wall faces. It classifies by colour, which is why it misreads a
  shadowed limestone wall as slate roof. The production version must read a material-index pass
  instead. That mistake is itself a finding: judge from what the renderer knows, not from pixels.

Measured cost on this machine, Cycles CPU, one asset: 1.0 s at 64 px per tile, 2.0 s at 128,
3.7 s at 192.

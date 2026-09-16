# art-src: assets as programs

The source for route 2 of `docs/art-pipeline.md`. Each asset is a small Python program that
builds itself in Blender; the driver renders it headless and the packer bakes it into the atlases
the game loads. The programs are tracked here; their rendered PNGs and the packed
`public/assets/<group>.{png,json}` are build output and are gitignored.

None of this ships in the game. The runtime depends on PixiJS alone. This is build-side tooling
that produces sprite atlases, exactly as `docs/mcp-setup.md` section 6 describes, and the game
loads an override frame the same way whether a human or this pipeline produced it.

## Layout

```
kit.py                 the style, as code: palette, materials, primitives, camera, light, render
structures/station.py  one asset program; build(kit) populates a Kit-owned scene
render_asset.py        renders one program in an isolated process and prints its anchor
```

The manifest of which program renders which frame key lives in `tools/render-assets.mjs`.

## Run it

```sh
pip install bpy                        # Blender 5.x as a Python module; no app, no display, no GPU
node tools/render-assets.mjs           # every asset in the manifest
node tools/render-assets.mjs structures  # one group
```

That writes `public/assets/<group>.png` + `.json`. Reload the game: `src/engine/atlas.ts`
generates the group procedurally, then overlays these frames on top, so an authored `station_1`
replaces that one frame while the other structure frames stay procedural. The debug panel reports
the group as `mixed`.

`PX_PER_TILE` (default 64) is the world scale a frame renders at, so a sprite drops straight onto
the grid. Raising it is the "art scale" engine change, made once for the whole game.

## Rules the programs follow

- **The data API only, never operators.** Geometry is built from explicit vertices so a program
  runs the same under the `bpy` module and under `blender --background`.
- **Materials by node type, never by name.** Node names are localised.
- **Everything from the kit.** No asset defines its own palette, light or camera. That is what
  keeps 75 assets reading as one set without a critic judging them.
- **Origin at the tile ground-centre.** The render's origin projects to the frame anchor the game
  pins to the tile, matching the procedural sprite it replaces.

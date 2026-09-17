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
structures/station.py  one asset program; build(kit, variant) populates a Kit-owned scene
props/pine.py          a family in one program: the variant argument picks the silhouette
render_asset.py        renders one program in an isolated process and reports what the driver needs
```

The manifest of which program renders which frame key lives in `tools/render-assets.mjs`. A
manifest entry with `variants: n` runs its program n times, passing 0..n-1, and keys the results
`_0`..`_{n-1}` -- which is how one `pine.py` supplies the three `props/pine_*` silhouettes the art
direction requires, rather than three near-copies of a program.

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

Review the result as a set, not one frame at a time:

```sh
node scratchpad/art-contact-sheet.mjs props sheet.png 3
node scratchpad/art-scene.mjs baked          # the same assets in a built scene
```

## From render to sprite

Each asset renders twice. The beauty pass is the lit Cycles render; the material pass beside it in
`<group>/id/` paints every material a flat index. `tools/pixelate.mjs` reads both and rebuilds the
frame in the game's medium:

- **The material comes from the index pass, never from the colour.** Matching a lit pixel to the
  nearest palette colour -- the obvious approach, and the first one here -- turns a sunlit leaf
  into cream and a shadowed limestone wall into slate, the failure `docs/art-pipeline.md` records
  from the spike. With the material known, a leaf can only ever be a shade of leaf.
- **The shade comes from the material's own ramp.** Every material in `kit.py` is three or four
  shades of one `src/art/palette.ts` family, and the render only decides which. It picks by the
  same thresholds `mass` in `src/art/props.ts` uses, so a baked frame bands like a generated one,
  and by ratio against the material's own base, so a lit slate roof reaches slate's top shade and
  still reads far darker than limestone's.
- **The band edges cluster 2x2**, through `hash2` from `src/engine/rng.ts` -- the generators' own
  noise. Without it the bands follow the mesh's facets and the sprite reads as low-poly rather
  than as painted.
- **The contour is `PixelBuf.outline`**, ported: lower and side rims darkened, upper rims only
  tinted. A baked sprite without it sits visibly flat beside a generated one.
- **The ground shadow** is the translucent ellipse `src/art/props.ts` draws, laid last so the
  contour never outlines it. A program declares its footprint as `SHADOW_R`.

## A mesh instead of a program

`mesh_asset.py` is the other door in. A mesh from anywhere -- an image-to-3D generator run
locally, a CC0 download, something modelled by hand -- becomes an asset the game can bake:

```python
from mesh_asset import mesh

SHADOW_R = 0.3

def build(k, v=0):
    mesh(k, "art-src/meshes/oak.glb", size=0.72, yaw=35,
         materials=["leaf", "leaf_pale", "bark", "bark_dark"])
```

That is still a program, and still the tracked source. What it records is everything about the
mesh that is a decision -- how big it is on the tile, which way it faces, and which part of the
palette it may use -- while the mesh file itself is an input, like a reference image, and is
gitignored. glTF, OBJ, FBX, PLY and STL all import.

Two things happen on the way in. The mesh is **normalised**: its transform folded into its
vertices, turned by `yaw`, scaled uniformly so its larger horizontal extent is `size` tiles, and
stood with its base on the tile origin -- so the anchor lands where every other asset's does,
whatever scale and origin it arrived with. Then every face is **repainted** with the kit material
nearest the colour the mesh already carries, sampled from its albedo texture, its material's base
colour or its vertex colours, whichever it has.

That repaint is what lets an imported mesh through the rest of the pipeline at all: `id_render`
needs every surface to belong to a named palette material, and a generated mesh has one textured
material or a handful of arbitrary ones. It is not the failure the banding used to have -- that
guessed a material from a *lit* pixel, after shading had moved it; this reads the flat surface
colour once per face, before any light exists. The `materials` list narrows it further: a tree
that can only resolve to leaf and bark cannot come out with a slate crown.

The match is made in OKLab, not RGB. Straight RGB distance is dominated by lightness and gets this
exact job wrong: a light brown trunk sits nearer a bright green than it does to dark bark, so the
first run produced a tree with a green trunk.

To try it without a generator, `scratchpad/mesh-fixture.py` writes two meshes shaped like the two
things these tools emit -- one UV-mapped with a baked texture, one with plain untextured materials
-- both at metres scale, turned to an odd yaw, with a floating origin and colours nowhere near the
palette:

```sh
<bpy python> scratchpad/mesh-fixture.py art-src/meshes
```

## Two things every asset program has to know

**The rig sees +x, -y and the top.** `docs/mcp-setup.md` 6.3 puts +x down-right and +y up-right,
so a door written on the +y face is a door nobody sees -- which is what had happened to the
station's windows, the cottage's door and the warehouse's loading doors. Building a frontage on +y
reads better than writing every offset negative, so programs keep doing that and call
`k.face_camera()` once at the end. The exception is an asset built from the rig's own axes, like
the windmill's sails: mirroring the scene would take those out of the picture plane, so it places
its frontage on -y directly.

**`FIT` is the fit to the sprite being replaced**, a `(footprint, height)` pair scaled about the
ground origin, so proportions are tuned without editing the geometry that describes the subject.
Keep it near 1: past roughly a quarter either way it stops adjusting the asset and starts
distorting it, and height a modest fit cannot reach belongs in the geometry instead. A kiln
stretched to the right frame height is not a kiln.

## Rules the programs follow

- **The data API only, never operators.** Geometry is built from explicit vertices so a program
  runs the same under the `bpy` module and under `blender --background`.
- **Materials by node type, never by name.** Node names are localised.
- **Everything from the kit.** No asset defines its own palette, light or camera. That is what
  keeps 75 assets reading as one set without a critic judging them.
- **Origin at the tile ground-centre.** The render's origin projects to the frame anchor the game
  pins to the tile, matching the procedural sprite it replaces. The kit nudges the camera by the
  fraction of a pixel needed to land that anchor on a whole pixel, as the generated sprites' are.
- **Seeded variation, not random.** `kit.Rng` is a small fixed LCG rather than Python's `random`,
  whose stream is an implementation detail. A variant's lumps are the same on every machine.

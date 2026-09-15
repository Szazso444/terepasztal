# Art pipeline: rendered assets, produced by agents

How the game reaches the look in `docs/art-direction/`. The short version: assets stop being
pixel code and become **3D programs**, headless Blender renders them, and the existing packer bakes
them into the atlases the renderer already loads. Models are the durable artefact; sprites are
build output. Nothing here changes the simulation.

This document is a plan, not a record of shipped work. The measurements in it were taken in this
repository; the sources for the research claims are listed at the end.

## 1. Why not more pixel art

`src/art` draws every frame by hand in TypeScript at 64×32 tiles with three or four flat shades per
material. That ceiling is structural, not a matter of effort:

- The concept boards are illustrations at roughly 150 px per tile, with ambient occlusion, a warm
  key and a cool fill, and smooth gradients. Flat-shaded pixels cannot carry that.
- Content multiplies badly. One locomotive costs 31 to 39 frames. A livery multiplies them. A new
  age of about eight vehicles and six buildings costs roughly 7 M pixels at 3× scale.
- Elevated track, viaducts and tubes need depth the 2D painter's algorithm does not have.

A 3D source fixes all three at once: light is computed, a facing is a camera angle, and depth is a
buffer. The question was only how to produce and maintain 3D without a modeller.

## 2. What was proven here

Measured in this container, not quoted from a vendor:

| Fact                                                                | Result                                                                                              |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Blender as a pip module, headless, no display, no GPU               | `bpy` 5.0.1 installs and runs                                                                       |
| The camera in `docs/mcp-setup.md` §6.3                              | a 1×1 unit plane renders exactly 64 px wide, 32 px tall, dead centre                                |
| Render cost, Cycles CPU, one asset with ground, track and furniture | 1.0 s at 64 px/tile, 2.0 s at 128, 3.7 s at 192                                                     |
| EEVEE headless on a CPU-only machine                                | unavailable, `libEGL.so.1` missing; matches Blender's own documentation that EEVEE is GPU-only      |
| Blender 5.0 engine identifier                                       | `BLENDER_EEVEE_NEXT` was renamed back to `BLENDER_EEVEE`; pin the string                            |
| A colour-based quality judge                                        | misreads a shadowed limestone wall as slate roof; judge from render passes, not from guessed pixels |

`art-src/_spike/` holds the scripts: `iso_calib.py` is the camera proof, `station.py` is a station
written as a parametric program, `measure.mjs` scores a render. `scratchpad/art-spike-*.png` are
the outputs. The spike also showed the honest limit: geometry an agent writes without feedback is
mediocre, and the loop needs gates, which is what section 4 is about.

## 3. Architecture

```
art-src/
  kit/            palette.py, lights.py, camera.py, materials.py, parts.py   <- the style, as code
  structures/     station.py, depot.py, windmill.py, ...                     <- one program per asset
  rolling/        steam_std.py, diesel_hood.py, bogie.py, ...
  props/, terrain/
tools/
  render-assets.mjs   one `blender -b` subprocess per asset -> PNG frames + anchors sidecar
  pack-atlas.mjs      existing: trims, corrects anchors, packs                <- already written and tested
public/assets/        <group>.png + <group>.json                              <- already loaded by the game
```

Three rules make this work:

- **One process per asset.** `bpy` can only be imported once per process and EEVEE can kill a
  process without raising, so the process boundary is the reset.
- **Data API, not operators.** `bpy.ops` fails in background mode with `poll() failed`. Build with
  `bpy.data` and `bmesh`. Put this in the agent's brief, because tutorials teach the opposite.
- **Look nodes up by type, never by name.** Node names are localised.

## 4. The automated loop

The user does not model. An agent writes and edits asset programs; gates decide whether the output
ships. The research is consistent on where to spend: **scale the verifier, not the generator.**

**Mechanical gates, deterministic, fail closed.** These are the ones that actually hold:

- manifold geometry, consistent normals, triangle budget, real unit scale, origin at the ground
  contact point
- frame count and anchor stability against the previous bake, the same discipline as the golden
  hashes in `src/world/mapgen.test.ts`
- atlas bounds and page limits, palette conformance (only colours from the palette module appear),
  silhouette coverage, and lighting rules read from a material-index pass rather than guessed from
  colour
- golden-image diff with a clustered-pixel threshold, baselines generated in CI

**Visual gate, weak by construction.** A vision model ranks a render against a blessed reference,
pairwise. It never scores style on an absolute scale: published agreement with human judgement is
about 0.42 correlation for CLIP-style scores, and vision judges systematically under-penalise
exactly the defects that matter here. Ranking is what they can do.

**Style is structural, not judged.** Every asset imports one palette module, one light rig, one
camera, one material set, one outline and shadow treatment. Consistency that is enforced in shared
code needs no critic. This is the discipline `docs/art-direction/README.md` already states for the
2D generators, ported to the Blender rig.

## 5. Engine changes required

Small, and each is independently useful.

| Change                                                                      | Where                                                                                                  | Why                                                                                                                                                |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-frame atlas merge: generator first, PNG frames override individual keys | `AtlasRegistry.loadGroup`, `src/engine/atlas.ts`                                                       | today an override replaces a whole group, so one authored building would disable 672 procedural ones. This is what makes the migration incremental |
| Multi-page atlases and a max-texture-size guard                             | `tools/pack-atlas.mjs`, `AtlasBuilder.build`                                                           | both emit a single page with unbounded height; about half of devices cap at 4096                                                                   |
| Art scale, smooth sampling, device resolution                               | `resolution` and `antialias` in `game.ts`, `scaleMode` in `atlas.ts`, `image-rendering` in `style.css` | four settings pin the game to crisp pixel art; illustrated art needs all four flipped                                                              |
| KTX2 compressed textures                                                    | Pixi v8 supports them natively                                                                         | 4× to 8× less texture memory, and no PNG decode on startup                                                                                         |
| Optional: depth pass per frame, per-pixel depth test                        | renderer                                                                                               | viaducts, tunnels and a train half inside a tube, without moving to runtime 3D                                                                     |

## 6. Order of work

1. **Rolling stock first.** 25 drawn facings per vehicle is where a 3D source pays structurally and
   hand-authoring never will. Ten locomotive bodies, seven wagon bodies and four running-gear parts
   cover every current vehicle; liveries become material swaps.
2. **Structures.** Stations, works, houses, bridges; levels are kitbash variants of one program.
3. **Terrain and props.** Tile kit last, because it is where seams and neighbour joins are hardest
   and where the current generators are weakest but adequate.

Each stage ships behind the per-frame merge, so the game always runs: authored frames where they
exist, procedural everywhere else.

## 7. Runtime 3D stays open

Baked sprites are the reversible choice: they reuse the renderer, the atlas contract, the anchors
and the packer. Runtime 3D wins on liveries, on facings and on depth, and loses on memory, on
determinism and on being a rewrite of the render layer plus a runtime dependency, which this
project's rules make an author-level decision.

The decision does not have to be made now, because **both paths need the same asset library**. The
precedent is Diablo II Resurrected: a 3D renderer over a grid-authoritative simulation, swapped
without touching the game logic. This simulation is already grid-authoritative and renderer-
agnostic.

## 8. Risks, in the order they will bite

1. **Silent style drift.** Every asset passes its own gate and the set is still incoherent. Vision
   critics err consistently, so the errors accumulate instead of cancelling. Mitigation: style in
   shared code, plus one contact-sheet review of the whole set per milestone. That review is the
   one human checkpoint this plan does not remove.
2. **A script that runs is not an asset that is right.** Benchmarks report executability near 1.0
   with a retry loop, while the same renders still show floating or disconnected parts. The
   mechanical gates exist for this.
3. **Crashes are normal.** The leading procedural pipeline in the field ships a retry-with-more-RAM
   stage. Budget a high single-digit percentage of assets needing regeneration; make regeneration
   cheap rather than chasing zero.
4. **The GPU question.** Stylised work wants EEVEE, EEVEE will not render headless without a GPU.
   Cycles on CPU is slower and more deterministic, which suits golden-image gating. Decide before
   writing the rig, not after.

## 9. Compliance

- **Steam**, since the January 2026 rewrite: disclose generated content that ships and is consumed
  by players. Development tooling is explicitly carved out.
- **EU**, since 2 August 2026: generated content needs visible labelling and machine-readable
  marking. This project is EU-based.
- **US copyright**: purely generated output is not copyrightable and must be disclaimed on
  registration; human-authored code and arrangement stay protected.
- **Tool licences**: one widely used open 3D generator excludes the EU and the UK outright and is
  non-commercial regardless; two popular hosted tools give attribution-only or non-commercial
  rights on their free tiers. Assets produced by our own code running in Blender avoid this class
  of problem entirely, which is a second reason to prefer programs over generated meshes.

## Sources

Research for this plan, September 2026. Reddit could not be read from the working environment at
all: it is blocked by the egress proxy, by the fetch tool, and by robots exclusion of the search
crawler, so no r/aigamedev material informed this document.

- Blender camera and sprite rigs: `github.com/jasonicarter/create-isocam`,
  `github.com/sudo-bcli/isometric-cameras`, `github.com/chr15m/blender-iso-render-bot`
- Headless and CI Blender: `github.com/BlenderKit/headless-blender-container`,
  `github.com/BlenderKit/blenderkit_asset_tasks`, `github.com/oqton/blenderless`
- Code-first 3D for agents: ProcFunc (`github.com/princeton-vl/procfunc`), Infinigen
  (`github.com/princeton-vl/infinigen`), LL3M (`github.com/threedle/ll3m`), 3DCodeBench
  (`github.com/gaoypeng/3dcodebench`)
- Verification limits: BlenderGym (`blendergym.github.io`), and the published work on vision judges
  ranking reliably but scoring unreliably
- Shipped sprite-baking pipelines: Factorio's graphics posts (FFF 146, 172, 218, 227, 264, 281),
  SimCity 4's Building Architect Tool, Age of Empires: Definitive Edition's re-bake, OpenTTD's
  32 bpp zoom levels
- Runtime 3D reference points: three.js `InstancedMesh`/`BatchedMesh` and `agargaro/instanced-mesh`,
  `lo-th/3d.city`, Diablo II Resurrected's renderer-over-grid architecture

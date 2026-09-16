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

**The slice is built.** `art-src/kit.py` is the shared kit; `art-src/structures/station.py` is the
first real asset; `art-src/render_asset.py` and `tools/render-assets.mjs` are the driver; and
`src/engine/atlas.ts` now overlays a PNG override onto a procedurally generated group frame by
frame. Running `node tools/render-assets.mjs structures` renders the station headless and packs it,
and the game loads it over the procedural `station_1` while every other structure frame stays
procedural — the debug panel reports the group as `mixed`. `scratchpad/art-pipeline-station-*.png`
show the rendered frame and the two stations composited on live terrain. The generated atlases are
build output and are gitignored; the programs are the source.

**The first whole family is built.** `art-src/props/` carries the nine vegetation and stone
programs of section 3 of the art direction — round tree, oak, birch, pine, spruce, bush, dead tree,
rock and boulder — as 26 frames covering every `props/*` key in those families. A manifest entry
declares `variants: n` and the program receives the variant, so one `pine.py` renders the three
silhouettes rather than three near-copies of a program; the seeded jitter in `kit.Rng` gives each
its own lumps deterministically. This is the first evidence at family scale rather than one asset:
`props` reports `mixed`, the baked frames sit within about a tenth of the sprites they replace, and
nothing else in the group moved.

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
  colour. **Built.** Every asset renders twice: the lit pass, and a material pass where each
  material emits a flat index. `tools/pixelate.mjs` rebuilds each pixel as its own material's base
  colour times a light step, so palette conformance is not a gate that can fail — it is the only
  thing the code can produce. Nearest-colour matching, which this replaced, put cream in sunlit
  foliage exactly as the spike's judge put slate on a shadowed limestone wall
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

**The 3D foundation is built.** `art-src/export_asset.py` and `tools/export-models.mjs` export the
same asset programs to glTF, and `src/render3d/isoScene.ts` renders them live in three.js through an
orthographic 2:1 dimetric camera with the kit's key-and-fill light. It boots only behind the `#r3d`
URL flag, through a dynamic import, so three.js is code-split into its own chunk and the default
game bundle stays PixiJS-only and unchanged in size. `scratchpad/art-pipeline-3d-preview.png` is the
station rendered live from the same `station.py` the sprite bake uses — the plan's thesis, that one
library drives both renderers, shown running. three.js is a real dependency now, added on the
author's instruction to build this route; the lazy load keeps it off the shipped path until a 3D
mode is chosen. What remains for a full swap is the tile world, toon or matcap shading, outlines and
a colour grade, and re-plumbing the `src/render` call sites — the render-layer work the matrix
prices, not the foundation.

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

The studio is in Canada. This is a summary of what applies, not legal advice; the registration and
disclosure specifics are worth an hour of a lawyer's time before a store page goes up.

- **Steam** is platform policy, not jurisdiction, so it applies wherever the studio sits. Since the
  January 2026 rewrite: disclose generated content that ships and is consumed by players, and
  generated marketing material. Development tooling is explicitly carved out, so an agent writing
  TypeScript or a build script is not a disclosure event. A generated sprite in the shipped atlas
  is. Two categories exist, pre-generated and live-generated; everything in this plan is
  pre-generated.
- **Canada** has no AI statute in force. The Artificial Intelligence and Data Act died with Bill
  C-27 when Parliament was prorogued in January 2025, and no successor had been tabled as of
  August 2026; the federal approach is privacy-law reform plus a voluntary code. No labelling
  obligation attaches here today.
- **The EU AI Act reaches outside the EU**, but probably not to this. It binds providers who place
  an AI system on the EU market and deployers whose output is used in the EU. The marking duty
  falls on the provider of the generative system, and the labelling duty on deployers of deepfakes
  and certain public-interest text. A game that ships pre-baked art is not itself an AI system, and
  station sprites are not deepfakes. The analysis changes the moment the game generates anything at
  runtime, which is also the moment Steam's live-generated category applies.
- **Canadian copyright** requires human authorship. Purely generated output is not protected;
  AI-assisted work can be, where a human exercised substantial skill and judgement, and the
  consultation outcome supports keeping that line. Registration is not required for protection in
  Canada, but the practical defence is a provenance record: which assets came from a program in
  this repository, who directed and reviewed it, and what was generated by a third-party model.
  Keeping assets as committed source code rather than opaque meshes is most of that record.
- **US copyright** matters only if registering there: disclaim the generated portions, or risk the
  registration.
- **Tool licences** are the constraint that actually binds. One widely used open 3D generator is
  non-commercial regardless of territory; its exclusion of the EU, the UK and South Korea does not
  reach a Canadian studio, but the non-commercial term does. Two popular hosted tools give
  attribution-only or non-commercial rights on their free tiers, and no vendor in this market
  warrants that its output is copyrightable. Assets produced by our own code running in Blender
  avoid this whole class of problem, which is a second reason to prefer programs over generated
  meshes.

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

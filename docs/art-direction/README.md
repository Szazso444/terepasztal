# Asset redesign implementation guide

The shipped art is the illustrated conversion: `tools/illustrated-sprites.mjs` packs the source
images into partial atlas overrides for supported scenery, buildings and icons, and
`terrain-production.md` and `building-production.md`, in this folder, describe how the terrain and
the buildings are made. World geometry and railcraft motion requirements are unchanged;
directional/layered art is still required for trains.

Pastoral industry, folk warmth and quiet ambition. The railway grows from timber and steam
into refined electrical infrastructure while its countryside and town identity remain familiar.

Prepared against repository commit `5b66cbd`. This is a proposed visual implementation guide,
not a gameplay change or an instruction to replace the existing simulation. The current game
has Steam, Diesel and Electric ages; high-speed is a later electric visual stage. For buildings,
the current decision is
[the building eras art package](../superpowers/specs/2026-10-02-building-eras-art-package-design.md):
six ages (Nuclear, Magnetic and Hyper after Electric) and four rotations per building (audit
A46). Until its pictures are in the game, the structures generator draws each building's other
rotations as placeholder turns of today's picture (`_r1` to `_r3`, `src/art/structures.ts`).

## How to use this pack

- [Searchable current asset catalog](asset-catalog.html): all **2,839 atlas frames**, plus
  **52 complete vehicle previews**. Choose a group, search an ID, or enable All variants.
- [Definition inventory](asset-inventory.md): every shipped locomotive, wagon, biome,
  station, works building, decor item and cargo definition, including full-chain mode.
- [Frame inventory](frame-inventory.json): exact names, groups, native dimensions and anchors.
  These are packed, transparency-trimmed frame dimensions and pixel anchors; a 64×32
  generator canvas can therefore appear narrower in the catalog without changing tile size.
- Images titled concept/reference describe the intended direction. Images prefixed `current-`
  are actual existing sprites, regenerated from the atlas whenever the generators change. They
  now show the redesigned art; the pre-redesign baseline sheets are the `art-*-before.png` files
  in `scratchpad/`, listed in `scratchpad/README.md`.
- Work from the written geometry and functionality rules when a concept picture disagrees.
  Generated pictures contain mixed detail scales, invented joinery, illustrative track layouts
  and occasional incorrect running gear. Do not trace those errors into production assets.

![Theme, materials and town growth](images/03-theme-town-growth.png)

## 1. Shared production rules

| Topic       | Implementation rule                                                                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projection  | Preserve 2:1 isometric projection and 64×32 base tiles. Existing elevation step is 10 px.                                                                                                |
| Pixel scale | Both smooth (2026-09-26, see "Style consistency" below): painted contours on nature, trains and buildings alike; no stair-stepped pixel foliage. Camera motion can stay continuous.      |
| Form        | Prioritise silhouette, then major panels, then material detail. Use broad colour clusters, not independent noise on every pixel.                                                         |
| Light       | One upper-left light convention. Roofs/top faces lightest; away-facing walls darkest. Use three or four shades per material.                                                             |
| Edges       | Selective dark lower/occluded edges. Avoid a black outline around every terrain diamond or every brick. Transparent margins must not contain coloured fringes.                           |
| Contact     | Ground shadows touch trunk/building bases. Rails sit on sleepers and ballast. Bridge piers enter water; no detached shadows or floating support feet.                                    |
| Scale       | Preserve gameplay footprint and clearance. A tall building can grow vertically, but its artwork must not imply an extra occupied tile.                                                   |
| Variation   | Deterministic seeded variations in silhouette, clusters and roof detail. Keep anchors and connection endpoints identical across variants.                                                |
| Clarity     | Trains and rails strongest; operational buildings next; scenery quietest. Status indicators must remain visible over every biome.                                                        |
| Delivery    | Illustrated overrides (`tools/illustrated-sprites.mjs`) ship over the `src/art` fallback generators. Keep frame contracts; no new runtime dependencies. Concept PNGs are reference only. |

Proposed palette seeds, to tune together in `src/art/palette.ts`: forest `#294638`, moss
`#78804C`, oat `#E4D5B5`, limestone `#BCA98B`, slate `#626B6C`, water `#477B82`, copper
`#A36B42`. Preserve distinct brighter semantic colours for warning, danger, selection and valid
placement. These are suggested base colours, not an instruction to recolour all stock green.
Use restrained oxblood, midnight blue, ochre and industrial orange for livery variety.

Every packed atlas texel goes through one cap pass, `tools/atlas-cap.mjs`, after resampling: alpha
under 16 is dropped and 250 and over made solid; a texel at or above the cursor white `#ECE4D0`
(`PAL.white`) in all three channels is scaled to at most (235, 227, 207), and one as strong as
the selection amber `#E8AA48` (`PAL.amber`; hue 25 to 50 degrees, saturation 0.62 and value
0.85 or more) is toned to saturation 0.6 and value 0.88, both keeping their hue. A set with a
large lit area over the cursor white's luma (the Fuel Pump, `LIT_FRAMES`) has its luma above 0.85
compressed smoothly under that luma instead. `tools/atlas-cap.test.mjs` checks every atlas in
`public/assets` against it. What a painting leaves over the caps is brought under them at packing.

## 2. Terrain, biomes and tile joins

![Proposed terrain and biome direction](images/01-land-biomes.png)

The display-block thickness in this concept sheet is illustrative. Do not add raised edges to
ordinary ground tiles. Snow patches and shoreline blends are proposed treatments; do not infer
new snow mechanics or terrain types from them. Wheat fields are sparse patches on plains grass,
grown by map generation about as rarely as oil fields, never a decoration painted onto every plains
tile; each field tile is a low raised prop (section 3), not a raised edge on the ground, and a farm
keeps its own plot in its picture. The ocean panel's railway is a bridge, not track laid on water.

| Existing biome | Target appearance                                                                  | Readability constraint                                                                     |
| -------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Plains         | Moss/meadow greens, broad quiet patches, sparse wildflowers.                       | Leave large open grass areas; sparse wheat fields on plains grass, never on every tile.    |
| Forest         | Dark leaf litter, rounded broadleaf clusters, clear trunk openings.                | Ballast must separate tracks from the dark ground; trees stand back from rail corridors.   |
| Desert         | Oat/ochre sand, warm rock, sparse cactus and occasional oasis palm.                | Keep sand less bright than selection indicators; no continuous high-contrast dune stripes. |
| Taiga          | Cooler blue-green conifers, subdued lichen ground. Optional cosmetic snow accents. | Distinguish pine and spruce by shape, not just colour.                                     |
| Swamp          | Peat greens, shallow teal pockets, reeds and occasional deadwood.                  | Shallow wet ground must remain distinct from actual unbuildable water.                     |
| Ocean          | Quiet teal water, limited horizontal glints, sandy and rocky shores.               | Do not texture it so strongly that bridge feet or moving trains disappear.                 |

Cover all terrain frame families: `grass`, `forest`, `rock`, `hillcut`, `sand`, `plains`,
`taiga`, `swamp`, `desert`, `water`, `hill`, `mountain`, `void`, `city`, and the interaction
overlays. Keep the four ground variants, three water variants with four animation frames,
and three hill/mountain/void variants present in the catalog.

- **Rock / mountain:** rock is low exposed stone; mountains have unmistakable raised mass.
  Preserve impassability and elevation anchors. Hillcut is flattened earth, not a second hill.
- **Shore joins:** redesign with shared edge coordinates. Blend masks are a proposed renderer
  extension, not a reason to paint arbitrary coastlines into every water tile. Test all neighbour
  combinations; never introduce gaps or paint over the track clearance area.
- **Water animation:** move a few highlights across four frames. No large pulsing brightness.
  Match the water hue used in submerged bridge shading.
- **City tiles:** paving the landscape painter lays, not a tile frame (`src/render/townPaving.ts`,
  run by the landscape worker; `terrain-production.md` has the detail). Small setts, about a tenth
  of a tile, in a fan of arcs, lit from the upper left, in warm stone a value step below the house
  walls and never brighter than the semantic colours. The outline wobbles slightly and rounds its
  convex corners; over the last quarter tile the setts wear out into the ground, and a fringe of
  packed earth fades into the ground outside. Each street door on the paving gets a doorstep. The
  paving has no painted streets of its own. The 3×3 `terrain/city_*` frames (`src/art/terrain.ts`)
  remain only as the fallback ground sprite when the landscape worker fails (and for a chunk not
  painted yet), so their art is not to be removed. The existing population-density trigger remains
  gameplay-owned; art does not convert additional terrain or introduce roads with path rules.
- **Void / locked fog:** subdued map-edge treatment distinct from ocean and buildable land.

[Current terrain sheet](images/current-terrain.png) · Source: `src/art/terrain.ts`,
`src/render/worldRenderer.ts`, `src/render/townPaving.ts`, `src/data/biomes.json`.

## 3. Trees, plants and natural objects

![Proposed vegetation and natural objects](images/02-nature-objects.png)

Use this sheet for silhouette and material relationships. Its leaf detail and human scale marker
are illustrative; retain the game's established compressed sprite scale. Simplify leaf clusters
before drawing individual twigs. Bare sprites should not acquire large square soil bases.

| Existing family    | Recognisable shape / treatment                                                           |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `tree`             | Round broadleaf crown; two or three connected canopy masses.                             |
| `oak`              | Wider and heavier than round trees; strong branching and low spreading crown.            |
| `birch`            | Slender pale trunk, airy uneven canopy; dark trunk breaks sparingly.                     |
| `pine`             | Open tiered canopy with visible trunk between groups.                                    |
| `spruce`           | Denser tapered cone; darker lower layers.                                                |
| `palm`             | Small fan of readable fronds on bent trunk; sparse desert/oasis accent.                  |
| `cactus`           | Clear ribbed column/arm silhouette; few highlights.                                      |
| `deadtree`         | Bare branching silhouette; do not reuse the living tree with foliage merely tinted grey. |
| `bush`             | Low two- or three-lobed cluster; shorter than train body.                                |
| `reeds`            | Sparse upright stems with a grounded wet base.                                           |
| `flowers`          | Four restrained colour variants, concentrated in tiny clusters.                          |
| `rock` / `boulder` | Small low stones versus larger angular masses; consistent stone lighting.                |
| `coal`             | Dark stratified outcrop, distinguishable from ordinary grey rock.                        |
| `oil`              | Small dark seep with restrained sheen; no bright rainbow pool.                           |
| `wheat`            | Low raised tile of straw-gold rows, 2.6 to 3.5 px high, darker front, irregular edge.    |
| `mangrove`         | Dark evergreen crown on arched prop roots ending in wet tips at the waterline; no water. |
| `willow`           | Weeping crown of hanging silvery-olive curtains over a short, forked trunk on a bank.    |

Preserve three variants for tree/pine/rock/birch/spruce/oak/cactus/bush/boulder/coal/oil/wheat/
mangrove/willow;
two for palm/deadtree/reeds; four for flowers. Change silhouette as well as shade. Check
placement near curves and signals: clearing a prop must remove its entire visual, and trunk
anchors must remain attached to the correct tile. Seasonal recolours are optional future work.

The game multiplies every prop by the season tint (`SEASON_FX` in `src/sim/weather.ts`), so judge a
prop's colour after it. Wheat in summer averages a straw gold, hue about 41 degrees and saturation
about 0.6 (its lit pixels near 187, 149, 66), the wheat of the approved art demo: yellow-gold,
never orange-rust. Its brightest red stays under the selection amber's 232 and the cursor white's 236.

[Current props sheet](images/current-props.png) · Source: `src/art/props.ts`.

## 4. Civic buildings, stations and housing

The theme board's growth strip establishes the proposed materials. The following sheet shows
the **current** buildings, levels, construction states and service art to redesign.

![Current structure families and upgrades](images/current-structures.png)

| Definition / role            | Proposed primary silhouette                                        | Upgrade language                                                                                             |
| ---------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Station (`station`)          | Passenger canopy, platform edge, readable station sign.            | Larger canopy, better frontage, additional existing platform treatment. Retain five levels.                  |
| Townhouse (`town`)           | Civic frontage, clock gable or small central tower, modest square. | More substantial civic wings. No passenger platform or passenger icon.                                       |
| House (`townhouse` decor ID) | Residential windows, door and domestic roof.                       | Cottage → low-rise apartments → high-rise → slender masonry/glass skyscraper. Capacities stay 20/60/140/300. |
| Warehouse                    | Broad loading doors, stacked crates, short loading canopy.         | More bays and better handling equipment; keep footprint.                                                     |
| Depot                        | Two-track engine shed with clearly open train portals.             | Timber/brick → iron spans → refined service hall; preserve all four orientations and gate clearances.        |
| Farm Halt                    | Barn, modest wheat patch, sacks and loading edge.                  | Larger barn/silo and tidier yard, not an unrelated factory.                                                  |
| Lumber Yard                  | Log stacks, saw shed, handling frame.                              | More organised stacks, covered sawline and better crane.                                                     |
| Quarry                       | Excavated rock face, pale stone heaps, lifting frame.              | Larger machinery and sorting bays inside the existing visual footprint.                                      |
| Water Pump                   | Intake pipe, pump house and small tank.                            | Clearer machinery and improved intake housing. Distinct from a service water tower.                          |

`mine`, `sand_pit` and `copper_mine` currently share quarry art in full-chain mode. Proposed
distinctive cues: dark ore bins/headframe for iron, pale low heaps for sand, warm copper ore
accents and a sorting shed for copper. Adding dedicated families requires updating art lookup;
it does not require new building IDs or changed recipes.

House construction frames `townhouse_s0/s1/s2` must show foundation → frame/scaffold → roof
work, all on the final building anchor. Do not confuse these construction stages with upgrade
levels. Keep scaffold contrast below operating signals. Taller assets need an occlusion check
beside rails; selection fading, if needed, is separate renderer work.

Sources: `src/art/structures.ts`, `src/art/industry.ts`, `src/art/civic.ts`,
`src/data/stations.json`, `stations_full.json`, `houses.json`, `decor.json`.

## 5. Works buildings and production objects

Use cream foundations, warm brick, slate, iron machinery and restrained copper details.
The process must read from one dominant object; recipes remain represented by UI icons.
Generic extra chimneys are not sufficient to distinguish every works upgrade.

| Existing building                       | Required identifying feature                                   | Proposed level 2–4 progression                                                                      |
| --------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Windmill                                | Four-sail mill, grain sacks and flour/bread cue.               | Stronger base, enclosed handling annex, refined sails and machinery; remain recognisable as a mill. |
| Charcoal Kiln                           | Low rounded/domed kiln, stacked wood, controlled dark opening. | More substantial kiln housing and covered wood handling.                                            |
| Stone Grinder                           | Broad crushing rollers/jaws, hopper, pale aggregate.           | Additional conveyor/covered sorting unit; no mine headframe.                                        |
| Oil Refinery                            | Tank, compact distillation column and connected pipes.         | More structured pipe racks and processing units.                                                    |
| Power Plant                             | Boiler/turbine hall, one clear stack, electrical yard.         | Larger hall and cleaner, better organised electrical equipment.                                     |
| Battery                                 | Transformer block and ceramic insulators in a low fenced yard. | Additional transformer/insulator assemblies.                                                        |
| Hydro Plant                             | Water intake and turbine house with visible outflow cue.       | Better intake gate and larger turbine housing; preserve shore placement rules.                      |
| Colliery                                | Dark coal bins, headframe or sorting tower.                    | Covered screens and improved loading plant.                                                         |
| Ironworks                               | Furnace mass, muted warm opening and ingot staging.            | Larger furnace enclosure and organised handling bays.                                               |
| Oil Derrick                             | Strong triangular pump/derrick silhouette, small tank.         | Reinforced frame and organised tank/pump assembly.                                                  |
| Full-chain Refinery (`diesel_refinery`) | Shares refinery art today; use the same material family.       | Distinguish its UI product icon; a separate asset is optional, not required to imply new mechanics. |
| Wire Mill                               | Drawbench/roller hall, large copper wire reels.                | Covered production line and larger neatly stacked reels.                                            |

Keep levels 1–4 and native anchors. Production props include piles, sacks/bales, logs, crates,
barrels, silos, chimneys, pipes, cranes and fences embedded in building generators. Redesign
these shared helpers once so stations and works agree. They are not all independently placeable
buildings. Smoke is a restrained effect, never a permanent opaque cloud hiding the rail yard.

Sources: `src/art/industry.ts`, `src/art/civic.ts`, `src/data/buildings.json`,
`src/data/buildings_full.json`.

## 6. Track, bridges, services and electricity

![Current track pieces and rotations](images/current-track.png)

| Family                      | Art direction                                                               | Invariant                                                                                        |
| --------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Regular rail                | Warm timber sleepers, neutral ballast, clear steel railheads.               | Existing gauge, endpoints and 1×1 curve/switch geometry.                                         |
| High-speed rail             | Pale concrete sleepers, tidier ballast, same coherent steel.                | 2×2 curves/switches, radius 1.5 tiles; unused member still reads as occupied apron.              |
| Switches                    | Small purposeful point mechanism; routes remain legible.                    | Every rotation and handedness connects exactly.                                                  |
| Crossings                   | Clear interleaved railheads and restrained sleeper texture.                 | Regular/regular, regular/high-speed and high-speed/high-speed variants.                          |
| Transition                  | Gradual sleeper/material change along one track.                            | Class transition, not an extra curve or platform.                                                |
| Wooden bridge               | Connected timber truss, real bracing and grounded piers.                    | Independent platform, then ordinary track; preserve span phases, both axes and upgrades.         |
| Stone bridge                | Continuous cream masonry arch, thicker supports, restrained joints.         | Same independent platform behaviour; art does not change capacity or clearance.                  |
| Water tower                 | Banded timber tank, stone/wood legs, recognisable water spout.              | Service structure, not a passenger building.                                                     |
| Coaling Stage (`fuel_stop`) | Coal bunker and chute/handling arm.                                         | Distinct from water tank and production colliery.                                                |
| Semaphore                   | Slim readable post, distinct arm silhouette and lamp.                       | Preserve every `semaphore_m*_d*` state and the renderer's orientation; colour plus arm position. |
| Third rail                  | Low insulated conductor beside track.                                       | Does not become an extra running rail or obscure switch route.                                   |
| Catenary / HV               | Slender posts, simple wires and insulators; HV structurally differentiated. | Contact height, live-state cues and route overlays remain functional.                            |
| Power line                  | Timber utility poles and restrained wire spans.                             | Distinguish supply network from railway overhead wires.                                          |

Sleepers keep one spacing across every tile join. Each rail line, whether a one-tile link or the
whole road of a 2×2 curve or switch, lays a whole number of equal pitches,
`length / round(length / step)`, with the first and last sleeper half a pitch from its ends
(`sleeperLayout` in `src/art/trackIllustrated.ts`), so two pieces that meet show one pitch between
their end sleepers. The class's `step` is the nominal spacing; the pitch strays from it by at most
half a step over the line. A transition lays one run over its whole length and only changes class
at the middle. A new piece kind or class takes its sleepers from that function, never from its own
loop.

The old `bridge` track kind remains in the data/art path for compatibility. Do not reintroduce
it as the primary build workflow. Preserve any needed legacy frame while redesigning the
independent platforms. Near bridge rails/parapets must occlude correctly; rear supports stay
behind the train. Test connected spans, lone decks, both directions and construction previews.

Electrical wires, selection overlays and connection lines also include runtime-drawn geometry;
the atlas catalog alone is not the whole system. Review `src/sim/catenary.ts`,
`src/render/powerLines.ts`, `src/render/worldRenderer.ts`, and the corresponding train overlays.

## 7. Locomotives, wagons and cargo overlays

![Early-age visual direction](images/04-early-ages.png)

[Current complete vehicle sheet](images/current-complete-vehicles.png) contains every one of
the 32 locomotive and 20 wagon definitions. The catalog's complete previews assemble body
parts and running gear; raw atlas frames often show only a part. Do not mistake a partial
frame for a missing vehicle. The definition inventory lists every ID and current body family.

| Existing body family | Redesign instructions                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `steam_early`        | Simple exposed boiler, tall chimney, timber/brass character. Keep the differences in existing paint and proportions.    |
| `steam_std`          | Strong boiler/cab/tender masses, sparse handrails and fittings. Preserve each model's configured articulation and size. |
| `steam_streamlined`  | Continuous shroud, distinctive nose and livery; still visibly steam stock.                                              |
| `steam_garratt`      | Separate engine units and central bridge/boiler mass. Connections remain visibly articulated.                           |
| `diesel_switcher`    | Short purposeful hood, distinct cab, workhorse proportions.                                                             |
| `diesel_hood`        | Long hood, walkways and ventilation groups; retain body length and bogie count.                                         |
| `diesel_cab`         | Strong cab/nose silhouette, coherent side panel rhythm.                                                                 |
| `electric_box`       | Angular cab, roof equipment and collector appropriate to definition.                                                    |
| `electric_crocodile` | Distinct long noses and articulated central cab; do not merge into a generic box.                                       |
| `electric_hs`        | Refined nose and coordinated passenger-era materials. An evolution of electric, not maglev.                             |

Stock without separate bogies retains **two fixed axles / four wheels**, in the same wheel style.
Separate `bogie` frames have two axles/four wheels; `bogie3` has three axles/six wheels.
`engine_unit` remains a distinct articulated mechanism. Do not infer axle count from a concept
image. Geometry stays in `vehicleSpec` and rigid-body posing: one sprite per rigid segment,
independent bogie motion, no curved slicing or artificial hinges. Keep 48 facings and the
existing mirrored/residual-rotation treatment. Art must not change compatibility verdicts.

| Wagon family / definitions                               | Defining visual cue                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Water Cart; Riveted, Welded and Pressure Tanks           | Cylindrical tank, age-specific bands/seams and fittings; same liquid role.                 |
| Wooden Hopper, Steel Hopper, Bathtub, Bottom-Dump Hopper | Open top and clear side-wall shape; stronger handling/discharge details through ages.      |
| Flatbed, Bolster Flat, Bulkhead Flat, Heavy Flat         | Low deck; distinct bolsters, end bulkheads or reinforced load bed.                         |
| Wooden Coach, Steel Coach, Pullman                       | Window rhythm, doors and roof form; preserve individual length and livery.                 |
| Brake Van                                                | Compact enclosed body with a visibly different end/cabin treatment from a passenger coach. |
| Plank Boxcar                                             | Broad cargo door and planked enclosed sides.                                               |
| Coal Cart, Fuel Cart, Battery Cart                       | Open coal bin, small fuel vessel, or enclosed battery housing; unmistakable service role.  |

Cargo overlays `heap`, `logs`, `bales`, `crates` use the same materials as world stockpiles.
Keep loads inside wagon walls and below practical clearance; liquids and passengers should
not receive a generic heap. Validate empty, partial and full loads where represented, including
reverse motion and coupled vehicles stopped on curves.

Sources: `src/art/rolling.ts`, `src/art/frames.ts`, `src/sim/body.ts`,
`src/render/trainRenderer.ts`, `src/ui/spritePreview.ts`.

## 8. Resource icons, people, paths and effects

![Current resource icons](images/current-icons.png)

Icons currently use 16×16 buffers. Keep a strong single silhouette with a selective outline,
not a miniature painting. Use the same object meaning in tooltips, recipes, cargo and inventory.

| Icon set                   | Proposed visual distinction                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| Water / wheat / food       | Drop or water vessel / tied wheat ears / recognisable bread loaf. Food must never look like raw wheat. |
| Wood / stone / coal / iron | Cut logs / faceted pale blocks / dark lumps / clean ingots.                                            |
| Iron ore / copper ore      | Rough mineral chunks, differentiated from refined iron and wire.                                       |
| Oil / crude / diesel       | Consistent vessel family with distinct silhouette marking and tint; labels remain available.           |
| Sand / wire                | Pale loose mound / copper spool with visible centre hole.                                              |
| Power / money              | Clear bolt / coin, brighter than scenery details.                                                      |
| Passengers / population    | Travel figure/bag versus grouped residents; do not rely on colour alone.                               |

Cargo definitions include both supply modes; power, money and population also have icons even
though they are not ordinary wagon cargo. Keep all 18 existing icon frames.

[Current people and paths](images/current-people.png) · [Current effects](images/current-fx.png).

- **People:** four current outfits, two walk frames, 6×12 buffers. Readable head/body/legs,
  subdued worker and resident clothing, consistent ground anchor. Further appearance variety
  is optional; preserve existing bounded population rendering and animation.
- **Paths:** roads are painted into the ground by the landscape painter along a centre line
  (#329), so they have no atlas frames; `people/road_stone_*` stays as the road tool's icon, with
  `people/path_dirt_*`. A level crossing is a deck drawn over the straight track a road crosses:
  `track/level_crossing_<regular|narrow>_<rot>` in the track group (`src/art/trackIllustrated.ts`),
  anchored exactly as `track/straight_<cls>_<rot>`. Regular track gets dressed stone setts, narrow
  track packed earth with timber check planks along both sides of each rail, and high-speed track
  none. The deck reaches 0.1 tile outside each rail, inside the ballast bed, and 0.16 tile either
  way along the track, half the road's width (`LEVEL_CROSSING_ACROSS`, `LEVEL_CROSSING_ALONG`).
  The rails' own strokes are cut out of it, so a crossing never paints out the railheads, and it
  never invents a road transport mode.
- **Weather:** rain is fine and low contrast; fog is translucent; smoke drifts in soft stepped
  clusters. Preserve frame anchors and avoid opaque rectangles on transparent backgrounds.
- **Light:** light-tile, glow and small glow should blend with warm lamps without washing out
  signal colours. Controlled effect alpha is allowed; it is not an excuse to blur structural sprites.
- **Interaction:** cursor, valid/invalid ghost, selection, warning/alert/note and locked fog must
  work on bright sand, dark forest and city paving. Pair colour with outline/shape or text.
- **Runtime UI:** floating numbers, overview markers, track previews, power overlays and
  selection outlines also need theme review. Keep numeric text crisp, and do not bake it into PNGs.

Sources: `src/art/icons.ts`, `src/art/people.ts`, `src/art/fx.ts`, `src/render/fx.ts`,
`src/render/floaters.ts`, `src/render/overviewRenderer.ts`, `src/ui/`.

## 9. Future visual continuity — not existing inventory

![Future-age concepts](images/05-future-ages.png)

High-speed develops the electric family with streamlined shapes and lighter infrastructure.
Fictional nuclear stock can be broad and substantial; maglev uses a distinct guideway and no
wheel bogies; hyperloop introduces enclosed tubes with selected cutaways. Keep cream masonry,
landscape colours and town landmarks. These concepts require separate gameplay and renderer
design before production; do not silently add them to this redesign's asset count.

## 10. Implementation order and acceptance

1. **Baseline:** preserve this catalog and current screenshots. Capture atlas generation times,
   dimensions and startup timing on the same machine used for after measurements.
2. **Shared materials:** update palette and common shape/texture helpers. Build a small scene
   with rail, water, a tree, station, House, windmill and one moving train.
3. **Terrain and vegetation:** complete quiet ground, consistent edges and track clearance.
4. **Rail and structures:** finish both bridge classes, service art, electrical geometry,
   civic roles and every upgrade/construction stage. Test occlusion with moving trains.
5. **Stock:** redesign by body family, then validate all definition/paint/size combinations.
6. **UI and effects:** derive complete previews from the actual atlas, then polish icon and
   status readability. Avoid separate inaccurate vehicle illustrations in crafting.
7. **Whole-world review:** normal play zoom, overview and close-up; rural, city, six biomes,
   all relevant orientations, day/night, weather and dense junctions.

Acceptance checklist per family:

- Every existing key still resolves; no missing full-chain or upgrade frames. If adding keys,
  update lookup/fallbacks deliberately and regenerate the inventory.
- No clipped transparent margins, anchor shifts, neighbour seams or changed track endpoints.
- Materials agree at native scale; no isolated pixel-art asset among smooth ones, or excessive
  texture noise.
- Identify cargo, building role and signal state without relying solely on colour.
- Bridge support water contact, vehicle occlusion and tall-building track visibility pass.
- Rigid bodies retain bogie movement and configured wheel counts; reversal and curve fixtures
  still pass. Do not revive superseded full-silhouette masking or body slicing decisions.
- Atlas dimensions/frame count and measured generation/startup cost remain within an agreed
  budget. Use roughly one second generation as the prior aspiration, not an unmeasured claim.
- Run typecheck, lint and applicable simulation/render regression fixtures after code edits.
  Save before/after scenes with identical seed, camera, zoom and lighting.

Regenerate the current reference catalog with `node scratchpad/build-art-guide.mjs` while the
development server is available at `127.0.0.1:5173`. It opens an isolated new-game context,
disables autosave, exports all frames and checks that every image resolves. Open
`asset-catalog.html` locally; it is standalone and needs no network or external dependencies.

## Image provenance and concept prompts

The five concept PNGs were produced with the built-in image-generation tool; current sheets
were rendered from the game's atlas through its existing sprite preview function. No generated
concept is loaded by the game. Further civic/industry image generation failed with a service
404; existing concept material plus complete current structure sheets support those sections.

See [concept-prompts.md](concept-prompts.md) for the prompt specifications used for the two
new sheets and a description of the three previously approved boards reused here.

## Production cozy landscape and scale contract

See [cozy-v3.md](cozy-v3.md) for the integrated terrain, contact edges, tree variants,
window lighting and music. It records the shared human/door scale, the explicitly
estimated equipment families, and the checks required when adding illustrated art.

## Terrain

[terrain-production.md](terrain-production.md) is the live state: `Landscape`, which
`WorldRenderer` constructs, paints shared-corner relief, mixed illustrated grass detail,
feathered interlocks, painted stones and contour-following foundation features. It replaced
the v4 checkpoint, which had rolled v3's ground and hill relief back to the illustrated atlas
([terrain-v4.md](terrain-v4.md), kept as history).

## Style consistency: both smooth (approved 2026-09-26)

Nature was pixel art with stair-stepped edges while trains, buildings and
infrastructure are smooth painted art. The approved direction is **both smooth**:
the illustrated pixel-art sources are rounded into painted contours when packed,
by `tools/pixel-art.mjs` (majority filter; colour regions are never blended into
each other, so edges stay crisp). It applies to the ground surfaces
(`npm run art:terrain`, radius 3 at source resolution), the fallback ground tiles
and the `props` group (`npm run art:illustrated`, radius 2 at atlas resolution).
Painted art (rock surface, mountain caps, structures) is not filtered. Frame
counts, sizes and anchors are unchanged. New nature art should be drawn smooth
rather than as pixel art; this is the rule the "Pixel scale" row of section 1 states.
The rejected alternatives and zoom comparisons are kept in
`scratchpad/style-options/`.

## Buildings by age and rotation (in production)

[building-production.md](building-production.md) describes how the 548 building pictures are
made: the tools, the artist agent's brief, what the check enforces, what the image generator
does wrong, and how to run the work again or extend it.

## Building ground data

Every building frame of the `structures` atlas, as the game builds it (the generators in
`src/art`, with their placeholder turns `_r1` to `_r3`, and `public/assets/structures.*` laid
over them), ships with data on where it stands on the ground: one file,
`src/art/buildingGround.json`, written by `tools/building-ground.mjs` from the frames' own pixels
and read through `src/art/buildingGround.ts` (`groundOf(frameKey)`; pure data, no DOM). Nothing
in it is typed in, and the tool changes no pixel, size or anchor. It is for the renderer's yards,
door paths, plinths and contact shadows, for walkers at doors (#406) and for roads that end at
doors (#408, #409).

```
node tools/building-ground.mjs            # write the file, print the findings (--all lists every one)
node tools/building-ground.mjs --check    # say whether the file is what the frames give now
```

Run it again after changing a generator, `public/assets/structures.*` or a place's `doors` in
`src/data`. A run with nothing changed writes the same bytes. `tools/building-ground.test.mjs`
fails when a building frame has no entry, when a corner of an entry's foot lies more than 1 world
px off the frame's opaque pixels, when a door disagrees with `doorsOf` (`src/sim/doors.ts`), when
the foot of a frame and of its mirror image are not mirror images, when the same picture declared
at 2 or 3 times its resolution has a foot more than 1 world px away, when an illustrated picture's
foot covers little of the base that `tools/building-fit.mjs` measures for it, and when the file is
not what the tool writes now.

An entry, keyed by frame (`structures/farm_1`, `structures/depot_r1_r3`). Every point is in
**world px from the frame's anchor** (texels over the atlas's `resolution`, x right, y down),
before the renderer's scale reference (`scaleReference`, `src/render/assetScale.ts`): a frame
drawn at scale k puts a point at k times these numbers. The anchor is the footprint's centre on
the ground. A tile is `[dx, dy]` from the footprint's corner tile (lowest x and y), the way
`doorsOf` counts them.

- `source`: `generated` (src/art) or `illustrated` (the shipped file pair); `rot`: the rotation
  the frame shows, 0 to 3 (a depot's `_r<axis>` frame is rotation 0 or 1, `_r2`/`_r3` turn it).
- `footprint`: the tiles it covers at that rotation.
- `foot`: where its walls meet the ground, the corners n, e, s, w (far, right, near, left) of a
  parallelogram. Its sides run on the picture's own ground lines: the game's 2:1 or near it (a
  slope of 0.33 to 0.67, the range `tools/building-fit.mjs` trusts), because an image generator
  keeps the camera only near the game's. It reaches as far along the base as the base goes,
  across the gaps between the piers of a trestle (up to 20 world px), and no further. The camera
  sees the S wall (w to s) and the E wall (s to e). Each corner lies on the picture's opaque
  pixels, within 1 world px. Where a picture has stretches that are not walls (a conveyor, a
  cage, steps), the foot is the walls' base and stops short of them, so it can be off the anchor
  by what the picture is off its footprint. It is measured at the detail the picture has: a
  picture enlarged without new detail (each texel copied m by m, at any offset, and declared at m
  times the resolution) is measured on its own texels and has the same foot. A picture redrawn
  with new detail is a new picture, and where two volumes fit its base nearly as well (the
  generated `windmill_r3`, `warehouse_4`, `farm_2`), the redraw can stand on the other one.
- `fit`: `walls` when a straight base was found (the two lines that most of the wall columns
  stand on, columns counting for the height of their run, so that a bench, a lamp post or ground
  paint in front is not taken for a wall; the near corner is the base's lowest point, so a column
  that stands more than 1 world px and half a texel below it, such as a bench against the base, is
  on neither line); `outline` when no base is long enough and the foot is
  the silhouette's lowest stand on the game's 2:1 (machinery, heaps, a trestle). Treat `outline`
  as approximate. A base whose near corner stands above the anchor, the footprint's centre on the
  ground, is on stilts or a roof, and is passed over for what stands lower (the generated coal
  stand `fuel_stop_r1` to `_r3` stands on its legs).
- `baked`: world px squared of opaque pixels below the foot between its outer corners: ground
  painted into the picture (a yard, a pond, a field) or what stands in front of the walls (a
  conveyor, a cage, steps), counted below the foot as written in the entry. 0 for a clean
  cut-out. A yard drawn by the renderer would double a baked one.
- `front`: the wall the building's front faces (S, W, N, E for r0 to r3), its two foot corners in
  tile order, and whether the camera sees it (`visible`).
- `doors`: only the doors the picture shows. Kind, tile, side and `reach` come from `doorsOf`
  (#406): a door of the data is the opening in the picture nearest the middle of its tile's share
  of the wall, within 0.3 tile, on a wall the camera sees (S or E). `point` is where the opening
  meets the ground (a step, if it has one), `width` the opening's width and `offset` its distance
  from that middle in tiles, along the wall. A door on a wall the camera cannot see, or one the
  picture does not show, has no entry: nothing is guessed, and a consumer fits a door by `reach`
  and the foot's wall.

The findings the tool prints are what the pictures do not give or disagree on: a door of the data
that is not seen, a door that stands off the middle of its tile, a door-shaped opening where the
data has no door, a foot that is `outline`, and ground baked into a picture. The illustrated
frames are drawn as cut-outs, so ground painted into the picture is a mark of the generators; in
an illustrated frame `baked` is what stands in front of the walls.
A door is found as a run of columns on the wall that differ from the wall's own colour at that
height, as tall and as wide as a door and standing near the foot. That is a heuristic: a door can
go unseen (a canopy over it, a plinth under it), and where the door is hidden the opening nearest
the middle of its tile can be a window or an arch of a door's size.

`node tools/building-ground.mjs --sheets` draws what was measured over every frame (the foot's
walls the camera sees in magenta, the two it does not in cyan, the front wall in orange, each
door in green, the anchor in red) into `scratchpad/building-ground/`, which is where a listed
door and a foot are checked by eye. `scratchpad/building-ground-findings.txt` is the full list of
findings (`--all`) for the pictures and the measure as they stand with the data committed (#435);
it is a snapshot, and the tool prints the current one.

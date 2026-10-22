# Textured blockout renders (pilot, 2026-10-21)

Inputs for the "paint over the textured render" pilot (queue prompt TB1, group `textured-pilot`). Three buildings, four views each: warehouse, water pump (`pump`), power plant (`power_plant`), r0 to r3.

Unlike `../scaffolds/` (AI-reconstructed, morphed), these are clean Blender blockouts matched to the painted r0, with the original painting projected onto them (the pilot of `renders/textured-blockout/`): the texture comes from the painting where the painting shows a surface, from mirrored and cloned patches elsewhere. The camera, the proportions and every part's position are exact (the game camera: elevation 30 degrees, azimuth 45 degrees, ortho, 2:1), on the review-2 plan canvas (1024 x 1024, anchor 512,800 for the warehouse and 512,832 for the pump, 8 canvas px per game px; 1536 x 1024, anchor 768,740, 5 canvas px per game px for the power plant). Even r0 comes from the model, so the light is the same in all four views.

Per view, in `<building>/`:

- `<building>-r<v>-textured.png`: variant B of the pilot, the render to PAINT OVER. The painting's own shading is taken out of the texture and the model is relit with the game sun (upper left), so the lit side is the lower-left wall in every view (left/right wall brightness ratio 1.25 to 2.5). Real RGBA, transparent background.
- `<building>-r<v>-bare.png`: the same shape in plain clay (shape and form check). Its alpha is the textured render's alpha, so both have the identical silhouette.
- `<building>-r<v>.json`: `outline_polygon_px` (outer contour of alpha above 128, canvas px, simplified to 0.7 px: the polygon matches the mask at IoU 0.997 or better, see `silhouette.polygon_vs_mask_iou`), `footprint_px` and `model_base_px` corners, the camera numbers, canvas, anchor and scale.

What the texture is not (what the painter fixes): the cloned and mirrored patches (back walls, far roof slopes, chimney backs, the underside of the canopy) are uniform and a little blocky, there are seams, the thin parts (pipes, the flywheel, the generator, window glazing) are smeared by the projection onto plain cylinders and boxes, and the painted highlights are baked in. Source paintings (origin/develop): `assets/source/base-v1/warehouse.png`, `pump.png`, `power-plant.png`. The scripts, the `.blend` files and the pilot's review page notes are in `renders/textured-blockout/` (not in the repository).

| Building | Source picture | View | Turned how | Textured render | Bare | JSON |
|---|---|---|---|---|---|---|
| Warehouse (`warehouse`) | base-v1/warehouse.png | r0 | front, sliding doors lower left, canopy end lower right | `warehouse/warehouse-r0-textured.png` | `warehouse/warehouse-r0-bare.png` | `warehouse/warehouse-r0.json` |
| Warehouse (`warehouse`) | base-v1/warehouse.png | r1 | front faces upper left, canopy end lower left, long back wall lower right | `warehouse/warehouse-r1-textured.png` | `warehouse/warehouse-r1-bare.png` | `warehouse/warehouse-r1.json` |
| Warehouse (`warehouse`) | base-v1/warehouse.png | r2 | front faces upper right, long back wall lower left, gable end with one small window lower right | `warehouse/warehouse-r2-textured.png` | `warehouse/warehouse-r2-bare.png` | `warehouse/warehouse-r2.json` |
| Warehouse (`warehouse`) | base-v1/warehouse.png | r3 | front faces lower right, gable end (no canopy) lower left | `warehouse/warehouse-r3-textured.png` | `warehouse/warehouse-r3-bare.png` | `warehouse/warehouse-r3.json` |
| Water pump (`pump`) | base-v1/pump.png | r0 | door gable lower right, pump set (pipe bend, flywheel, strainer basket) lower left | `pump/pump-r0-textured.png` | `pump/pump-r0-bare.png` | `pump/pump-r0.json` |
| Water pump (`pump`) | base-v1/pump.png | r1 | door gable lower left, pump set behind at the upper left | `pump/pump-r1-textured.png` | `pump/pump-r1-bare.png` | `pump/pump-r1.json` |
| Water pump (`pump`) | base-v1/pump.png | r2 | long side lower left, gable end lower right, pump set behind it at the right | `pump/pump-r2-textured.png` | `pump/pump-r2-bare.png` | `pump/pump-r2.json` |
| Water pump (`pump`) | base-v1/pump.png | r3 | gable end lower left, side wall with window, flywheel and pipe lower right | `pump/pump-r3-textured.png` | `pump/pump-r3-bare.png` | `pump/pump-r3.json` |
| Power plant (`power_plant`) | base-v1/power-plant.png | r0 | arched window row lower left, machine-house annex and chimney at the right | `power_plant/power_plant-r0-textured.png` | `power_plant/power_plant-r0-bare.png` | `power_plant/power_plant-r0.json` |
| Power plant (`power_plant`) | base-v1/power-plant.png | r1 | gable end with the large arched window lower left, long wall with arched windows lower right, chimney in front | `power_plant/power_plant-r1-textured.png` | `power_plant/power_plant-r1-bare.png` | `power_plant/power_plant-r1.json` |
| Power plant (`power_plant`) | base-v1/power-plant.png | r2 | long wall with arched windows lower left, gable end lower right, chimney and annex at the upper left | `power_plant/power_plant-r2-textured.png` | `power_plant/power_plant-r2-bare.png` | `power_plant/power_plant-r2.json` |
| Power plant (`power_plant`) | base-v1/power-plant.png | r3 | gable end with an arched window lower left, long wall with arched windows lower right, chimney behind | `power_plant/power_plant-r3-textured.png` | `power_plant/power_plant-r3-bare.png` | `power_plant/power_plant-r3.json` |

Silhouette areas (opaque px, alpha above 128): warehouse 245950, 246366, 246467, 245848; pump 186018, 164853, 174742, 170017; power plant 174849, 151092, 168910, 153374 (r0 to r3).

## Batch A (2026-10-22): station, town hall, big farm, house, small farm halt, quarry

Same method as the pilot (`renders/textured-blockout/`, batch A scripts in `tools_a/`, one `build_<job>.py` and `measure-<job>.json` per building next to the `.blend`; not in the repository): the blockout is measured from the painted r0 through the painting's own orthographic camera, its silhouette is checked against the painting from that camera, the painting is projected from that camera, the unseen faces are mirrored or cloned from same-material painted texels (no generative fill), variant B is de-lit and relit with the game sun, and r0 to r3 are rendered at the game camera (30 degrees, 2:1) on the review-2 plan canvas of the job (8 canvas px per game px). File names follow the pilot: `<job>/<job>-r<v>-textured.png`, `<job>-r<v>-bare.png` (alpha = the textured render's alpha), `<job>-r<v>.json` (outline polygon, base corners, camera, canvas, anchor). Holes inside a silhouette (gaps between the crane and the building) are listed in `outline_holes_px`.

| Building | Source picture | Footprint at r0 | Painted camera, elevation / azimuth (deg) | Canvas | IoU, painting camera (1:1 / best fit) | Texture painted / mirrored / cloned / healed or mean colour | Files |
|---|---|---|---|---|---|---|---|
| House (`townhouse`) | base-v1/house-cottage.png | 1 x 1 | 23.5 / 43.1 | 1024 x 1536, anchor 512,1344 | 0.963 / 0.969 | 45% / 25% / 29% / 2.0% | `townhouse/townhouse-r0..r3-{textured,bare}.png`, `townhouse/townhouse-r0..r3.json` |
| Big station (`big_station`) | base-v1/station.png | 2 x 1 | 14.7 / 47.9 | 1024 x 1024, anchor 512,800 | 0.933 / 0.933 | 34% / 19% / 46% / 0.6% | `big_station/big_station-r0..r3-{textured,bare}.png`, `big_station/big_station-r0..r3.json` |
| Town hall (`town`) | base-v1/townhouse-civic.png | 2 x 1 | 21.1 / 38.1 | 1024 x 1024, anchor 512,800 | 0.940 / 0.944 | 36% / 13% / 50% / 0.7% | `town/town-r0..r3-{textured,bare}.png`, `town/town-r0..r3.json` |
| Big farm (`big_farm`) | base-v1/farm.png | 1 x 2 | 20.5 / 45.0 | 1024 x 1024, anchor 512,800 | 0.925 / 0.929 | 36% / 19% / 44% / 1.1% | `big_farm/big_farm-r0..r3-{textured,bare}.png`, `big_farm/big_farm-r0..r3.json` |
| Small farm halt (`farm`) | buildings-v2/farm/farm-a0-r0.png | 1 x 1 | 24.4 / 47.3 | 1024 x 1024, anchor 512,832 | 0.954 / 0.964 | 42% / 19% / 37% / 1.2% | `farm/farm-r0..r3-{textured,bare}.png`, `farm/farm-r0..r3.json` |
| Quarry (`quarry`) | buildings-v2/quarry/quarry-a0-r0.png | 1 x 1 | 30.0 / 45.0 | 1024 x 1024, anchor 512,832 | 0.929 / 0.931 | 46% / 12% / 42% / 0.0% | `quarry/quarry-r0..r3-{textured,bare}.png`, `quarry/quarry-r0..r3.json` |

Silhouette areas (opaque px, alpha above 128), r0 to r3:
- townhouse: 101711, 101854, 103420, 103170
- big_station: 242481, 272567, 279170, 232631
- town: 355442, 356216, 353028, 355306
- big_farm: 302385, 266164, 302142, 287132
- farm: 135907, 121986, 140498, 129354
- quarry: 132413, 104562, 119298, 113400

Notes:

- The painted cameras are not the 30 degree game camera and several paintings are not strictly orthographic (a long base line falls at 0.32, the ridge at 0.26); where the lines disagree the blockout uses one compromise camera (big station 14.7 degrees, big farm 20.5, town hall 21.1), and the IoU above is for that camera. Camera numbers: `elevation / azimuth` as fitted from the base lines; `azimuth` is the proj-frame value, the renderer uses 90 minus it.
- Long side of the base = 0.9 of the footprint's long side (the plan's 90 per cent rule); the other side follows the painted ratio (house 0.565, town hall 0.835, farm halt 0.845). The unseen sides are plain continuations; the silo of the farm halt and the farm are cylinders (their back is mirrored from the painted half).
- Small farm halt, extra check against the existing buildings-v2 paintings of the same rotation (`farm/extra-checks.json`; the paintings are drawn about 1.3 to 1.4 times the plan scale, so the best uniform scale + shift is the fair figure): r1 0.83, r2 0.60, r3 0.66 (mapped 1:1 to the plan canvas 0.53, 0.31, 0.36). The existing r2 painting shows the same view as r0, not a half turn.
- Quarry, extra check against the accepted r1 and r3 paintings (`quarry/extra-checks.json`): 0.27 and 0.41 mapped 1:1, 0.67 and 0.67 with the best scale and shift. The accepted r1 and r3 are not turns of the r0 shape (the crane is drawn at the left in every view, the paintings are 1.5 to 1.8 times the plan scale); the blockout follows r0.
- Healed or mean colour = texels with no usable painted or cloned source, filled from the nearest texel or the material mean (1 to 2 per cent). What the painter fixes is as in the pilot: cloned and mirrored patches are uniform and a little blocky, thin parts (pipes, ropes, rails, the silo hoop bands) are smeared by the projection.

## Batch C (2026-10-22): battery, coaling stage, fuel pump; power plant material crops

Same method as the pilot and batch A (`renders/textured-blockout/`, one `build_<job>.py` and `measure-<job>.json` per building under `renders/blockout-pilot/<job>/`, not in the repository): blockout measured from the painted r0, painting projected from its own camera, unseen faces mirrored or cloned from the same material, variant B (de-lit, game sun). No generative fill.

| Building | Source picture | Footprint at r0 | Painted camera, elevation / renderer azimuth (deg) | Canvas | IoU, painting camera (1:1 / best fit) | Texture painted / mirrored / cloned / healed or mean colour | Files |
|---|---|---|---|---|---|---|---|
| Battery (`substation`) | base-v1/substation.png | 2 x 2 | 27.6 / 45.0 | 1536 x 1024, anchor 768,760 | 0.928 / 0.931 | 42% / 10% / 45% / 3.8% | `substation/substation-r0..r3-{textured,bare}.png`, `substation/substation-r0..r3.json` |
| Coaling stage (`fuel_stop`) | buildings-v2/fuel_stop/fuel_stop-a0-r0.png (accepted r0) | oblong, 0.864 x 1.136 (long side lower right) | 30.8 / 43.7 | 1024 x 1024, anchor 512,832 | 0.925 / 0.925 | 36% / 16% / 48% / 0.0% | `fuel_stop/fuel_stop-r0..r3-{textured,bare}.png`, `fuel_stop/fuel_stop-r0..r3.json` |
| Fuel pump (`fuel_pump`) | fuel-2026-10-11/fuel_pump-a1-r0.png (origin/art/325-fuel-pump) | 1 x 1 | 33.5 / 47.0 | 1024 x 1024, anchor 512,832 | 0.928 / 0.928 | 40% / 17% / 42% / 1.8% | `fuel_pump/fuel_pump-r0..r3-{textured,bare}.png`, `fuel_pump/fuel_pump-r0..r3.json` |

Texture shares per view (painted / copied / cloned / healed or mean), r0, r1, r2, r3:
- substation: 90/1/8/1, 27/10/61/2, 9/16/73/2, 49/6/39/6 per cent
- fuel_stop: 82/2/16/0, 45/8/46/0, 6/29/66/0, 25/27/48/0 per cent
- fuel_pump: 89/1/9/1, 26/22/51/0, 3/30/65/2, 49/14/36/2 per cent

Silhouette areas (opaque px, alpha above 128), r0 to r3:
- substation: 240533, 222147, 241779, 236182
- fuel_stop: 284432, 280874, 282532, 282171
- fuel_pump: 122838, 115032, 123700, 116334

Notes:

- Battery: the painted slab is oblong (1.87 x 1.39 tiles at the painted scale), not the plan's 1.8 x 1.8; the blockout follows the painting. The left gantry foot stands about 0.35 tile outside the slab corner in the painting; it is kept on a small joined pad, so it overhangs the slab at r1 to r3. The outline polygons carry `hole_polygons_px` as well (the gap between the gantry legs and beam), without them the polygon would not match the mask (0.76 to 0.84); with them the polygon matches the mask at 0.989 to 0.996. Left/right wall brightness in variant B: r0 1.95, r1 0.85 (the left wall is not the brighter one there), r2 1.77, r3 1.94.
- Coaling stage: the painting sits at about the plan scale (0.945); the sixth pier of the plan is modelled although the painting shows five. Texture at the painting camera: mean difference 5.5/255, PSNR 27.7 dB. The bin end faces (fix round 2) carry planks copied from the painted long face; weak: cloned coal tops, streaky timber, blotchy stone piers, the middle back pier is cloned. Extra check against the accepted r2 (attempt 8), scaled by 1024/1254 onto the plan canvas (`fuel_stop/extra-checks.json`, overlay `fuel_stop/extra-check-r2-overlay.png`): IoU 0.708 mapped 1:1, 0.859 with the best uniform scale (0.905) and shift. The aspect ratio matches (0.673 both); the accepted r2 is about 10 per cent larger and its leg and pier layout differs.
- Fuel pump: the painted house is 1.0 x 0.5 (depth over length 0.5), not the plan's 0.78; the model is scaled so the long side of the base is 0.9 tile (the plan base is 0.70 x 0.90). Extra check against the accepted r1 (attempt 15) and r2 (attempt 11), scaled onto the plan canvas (`fuel_pump/extra-checks.json`, overlays `fuel_pump/extra-check-r{1,2}-overlay.png`): r1 0.711 mapped 1:1, 0.815 with the best scale (1.135) and shift; r2 0.738 and 0.810 (scale 1.07). The accepted views are 9 to 14 per cent wider and 6 to 18 per cent taller (bounding boxes 389 x 625 and 485 x 522 against the blockout's 342 x 529 and 445 x 490, same ground line). Differences in shape: in the accepted r1 the hose post is a long pipe leaning about 27 degrees to the right and reaching y=291 (the blockout's is vertical, reaching y=386); in the accepted r2 the arm is horizontal and the hose hangs about 25 px further right (the blockout's rises slightly). The accepted r3 (not accepted by the author) is 0.34 / 0.55. Weak: the back faces of the open truss story are grey slate-like clones (painted roof slate landed on the wood backing and was cloned), thin parts (hose, pipes, rail) are smeared.
- Healed or mean colour = texels with no usable painted or cloned source (see batch A). What the painter fixes is as in the pilot.

### Power plant: material crops (`power_plant/materials/`)

For the Codex paint-over of `power_plant` (the textured blockout above is kept as it is). Square crops cut from the original painting (origin/develop `assets/source/base-v1/power-plant.png`), each showing one material or detail, never the whole building or its outline; `materials.json` names each crop, its source rectangle and its enlargement. Only opaque pixels are read: every rectangle has alpha 250 or more everywhere (the source's orange glow is at alpha 0 and is in no crop). The painting's brick, slate and stone patches are small (the stone blocks and brick piers are 40 to 140 px across), so each crop is the largest clean patch, enlarged by an integer factor with nearest neighbour (no resampling) to 240 to 348 px; `native_px` is the size in the original.

| Crop | Material or detail | Size (px) | Source rectangle in the original |
|---|---|---|---|
| `materials/brick_wall.png` | brick wall (hall brick pier, lit and dark face) | 288 (2x) | 740,743 to 884,887 |
| `materials/slate_roof.png` | slate roof, front slope | 348 (2x) | 519,399 to 693,573 |
| `materials/arched_window_green_frame.png` | arched window, green frame, glazing bars, arch ring | 256 (2x) | 602,686 to 730,814 |
| `materials/stone_quoin.png` | cream stone quoin blocks (chimney base) | 256 (4x) | 1254,590 to 1318,654 |
| `materials/chimney_brick.png` | chimney brick, lit and dark face | 240 (2x) | 1214,368 to 1334,488 |
| `materials/generator_metal.png` | generator and annex green sheet metal, fan grille | 300 (3x) | 1190,648 to 1290,748 |

## Batch B (2026-10-22): stone grinder, oil refinery, colliery, ironworks, oil derrick

Same method as the pilot and batch A (`renders/textured-blockout/`, batch B scripts in `tools_b/`, one `build_<job>.py` per building next to the `.blend`; not in the repository): measured blockout from the painted r0 through the painting's own orthographic camera, silhouette checked against the painting from that camera, painting projected from that camera, unseen faces mirrored or cloned from same-material painted texels (no generative fill), variant B (de-lit, game sun), r0 to r3 at the game camera (30 degrees, 2:1) on the review-2 plan canvas of the job. The thin parts (head frame, tower lattice, wheels, rods, pipes, railings, ladders, the chain and the fence of the ironworks) are real thin geometry, not slabs. Footprints follow F7 (grinder 1 x 1, refinery 1 x 1, colliery 2 x 2, ironworks 2 x 2, oil derrick 2 x 1); the plan JSONs agree with F7 everywhere. Grinder, refinery and oil derrick have no r0 plan, so the canvas, scale and anchor are those of their r1 plans (the same for every view).

| Building | Source picture | Footprint at r0 | Painted camera, elevation / azimuth (deg) | Canvas | IoU, painting camera (1:1 / best fit) | Texture painted / mirrored / cloned / healed or mean colour | Files |
|---|---|---|---|---|---|---|---|
| Stone grinder (`grinder`) | base-v1/grinder.png | 1 x 1 | 24.0 / 45.0 | 1024 x 1024, anchor 512,832 | 0.955 / 0.958 | 41% / 4% / 55% / 0.0% | `grinder/grinder-r0..r3-{textured,bare}.png`, `grinder/grinder-r0..r3.json` |
| Oil refinery (`refinery`) | base-v1/refinery.png | 1 x 1 | 24.0 / 45.0 | 1024 x 1024, anchor 512,832 | 0.923 / 0.923 | 29% / 8% / 55% / 7.7% | `refinery/refinery-r0..r3-{textured,bare}.png`, `refinery/refinery-r0..r3.json` |
| Colliery (`colliery`) | base-v1/works-full-colliery.png | 2 x 2 | 23.5 / 45.0 | 1536 x 1024, anchor 768,760 | 0.927 / 0.929 | 32% / 11% / 56% / 0.0% | `colliery/colliery-r0..r3-{textured,bare}.png`, `colliery/colliery-r0..r3.json` |
| Ironworks (`ironworks`) | base-v1/works-full-ironworks.png | 2 x 2 | 23.5 / 45.0 | 1536 x 1024, anchor 768,760 | 0.932 / 0.936 | 35% / 7% / 57% / 2.0% | `ironworks/ironworks-r0..r3-{textured,bare}.png`, `ironworks/ironworks-r0..r3.json` |
| Oil derrick (`oil_derrick`) | base-v1/works-full-oil-derrick.png | 2 x 1 | 25.0 / 45.5 | 1024 x 1024, anchor 512,800 | 0.902 / 0.904 | 25% / 7% / 54% / 14% | `oil_derrick/oil_derrick-r0..r3-{textured,bare}.png`, `oil_derrick/oil_derrick-r0..r3.json` |

Texture shares per view (painted / copied / cloned / healed or mean), r0, r1, r2, r3:
- grinder: 89/0/11/0, 31/3/66/0, 2/8/90/0, 50/5/45/0 per cent
- refinery: 65/0/29/5, 18/10/60/12, 1/16/75/9, 36/7/47/10 per cent
- colliery: 78/0/21/1, 28/9/62/1, 0/19/80/0, 30/13/57/0 per cent
- ironworks: 75/0/23/2, 24/8/64/3, 1/12/87/0, 37/8/55/0 per cent
- oil_derrick: 57/1/37/5, 10/12/66/12, 1/9/68/22, 34/3/54/10 per cent

Silhouette areas (opaque px, alpha above 128), r0 to r3:
- grinder: 129538, 112172, 127637, 116003
- refinery: 95734, 61895, 95306, 63500
- colliery: 114065, 110448, 115896, 96647
- ironworks: 213434, 181948, 219812, 176229
- oil_derrick: 249204, 235372, 268549, 233008

Notes:

- The outline polygons carry `hole_polygons_px` (the see-through gaps, area 60 px or more) next to `outline_polygon_px`; subtract them to get the mask (polygon against mask 0.98 to 0.999 with the holes subtracted; the lattices and the derrick's frame windows would not match without them).
- Camera and scale: the paintings are close to orthographic at 23.5 to 25 degrees, not 30; the derrick is drawn at azimuth 45.5 (its two ground edges have slopes 0.43 and 0.41). k (painting px per tile) comes from the plan rule: the painted base from the left corner to the right corner is 0.9 of the footprint span after scaling to the plan canvas (grinder 700, refinery 738, colliery 558, ironworks 462, derrick 391). The painted shapes are not square, so the models are about 1.2 x 0.64 (grinder, with the lean-to shed), 1.19 x 0.78 (refinery), 1.8 x 1.0 (colliery), 2.15 x 1.6 (ironworks) and 2.1 x 0.86 tiles (derrick) inside their footprints.
- Grinder: house, portal wall with two arches and the shed are measured from rectified front and gable views. Fix round 2 (see the section at the end): the hopper no longer passes through the roof, the walls and the roof are clean at r1 to r3. Weak: the millstones are plain cylinders; the arch interiors and the gap between hopper and house are smeared at r1 to r3.
- Refinery: tank, column with three railed platforms, furnace on its frame, vessels, chimney and the copper pipes are modelled; the frames carry dark infill panels at the back so they are not see-through, as in the painting. Weak: the yellow railings and the pipe backs are tiled from small painted patches (grey-brown, not yellow, at r1 to r3), the steel frames show cloned vertical streaks, the furnace's far side is cloned steel and corrugation. Healed or mean colour is 7.7 per cent because leftover thin groups copy tiled patches of the same material first (a tile pass added for this batch) and only then the mean.
- Colliery: the painted building is about 1.8 x 1.0 tiles (head frame at -x, engine house at +x), narrower than the plan's 694 px base. The painting is not geometrically consistent, so parts are placed from pixels at the painting camera; the head frame (fix round 2) is a 3D frame: the painted front legs plus two inclined back legs hidden behind them at r0, a stone footing under every leg, ties between the planes, braces anchored on the legs, the rope ends on the wheel rim and on the cabin roof. A dark backing sheet under the hoppers keeps the silhouette solid and shows from behind at r2. The outline polygon matches the mask at 0.985 to 0.989 with the holes subtracted.
- Ironworks: the painting is only mostly orthographic; the tower's right-front base sits about 50 px higher than a Y = 0 ground line allows, so the plinth is notched under it (the blue band in the IoU difference). Weak: the copper boiler, the hoist chain and the fence are smeared at r1 to r3; the unseen sides are cloned brick, stone and slate (r2 shows 1 per cent painted), with the roof and wall geometry of fix round 2.
- Oil derrick: 0.902 is under the 0.92 target and just over the 0.90 skip line, after many correction rounds. The silhouette is right where a part is a plate (the beam and the horse head are plates whose outline is read from the painting's pixels on their plane; the base frame's two windows are cut from the painting's holes); what is not matched is the lattice of the Samson post (four faces of X braces, the painting's small gaps do not line up) and the thin parts of the wellhead. Weak: the back faces of the beam and the horse head are blocky clone patches, the tower lattice is smeared at r1 to r3, the flywheel and the pipes are thin and partly mean colour (14 per cent healed or mean, the highest of the batch).
- Fill changes made during the batch (the grinder and the derrick got both, the refinery the tile pass only, the colliery and the ironworks ran before them and keep the earlier fill): a tile pass for texels that have no clone exemplar (patches of the same material's own painted texels instead of the flat mean colour), and a spill removal (painted texels that no r0 view sees and that are colour outliers of their material are re-cloned).
- What the painter fixes is as in the pilot: cloned and mirrored patches are uniform and a little blocky, the thin parts are smeared by the projection, the painted highlights are baked in.

## Fix round 2 (2026-10-22): grinder, quarry, colliery, ironworks, coaling stage

Five blockouts were refused on review (broken turned views); the files above are re-rendered at the same paths. Cause, fix and the r0 match (IoU at the painting camera, 1:1; previous value in brackets; the bar is 0.92 or the previous value):

| Building | What was wrong | Fix | IoU at r0 |
|---|---|---|---|
| Grinder | Holes in the walls and roof at r1 to r3: mirrored copies of the front wall carried the dark arch interiors, a hopper brace and a white streak onto the back wall; the hopper and its rubble passed through the lower roof slope and the painted rubble landed on the slate. The mesh itself was closed (one non-manifold edge where the left arch touched the wall top, now removed). | The roof's lower slope is cut by the hopper's own envelope (the roof wraps round it, nothing passes through); mirror sources must lie in a plain patch of their face (colour and variance near the face's median), so the back walls are cloned from clean stone; the left arch apex is 0.008 lower. | 0.9545 (0.9554) |
| Quarry | The winch house had no back and no crane-side wall (an open frame): r2 and r3 looked through it at the mast and the drum; the cloned timber came from mixed frames. The crane is attached (jib, strut, rope, load) and nothing floats. | Plank walls on the two unseen sides (back, crane side) between the posts; same cleaner fill. | 0.9291 (0.9286) |
| Colliery | The head frame was one flat plane of legs: from r2 and r3 the deck stood on a few slanted sticks; the two braces between the front legs and a ladder rung touched nothing, the rope ended in the air 0.09 tile before the cabin, one gantry post had no footing. | Real 3D head frame: two inclined back legs (the front legs moved along their own view rays, so r0 does not change), footings under every leg, ties and braces between the planes, braces anchored on the legs, rungs between the rails, iron corbels joining the leg tops to the deck, the rope ends on the rim of the wheel and on the cabin roof edge (both ends slid along their view rays), footing under the gantry post. Mesh check: no floating part. | 0.9272 (0.9320) |
| Ironworks | Blocky unseen sides: a brick box climbed above the roofs behind the tower, the store's left roof passed through the tower roof, the clerestory stuck out past its roof, a blank back wall, 1 per cent painted at r2. | The hall block behind the roofs stops at the eave and its back is flush with the back wall; the store's lower roof starts at the tower wall (a clean valley against the tower roof); the clerestory roof and ridge cover the clerestory; the back wall has three arched windows with stone rings and a plinth band (the rhythm of the painted front). | 0.9324 (0.9305) |
| Coaling stage | The bin end faces were a flat yellow: faces with no mirror partner fell to the tile pass or the mean colour. | The hidden long face is mirrored from the painted one; the short end (behind the winch and chute) is copied from the painted long face by plan position (same material); the clone step also tries small exemplar blocks before it tiles; two chain pieces reach their rings and the spout (mesh check: no floating part). | 0.9245 (0.9250) |

Fill changes (all five): mirror sources must pass a plain-patch test per face group (window mean colour within 40 of the group's median, luminance variance not above 5 times the median plus 60); that test only filters sources, it does not change what is painted. The texture shares in the tables above are the new ones.

Mesh sanity check (all 17 textured blockouts, closed solids per part, outward normals, no edge shared by more than two faces, every part touching the ground-connected set within 0.012 tile): the five above are clean after the fixes (open edges 0, inward 0, non-manifold 0, floating 0). On the branch the other 12 have no open or inward parts; one small floating part each (smaller than 0.2 tile: oil derrick, refinery, battery, town hall) is left as it is.

Extra checks against the accepted paintings (`quarry/extra-checks.json`, `fuel_stop/extra-checks.json`, the r2 overlay) were made with the earlier blockouts; the silhouettes changed by less than 0.5 per cent of the area at r1 to r3, so the figures stand.

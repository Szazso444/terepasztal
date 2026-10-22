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
| Quarry (`quarry`) | buildings-v2/quarry/quarry-a0-r0.png | 1 x 1 | 30.0 / 45.0 | 1024 x 1024, anchor 512,832 | 0.929 / 0.930 | 46% / 19% / 34% / 1.8% | `quarry/quarry-r0..r3-{textured,bare}.png`, `quarry/quarry-r0..r3.json` |

Silhouette areas (opaque px, alpha above 128), r0 to r3:
- townhouse: 101711, 101854, 103420, 103170
- big_station: 242481, 272567, 279170, 232631
- town: 355442, 356216, 353028, 355306
- big_farm: 302385, 266164, 302142, 287132
- farm: 135907, 121986, 140498, 129354
- quarry: 132322, 104562, 119298, 113363

Notes:

- The painted cameras are not the 30 degree game camera and several paintings are not strictly orthographic (a long base line falls at 0.32, the ridge at 0.26); where the lines disagree the blockout uses one compromise camera (big station 14.7 degrees, big farm 20.5, town hall 21.1), and the IoU above is for that camera. Camera numbers: `elevation / azimuth` as fitted from the base lines; `azimuth` is the proj-frame value, the renderer uses 90 minus it.
- Long side of the base = 0.9 of the footprint's long side (the plan's 90 per cent rule); the other side follows the painted ratio (house 0.565, town hall 0.835, farm halt 0.845). The unseen sides are plain continuations; the silo of the farm halt and the farm are cylinders (their back is mirrored from the painted half).
- Small farm halt, extra check against the existing buildings-v2 paintings of the same rotation (`farm/extra-checks.json`; the paintings are drawn about 1.3 to 1.4 times the plan scale, so the best uniform scale + shift is the fair figure): r1 0.83, r2 0.60, r3 0.66 (mapped 1:1 to the plan canvas 0.53, 0.31, 0.36). The existing r2 painting shows the same view as r0, not a half turn.
- Quarry, extra check against the accepted r1 and r3 paintings (`quarry/extra-checks.json`): 0.27 and 0.41 mapped 1:1, 0.67 and 0.67 with the best scale and shift. The accepted r1 and r3 are not turns of the r0 shape (the crane is drawn at the left in every view, the paintings are 1.5 to 1.8 times the plan scale); the blockout follows r0.
- Healed or mean colour = texels with no usable painted or cloned source, filled from the nearest texel or the material mean (1 to 2 per cent). What the painter fixes is as in the pilot: cloned and mirrored patches are uniform and a little blocky, thin parts (pipes, ropes, rails, the silo hoop bands) are smeared by the projection.

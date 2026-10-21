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

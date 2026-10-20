# Scaffold renders (review 2)

Turned-view scaffolds for the remaining building jobs, made on 2026-10-19. Each building is one 3D model reconstructed from its painted r0 and rendered at the exact game camera (elevation 30 degrees, azimuth 45 degrees, ortho) on the review-2 guide canvas: same canvas size and anchor as `assets/source/buildings-v2/guides/review2/<job>-r<v>-plan.json` (plan JSON of `claude/art-guides-review-2`; the coaling stage uses the oblong plan of #524).

Per view, in `<job>/`:

- `<job>-r<v>-lit.png`: the render with the painting projected back onto the model, light corrected for the turn. Paint over this one.
- `<job>-r<v>-bare.png`: the same shape in plain clay, lit from the upper left. Silhouette and form check.
- `<job>-r<v>.json`: the outline polygon (`outline_polygon_px`, canvas px), `base`/`footprint` corners, camera numbers, canvas and anchor, the measures of the fit to the plan, the verdict and the invented surfaces.

How it was made: the painted r0 rectified to the true 2:1 projection with the game converter (`projectionMatrix`/`rectifyProjection` in `tools/illustrated-sprites.mjs`, slopes measured on each picture), ComfyUI image-to-3D (Pixal3D), then headless Blender: painted from the picture, faces lined up with the axes, pose picked among 24 by rendering each against the picture, one uniform scale so the base long side is 0.90 of the footprint, put on the footprint centre. Seen sides are carried over from r0; every side the front view does not show is made up by the reconstruction (plain, soft, sometimes patchy). Painting stays painting: these are scaffolds, not pictures.

Overlap is the outline overlap (intersection over union) between the rectified painting and the model's r0 silhouette after the best scale and shift. A reconstruction below 0.70 would be retried once; none was needed.

| Code | Job (folder) | Source picture | Views | r0 overlap | Verdict | Invented surfaces |
|---|---|---|---|---|---|---|
| C4e | Coaling stage (`fuel_stop`) | buildings-v2 fuel_stop-a0-r0 | r1, r3 | 0.918 | r1: usable, soft in places; r3: usable, soft in places | r1: far legs and feet. r3: far legs. |
| C18a | Big Station (`big_station`) | base-v1/station.png | r1, r2, r3 | 0.920 | r1: usable, soft in places; r2: usable, soft in places; r3: usable, soft in places | r1: long back wall. r2: both walls (back and rear gable). r3: canopy underside, rear gable end. |
| C19a | Town hall (`town`) | base-v1/townhouse-civic.png | r1, r2, r3 | 0.942 | r1: usable, soft in places; r2: usable, soft in places; r3: good | r1: long rear wall. r2: both walls, no features. r3: one gable end. |
| C20a | Warehouse (`warehouse`) | warehouse.png (base-v1), from the pilot | r1, r2, r3 | 0.910 | r1: usable, soft in places; r2: usable, soft in places; r3: good | r1: long back wall. r2: both walls. r3: far end. |
| C21a | Small farm halt (`farm`) | buildings-v2 farm-a0-r0 | r1, r3 | 0.926 | r1: usable, soft in places; r3: usable, soft in places | r1: rear wall of the barn. r3: far wall and rear of the silo. |
| C22a | Big Farm Halt (`big_farm`) | base-v1/farm.png | r1, r2, r3 | 0.938 | r1: good; r2: usable, soft in places; r3: good | r1: silo end wall. r2: both walls. r3: back wall. |
| C23a | Quarry (`quarry`) | buildings-v2 quarry-a0-r0 | r2 | 0.894 | r2: usable, soft in places | r2: both stone walls, the hopper from behind. |
| C24a | Water pump (`pump`) | base-v1/pump.png | r1, r2, r3 | 0.914 | r1: good; r2: usable, soft in places; r3: usable, soft in places | r1: end wall. r2: both walls. r3: back of the flywheel. |
| C25a | Stone grinder (`grinder`) | base-v1/grinder.png | r1, r2, r3 | 0.963 | r1: good; r2: usable, soft in places; r3: usable, soft in places | r1: gable end. r2: both walls. r3: far end. |
| C26a | Oil refinery (`refinery`) | base-v1/refinery.png | r1, r2, r3 | 0.900 | r1: usable, soft in places; r2: usable, soft in places; r3: usable, soft in places | r1/r2/r3: the far sides of the pipe runs, tank ends, back of the furnace frame. |
| C27a | Power plant (`power_plant`) | base-v1/power-plant.png | r1, r2, r3 | 0.935 | r1: good; r2: usable, soft in places; r3: good | r1: long back wall. r2: both walls. r3: rear gable end. |
| C28a | Battery (`substation`) | base-v1/substation.png | r0, r1, r2, r3 | 0.869 | r0: good; r1: usable, soft in places; r2: usable, soft in places; r3: usable, soft in places | r1: rear fins and gantry side. r2: both tank sides. r3: far side. |
| C30a | Colliery (`colliery`) | works-full-colliery | r1, r2, r3 | 0.856 | r1: usable, soft in places; r2: usable, soft in places; r3: usable, soft in places | r1: engine house back wall. r2: both sides, bins from behind. r3: back of the head frame. |
| C31a | Ironworks (`ironworks`) | works-full-ironworks | r1, r2, r3 | 0.935 | r1: usable, soft in places; r2: usable, soft in places; r3: usable, soft in places | r1: far wall. r2: both walls (patchy). r3: open hall seen from the rear. |
| C32a | Oil derrick (`oil_derrick`) | works-full-oil-derrick.png, from the pilot | r1, r2, r3 | 0.756 | r1: usable, soft in places; r2: usable, soft in places; r3: usable, soft in places | tank, back of the beam and lattice. |
| C33a | House (cottage) (`townhouse`) | house-cottage.png, from the pilot | r2, r3 | 0.951 | r2: good; r3: good | r2: rear wall (two windows). r3: far end. |
| R8e | Fuel Pump (`fuel_pump`) | fuel_pump-a1-r0 (art/325-fuel-pump) | r1, r2, r3 | 0.905 | r1: usable, soft in places; r2: usable, soft in places; r3: good | r1: rear wall, hose. r2: both walls. r3: rear wall. |

No job is without a usable scaffold. Skipped on purpose: C29a hydro and C35a narrow depot (no r0 painted yet), the windmill.

Notes:

- The base rule fixes only the long side (0.90 of the footprint). The short side follows the painted body, so the grinder (0.56 of the tile), colliery (0.55 of the long side), house (0.60) and similar fill less of the footprint than the plan base; the station, big farm and power plant stand out of the plan base on the short side (canopy, porch, annex).
- C28a Battery: r0 is the model at the true game camera, for a repainted r0. The painted slab is oblong (1.8 by 1.29 tiles), not the 2 x 2 square of the plan; square it when repainting if it must fill the plan.
- 1536 x 1024 canvases (power plant, battery, colliery, ironworks) render at the plan's scale: 5 and 6 canvas px per game px, not 8.
- Rectifying slopes are measured by eye on each picture's wall bases (listed in each source note in the review page); the converter default is 0.3 / -0.38.
- C20a warehouse, C32a oil derrick and C33a house are the pilot of 2026-10-19, copied unchanged (house r1 was already accepted from Codex).

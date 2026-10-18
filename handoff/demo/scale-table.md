# Building scale, measured again from scratch (demo v9.2, part A, item 9)

Method. Every building picture was cut from the running v9.1 page (the sprite as drawn at Building scale As before,
Building life off) and read in its own texels: the door from its lintel shadow to the foot of its leaf, the eave from
the roof's lower edge to the silhouette's foot in the same column, storeys between string courses. Columns were read
with `col.py` (runs of one colour down a column), against 4x grids (`grid.py`) with a red 9 px person bar. A person is
9 px at zoom 1 = 1.75 m, so 1 m = 5.143 px and 1 px = 0.194 m; a reading is good to one texel (0.2 to 0.5 px).
Targets, read strictly: a door 2.1 m (2.0 to 2.2 accepted), a storey / eave 3.0 m (2.85 to 3.15 accepted). One factor a
picture, never one axis: the geometric mean of its asks (a measure inside its range asks 1), rounded to 0.05, and not
limited to the building's tile. v9's table differed on a few readings (the house's door 2.26 m and the small house's
2.13 m; here all three houses read 2.30 to 2.31 m; the station's gable door 2.50 not 2.44 m; the farm's eave).

| Building | Picture | Door | Eave or storey | Other | Asks | Factor |
|---|---|---|---|---|---|---|
| House (cottage, small, small 2) | townhouse, _2, _3, _s0, _s1, _s2 | 2.30 m | eave 3.02 m (storey inside range) | ridge 5.9 m | door 0.91, eave 1 | **0.95** |
| Town hall | town_2, town_3 | 1.78 m, on 0.8 m of steps | storeys 2.47 and 2.04 m (mean 2.26) | cornice 4.5 m, cupola 10.4 m | door 1.18, storeys 1.33 | **1.25** |
| Station | station_2 | gable door 2.50, platform door 2.21 (mean 2.35); lean-to 1.57 | eave 4.0 m | | door 0.89, eave 0.75 | **0.80** |
| Warehouse | warehouse_1 | goods door 2.27 m | eave 3.2 m | | door 0.93, eave 0.94 | **0.95** |
| Farm halt | farm_2 | 2.84 m | eave 3.9 m (4.4 at the door column, 3.3 above the plinth at the long wall) | | door 0.74, eave 0.77 | **0.75** |
| Water pump | pump_1 | 2.48 m | eave 4.1 m (3.5 above the door's sill) | | door 0.85, eave 0.73 | **0.80** |
| Lumber yard | lumber_2 | none | saw shed eave 3.74 m | | eave 0.80 | **0.80** |
| Quarry | quarry_2 | none | hoist hut eave 3.16 m | stone skip 2.43 m (a quarry skip is 1.4 m) | skip 0.58, hut 0.95 | **0.75** |
| Windmill | windmill | 2.50 m | tower 7.9 m to the cap (about 2.6 floors: true) | | door 0.84, tower 1 | **0.90** |
| Coaling stage | fuel_stop | none | bunker floor 4.0 m (clears a tender) | | 1 | **1** |
| Water tower | water_tower | none | tank floor 2.2 m, spout end 1.3 m, 4.7 m in all | a water tank floor stands 4.5 to 6 m, 8 to 12 m in all | floor 2.05, total 1.70 | **1.85** |
| Fuel Pump (r0; r1 to r3 alike) | building/fuel_pump-a1-r0 | 2.92 m | brick house eave 4.8 m | 13 m in all | door 0.72, eave 0.62 | **0.65** |

Drawn sizes (world px, width x height), As before then Smaller: house 45.6x48.7 to 43.3x46.3; town hall 47.0x61.1 to
58.8x76.4; station 79.0x62.0 to 63.2x49.6; warehouse 46.6x47.6 to 44.2x45.2; farm 74.1x73.6 to 55.6x55.2; water pump
45.5x48.0 to 36.4x38.4; lumber yard 67.4x63.3 to 53.9x50.6; quarry 67.8x86.5 to 50.8x64.9; windmill 78.5x83.4 to
70.7x75.1; Fuel Pump 76.0x75.0 to 49.4x48.8; water tower (the one at 1.0) to 1.85 times that.

What changes against True v9: houses 1 to 0.95, station 1 to 0.8, warehouse 1 to 0.95, lumber yard 1 to 0.8, farm 0.9
to 0.75, pump 0.9 to 0.8, quarry 0.8 to 0.75, Fuel Pump 0.8 to 0.65, town hall 1 to 1.25 (v9 asked 1.5 with its looser
civic door; strictly it asks 1.25), water tower 1.75 to 1.85; windmill 0.9 and coaling stage 1 as in v9. Two pictures
cannot be made true by scaling: the farm's door is large for its walls, and the quarry's stone skip is a wagon twice a
real one's height.

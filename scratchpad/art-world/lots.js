// Candidate art allocations, deliberately separate from simulation footprints.
// Door measurements are approximate logical pixels in the current 4x atlas.
// Target door = 2.1m * 6 world px/m; adult reference = 1.75m * 6 world px/m.
export const metresToPixels = 6;
export const profiles = {
  'structures/station_1': { material: 'stone', w: 3, h: 2, doorPixels: 10.5 },
  'structures/townhouse': { material: 'stone', w: 2, h: 2, doorPixels: 18 },
  'structures/townhouse_2': { material: 'stone', w: 2, h: 2, doorPixels: 18 },
  'structures/town_1': { material: 'stone', w: 3, h: 2, doorPixels: 10 },
  'structures/warehouse_1': { material: 'gravel', w: 3, h: 2, doorPixels: 11 },
  'structures/farm_1': { material: 'dirt', w: 3, h: 2, doorPixels: 12 },
  'structures/windmill': { material: 'dirt', w: 2, h: 2, doorPixels: 13 },
  'structures/water_tower': { material: 'gravel', w: 2, h: 2, scale: 0.7 },
  'structures/fuel_stop': { material: 'gravel', w: 2, h: 2, scale: 0.65 },
  'structures/lumber_1': { material: 'dirt', w: 3, h: 2, doorPixels: 12 },
  'structures/quarry_1': { material: 'gravel', w: 3, h: 2, scale: 1 },
  'structures/refinery': { material: 'gravel', w: 3, h: 2, scale: 1.1 },
  'structures/power_plant': { material: 'gravel', w: 3, h: 2, scale: 1.1 },
  'structures/substation': { material: 'gravel', w: 2, h: 2, scale: 1 },
  'structures/grinder': { material: 'gravel', w: 2, h: 2, doorPixels: 12 },
  'structures/kiln': { material: 'dirt', w: 2, h: 2, scale: 1 },
  'structures/pump_1': { material: 'gravel', w: 2, h: 2, scale: 1 },
  'structures/ironworks': { material: 'gravel', w: 3, h: 2, scale: 1 },
  'structures/colliery': { material: 'gravel', w: 3, h: 2, scale: 1 },
};
export const visualScale = (key) => {
  const p = profiles[key];
  return p?.doorPixels ? (2.1 * metresToPixels) / p.doorPixels : (p?.scale ?? 1);
};

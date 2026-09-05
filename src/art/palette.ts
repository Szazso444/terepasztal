/** Shared muted palette. Colours are [r,g,b]. Keep placeholders and real art on the same palette. */
export type RGB = readonly [number, number, number];

export const PAL = {
  // terrain
  grass: [
    [62, 78, 46],
    [72, 90, 54],
    [54, 68, 40],
    [80, 98, 60],
  ] as RGB[],
  forestFloor: [
    [48, 62, 38],
    [56, 72, 44],
    [40, 52, 32],
    [60, 76, 48],
  ] as RGB[],
  hill: [
    [104, 96, 66],
    [118, 110, 78],
    [90, 84, 58],
    [128, 120, 88],
  ] as RGB[],
  hillSideL: [80, 70, 48] as RGB,
  hillSideR: [64, 56, 38] as RGB,
  water: [
    [34, 52, 70],
    [40, 60, 80],
    [28, 44, 60],
    [46, 70, 92],
  ] as RGB[],
  rock: [
    [88, 86, 80],
    [98, 96, 90],
    [74, 72, 66],
    [108, 106, 100],
  ] as RGB[],
  sand: [
    [140, 126, 90],
    [150, 136, 100],
    [126, 112, 78],
  ] as RGB[],
  // vegetation
  leaf: [
    [46, 72, 40],
    [60, 90, 50],
    [36, 56, 32],
    [74, 104, 58],
  ] as RGB[],
  pine: [
    [38, 62, 42],
    [48, 78, 52],
    [28, 46, 32],
    [60, 92, 62],
  ] as RGB[],
  trunk: [74, 54, 36] as RGB,
  trunkDark: [50, 36, 24] as RGB,
  // rails and structures
  rail: [110, 114, 120] as RGB,
  railDark: [70, 74, 80] as RGB,
  railLight: [150, 154, 160] as RGB,
  sleeper: [78, 62, 44] as RGB,
  sleeperDark: [54, 42, 30] as RGB,
  ballast: [
    [88, 84, 76],
    [100, 96, 88],
    [76, 72, 64],
  ] as RGB[],
  stone: [
    [96, 92, 86],
    [112, 108, 100],
    [80, 76, 70],
  ] as RGB[],
  timber: [
    [112, 84, 54],
    [128, 98, 64],
    [92, 68, 44],
  ] as RGB[],
  roof: [
    [96, 52, 40],
    [112, 62, 46],
    [78, 42, 32],
  ] as RGB[],
  roofSlate: [
    [70, 74, 84],
    [84, 88, 98],
    [56, 60, 70],
  ] as RGB[],
  iron: [
    [62, 64, 70],
    [78, 80, 86],
    [46, 48, 54],
    [96, 98, 104],
  ] as RGB[],
  rust: [
    [122, 72, 44],
    [140, 86, 54],
    [98, 58, 36],
  ] as RGB[],
  brass: [176, 140, 72] as RGB,
  // accents
  amber: [224, 160, 64] as RGB,
  amberDark: [160, 104, 32] as RGB,
  cyan: [96, 200, 216] as RGB,
  cyanDark: [48, 120, 136] as RGB,
  red: [160, 56, 48] as RGB,
  outline: [18, 18, 16] as RGB,
  white: [220, 214, 196] as RGB,
  // cargo
  cargoGrain: [196, 168, 86] as RGB,
  cargoWood: [132, 96, 58] as RGB,
  cargoOre: [110, 100, 92] as RGB,
  cargoCoal: [40, 40, 42] as RGB,
  cargoGoods: [150, 120, 80] as RGB,
  cargoSteel: [150, 156, 166] as RGB,
  cargoOil: [40, 36, 40] as RGB,
  cargoStone: [130, 126, 118] as RGB,
} as const;

export function shade(c: RGB, f: number): RGB {
  return [clamp(c[0] * f), clamp(c[1] * f), clamp(c[2] * f)];
}
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    clamp(a[0] + (b[0] - a[0]) * t),
    clamp(a[1] + (b[1] - a[1]) * t),
    clamp(a[2] + (b[2] - a[2]) * t),
  ];
}
function clamp(v: number) {
  return Math.max(0, Math.min(255, Math.round(v)));
}
export function css(c: RGB): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
export function hex(c: RGB): number {
  return (c[0] << 16) | (c[1] << 8) | c[2];
}

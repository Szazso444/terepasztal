/** Shared muted palette. Colours are [r,g,b]. Keep placeholders and real art on the same palette. */
export type RGB = readonly [number, number, number];

export const PAL = {
  // terrain
  grass: [
    [81, 108, 68],
    [90, 118, 76],
    [72, 98, 62],
    [104, 130, 86],
  ] as RGB[],
  forestFloor: [
    [57, 81, 58],
    [66, 92, 65],
    [48, 70, 51],
    [76, 102, 72],
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
    [48, 88, 103],
    [59, 102, 117],
    [40, 76, 92],
    [72, 116, 128],
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
    [65, 103, 67],
    [82, 126, 78],
    [49, 84, 59],
    [104, 143, 86],
  ] as RGB[],
  pine: [
    [44, 87, 73],
    [60, 106, 87],
    [35, 70, 62],
    [76, 122, 98],
  ] as RGB[],
  trunk: [74, 54, 36] as RGB,
  trunkDark: [50, 36, 24] as RGB,
  // rails and structures
  rail: [110, 114, 120] as RGB,
  railDark: [70, 74, 80] as RGB,
  railLight: [183, 199, 198] as RGB,
  sleeper: [78, 62, 44] as RGB,
  sleeperDark: [54, 42, 30] as RGB,
  ballast: [
    [88, 84, 76],
    [100, 96, 88],
    [76, 72, 64],
  ] as RGB[],
  stone: [
    [131, 126, 111],
    [148, 143, 125],
    [112, 109, 98],
  ] as RGB[],
  timber: [
    [144, 106, 66],
    [165, 126, 80],
    [117, 83, 53],
  ] as RGB[],
  roof: [
    [142, 75, 57],
    [167, 91, 66],
    [115, 60, 48],
  ] as RGB[],
  roofSlate: [
    [66, 91, 103],
    [83, 110, 119],
    [51, 72, 86],
  ] as RGB[],
  iron: [
    [68, 81, 88],
    [85, 101, 108],
    [49, 62, 70],
    [112, 127, 132],
  ] as RGB[],
  rust: [
    [122, 72, 44],
    [140, 86, 54],
    [98, 58, 36],
  ] as RGB[],
  brass: [210, 166, 88] as RGB,
  // accents
  amber: [224, 160, 64] as RGB,
  amberDark: [160, 104, 32] as RGB,
  cyan: [96, 200, 216] as RGB,
  cyanDark: [48, 120, 136] as RGB,
  red: [160, 56, 48] as RGB,
  outline: [26, 36, 37] as RGB,
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

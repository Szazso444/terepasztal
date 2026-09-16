/**
 * Shared palette: pastoral industry, folk warmth and quiet ambition. Colours are [r,g,b].
 *
 * The seeds (docs/art-direction) are forest #294638, moss #78804C, oat #E4D5B5, limestone
 * #BCA98B, slate #626B6C, water #477B82 and copper #A36B42. Every material below is three or
 * four shades of one of those families under a single upper-left light: index 0 is the base,
 * 1 the lit shade, 2 the shadow, 3 (where present) the brightest top face. Semantic colours
 * (warning, danger, selection, valid placement) stay brighter than any scenery colour.
 */
export type RGB = readonly [number, number, number];

export const PAL = {
  // terrain
  grass: [
    [122, 146, 76],
    [134, 158, 84],
    [108, 130, 68],
    [146, 170, 94],
  ] as RGB[],
  forestFloor: [
    [80, 102, 56],
    [92, 114, 64],
    [68, 88, 50],
    [102, 124, 72],
  ] as RGB[],
  hill: [
    [148, 130, 90],
    [160, 142, 100],
    [132, 116, 80],
    [172, 154, 110],
  ] as RGB[],
  hillSideL: [130, 108, 72] as RGB,
  hillSideR: [104, 86, 58] as RGB,
  water: [
    [72, 124, 132],
    [84, 138, 146],
    [62, 110, 120],
    [100, 158, 162],
  ] as RGB[],
  rock: [
    [140, 136, 126],
    [154, 150, 140],
    [120, 116, 106],
    [170, 166, 156],
  ] as RGB[],
  sand: [
    [214, 196, 150],
    [226, 210, 166],
    [198, 180, 136],
  ] as RGB[],
  // vegetation
  leaf: [
    [90, 134, 68],
    [110, 154, 80],
    [70, 110, 58],
    [132, 172, 94],
  ] as RGB[],
  pine: [
    [54, 98, 78],
    [68, 116, 92],
    [42, 80, 66],
    [86, 134, 106],
  ] as RGB[],
  trunk: [112, 80, 50] as RGB,
  trunkDark: [78, 54, 34] as RGB,
  // rails and structures
  rail: [128, 132, 136] as RGB,
  railDark: [82, 86, 90] as RGB,
  railLight: [200, 206, 208] as RGB,
  sleeper: [124, 92, 58] as RGB,
  sleeperDark: [88, 64, 40] as RGB,
  ballast: [
    [152, 146, 134],
    [166, 160, 148],
    [136, 130, 118],
  ] as RGB[],
  /** cream limestone masonry */
  stone: [
    [188, 169, 139],
    [206, 190, 162],
    [164, 146, 118],
  ] as RGB[],
  timber: [
    [158, 116, 70],
    [180, 136, 86],
    [132, 94, 56],
  ] as RGB[],
  /** warm clay tile roof */
  roof: [
    [154, 88, 62],
    [176, 104, 74],
    [128, 70, 50],
  ] as RGB[],
  roofSlate: [
    [98, 107, 108],
    [116, 126, 128],
    [78, 86, 88],
  ] as RGB[],
  iron: [
    [86, 96, 102],
    [104, 116, 122],
    [64, 72, 78],
    [132, 144, 148],
  ] as RGB[],
  rust: [
    [138, 84, 52],
    [158, 100, 64],
    [112, 66, 42],
  ] as RGB[],
  copper: [
    [163, 107, 66],
    [186, 128, 84],
    [134, 86, 52],
  ] as RGB[],
  brass: [214, 172, 92] as RGB,
  // accents
  amber: [232, 170, 72] as RGB,
  amberDark: [172, 112, 40] as RGB,
  cyan: [102, 204, 214] as RGB,
  cyanDark: [54, 132, 146] as RGB,
  red: [176, 58, 48] as RGB,
  /** soft contour: a dark green-grey, never black */
  outline: [40, 46, 40] as RGB,
  white: [236, 228, 208] as RGB,
  // cargo
  cargoGrain: [212, 180, 92] as RGB,
  cargoWood: [148, 108, 64] as RGB,
  cargoOre: [124, 112, 100] as RGB,
  cargoCoal: [44, 44, 46] as RGB,
  cargoGoods: [166, 132, 88] as RGB,
  cargoSteel: [160, 166, 176] as RGB,
  cargoOil: [44, 40, 44] as RGB,
  cargoStone: [172, 160, 138] as RGB,
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

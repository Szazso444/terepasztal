/** Cool taiga, muddy swamp, pale desert: tint the terrain colour by biome (grass/forest only). */
export function biomeShade(css: string, biome: number, terrain: number): string {
  if (terrain !== 0 && terrain !== 1) return css;
  const m = /^#([0-9a-f]{6})$/i.exec(css);
  if (!m) return css;
  let r = parseInt(m[1].slice(0, 2), 16);
  let g = parseInt(m[1].slice(2, 4), 16);
  let b = parseInt(m[1].slice(4, 6), 16);
  if (biome === 0) {
    r += 18;
    g += 14;
  } else if (biome === 3) {
    r -= 10;
    b += 22;
  } else if (biome === 4) {
    r += 10;
    g -= 14;
    b -= 10;
  } else if (biome === 2) {
    r += 40;
    g += 24;
  }
  const c = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

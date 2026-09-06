import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { PAL, shade, type RGB } from './palette';
import { PixelBuf } from './pixels';

const S = 16;

/** Water drop. */
function water(): PixelBuf {
  const b = new PixelBuf(S, S);
  const c: RGB[] = [PAL.water[3], [70, 110, 140], PAL.water[1]];
  for (let y = 2; y < 14; y++) {
    const t = (y - 2) / 11;
    const hw =
      y < 8 ? Math.round(t * 5) : Math.round(Math.sqrt(Math.max(0, 1 - ((y - 9) / 5) ** 2)) * 4.5);
    for (let x = 8 - hw; x <= 8 + hw - 1; x++) b.set(x, y, x < 7 ? c[0] : x > 9 ? c[2] : c[1]);
  }
  b.set(6, 9, PAL.white);
  b.set(6, 10, PAL.white);
  b.outline(PAL.outline, 220);
  return b;
}
/** Ear of wheat. */
function wheat(): PixelBuf {
  const b = new PixelBuf(S, S);
  b.line(8, 15, 8, 5, PAL.timber[1]);
  const g: RGB[] = [PAL.cargoGrain, shade(PAL.cargoGrain, 1.15), shade(PAL.cargoGrain, 0.8)];
  for (let i = 0; i < 4; i++) {
    const y = 3 + i * 2;
    b.rect(8 - 3, y + 1, 3, 2, g[i % 3]);
    b.rect(8 + 1, y, 3, 2, g[(i + 1) % 3]);
    b.set(8 - 4, y + 1, g[2]);
    b.set(8 + 4, y, g[1]);
  }
  b.rect(7, 1, 3, 2, g[1]);
  b.outline(PAL.outline, 220);
  return b;
}
/** Rock. */
function stone(): PixelBuf {
  const b = new PixelBuf(S, S);
  b.ellipse(8, 9, 6, 4.5, PAL.rock, 3, 0.5);
  b.rect(5, 5, 5, 3, PAL.rock[3]);
  b.set(4, 8, PAL.rock[2]);
  b.rect(9, 10, 4, 2, PAL.rock[2]);
  b.outline(PAL.outline, 220);
  return b;
}
/** Log, seen end-on with rings. */
function wood(): PixelBuf {
  const b = new PixelBuf(S, S);
  b.rect(3, 5, 10, 7, PAL.trunk);
  b.rect(3, 11, 10, 2, PAL.trunkDark);
  b.ellipse(12, 8, 3, 4, [PAL.sand[1], PAL.sand[0]], 4, 0.2);
  b.set(12, 8, PAL.trunk);
  b.rect(4, 7, 6, 1, PAL.trunkDark);
  b.outline(PAL.outline, 220);
  return b;
}
/** Lump of coal. */
function coal(): PixelBuf {
  const b = new PixelBuf(S, S);
  const c: RGB[] = [
    [40, 40, 44],
    [58, 58, 64],
    [28, 28, 32],
  ];
  b.ellipse(8, 9, 6, 5, c, 5, 0.5);
  b.rect(5, 5, 3, 2, c[1]);
  b.set(10, 7, [90, 90, 98]);
  b.set(6, 11, c[2]);
  b.outline(PAL.outline, 220);
  return b;
}
/** Oil barrel. */
function oil(): PixelBuf {
  const b = new PixelBuf(S, S);
  const d: RGB[] = [
    [52, 46, 52],
    [68, 60, 68],
    [40, 34, 40],
  ];
  b.rect(4, 3, 8, 11, d[0]);
  b.rect(4, 3, 3, 11, d[1]);
  b.rect(10, 3, 2, 11, d[2]);
  b.rect(3, 5, 10, 1, PAL.iron[3]);
  b.rect(3, 11, 10, 1, PAL.iron[3]);
  b.rect(5, 2, 6, 1, d[1]);
  b.set(7, 8, PAL.amber);
  b.set(8, 8, PAL.amber);
  b.outline(PAL.outline, 220);
  return b;
}
/** Iron ingot. */
function iron(): PixelBuf {
  const b = new PixelBuf(S, S);
  const s: RGB[] = [PAL.cargoSteel, shade(PAL.cargoSteel, 1.2), shade(PAL.cargoSteel, 0.75)];
  for (let y = 5; y < 12; y++) {
    const w = 4 + Math.round((y - 5) * 0.6);
    for (let x = 8 - w; x < 8 + w; x++) b.set(x, y, y < 7 ? s[1] : x > 8 + w - 3 ? s[2] : s[0]);
  }
  b.rect(5, 4, 6, 1, s[1]);
  b.outline(PAL.outline, 220);
  return b;
}
/** Lightning bolt. */
function power(): PixelBuf {
  const b = new PixelBuf(S, S);
  const pts: [number, number][] = [
    [9, 1],
    [4, 8],
    [8, 8],
    [6, 15],
    [12, 6],
    [8, 6],
    [10, 1],
  ];
  for (let y = 1; y < 15; y++)
    for (let x = 2; x < 14; x++) {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (
          yi > y + 0.5 !== yj > y + 0.5 &&
          x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi
        )
          inside = !inside;
      }
      if (inside) b.set(x, y, x < 8 ? PAL.amber : PAL.amberDark);
    }
  b.outline(PAL.outline, 220);
  return b;
}
/** Coin stack. */
function money(): PixelBuf {
  const b = new PixelBuf(S, S);
  const g: RGB[] = [PAL.brass, shade(PAL.brass, 1.2), shade(PAL.brass, 0.8)];
  for (let i = 0; i < 4; i++) {
    b.ellipse(8, 12 - i * 2, 5, 2, g, 6 + i, 0.2);
  }
  b.ellipse(8, 5, 5, 2, [g[1], g[0]], 9, 0.1);
  b.outline(PAL.outline, 220);
  return b;
}

export function generateIconsAtlas(): AtlasImage {
  const ab = new AtlasBuilder();
  const gens: Record<string, () => PixelBuf> = {
    water,
    wheat,
    stone,
    wood,
    coal,
    oil,
    iron,
    power,
    money,
  };
  for (const [id, g] of Object.entries(gens)) ab.add(`icons/${id}`, g().toImageData(), 8, 8);
  return ab.build(128);
}

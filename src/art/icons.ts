import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { PAL, shade, type RGB } from './palette';
import { PixelBuf } from './pixels';

const S = 16;

/** Row widths (odd, centred on x=8) of a droplet: pointed top, rounded bottom. Rows y=1..14. */
const DROP_ROWS = [1, 1, 3, 3, 5, 5, 7, 7, 9, 9, 9, 9, 7, 5];

/** Droplet silhouette shaded left-light / right-dark with a small glossy highlight. */
function droplet(shades: [RGB, RGB, RGB], hi: RGB): PixelBuf {
  const b = new PixelBuf(S, S);
  DROP_ROWS.forEach((w, i) => {
    const y = i + 1;
    const hw = (w - 1) / 2;
    for (let x = 8 - hw; x <= 8 + hw; x++)
      b.set(x, y, x < 7 ? shades[0] : x > 9 ? shades[2] : shades[1]);
  });
  b.set(6, 8, hi);
  b.set(6, 9, hi);
  b.set(5, 10, hi);
  b.outline(PAL.outline, 220);
  return b;
}
/** Water drop: clear blue, bright white highlight. */
function water(): PixelBuf {
  return droplet(
    [
      [96, 156, 214],
      [64, 122, 186],
      [40, 88, 148],
    ],
    [236, 244, 250],
  );
}
/** Oil drop: near-black with a subtle grey gloss. */
function oil(): PixelBuf {
  return droplet(
    [
      [64, 60, 66],
      [42, 38, 42],
      [26, 24, 28],
    ],
    [128, 122, 132],
  );
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

/** 3x5 glyphs, one string per row, '#' = ink. */
const GLYPH_F = ['###', '#..', '##.', '#..', '#..'];
const GLYPH_e = ['.##', '#.#', '###', '#..', '.##'];
function glyph(b: PixelBuf, rows: string[], x0: number, y0: number, c: RGB) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') b.set(x0 + x, y0 + y, c);
  });
}
/** Iron ingot: silver bar stamped "Fe". */
function iron(): PixelBuf {
  const b = new PixelBuf(S, S);
  const s: RGB[] = [PAL.cargoSteel, shade(PAL.cargoSteel, 1.25), shade(PAL.cargoSteel, 0.72)];
  // trapezoid bar: narrower on top, 7 rows tall
  for (let y = 4; y < 12; y++) {
    const inset = y < 6 ? 1 : 0;
    for (let x = 2 + inset; x < 14 - inset; x++) {
      b.set(x, y, y < 6 ? s[1] : x >= 12 ? s[2] : y === 11 ? s[2] : s[0]);
    }
  }
  b.set(2, 6, s[1]);
  const ink: RGB = [38, 40, 46];
  glyph(b, GLYPH_F, 4, 6, ink);
  glyph(b, GLYPH_e, 8, 6, ink);
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

const PERSON: RGB = [206, 178, 140];
const PERSON_DARK: RGB = [168, 140, 104];
/** Bust silhouette: round head over rounded shoulders. `hw` = shoulder half-width, `r` = head radius. */
function bust(b: PixelBuf, cx: number, top: number, r: number, hw: number, c: RGB, dark: RGB) {
  // head
  for (let y = 0; y < r * 2; y++)
    for (let x = 0; x < r * 2; x++) {
      const nx = (x + 0.5 - r) / r;
      const ny = (y + 0.5 - r) / r;
      if (nx * nx + ny * ny <= 1) b.set(cx - r + x, top + y, c);
    }
  // shoulders / torso: rounded top corners, flat bottom at y=14
  const y0 = top + r * 2 + 1;
  for (let y = y0; y < 15; y++) {
    const shrink = y === y0 ? 1 : 0;
    for (let x = cx - hw + shrink; x < cx + hw - shrink; x++)
      b.set(x, y, x >= cx + hw - 2 ? dark : c);
  }
}
/** Two people side by side. */
function passengers(): PixelBuf {
  const b = new PixelBuf(S, S);
  bust(b, 11, 3, 2, 3, PERSON_DARK, shade(PERSON_DARK, 0.85));
  bust(b, 5, 3, 2, 3, PERSON, PERSON_DARK);
  b.outline(PAL.outline, 220);
  return b;
}
/** A single person. */
function population(): PixelBuf {
  const b = new PixelBuf(S, S);
  bust(b, 8, 1, 3, 5, PERSON, PERSON_DARK);
  b.outline(PAL.outline, 220);
  return b;
}

/** Ore lump: base shades with a few glints of the metal. */
function oreLump(base: RGB[], glint: RGB, seed: number): PixelBuf {
  const b = new PixelBuf(S, S);
  b.ellipse(8, 9, 6, 5, base, seed, 0.5);
  b.rect(5, 5, 3, 2, base[1]);
  b.set(10, 7, glint);
  b.set(7, 10, glint);
  b.set(11, 11, shade(glint, 0.8));
  b.set(6, 12, base[2]);
  b.outline(PAL.outline, 220);
  return b;
}
/** Iron ore: rusty brown lump with silver flecks. */
function ironOre(): PixelBuf {
  return oreLump(
    [
      [124, 84, 60],
      [148, 104, 72],
      [92, 62, 44],
    ],
    [176, 180, 188],
    11,
  );
}
/** Copper ore: dull brown lump with verdigris and copper glints. */
function copperOre(): PixelBuf {
  const b = oreLump(
    [
      [110, 88, 62],
      [128, 104, 72],
      [84, 66, 46],
    ],
    [206, 130, 70],
    13,
  );
  b.set(9, 10, [78, 142, 110]);
  b.set(5, 8, [78, 142, 110]);
  return b;
}
/** Crude oil: brown-black drop with a dull olive gloss. */
function crude(): PixelBuf {
  return droplet(
    [
      [76, 64, 42],
      [50, 42, 28],
      [30, 26, 18],
    ],
    [128, 116, 74],
  );
}
/** Diesel: amber drop with a pale highlight. */
function diesel(): PixelBuf {
  return droplet(
    [
      [214, 172, 72],
      [172, 130, 46],
      [122, 90, 32],
    ],
    [244, 226, 168],
  );
}
/** Sand: a low heap with a few grains around it. */
function sand(): PixelBuf {
  const b = new PixelBuf(S, S);
  for (let y = 0; y < 7; y++) {
    const hw = 1 + y;
    for (let x = 8 - hw; x <= 8 + hw; x++)
      b.set(x, 6 + y, x < 7 ? PAL.sand[1] : x > 9 ? PAL.sand[2] : PAL.sand[0]);
  }
  b.set(3, 13, PAL.sand[2]);
  b.set(13, 12, PAL.sand[2]);
  b.set(12, 14, PAL.sand[1]);
  b.set(7, 7, shade(PAL.sand[1], 1.15));
  b.outline(PAL.outline, 220);
  return b;
}
/** Wire: a coil of copper, seen from the side. */
function wire(): PixelBuf {
  const b = new PixelBuf(S, S);
  const cu: RGB[] = [
    [196, 122, 66],
    [222, 150, 88],
    [150, 90, 48],
  ];
  for (let i = 0; i < 4; i++)
    b.ellipse(8, 5 + i * 2, 5.5, 2.2, [cu[1], cu[0], cu[2]], 20 + i, 0.15);
  b.ellipse(8, 4, 5.5, 2.2, [cu[2], cu[0]], 25, 0.1);
  b.rect(7, 3, 3, 1, PAL.iron[1]);
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
    passengers,
    population,
    iron_ore: ironOre,
    copper_ore: copperOre,
    crude,
    diesel,
    sand,
    wire,
  };
  for (const [id, g] of Object.entries(gens)) ab.add(`icons/${id}`, g().toImageData(), 8, 8);
  return ab.build(128);
}

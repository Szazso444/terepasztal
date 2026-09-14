import type { AtlasBuilder } from '../engine/atlas';
import { PixelBuf } from './pixels';
import { mix, PAL, type RGB } from './palette';
import { drawPrism, fillPoly } from './iso3d';

const OX = 48,
  OY = 38;
/** Connected timber trusses and masonry arches. Decks are below track; near rails occlude wheels. */
function span(
  material: 'wood' | 'stone',
  axis: number,
  n: number,
  phase: number,
  edge: number,
  rail: boolean,
) {
  const b = new PixelBuf(96, 88);
  const pt = (l: number, w: number, z: number) => {
    const x = axis ? l : w,
      y = axis ? w : l;
    return { x: OX + (x - y) * 32, y: OY + (x + y) * 16 - z };
  };
  const line = (
    l: number,
    w: number,
    z: number,
    l2: number,
    w2: number,
    z2: number,
    c: RGB,
    thick = 1,
  ) => {
    const a = pt(l, w, z),
      d = pt(l2, w2, z2);
    for (let k = 0; k < thick; k++) b.line(a.x, a.y + k, d.x, d.y + k, c);
  };
  const stone = material === 'stone';
  const side = stone ? PAL.stone : PAL.timber;
  const pier = (l: number, w: number) => {
    const p = pt(l, w, -26);
    const support = new PixelBuf(b.w, b.h);
    drawPrism(support, {
      ox: OX,
      oy: OY,
      cx: axis ? l : w,
      cy: axis ? w : l,
      angle: axis ? 0 : Math.PI / 2,
      len: stone ? 0.15 : 0.075,
      wid: stone ? 0.16 : 0.075,
      z0: -32,
      h: 28,
      top: side,
      side,
      seed: 19,
    });
    // The water hides the foot: damp masonry/timber gives way to a translucent reflection.
    for (let y = 0; y < support.h; y++)
      for (let x = 0; x < support.w; x++) {
        const c = support.get(x, y);
        if (!c) continue;
        const depth = y - p.y;
        if (depth > 5) continue;
        b.set(
          x,
          y,
          mix(c, PAL.water[2], depth >= 0 ? 0.7 : depth > -4 ? 0.3 : 0),
          depth >= 0 ? Math.round(150 * (1 - depth / 6)) : 255,
        );
      }
    // Broken, shallow ripples meet the wet edge without drawing a solid ring around the pier.
    b.line(p.x - 6, p.y, p.x - 3, p.y + 1, PAL.water[3]);
    b.line(p.x + 2, p.y + 2, p.x + 6, p.y + 1, PAL.water[1]);
  };
  if (!rail) {
    drawPrism(b, {
      ox: OX,
      oy: OY,
      cx: 0,
      cy: 0,
      angle: axis ? 0 : Math.PI / 2,
      len: 1,
      wid: 0.68,
      z0: -4,
      h: 4,
      top: side,
      side,
      seed: 71,
    });
    // A continuous arch below the deck, with supports at span ends and every fourth tile.
    for (const w of [-0.26, 0.26]) {
      const start = (edge & 1) !== 0 || phase === 0;
      const end = (edge & 2) !== 0 || phase === n - 1;
      if (start) pier(-0.46, w);
      if (end) pier(0.46, w);
      if (stone) {
        const arc = (v: number) =>
          -25 + 19 * Math.sin(Math.PI * Math.min(1, (phase + v + 0.5) / n));
        const wall = [pt(-0.5, w, -4), pt(0.5, w, -4)];
        for (let q = 16; q >= 0; q--) {
          const l = -0.5 + q / 16;
          wall.push(pt(l, w, arc(l)));
        }
        fillPoly(b, wall, (x, y) =>
          y % 5 === 0 || (x + Math.floor(y / 5) * 4) % 9 === 0 ? side[2] : side[1],
        );
        for (let q = 0; q < 16; q++) {
          const l = -0.5 + q / 16,
            l2 = l + 1 / 16;
          line(l, w, arc(l), l2, w, arc(l2), side[0], 4);
        }
      } else {
        if (start) line(-0.46, w, -23, 0.42, w, -6, side[1], 2);
        if (end) line(-0.42, w, -6, 0.46, w, -23, side[1], 2);
      }
    }
  }
  // Far fence belongs to the deck pass. Near fence belongs to the object pass.
  const w = rail ? 0.32 : -0.32;
  if (stone) {
    line(-0.5, w, 2, 0.5, w, 2, side[1], 3);
    for (const l of [-0.5, 0, 0.5]) line(l, w, 0, l, w, 4, side[0], 2);
  } else {
    const height = (v: number) =>
      n === 1 ? 9 : Math.min(15, 6 + Math.min(phase + v + 0.5, n - phase - v - 0.5) * 10);
    line(-0.5, w, 1, 0.5, w, 1, side[2], 2);
    line(-0.5, w, height(-0.5), 0.5, w, height(0.5), side[1], 2);
    line(-0.5, w, 1, 0.5, w, height(0.5), side[0], 2);
    line(-0.5, w, height(-0.5), 0.5, w, 1, side[2], 2);
    line(-0.5, w, 1, -0.5, w, height(-0.5), side[1], 2);
  }
  return b;
}
function reinforcement(material: 'wood' | 'stone', axis: number, level: number, rail: boolean) {
  const b = new PixelBuf(96, 88);
  const colour = material === 'wood' ? PAL.iron : PAL.stone;
  for (const w of rail ? [0.32] : [-0.32])
    for (let k = 0; k < level - 1; k++) {
      const l = (k - (level - 2) / 2) * 0.28;
      const x = axis ? l : w,
        y = axis ? w : l;
      drawPrism(b, {
        ox: OX,
        oy: OY,
        cx: x,
        cy: y,
        angle: axis ? 0 : Math.PI / 2,
        len: 0.1,
        wid: 0.09,
        z0: -5,
        h: material === 'wood' ? 13 : 10,
        top: colour,
        side: colour,
        seed: 82 + k,
      });
    }
  return b;
}
export function addBridgeFrames(ab: AtlasBuilder) {
  for (const material of ['wood', 'stone'] as const) {
    const preview = new PixelBuf(160, 120);
    for (let phase = 0; phase < 3; phase++) {
      const edge = phase === 0 ? 1 : phase === 2 ? 2 : 0;
      const dx = phase * 32,
        dy = phase * 16;
      preview.blit(span(material, 1, 3, phase, edge, false), dx, dy);
      preview.blit(span(material, 1, 3, phase, edge, true), dx, dy);
    }
    ab.add('structures/bridge_' + material, preview.toImageData(), OX + 32, OY + 16);
    for (let axis = 0; axis < 2; axis++)
      for (let level = 2; level <= 4; level++)
        for (const rail of [false, true])
          ab.add(
            `structures/bridge_detail_${material}_${axis}_${level}_${rail ? 'rail' : 'deck'}`,
            reinforcement(material, axis, level, rail).toImageData(),
            OX,
            OY,
          );
    for (let axis = 0; axis < 2; axis++)
      for (let n = 1; n <= 4; n++)
        for (let phase = 0; phase < 4; phase++)
          for (let edge = 0; edge < 4; edge++)
            for (const rail of [false, true])
              ab.add(
                `structures/span_${material}_${axis}_${n}_${phase}_${edge}_${rail ? 'rail' : 'deck'}`,
                span(material, axis, n, phase, edge, rail).toImageData(),
                OX,
                OY,
              );
  }
}

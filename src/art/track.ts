import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { Dir } from '../engine/iso';
import { hash2 } from '../engine/rng';
import { PAL, mix, shade, type RGB } from './palette';
import { PixelBuf } from './pixels';
import { proj } from './iso3d';
import { linkPoints, unitDef } from '../world/trackGeom';
import type { Vec2 } from '../engine/iso';
import {
  TRACK_ITEMS,
  CLASS_N,
  itemKey,
  isUnitKind,
  pieceLinks,
  rotationCount,
  type TrackClass,
  type TrackKind,
  type Link,
} from '../world/track';

const W = 64;
const H = 40; // a little taller than the tile for bridge posts
const OX = 32;
const OY = 16;

interface RailStyle {
  ballast: boolean;
  seed: number;
  /** high-speed: concrete sleepers, wider ballast shoulder, brighter rail */
  cls?: TrackClass;
}
function drawLinkRails(b: PixelBuf, link: Link, opts: RailStyle) {
  drawRails(b, linkPoints(link[0], link[1], 24), opts);
}
function drawRails(b: PixelBuf, pts: Vec2[], opts: RailStyle) {
  const gauge = 0.16; // half-gauge in tile units
  const hs = opts.cls === 'high_speed';
  const shoulder = hs ? 0.4 : 0.32;
  const sleeper: RGB = hs ? [150, 150, 146] : PAL.sleeper;
  const sleeperDark: RGB = hs ? [110, 110, 108] : PAL.sleeperDark;
  // ballast band
  if (opts.ballast) {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[Math.min(pts.length - 1, i + 1)];
      const r = pts[Math.max(0, i - 1)];
      const dx = q.x - r.x;
      const dy = q.y - r.y;
      const l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l;
      const ny = dx / l;
      for (let s = -shoulder; s <= shoulder; s += 0.03) {
        const sp = proj(OX, OY, p.x + nx * s, p.y + ny * s);
        const px = Math.floor(sp.x);
        const py = Math.floor(sp.y);
        const n = hash2(px >> 1, py >> 1, opts.seed);
        const c = mix(PAL.ballast[0], PAL.ballast[Math.min(2, Math.floor(n * 3))], 0.25);
        b.set(px, py, Math.abs(s) > shoulder - 0.06 ? shade(c, 0.85) : c);
      }
    }
  }
  // Constant arc spacing also holds across the densely sampled high-speed geometry.
  let distance = 0;
  let nextSleeper = 0.07;
  for (let i = 1; i < pts.length - 1; i++) {
    const a0 = pts[i - 1];
    const b0 = pts[i];
    const step = Math.hypot(b0.x - a0.x, b0.y - a0.y);
    distance += step;
    if (distance < nextSleeper || step < 1e-8) continue;
    const t = 1 - (distance - nextSleeper) / step;
    const p = { x: a0.x + (b0.x - a0.x) * t, y: a0.y + (b0.y - a0.y) * t };
    nextSleeper += 0.14;
    const q = pts[i + 1];
    const r = pts[i - 1];
    const dx = q.x - r.x;
    const dy = q.y - r.y;
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l;
    const ny = dx / l;
    const a = proj(OX, OY, p.x + nx * 0.24, p.y + ny * 0.24);
    const c = proj(OX, OY, p.x - nx * 0.24, p.y - ny * 0.24);
    b.line(Math.round(a.x), Math.round(a.y), Math.round(c.x), Math.round(c.y), sleeper);
    b.line(Math.round(a.x), Math.round(a.y) + 1, Math.round(c.x), Math.round(c.y) + 1, sleeperDark);
  }
  // rails: dark then light highlight one px up
  for (const side of [-gauge, gauge]) {
    const rail: { x: number; y: number }[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[Math.min(pts.length - 1, i + 1)];
      const r = pts[Math.max(0, i - 1)];
      const dx = q.x - r.x;
      const dy = q.y - r.y;
      const l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l;
      const ny = dx / l;
      const sp = proj(OX, OY, p.x + nx * side, p.y + ny * side);
      rail.push({ x: Math.round(sp.x), y: Math.round(sp.y) });
    }
    for (let i = 0; i + 1 < rail.length; i++)
      b.line(rail[i].x, rail[i].y + 1, rail[i + 1].x, rail[i + 1].y + 1, PAL.railDark);
    for (let i = 0; i + 1 < rail.length; i++)
      b.line(rail[i].x, rail[i].y, rail[i + 1].x, rail[i + 1].y, PAL.rail);
    for (let i = 0; i + 1 < rail.length; i += hs ? 1 : 2)
      b.set(rail[i].x, rail[i].y, PAL.railLight);
  }
}

function bridgeDeck(b: PixelBuf, link: Link, seed: number) {
  const pts = linkPoints(link[0], link[1], 24);
  // posts under the deck edges
  for (const i of [3, 12, 21]) {
    const p = pts[i];
    const q = pts[i + 1];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l;
    const ny = dx / l;
    for (const s of [-0.36, 0.36]) {
      const sp = proj(OX, OY, p.x + nx * s, p.y + ny * s);
      b.rect(Math.round(sp.x) - 1, Math.round(sp.y), 2, 9, PAL.timber[2]);
      b.set(Math.round(sp.x) - 1, Math.round(sp.y), PAL.timber[1]);
    }
  }
  // planks across
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[Math.min(pts.length - 1, i + 1)];
    const r = pts[Math.max(0, i - 1)];
    const dx = q.x - r.x;
    const dy = q.y - r.y;
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l;
    const ny = dx / l;
    for (let s = -0.4; s <= 0.4; s += 0.03) {
      const sp = proj(OX, OY, p.x + nx * s, p.y + ny * s);
      const px = Math.floor(sp.x);
      const py = Math.floor(sp.y);
      const plank = (i >> 1) % 2 === 0 ? 1 : 0;
      const c: RGB = Math.abs(s) > 0.36 ? PAL.timber[2] : PAL.timber[plank];
      b.set(px, py, shade(c, 0.9 + 0.2 * hash2(px, py, seed)));
    }
  }
}

function pieceSprite(kind: TrackKind, rot: number, cls: TrackClass, cls2?: TrackClass): PixelBuf {
  const b = new PixelBuf(W, H);
  const links = pieceLinks(kind, rot);
  const seed = 900 + rot;
  const clsOf = (i: number) => (kind === 'crossing' && i === 1 ? (cls2 ?? cls) : cls);
  if (kind === 'bridge') {
    for (const l of links) bridgeDeck(b, l, seed);
    for (const l of links) drawLinkRails(b, l, { ballast: false, seed, cls });
  } else if (kind === 'transition') {
    // half wooden sleepers, half concrete: the class changes on this tile
    const pts = linkPoints(links[0][0], links[0][1], 24);
    const half = Math.floor(pts.length / 2);
    drawRails(b, pts, { ballast: true, seed, cls: 'high_speed' });
    drawRails(b, pts.slice(0, half + 1), { ballast: true, seed, cls: 'regular' });
    drawRails(b, pts, { ballast: false, seed, cls: 'regular' });
  } else {
    links.forEach((l, i) => drawLinkRails(b, l, { ballast: true, seed, cls: clsOf(i) }));
    // draw rails again without ballast so crossings overlap cleanly
    links.forEach((l, i) => drawLinkRails(b, l, { ballast: false, seed, cls: clsOf(i) }));
    if (kind === 'switch') {
      // small lever box near the shared end
      const shared = links[0].find((d) => links[1].includes(d as Dir))!;
      const sp = proj(
        OX,
        OY,
        shared === Dir.E ? 0.28 : shared === Dir.W ? -0.28 : 0,
        shared === Dir.S ? 0.28 : shared === Dir.N ? -0.28 : 0,
      );
      b.rect(Math.round(sp.x) + 4, Math.round(sp.y) - 3, 3, 3, PAL.rust[1]);
      b.set(Math.round(sp.x) + 5, Math.round(sp.y) - 4, PAL.amber);
    }
  }
  return b;
}

/** One tile of a wide (n × n) curve or switch: its own polylines, or bare ballast for the blocked corner. */
function memberSprite(
  kind: 'curve' | 'switch',
  cls: TrackClass,
  rot: number,
  member: number,
): PixelBuf {
  const b = new PixelBuf(W, H);
  const def = unitDef(kind, CLASS_N[cls], rot);
  const m = def.members[member];
  const seed = 950 + rot * 7 + member;
  if (!m.links.length) {
    // blocked inner corner: a gravel apron so the footprint reads as one piece
    for (let ty = -0.5; ty <= 0.5; ty += 0.03)
      for (let tx = -0.5; tx <= 0.5; tx += 0.03) {
        const sp = proj(OX, OY, tx, ty);
        const px = Math.floor(sp.x);
        const py = Math.floor(sp.y);
        const n = hash2(px >> 1, py >> 1, seed);
        b.set(px, py, shade(PAL.ballast[Math.min(2, Math.floor(n * 3))], 0.9));
      }
    return b;
  }
  const dense = (pts: Vec2[]) => {
    // resample to ~24 points so sleepers space evenly
    const out: Vec2[] = [];
    let len = 0;
    for (let i = 1; i < pts.length; i++)
      len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const n = Math.max(6, Math.round(len * 24));
    let i = 1;
    let acc = 0;
    for (let k = 0; k <= n; k++) {
      const target = (len * k) / n;
      while (
        i < pts.length - 1 &&
        acc + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) < target
      ) {
        acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        i++;
      }
      const segLen = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) || 1;
      const t = Math.min(1, Math.max(0, (target - acc) / segLen));
      out.push({
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
      });
    }
    return out;
  };
  for (const l of m.links) drawRails(b, dense(l.pts), { ballast: true, seed, cls });
  for (const l of m.links) drawRails(b, dense(l.pts), { ballast: false, seed, cls });
  return b;
}

export function generateTrackAtlas(): AtlasImage {
  const ab = new AtlasBuilder();
  for (const it of TRACK_ITEMS) {
    const key = itemKey(it);
    for (let r = 0; r < rotationCount(it.kind); r++) {
      if (isUnitKind(it.kind, it.cls)) {
        const def = unitDef(it.kind as 'curve' | 'switch', CLASS_N[it.cls], r);
        def.members.forEach((_, mi) =>
          ab.add(
            `track/${key}_${r}_m${mi}`,
            memberSprite(it.kind as 'curve' | 'switch', it.cls, r, mi).toImageData(),
            OX,
            OY,
          ),
        );
        // the anchor's member sprite doubles as the toolbar preview
        ab.add(
          `track/${key}_${r}`,
          memberSprite(it.kind as 'curve' | 'switch', it.cls, r, 1).toImageData(),
          OX,
          OY,
        );
      } else
        ab.add(`track/${key}_${r}`, pieceSprite(it.kind, r, it.cls, it.cls2).toImageData(), OX, OY);
    }
  }
  return ab.build(1024);
}

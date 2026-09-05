import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { Dir } from '../engine/iso';
import { hash2 } from '../engine/rng';
import { PAL, shade, type RGB } from './palette';
import { PixelBuf } from './pixels';
import { proj } from './iso3d';
import { linkPoints } from '../world/trackGeom';
import { TRACK_KINDS, pieceLinks, rotationCount, type TrackKind, type Link } from '../world/track';

const W = 64;
const H = 40; // a little taller than the tile for bridge posts
const OX = 32;
const OY = 16;

function drawLinkRails(b: PixelBuf, link: Link, opts: { ballast: boolean; seed: number }) {
  const pts = linkPoints(link[0], link[1], 24);
  const gauge = 0.16; // half-gauge in tile units
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
      for (let s = -0.32; s <= 0.32; s += 0.03) {
        const sp = proj(OX, OY, p.x + nx * s, p.y + ny * s);
        const px = Math.floor(sp.x);
        const py = Math.floor(sp.y);
        const n = hash2(px >> 1, py >> 1, opts.seed);
        const c = PAL.ballast[Math.min(2, Math.floor(n * 3))];
        b.set(px, py, Math.abs(s) > 0.26 ? shade(c, 0.85) : c);
      }
    }
  }
  // sleepers
  for (let i = 1; i < pts.length - 1; i += 3) {
    const p = pts[i];
    const q = pts[i + 1];
    const r = pts[i - 1];
    const dx = q.x - r.x;
    const dy = q.y - r.y;
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l;
    const ny = dx / l;
    const a = proj(OX, OY, p.x + nx * 0.24, p.y + ny * 0.24);
    const c = proj(OX, OY, p.x - nx * 0.24, p.y - ny * 0.24);
    b.line(Math.round(a.x), Math.round(a.y), Math.round(c.x), Math.round(c.y), PAL.sleeper);
    b.line(
      Math.round(a.x),
      Math.round(a.y) + 1,
      Math.round(c.x),
      Math.round(c.y) + 1,
      PAL.sleeperDark,
    );
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
    for (let i = 0; i + 1 < rail.length; i += 2) b.set(rail[i].x, rail[i].y, PAL.railLight);
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

function pieceSprite(kind: TrackKind, rot: number): PixelBuf {
  const b = new PixelBuf(W, H);
  const links = pieceLinks(kind, rot);
  const seed = 900 + rot;
  if (kind === 'bridge') {
    for (const l of links) bridgeDeck(b, l, seed);
    for (const l of links) drawLinkRails(b, l, { ballast: false, seed });
  } else {
    for (const l of links) drawLinkRails(b, l, { ballast: true, seed });
    // draw rails again without ballast so crossings overlap cleanly
    for (const l of links) drawLinkRails(b, l, { ballast: false, seed });
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

export function generateTrackAtlas(): AtlasImage {
  const ab = new AtlasBuilder();
  for (const kind of TRACK_KINDS)
    for (let r = 0; r < rotationCount(kind); r++) {
      ab.add(`track/${kind}_${r}`, pieceSprite(kind, r).toImageData(), OX, OY);
    }
  return ab.build(1024);
}

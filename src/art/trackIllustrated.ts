import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import type { Vec2 } from '../engine/iso';
import { hash2 } from '../engine/rng';
import { linkPoints, unitDef } from '../world/trackGeom';
import {
  TRACK_ITEMS,
  CLASS_N,
  itemKey,
  isUnitKind,
  pieceLinks,
  rotationCount,
  type TrackClass,
} from '../world/track';

const R = 4,
  W = 72,
  H = 44,
  OX = 36,
  OY = 20;
type RailPath = { points: Vec2[]; cls: TrackClass };
const project = (p: Vec2) => ({ x: OX + (p.x - p.y) * 32, y: OY + (p.x + p.y) * 16 });
const offset = (p: Vec2, n: Vec2, d: number) => ({ x: p.x + n.x * d, y: p.y + n.y * d });

function draw(paths: RailPath[], seed: number, bridge = false, apron = false) {
  const canvas = document.createElement('canvas');
  canvas.width = W * R;
  canvas.height = H * R;
  const c = canvas.getContext('2d')!;
  c.scale(R, R);
  const polygon = (points: Vec2[], color: string) => {
    c.beginPath();
    points.forEach((p, i) => {
      const q = project(p);
      if (i) c.lineTo(q.x, q.y);
      else c.moveTo(q.x, q.y);
    });
    c.closePath();
    c.fillStyle = color;
    c.fill();
  };
  const line = (points: Vec2[], color: string, width: number, dy = 0) => {
    c.beginPath();
    points.forEach((p, i) => {
      const q = project(p);
      if (i) c.lineTo(q.x, q.y + dy);
      else c.moveTo(q.x, q.y + dy);
    });
    c.strokeStyle = color;
    c.lineWidth = width;
    c.lineJoin = 'round';
    c.stroke();
  };
  c.beginPath();
  c.moveTo(OX, OY - 16.3);
  c.lineTo(OX + 32.6, OY);
  c.lineTo(OX, OY + 16.3);
  c.lineTo(OX - 32.6, OY);
  c.closePath();
  c.clip();
  const rows = paths.map(({ points, cls }) => ({
    points,
    cls,
    normals: points.map((p, i) => {
      const a = points[Math.max(0, i - 1)],
        b = points[Math.min(points.length - 1, i + 1)];
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
    }),
  }));
  if (apron)
    polygon(
      [
        { x: -0.5, y: -0.5 },
        { x: 0.5, y: -0.5 },
        { x: 0.5, y: 0.5 },
        { x: -0.5, y: 0.5 },
      ],
      '#827765',
    );
  for (const { points, normals, cls } of rows) {
    const shoulder = cls === 'high_speed' ? 0.34 : 0.29;
    for (const [extra, alpha] of bridge
      ? [[0, 1]]
      : [
          [0.06, 0.07],
          [0.035, 0.12],
          [0, 0.23],
          [-0.04, 0.35],
        ]) {
      c.globalAlpha = alpha;
      polygon(
        [
          ...points.map((p, i) => offset(p, normals[i], shoulder + extra)),
          ...points.map((p, i) => offset(p, normals[i], -shoulder - extra)).reverse(),
        ],
        bridge ? '#826446' : '#827b69',
      );
    }
    c.globalAlpha = 1;
    // Fine warm stone texture, with a quieter shoulder, instead of checkerboard one-pixel ballast.
    for (let i = 0; i < points.length; i++)
      for (let j = -8; j <= 8; j++) {
        const k = hash2(i, j, seed);
        c.globalAlpha = bridge ? 1 : 0.25 + 0.45 * (1 - Math.abs(j) / 9);
        const p = project(offset(points[i], normals[i], (j * shoulder) / 8));
        c.fillStyle = bridge
          ? k > 0.5
            ? '#997958'
            : '#72573e'
          : k > 0.72
            ? '#a99c82'
            : k < 0.28
              ? '#6f695b'
              : '#918570';
        c.beginPath();
        c.ellipse(
          p.x + (k - 0.5) * 0.8,
          p.y,
          (bridge ? 0.9 : 0.3) + k * 0.32,
          0.18 + k * 0.14,
          0,
          0,
          Math.PI * 2,
        );
        c.fill();
      }
  }
  for (const { points, normals, cls } of rows) {
    c.globalAlpha = 1;
    let distance = 0,
      next = 0.055;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        len = Math.hypot(b.x - a.x, b.y - a.y);
      while (next <= distance + len) {
        const t = (next - distance) / (len || 1),
          p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const n = normals[i],
          along = { x: n.y, y: -n.x };
        const corners = [
          offset(offset(p, n, -0.235), along, -0.028),
          offset(offset(p, n, 0.235), along, -0.028),
          offset(offset(p, n, 0.235), along, 0.028),
          offset(offset(p, n, -0.235), along, 0.028),
        ];
        polygon(corners, cls === 'high_speed' ? '#b9b3a0' : '#725039');
        line(corners.slice(0, 2), cls === 'high_speed' ? '#d1cbb7' : '#a17c52', 0.38, -0.22);
        for (const side of [-0.16, 0.16]) {
          const q = project(offset(p, n, side));
          c.fillStyle = '#554f43';
          c.fillRect(q.x - 0.45, q.y - 0.35, 0.9, 0.7);
        }
        next += 0.14;
      }
      distance += len;
    }
    for (const side of [-0.16, 0.16]) {
      const rail = points.map((p, i) => offset(p, normals[i], side));
      line(rail, '#4c4940', 1.25, 0.35);
      line(rail, '#827d70', 0.95);
      line(rail, '#d1c7ac', 0.4, -0.3);
    }
  }
  return c.getImageData(0, 0, W * R, H * R);
}

/** Source-inspired timber/steel materials on the real track polylines, in every orientation. */
export function generateIllustratedTrackAtlas(): AtlasImage {
  const ab = new AtlasBuilder();
  for (const it of TRACK_ITEMS)
    for (let rotation = 0; rotation < rotationCount(it.kind); rotation++) {
      const key = `track/${itemKey(it)}_${rotation}`;
      if (isUnitKind(it.kind, it.cls)) {
        const def = unitDef(it.kind as 'curve' | 'switch', CLASS_N[it.cls], rotation);
        const member = (index: number) =>
          draw(
            def.members[index].links.map((l) => ({ points: l.pts, cls: it.cls })),
            rotation * 13 + index,
            false,
            !def.members[index].links.length,
          );
        def.members.forEach((_, i) => ab.add(`${key}_m${i}`, member(i), OX * R, OY * R));
        ab.add(key, member(1), OX * R, OY * R);
      } else {
        const paths = pieceLinks(it.kind, rotation).map((link, i) => ({
          points: linkPoints(link[0], link[1], 96),
          cls: it.kind === 'crossing' && i === 1 ? (it.cls2 ?? it.cls) : it.cls,
        }));
        if (it.kind === 'transition') {
          const points = paths[0].points,
            mid = Math.floor(points.length / 2);
          paths.splice(
            0,
            1,
            { points: points.slice(0, mid + 1), cls: 'regular' },
            { points: points.slice(mid), cls: 'high_speed' },
          );
        }
        ab.add(key, draw(paths, rotation * 13, it.kind === 'bridge'), OX * R, OY * R);
      }
    }
  return { ...ab.build(2048), resolution: R };
}

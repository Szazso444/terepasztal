import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import type { Vec2 } from '../engine/iso';
import { hash2 } from '../engine/rng';
import {
  linkPoints,
  unitDef,
  unitIconPaths,
  unitRailPaths,
  type SwitchForm,
} from '../world/trackGeom';
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
/**
 * Per class: each rail's offset from the centre line, half a sleeper's length, sleeper spacing,
 * ballast shoulder, sleeper colours and rail line widths. Narrow gauge puts its rails closer
 * together on short, closely spaced timber sleepers laid straight on the ground, with no ballast,
 * like a forest or mine line.
 */
const STYLE: Record<
  TrackClass,
  {
    rail: number;
    sleeper: number;
    step: number;
    shoulder: number;
    /** a bed of ballast under the sleepers */
    bed: boolean;
    tie: string;
    tieHi: string;
    widths: [number, number, number];
  }
> = {
  regular: {
    rail: 0.12,
    sleeper: 0.17625,
    step: 0.14,
    shoulder: 0.2175,
    bed: true,
    tie: '#725039',
    tieHi: '#a17c52',
    widths: [1.25, 0.95, 0.4],
  },
  high_speed: {
    rail: 0.12,
    sleeper: 0.17625,
    step: 0.14,
    shoulder: 0.255,
    bed: true,
    tie: '#b9b3a0',
    tieHi: '#d1cbb7',
    widths: [1.25, 0.95, 0.4],
  },
  narrow: {
    rail: 0.08,
    sleeper: 0.14,
    step: 0.115,
    shoulder: 0.19,
    bed: false,
    tie: '#664631',
    tieHi: '#8f6c47',
    widths: [0.95, 0.72, 0.32],
  },
};
// Preview only (scratch scenes): ?gauge=<half gauge in tiles> draws regular and high-speed track with
// its rails that far from the centre line, sleepers and ballast narrowed with them.
const previewGauge =
  typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('gauge')) : 0;
if (previewGauge > 0)
  for (const cls of ['regular', 'high_speed'] as const) {
    const k = previewGauge / STYLE[cls].rail;
    STYLE[cls].rail = previewGauge;
    STYLE[cls].sleeper *= k;
    STYLE[cls].shoulder *= k;
  }
const project = (p: Vec2) => ({ x: OX + (p.x - p.y) * 32, y: OY + (p.x + p.y) * 16 });
const offset = (p: Vec2, n: Vec2, d: number) => ({ x: p.x + n.x * d, y: p.y + n.y * d });

/** `scale` shrinks the rails, sleepers and bed with the path: an icon of a piece drawn small. */
function draw(paths: RailPath[], seed: number, bridge = false, scale = 1) {
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
  for (const { points, normals, cls } of rows) {
    if (!STYLE[cls].bed && !bridge) continue;
    const shoulder = STYLE[cls].shoulder * scale;
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
    const base = STYLE[cls];
    const st = {
      ...base,
      rail: base.rail * scale,
      sleeper: base.sleeper * scale,
      step: base.step * Math.max(scale, 0.75),
    };
    let distance = 0,
      next = st.step / 2.5;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        len = Math.hypot(b.x - a.x, b.y - a.y);
      while (next <= distance + len) {
        const t = (next - distance) / (len || 1),
          p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const n = normals[i],
          along = { x: n.y, y: -n.x },
          half = st.sleeper;
        const corners = [
          offset(offset(p, n, -half), along, -0.028),
          offset(offset(p, n, half), along, -0.028),
          offset(offset(p, n, half), along, 0.028),
          offset(offset(p, n, -half), along, 0.028),
        ];
        polygon(corners, st.tie);
        line(corners.slice(0, 2), st.tieHi, 0.38, -0.22);
        for (const side of [-st.rail, st.rail]) {
          const q = project(offset(p, n, side));
          c.fillStyle = '#554f43';
          c.fillRect(q.x - 0.45, q.y - 0.35, 0.9, 0.7);
        }
        next += st.step;
      }
      distance += len;
    }
  }
  // rails last, over every road's sleepers: where two roads meet, neither rail is cut
  for (const { points, normals, cls } of rows) {
    const st = STYLE[cls];
    const widths = st.widths.map((w) => w * Math.max(scale, 0.75));
    for (const side of [-st.rail * scale, st.rail * scale]) {
      const rail = points.map((p, i) => offset(p, normals[i], side));
      line(rail, '#4c4940', widths[0], 0.35);
      line(rail, '#827d70', widths[1]);
      line(rail, '#d1c7ac', widths[2], -0.3);
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
        const forms: SwitchForm[] = it.kind === 'switch' ? ['turn', 'parallel'] : ['turn'];
        for (const form of forms) {
          const def = unitDef(it.kind as 'curve' | 'switch', CLASS_N[it.cls], rotation, form);
          const tag = form === 'parallel' ? 'p' : '';
          // every member draws the whole piece, shifted into its own tile and clipped to it, so
          // rails and ballast run on across tile edges; the empty inner tile shows only the
          // ballast that spills into it. Each road is one unbroken line, so sleepers keep their
          // spacing and rails their direction where tiles meet.
          const roads = unitRailPaths(
            it.kind as 'curve' | 'switch',
            CLASS_N[it.cls],
            rotation,
            form,
          );
          const member = (index: number) => {
            const own = def.members[index];
            return draw(
              roads.map((pts) => ({
                points: pts.map((q) => ({ x: q.x - own.dx, y: q.y - own.dy })),
                cls: it.cls,
              })),
              rotation * 13,
            );
          };
          def.members.forEach((_, i) => ab.add(`${key}${tag}_m${i}`, member(i), OX * R, OY * R));
          // the toolbar icon: the whole piece, small, on one tile
          if (form === 'turn') {
            const n = CLASS_N[it.cls];
            const icon = unitIconPaths(it.kind as 'curve' | 'switch', n, rotation).map(
              (points) => ({ points, cls: it.cls }),
            );
            ab.add(key, draw(icon, rotation * 13, false, 1 / n), OX * R, OY * R);
          }
        }
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

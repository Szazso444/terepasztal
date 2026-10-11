import { linkPoints } from '/src/world/trackGeom.ts';
import { hash2 } from '/src/engine/rng.ts';
const R = 4,
  W = 72,
  H = 44,
  OX = 36,
  OY = 20;
const project = (p) => ({ x: OX + (p.x - p.y) * 32, y: OY + (p.x + p.y) * 16 });
const offset = (p, n, d) => ({ x: p.x + n.x * d, y: p.y + n.y * d });
const rgb = (c) => 'rgb(' + c.map(Math.round).join(',') + ')';
export function installTerrainRails(g, materials) {
  const report = [];
  for (const [key, piece] of g.track.pieces) {
    const x = key % g.map.w,
      y = Math.floor(key / g.map.w),
      terrain = materials.color(x, y);
    const bed = terrain.map((v, i) => v * 0.48 + [129, 121, 102][i] * 0.52);
    const c = document.createElement('canvas');
    c.width = W * R;
    c.height = H * R;
    const ctx = c.getContext('2d');
    ctx.scale(R, R);
    const polygon = (points, color, alpha = 1) => {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      points.forEach((p, i) => {
        const q = project(p);
        i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      });
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    const line = (points, color, width, dy = 0) => {
      ctx.beginPath();
      points.forEach((p, i) => {
        const q = project(p);
        i ? ctx.lineTo(q.x, q.y + dy) : ctx.moveTo(q.x, q.y + dy);
      });
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = color;
      ctx.stroke();
    };
    ctx.beginPath();
    ctx.moveTo(OX, OY - 16);
    ctx.lineTo(OX + 32, OY);
    ctx.lineTo(OX, OY + 16);
    ctx.lineTo(OX - 32, OY);
    ctx.closePath();
    ctx.clip();
    const paths = piece.links.map(([a, b]) => linkPoints(a, b, 96));
    const rows = paths.map((points) => ({
      points,
      normals: points.map((p, i) => {
        const a = points[Math.max(0, i - 1)],
          b = points[Math.min(points.length - 1, i + 1)],
          l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
      }),
    }));
    for (const { points, normals } of rows) {
      // Nested low-alpha shoulders expose the local tile instead of an opaque strip.
      for (const [shoulder, a] of [
        [0.34, 0.07],
        [0.3, 0.1],
        [0.265, 0.16],
        [0.23, 0.28],
      ])
        polygon(
          [
            ...points.map((p, i) => offset(p, normals[i], shoulder)),
            ...points.map((p, i) => offset(p, normals[i], -shoulder)).reverse(),
          ],
          rgb(bed),
          a,
        );
      for (let i = 0; i < points.length; i += 3)
        for (let j = -6; j <= 6; j++) {
          const n = hash2(i + x * 17, j + y * 19, 7412),
            q = project(offset(points[i], normals[i], j * 0.043));
          ctx.globalAlpha = 0.23 * (1 - Math.abs(j) / 8);
          ctx.fillStyle = rgb(bed.map((v) => v + (n - 0.5) * 34));
          ctx.fillRect(q.x, q.y, 0.28 + n * 0.25, 0.25);
        }
      ctx.globalAlpha = 1;
    }
    for (const { points, normals } of rows) {
      let distance = 0,
        next = 0.055;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i],
          len = Math.hypot(b.x - a.x, b.y - a.y);
        while (next <= distance + len) {
          const t = (next - distance) / (len || 1),
            p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
            n = normals[i],
            along = { x: n.y, y: -n.x };
          const corners = [
            offset(offset(p, n, -0.235), along, -0.028),
            offset(offset(p, n, 0.235), along, -0.028),
            offset(offset(p, n, 0.235), along, 0.028),
            offset(offset(p, n, -0.235), along, 0.028),
          ];
          polygon(corners, '#73583e');
          line(corners.slice(0, 2), '#9e8058', 0.33, -0.18);
          next += 0.14;
        }
        distance += len;
      }
      for (const side of [-0.16, 0.16]) {
        const rail = points.map((p, i) => offset(p, normals[i], side));
        line(rail, '#4c4940', 1.15, 0.3);
        line(rail, rgb(terrain.map((v, i) => v * 0.12 + [141, 138, 122][i] * 0.88)), 0.85);
        line(rail, '#cec6af', 0.32, -0.26);
      }
    }
    const name = 'review/track_' + key;
    g.atlas.register({
      image: c,
      resolution: R,
      frames: { [name]: { x: 0, y: 0, w: W * R, h: H * R, ax: OX * R, ay: OY * R } },
    });
    const s = g.world.trackSprites.get(key),
      f = g.atlas.get(name);
    s.texture = f.texture;
    s.anchor.set(f.anchorX, f.anchorY);
    report.push({
      x,
      y,
      terrain: materials.kind(x, y),
      bedColor: bed.map(Math.round),
      railGauge: 0.32,
    });
  }
  return report;
}

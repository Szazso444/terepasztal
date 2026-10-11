const load = async (src) => {
  const i = new Image();
  i.src = src;
  await i.decode();
  return i;
};
const [grass, stone, station] = await Promise.all(
  [
    '/assets/source/base-v1/terrain-grass.png',
    '/assets/source/base-v1/people-road-stone.png',
    '../station-pipeline/previous-sprite.png',
  ].map(load),
);
const pixels = (i) => {
  const c = document.createElement('canvas');
  c.width = i.width;
  c.height = i.height;
  const x = c.getContext('2d');
  x.drawImage(i, 0, 0);
  return x.getImageData(0, 0, c.width, c.height);
};
const g = pixels(grass),
  s = pixels(stone);
const clamp = (t) => Math.max(0, Math.min(1, t)),
  smooth = (t) => {
    t = clamp(t);
    return t * t * (3 - 2 * t);
  };
const mirror = (t) => 1 - Math.abs((((t % 2) + 2) % 2) - 1);
// Continuous material coordinates; no tile-local texture resets or tile-local lighting.
function sample(p, u, v, kind) {
  // Stone repeats the source layout in one direction. Mirroring its joints
  // created alternating directions and an optical zigzag at patch boundaries.
  const a = kind === 'stone' ? u - Math.floor(u) : mirror(u),
    b = kind === 'stone' ? v - Math.floor(v) : mirror(v);
  const x = kind === 'grass' ? 0.5 + (a - b) * 0.34 : 0.5 + (a - b) * 0.33;
  const y = kind === 'grass' ? 0.49 + (a + b - 1) * 0.27 : 0.5 + (a + b - 1) * 0.4;
  const i =
    (Math.min(p.height - 1, Math.max(0, Math.round(y * p.height))) * p.width +
      Math.min(p.width - 1, Math.max(0, Math.round(x * p.width)))) *
    4;
  return [p.data[i], p.data[i + 1], p.data[i + 2]];
}
const project = (x, y) => [380 + (x - y) * 46, 85 + (x + y) * 23];
const noise = (x, y) => Math.sin(x * 8.1 + y * 3.7) * 0.035 + Math.sin(x * 19.1 - y * 13.2) * 0.016;
const rect = (x, y, a, b, c, d) => Math.min(x - a, c - x, y - b, d - y);
function ground(full) {
  const canvas = document.createElement('canvas');
  canvas.width = 760;
  canvas.height = 620;
  const ctx = canvas.getContext('2d'),
    out = ctx.createImageData(760, 620);
  for (let py = 0; py < 620; py++)
    for (let px = 0; px < 760; px++) {
      const x = ((px - 380) / 46 + (py - 85) / 23) / 2,
        y = ((py - 85) / 23 - (px - 380) / 46) / 2;
      if (x < 0 || x > 7 || y < 0 || y > 7) continue;
      const a = sample(g, x * 0.69 + y * 0.07, y * 0.73 - x * 0.03, 'grass');
      const d = full ? rect(x, y, 0.8, 1.9, 6.2, 5.6) : rect(x, y, 1.15, 2.4, 5.9, 4.8);
      const approach = full ? rect(x, y, 3.6, 5.25, 4.25, 6.6) : -10;
      const blend = smooth((Math.max(d, approach) + noise(x, y) + 0.12) / 0.32);
      const b = sample(s, x / 3.5, y / 3.5, 'stone');
      const i = (py * 760 + px) * 4;
      const shade = 1 + 0.028 * Math.sin(x * 2.3 + y) * Math.cos(y * 3.1);
      for (let k = 0; k < 3; k++) out.data[i + k] = (a[k] * (1 - blend) + b[k] * blend) * shade;
      out.data[i + 3] = 255;
    }
  ctx.putImageData(out, 0, 0);
  return canvas;
}
const grounds = [ground(false), ground(true)];
function line(ctx, points, color) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = color;
  ctx.stroke();
}
function draw() {
  for (const [index, id] of ['compact', 'full'].entries()) {
    const c = document.getElementById(id),
      ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 760, 620);
    ctx.drawImage(grounds[index], 0, 0);
    if (document.querySelector('#grid').checked) {
      ctx.lineWidth = 0.6;
      for (let i = 0; i <= 7; i++) {
        line(ctx, [project(i, 0), project(i, 7)], '#ffffff40');
        line(ctx, [project(0, i), project(7, i)], '#ffffff40');
      }
      ctx.lineWidth = 2;
      line(
        ctx,
        [
          [1, 2],
          [6, 2],
          [6, 6],
          [1, 6],
          [1, 2],
        ].map((p) => project(...p)),
        '#f6cf7d',
      );
    }
    const [ax, ay] = project(3.35, 3.2);
    if (document.querySelector('#building').checked) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(station, ax - 92 * 1.8, ay - 125 * 1.5, 180 * 1.8, 169 * 1.5);
    }
    if (document.querySelector('#people').checked)
      for (const [x, y] of [
        [3.5, 4.35],
        [4.05, 4.5],
      ]) {
        const [px, py] = project(x, y);
        ctx.fillStyle = '#dec798';
        ctx.beginPath();
        ctx.arc(px, py - 31, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#cfaa61';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(px, py - 26);
        ctx.lineTo(px, py - 12);
        ctx.stroke();
        ctx.lineWidth = 2;
        line(
          ctx,
          [
            [px, py - 13],
            [px - 3, py],
            [px, py - 13],
            [px + 3, py],
          ],
          '#433e32',
        );
        line(
          ctx,
          [
            [px - 5, py - 16],
            [px, py - 24],
            [px + 5, py - 16],
          ],
          '#cfaa61',
        );
      }
  }
  window.yardStudyReady = true;
}
document.querySelectorAll('input').forEach((e) => e.addEventListener('change', draw));
draw();

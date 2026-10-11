import { cameras, project, depth } from './projection.mjs';
import { buildingMesh, tint } from './models.mjs';
import { dimensions } from '../grid-buildings/footprint.mjs';

const manifest = await (await fetch('../building-poc/sprites/manifest.json')).json();
const images = {},
  palettes = {};
const names = {
  house: 'Stone cottage',
  station: 'Passenger station',
  'stations-farm': 'Farm',
  'stations-lumber': 'Lumber mill',
  'stations-quarry': 'Quarry',
  'stations-pump': 'Pump house',
  'stations-town': 'Town hall',
  'stations-warehouse': 'Warehouse',
};
await Promise.all(
  Object.keys(manifest.frames).map(async (key) => {
    const image = new Image();
    image.src = `../building-poc/sprites/${key}.png`;
    await image.decode();
    images[key] = image;
  }),
);
// Sample only colors; the simplified meshes never pretend to reproduce the source detail.
for (const b of manifest.buildings) {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(images[`${b.key}-0`], 0, 0, 96, 96);
  const pixels = ctx.getImageData(0, 0, 96, 96).data,
    warm = [],
    cool = [],
    green = [];
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, bl, a] = pixels.slice(i, i + 4);
    if (a < 220) continue;
    if (r > g && g > bl && r > 120) warm.push([r, g, bl]);
    if (bl >= r * 0.92 && r > 35 && r < 155) cool.push([r, g, bl]);
    if (g > r * 1.05 && g > bl && g < 140) green.push([r, g, bl]);
  }
  const mean = (list, fallback) =>
    list.length
      ? '#' +
        [0, 1, 2]
          .map((k) =>
            Math.round(list.reduce((s, p) => s + p[k], 0) / list.length)
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')
      : fallback;
  palettes[b.key] = {
    wall: mean(warm, '#c9b995'),
    roof: mean(cool, '#59636a'),
    door: mean(green, '#3e5e4c'),
  };
}
const byId = Object.fromEntries(manifest.buildings.map((b) => [b.key, b]));
const select = document.querySelector('#asset');
for (const b of manifest.buildings)
  select.add(new Option(`${names[b.key]} · ${b.tiles === 1 ? '1×1' : '1×2 / 2×1'}`, b.key));
select.value = 'stations-farm';
let rotation = 0;
const surfaces = cameras.map((camera) => {
  const card = document.createElement('article');
  card.className = `card ${camera.id}`;
  card.innerHTML = `<header><div class="tag">${camera.id === 'current' ? 'CURRENT GRID TARGET' : 'ALTERNATE CAMERA'}</div><h3>${camera.name}</h3><div class="metric">${((camera.elevation * 180) / Math.PI).toFixed(3)}° elevation · 45° azimuth</div></header><canvas width="840" height="640" aria-label="${camera.name} geometry scene"></canvas><footer>${camera.note}<br>Geometry study · sampled asset colors</footer>`;
  document.querySelector('#scenes').append(card);
  return card.querySelector('canvas');
});
const originalCanvases = [];
for (let r = 0; r < 4; r++) {
  const figure = document.createElement('figure');
  figure.innerHTML = `<canvas width="320" height="340" aria-label="Original sprite facing ${r}"></canvas><figcaption>${r * 90}° rotation · original PNG</figcaption>`;
  document.querySelector('#originals').append(figure);
  originalCanvases.push(figure.querySelector('canvas'));
}
document.querySelector('#numbers').innerHTML = cameras
  .map(
    (c) =>
      `<tr><td>${c.name}</td><td>${((c.elevation * 180) / Math.PI).toFixed(3)}°</td><td>±${((Math.atan(Math.sin(c.elevation)) * 180) / Math.PI).toFixed(3)}°</td><td>${(1 / Math.sin(c.elevation)).toFixed(3)} : 1</td></tr>`,
  )
  .join('');

function polygon(ctx, p, color, stroke) {
  ctx.beginPath();
  p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.65;
    ctx.stroke();
  }
}
function line(ctx, p, color, width = 1) {
  ctx.beginPath();
  p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}
function paths() {
  const ring = [];
  for (const [cx, cy, start] of [
    [1.25, 1.25, Math.PI],
    [9.35, 1.25, Math.PI * 1.5],
    [9.35, 9.35, 0],
    [1.25, 9.35, Math.PI * 0.5],
  ])
    for (let i = 0; i <= 20; i++)
      ring.push([
        cx + 0.8 * Math.cos(start + (i * Math.PI) / 40),
        cy + 0.8 * Math.sin(start + (i * Math.PI) / 40),
      ]);
  ring.push(ring[0]);
  const result = [
    ring,
    [
      [0.45, 6.5],
      [10.15, 6.5],
    ],
    [
      [6.5, 0.45],
      [6.5, 10.15],
    ],
  ];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    result.push([
      [8.2, 8.2],
      [8.2 + 1.65 * Math.cos(a), 8.2 + 1.65 * Math.sin(a)],
    ]);
  }
  return result;
}
const railPaths = paths();
function track(ctx, p, path) {
  let sinceTie = 0;
  for (let i = 1; i < path.length; i++) {
    const [x, y] = path[i - 1],
      [xx, yy] = path[i],
      dx = xx - x,
      dy = yy - y,
      len = Math.hypot(dx, dy);
    if (!len) continue;
    const nx = -dy / len,
      ny = dx / len;
    const quad = (along, span, half) =>
      [
        [x + (dx * along) / len + nx * half, y + (dy * along) / len + ny * half],
        [x + (dx * (along + span)) / len + nx * half, y + (dy * (along + span)) / len + ny * half],
        [x + (dx * (along + span)) / len - nx * half, y + (dy * (along + span)) / len - ny * half],
        [x + (dx * along) / len - nx * half, y + (dy * along) / len - ny * half],
      ].map((q) => p(...q, 0.003));
    polygon(ctx, quad(0, len, 0.16), '#878471');
    for (let s = sinceTie; s < len; s += 0.13) polygon(ctx, quad(s, 0.045, 0.125), '#63543d');
    sinceTie = (sinceTie - len) % 0.13;
    if (sinceTie < 0) sinceTie += 0.13;
    for (const side of [-1, 1])
      line(
        ctx,
        [
          p(x + nx * 0.072 * side, y + ny * 0.072 * side, 0.013),
          p(xx + nx * 0.072 * side, yy + ny * 0.072 * side, 0.013),
        ],
        '#ddd4b6',
        1.5,
      );
  }
}
function placements() {
  if (document.querySelector('#layout').value === 'mixed') {
    const locations = [
      [1, 1],
      [4, 1],
      [7, 1],
      [1, 4],
      [4, 4],
      [7, 4],
      [1, 7],
      [4, 7],
    ];
    return manifest.buildings.map((b, i) => ({ b, r: (i + rotation) % 4, at: locations[i] }));
  }
  return [
    [1, 1],
    [4, 1],
    [1, 4],
    [4, 4],
  ].map((at, i) => ({ b: byId[select.value], r: (i + rotation) % 4, at }));
}
function drawScene(canvas, camera) {
  const ctx = canvas.getContext('2d'),
    close = document.querySelector('#view').value === 'close',
    scale = (close ? 66 : 34) * Number(document.querySelector('#zoom').value);
  const origin = [420, close ? 365 - 7 * scale * Math.sin(camera.elevation) : 155];
  const p = (x, y, z = 0) => project(camera, x, y, z, scale, origin);
  ctx.fillStyle = '#213a30';
  ctx.fillRect(0, 0, 840, 640);
  const grid = document.querySelector('#grid').checked;
  for (let x = 0; x < 11; x++)
    for (let y = 0; y < 11; y++) {
      polygon(
        ctx,
        [
          [x, y],
          [x + 1, y],
          [x + 1, y + 1],
          [x, y + 1],
        ].map((v) => p(...v)),
        tint('#536b43', 0.975 + ((x * 7 + y * 13) % 7) * 0.008),
        grid ? '#71816a' : null,
      );
      for (let i = 0; i < 8; i++) {
        const u = ((i * 37 + x * 17 + y * 3) % 97) / 97,
          v = ((i * 23 + y * 19 + x * 7) % 89) / 89;
        line(ctx, [p(x + u, y + v), p(x + u + 0.03, y + v + 0.03)], '#718253', 0.75);
      }
    }
  railPaths.forEach((path) => track(ctx, p, path));
  const meshes = [];
  for (const {
    b,
    r,
    at: [x, y],
  } of placements()) {
    const [w, h] = dimensions(b.tiles, r),
      palette = palettes[b.key];
    polygon(
      ctx,
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ].map((v) => p(...v, 0.006)),
      b.material === 'dirt' ? '#958769' : '#a29b82',
      grid ? '#e2c273' : null,
    );
    for (let u = 0.025; u < w - 0.1; u += 0.16)
      for (let v = 0.02; v < h - 0.1; v += 0.12)
        polygon(
          ctx,
          [
            [x + u, y + v],
            [x + u + 0.145, y + v],
            [x + u + 0.145, y + v + 0.103],
            [x + u, y + v + 0.103],
          ].map((q) => p(...q, 0.008)),
          tint(
            b.material === 'dirt' ? '#968565' : '#aca48c',
            0.91 + ((Math.round(u * 100) + Math.round(v * 200)) % 5) * 0.026,
          ),
        );
    meshes.push(...buildingMesh(b, r, [x, y], palette));
    const human = [x + w - 0.12, y + h - 0.09];
    // Same 1.8m reference at an illustrative 8m per tile, every camera and building.
    const [hx, hy] = p(...human, 0.01),
      [tx, ty] = p(...human, 0.185),
      [headX, headY] = p(...human, 0.225);
    meshes.push({
      p: [
        [human[0] - 0.026, human[1], 0.025],
        [human[0] + 0.026, human[1], 0.025],
        [human[0] + 0.026, human[1], 0.18],
        [human[0] - 0.026, human[1], 0.18],
      ],
      color: '#b56144',
      n: [0, 1, 0],
      bias: 0,
    });
    // Marker is drawn again after the geometry, outside the building shell.
    meshes.push({
      person: [hx, hy, tx, ty, headX, headY],
      p: [[...human, 0.225]],
      n: [0, 0, 1],
      color: '#d9bd8b',
    });
    const label = p(x + w / 2, y + h + 0.23);
    ctx.font = '12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8d7a6';
    ctx.fillText(`${names[b.key]} · ${r * 90}°`, ...label);
  }
  const view = [
    Math.cos(camera.elevation) / Math.SQRT2,
    Math.cos(camera.elevation) / Math.SQRT2,
    Math.sin(camera.elevation),
  ];
  meshes
    .filter((f) => f.n.reduce((s, n, i) => s + n * view[i], 0) > 0)
    .sort(
      (a, b) =>
        a.p.reduce((s, q) => s + depth(camera, q), 0) / a.p.length +
        (a.bias || 0) -
        b.p.reduce((s, q) => s + depth(camera, q), 0) / b.p.length -
        (b.bias || 0),
    )
    .forEach((f) => {
      if (f.person) {
        const [hx, hy, tx, ty, headX, headY] = f.person;
        line(
          ctx,
          [
            [hx, hy],
            [tx, ty],
          ],
          '#b76546',
          3,
        );
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(headX, headY, 1.8, 0, Math.PI * 2);
        ctx.fill();
      } else
        polygon(
          ctx,
          f.p.map((q) => p(...q)),
          f.color,
        );
    });
  if (document.querySelector('#axes').checked) {
    const o = [8.2, 8.2];
    line(ctx, [p(...o, 0.03), p(9.9, 8.2, 0.03)], '#e79b80', 2);
    line(ctx, [p(...o, 0.03), p(8.2, 9.9, 0.03)], '#86bbc6', 2);
    line(ctx, [p(...o, 0.03), p(...o, 1.7)], '#e7d69b', 2);
    ctx.font = '13px system-ui';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e5d6ac';
    ctx.fillText('Z', ...p(...o, 1.85));
  }
}
function drawOriginals() {
  const b = byId[select.value];
  document.querySelector('#asset-name').textContent = `${names[b.key]} · four generated facings`;
  originalCanvases.forEach((canvas, r) => {
    const ctx = canvas.getContext('2d'),
      [w, h] = dimensions(b.tiles, r),
      f = manifest.frames[`${b.key}-${r}`];
    const p = (x, y) => [160 + (x - y) * 52, 260 + (x + y) * 26];
    ctx.fillStyle = '#263e34';
    ctx.fillRect(0, 0, 320, 340);
    for (let x = -2; x < 3; x++)
      for (let y = -2; y < 3; y++)
        polygon(
          ctx,
          [
            [x, y],
            [x + 1, y],
            [x + 1, y + 1],
            [x, y + 1],
          ].map((q) => p(...q)),
          '#364c3f',
          '#607561',
        );
    polygon(
      ctx,
      [
        [-w / 2, -h / 2],
        [w / 2, -h / 2],
        [w / 2, h / 2],
        [-w / 2, h / 2],
      ].map((q) => p(...q)),
      '#7e8064',
      '#f2cd70',
    );
    ctx.drawImage(images[`${b.key}-${r}`], 160 - f.ax, 260 - f.ay, f.w, f.h);
    line(ctx, [p(-1.1, 1.2), p(1.1, 1.2)], '#e79b80', 2);
    line(ctx, [p(1.2, -1.1), p(1.2, 1.1)], '#86bbc6', 2);
  });
}
function render() {
  surfaces.forEach((c, i) => drawScene(c, cameras[i]));
  drawOriginals();
  window.projectionStudy = {
    ready: true,
    cameras: cameras.map((c) => ({ id: c.id, elevation: c.elevation })),
    asset: select.value,
    rotation,
    placements: placements().map((v) => ({
      key: v.b.key,
      rotation: v.r,
      tiles: v.b.tiles,
      anchor: v.at,
    })),
  };
}
document.querySelector('#rotate').onclick = () => {
  rotation = (rotation + 1) % 4;
  render();
};
for (const control of document.querySelectorAll('select,input'))
  control.addEventListener('input', render);
render();

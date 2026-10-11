import { Site } from './state.mjs';
import { drawModel } from './model.mjs';
import { drawIllustrated, assetManifest } from './illustrated.js';
import { footprint, rotatePoint } from '../grid-buildings/footprint.mjs';
const canvas = document.getElementById('world'),
  ctx = canvas.getContext('2d'),
  status = document.getElementById('status');
let site,
  rotation = 0,
  hover = null;
const assetSelect = document.getElementById('asset');
for (const b of assetManifest.buildings ?? []) {
  const option = document.createElement('option');
  option.value = b.key;
  option.textContent = `${b.id} · ${b.tiles} tile${b.tiles === 2 ? 's' : ''}`;
  assetSelect.append(option);
}
const selectedAsset = () => assetManifest.buildings?.find((b) => b.key === assetSelect.value);
const isBuilding = (tool) => ['house', 'station', 'asset'].includes(tool);
const selectedTiles = (tool) =>
  tool === 'asset' ? (selectedAsset()?.tiles ?? 1) : tool === 'station' ? 2 : 1;
const project = (x, y, z = 0) => [600 + (x - y) * 52, 135 + (x + y) * 26 - z * 70];
const drawBuilding = (...args) =>
  (document.getElementById('art').checked ? drawIllustrated : drawModel)(...args);
function polygon(points, fill, stroke) {
  ctx.beginPath();
  points.forEach((p, i) => {
    const [x, y] = project(...p);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}
const tile = (x, y, fill, stroke) =>
  polygon(
    [
      [x - 0.5, y - 0.5, 0],
      [x + 0.5, y - 0.5, 0],
      [x + 0.5, y + 0.5, 0],
      [x - 0.5, y + 0.5, 0],
    ],
    fill,
    stroke,
  );
function yard(b) {
  const material = assetManifest.buildings?.find((a) => a.key === b.asset)?.material ?? 'stone';
  const palette =
    material === 'dirt'
      ? ['#aa9168', '#b09b72', '#a18a62']
      : material === 'gravel'
        ? ['#96978d', '#a1a096', '#8b8e83']
        : ['#beb49b', '#c9bea4', '#b2ad99'];
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < b.tiles * 6; col++) {
      const x = col / 6 + 0.008,
        y = row / 8 + 0.008,
        w = 1 / 6 - 0.016,
        h = 1 / 8 - 0.016;
      const pts = [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ].map(([a, c]) => {
        const [u, v] = rotatePoint(a, c, b.tiles, b.rotation);
        return [u + b.x - 0.5, v + b.y - 0.5, 0];
      });
      polygon(pts, palette[(row + col) % 3]);
    }
}
function draw() {
  ctx.clearRect(0, 0, 1200, 740);
  for (let n = 0; n < 19; n++)
    for (let x = 0; x < 10; x++) {
      const y = n - x;
      if (y >= 0 && y < 10)
        tile(
          x,
          y,
          (x + y) % 2 ? '#536d43' : '#59734a',
          document.getElementById('grid').checked ? '#7d946e' : null,
        );
    }
  for (const key of site.tracks) {
    const [x, y] = key.split(',').map(Number);
    tile(x, y, '#8d8773');
    for (const d of [-0.15, 0.15]) {
      const a = project(x - 0.5, y + d),
        b = project(x + 0.5, y + d);
      ctx.beginPath();
      ctx.moveTo(...a);
      ctx.lineTo(...b);
      ctx.strokeStyle = '#d1d3c7';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  site.buildings.forEach(yard);
  const ordered = [...site.buildings].sort((a, b) => a.x + a.y - (b.x + b.y));
  for (const b of ordered) {
    drawBuilding(ctx, b.tiles, b.rotation, project, [b.x - 0.5, b.y - 0.5], b.asset);
    if (b.asset ? b.asset.startsWith('stations-') : b.tiles === 2) {
      const [x, y] = project(b.x, b.y + 0.5);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = site.served(b) ? '#68d4c5' : '#ecc16a';
      ctx.fill();
    }
  }
  const tool = document.getElementById('tool').value;
  if (hover) {
    const [x, y] = hover,
      tiles = selectedTiles(tool);
    const cells =
      (tool === 'rotate' || tool === 'remove') && site.at(x, y)
        ? footprint(site.at(x, y).x, site.at(x, y).y, site.at(x, y).tiles, site.at(x, y).rotation)
        : footprint(x, y, tiles, rotation);
    const valid = isBuilding(tool)
      ? site.valid(x, y, tiles, rotation)
      : tool === 'track'
        ? !site.at(x, y) && x >= 0 && y >= 0 && x < 10 && y < 10
        : true;
    ctx.lineWidth = 2;
    for (const [a, b] of cells)
      tile(a, b, valid ? '#8dc87940' : '#d25c5c65', valid ? '#afe992' : '#ff8b80');
    if (isBuilding(tool)) {
      ctx.globalAlpha = 0.45;
      drawBuilding(
        ctx,
        tiles,
        rotation,
        project,
        [x - 0.5, y - 0.5],
        tool === 'asset' ? selectedAsset()?.key : undefined,
      );
      ctx.globalAlpha = 1;
    }
  }
  document.getElementById('summary').textContent =
    `${site.buildings.length} buildings · ${site.tracks.size} track cells · preview facing ${rotation + 1}/4`;
  window.buildingPOC = { site, rotation, hover };
  window.buildingPOCReady = true;
}
function reset() {
  site = new Site();
  for (let x = 1; x < 9; x++) site.track(x, 5);
  site.place(3, 4, 2, 0);
  site.place(6, 2, 1, 1);
  site.place(2, 7, 1, 2);
  hover = null;
  status.textContent =
    'Example ready. Place a building or try rotating the station beside the track.';
  draw();
}
function pick(e) {
  const r = canvas.getBoundingClientRect(),
    sx = ((e.clientX - r.left) * canvas.width) / r.width,
    sy = ((e.clientY - r.top) * canvas.height) / r.height;
  return [
    Math.round(((sx - 600) / 52 + (sy - 135) / 26) / 2),
    Math.round(((sy - 135) / 26 - (sx - 600) / 52) / 2),
  ];
}
canvas.onpointermove = (e) => {
  hover = pick(e);
  draw();
};
canvas.onpointerleave = () => {
  hover = null;
  draw();
};
canvas.onclick = (e) => {
  const [x, y] = pick(e),
    tool = document.getElementById('tool').value;
  let ok = false;
  if (isBuilding(tool))
    ok = site.place(
      x,
      y,
      selectedTiles(tool),
      rotation,
      tool === 'asset' ? selectedAsset()?.key : undefined,
    );
  else if (tool === 'track') ok = site.track(x, y);
  else if (tool === 'rotate') ok = site.rotate(x, y);
  else ok = site.remove(x, y);
  status.textContent = ok
    ? 'Applied.'
    : 'Cannot apply here: check occupied cells, map edge or selection.';
  draw();
};
const rotate = () => {
  rotation = (rotation + 1) % 4;
  draw();
};
document.getElementById('rotate').onclick = rotate;
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) {
    e.preventDefault();
    rotate();
  }
});
document.getElementById('tool').onchange = draw;
assetSelect.onchange = () => {
  document.getElementById('tool').value = 'asset';
  draw();
};
document.getElementById('grid').onchange = draw;
document.getElementById('art').onchange = draw;
document.getElementById('reset').onclick = reset;
document.getElementById('save').onclick = () => {
  try {
    localStorage.setItem('terepasztal-building-poc-v1', JSON.stringify(site.serialize()));
    status.textContent = 'POC layout saved separately from game saves.';
  } catch {
    status.textContent = 'Browser storage unavailable.';
  }
};
document.getElementById('load').onclick = () => {
  try {
    const data = localStorage.getItem('terepasztal-building-poc-v1');
    if (!data) throw Error('No saved POC layout');
    site = Site.restore(JSON.parse(data));
    draw();
    status.textContent = 'POC layout loaded.';
  } catch (e) {
    status.textContent = e.message;
  }
};
reset();
const requestedAsset = new URLSearchParams(location.search).get('asset');
if (requestedAsset && assetManifest.buildings?.some((b) => b.key === requestedAsset)) {
  assetSelect.value = requestedAsset;
  document.getElementById('tool').value = 'asset';
  draw();
}

import { dimensions, rotatePoint, footprint, canPlace } from './footprint.mjs';
let rotation = 0,
  blocked = false;
const project = (x, y, z = 0) => [300 + (x - y) * 52, 100 + (x + y) * 26 - z * 70];
function drawModel(ctx, tiles) {
  const faces = [];
  const transform = ([x, y, z]) => {
    const [a, b] = rotatePoint(x, y, tiles, rotation);
    return [a + 1.5, b + 1.5, z];
  };
  function face(points, color, overlay = 0) {
    const p = points.map(transform);
    faces.push({
      p,
      color,
      depth: p.reduce((n, v) => n + v[0] + v[1] + v[2] * 1.5, 0) / p.length + overlay,
    });
  }
  function box(x, y, z, w, d, h, color) {
    face(
      [
        [x, y, z + h],
        [x + w, y, z + h],
        [x + w, y + d, z + h],
        [x, y + d, z + h],
      ],
      color[0],
    );
    face(
      [
        [x, y, z],
        [x + w, y, z],
        [x + w, y, z + h],
        [x, y, z + h],
      ],
      color[1],
    );
    face(
      [
        [x + w, y, z],
        [x + w, y + d, z],
        [x + w, y + d, z + h],
        [x + w, y, z + h],
      ],
      color[2],
    );
    face(
      [
        [x + w, y + d, z],
        [x, y + d, z],
        [x, y + d, z + h],
        [x + w, y + d, z + h],
      ],
      color[1],
    );
    face(
      [
        [x, y + d, z],
        [x, y, z],
        [x, y, z + h],
        [x, y + d, z + h],
      ],
      color[2],
    );
  }
  const x = 0.1,
    y = 0.14,
    w = tiles - 0.2,
    d = 0.59,
    eave = 0.8,
    ridge = 1.15;
  box(x, y, 0, w, d, eave, ['#e1d2ac', '#cdbb92', '#b7a77f']);
  // Roof planes and gable infill have fixed world geometry, not stretched pixels.
  const mid = y + d / 2;
  for (const end of [x, x + w])
    face(
      [
        [end, y, eave],
        [end, y + d, eave],
        [end, mid, ridge],
      ],
      '#d8c59c',
    );
  face(
    [
      [x - 0.025, y - 0.025, eave],
      [x + w + 0.025, y - 0.025, eave],
      [x + w + 0.025, mid, ridge],
      [x - 0.025, mid, ridge],
    ],
    '#65717b',
  );
  face(
    [
      [x - 0.025, mid, ridge],
      [x + w + 0.025, mid, ridge],
      [x + w + 0.025, y + d + 0.025, eave],
      [x - 0.025, y + d + 0.025, eave],
    ],
    '#46525e',
  );
  // Front and rear doors share dimensions on both building types.
  for (const wall of [rotation === 0 || rotation === 3 ? y + d + 0.003 : y - 0.003]) {
    const dx = tiles / 2 - 0.07;
    face(
      [
        [dx, wall, 0],
        [dx + 0.14, wall, 0],
        [dx + 0.14, wall, 0.46],
        [dx, wall, 0.46],
      ],
      '#294b3f',
      2,
    );
    for (const wx of tiles === 2 ? [0.3, 1.5] : [0.16, 0.71])
      face(
        [
          [wx, wall, 0.3],
          [wx + 0.12, wall, 0.3],
          [wx + 0.12, wall, 0.58],
          [wx, wall, 0.58],
        ],
        '#375b50',
        2,
      );
  }
  // Side windows make the rotated back and gable views distinguishable.
  for (const wall of [rotation < 2 ? x + w + 0.003 : x - 0.003])
    face(
      [
        [wall, 0.34, 0.31],
        [wall, 0.49, 0.31],
        [wall, 0.49, 0.56],
        [wall, 0.34, 0.56],
      ],
      '#375b50',
      2,
    );
  for (const cx of tiles === 2 ? [0.36, 1, 1.65] : [0.55]) {
    box(cx - 0.05, mid - 0.05, 0.97, 0.1, 0.1, 0.35, ['#dfcda6', '#cbb58b', '#b49b74']);
    box(cx - 0.04, mid - 0.04, 1.32, 0.035, 0.06, 0.09, ['#a66b48', '#935d41', '#754a34']);
  }
  if (tiles === 2) {
    box(0.1, 0.72, 0.65, 1.8, 0.22, 0.035, ['#eee0b8', '#c9b58e', '#b5a27e']);
    for (const px of [0.15, 0.7, 1.3, 1.85])
      box(px, 0.88, 0, 0.035, 0.035, 0.65, ['#476454', '#355342', '#2b4436']);
  }
  // Simple masonry courses; a geometry study, not the final illustrated texture.
  for (let z = 0.13; z < 0.79; z += 0.13) {
    face(
      [
        [x, y - 0.006, z],
        [x + w, y - 0.006, z],
        [x + w, y - 0.006, z + 0.008],
        [x, y - 0.006, z + 0.008],
      ],
      '#baa984',
    );
    face(
      [
        [x, y + d + 0.006, z],
        [x + w, y + d + 0.006, z],
        [x + w, y + d + 0.006, z + 0.008],
        [x, y + d + 0.006, z + 0.008],
      ],
      '#baa984',
    );
  }
  faces.sort((a, b) => a.depth - b.depth);
  for (const { p, color } of faces) {
    ctx.beginPath();
    p.forEach((v, i) => {
      const [a, b] = project(...v);
      if (i) ctx.lineTo(a, b);
      else ctx.moveTo(a, b);
    });
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
}
function poly(ctx, points, fill, stroke) {
  ctx.beginPath();
  points.forEach((p, i) => {
    const [x, y] = project(...p);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
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
function render() {
  for (const [id, tiles] of [
    ['house', 1],
    ['station', 2],
  ]) {
    const c = document.getElementById(id),
      ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    for (let n = 0; n <= 8; n++)
      for (let x = 0; x < 5; x++) {
        const y = n - x;
        if (y < 0 || y >= 5) continue;
        poly(
          ctx,
          [
            [x - 0.5, y - 0.5, 0],
            [x + 0.5, y - 0.5, 0],
            [x + 0.5, y + 0.5, 0],
            [x - 0.5, y + 0.5, 0],
          ],
          (x + y) % 2 ? '#536d43' : '#59734a',
          document.querySelector('#grid').checked ? '#7d946e' : null,
        );
      }
    const cells = footprint(2, 2, tiles, rotation),
      obstacles = new Set(blocked ? ['2,3'] : []),
      valid = canPlace(2, 2, tiles, rotation, obstacles);
    if (blocked)
      poly(
        ctx,
        [
          [1.5, 2.5, 0],
          [2.5, 2.5, 0],
          [2.5, 3.5, 0],
          [1.5, 3.5, 0],
        ],
        '#a16858',
      );
    if (document.querySelector('#yard').checked) {
      // Slabs are generated in building-local coordinates, clipped to the exact lot.
      for (let row = 0; row < 8; row++)
        for (let col = 0; col < tiles * 6; col++) {
          const x = col / 6 + 0.008,
            y = row / 8 + 0.008,
            w = 1 / 6 - 0.016,
            h = 1 / 8 - 0.016;
          const corners = [
            [x, y],
            [x + w, y],
            [x + w, y + h],
            [x, y + h],
          ].map(([a, b]) => {
            const [u, v] = rotatePoint(a, b, tiles, rotation);
            return [u + 1.5, v + 1.5, 0];
          });
          poly(ctx, corners, ['#beb49b', '#c9bea4', '#b2ad99'][(row * 7 + col * 3) % 3]);
        }
    }
    for (const [x, y] of cells) {
      ctx.lineWidth = 2;
      poly(
        ctx,
        [
          [x - 0.5, y - 0.5, 0],
          [x + 0.5, y - 0.5, 0],
          [x + 0.5, y + 0.5, 0],
          [x - 0.5, y + 0.5, 0],
        ],
        null,
        valid ? '#ebc77b' : '#ff9580',
      );
    }
    drawModel(ctx, tiles);
    const mark = [
      [tiles / 2 - 0.1, 0.99],
      [tiles / 2 + 0.1, 0.99],
      [tiles / 2, 1.08],
    ].map(([x, y]) => {
      const [a, b] = rotatePoint(x, y, tiles, rotation);
      return [a + 1.5, b + 1.5, 0];
    });
    poly(ctx, mark, '#67d0c5');
    const [w, h] = dimensions(tiles, rotation);
    document.getElementById(id + '-status').textContent =
      `${w} × ${h} · ${cells.length} occupied cell${tiles === 2 ? 's' : ''} · ${valid ? 'Placement valid' : 'Blocked: second cell occupied'}`;
  }
  document.getElementById('facing').textContent = [
    'South-east',
    'South-west',
    'North-west',
    'North-east',
  ][rotation];
  window.gridBuildingsReady = true;
  window.gridBuildingState = { rotation, blocked };
}
document.getElementById('rotate').onclick = () => {
  rotation = (rotation + 1) % 4;
  render();
};
document.getElementById('block').onclick = () => {
  blocked = !blocked;
  render();
};
document.querySelectorAll('input').forEach((e) => (e.onchange = render));
render();

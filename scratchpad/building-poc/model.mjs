import { rotatePoint } from '../grid-buildings/footprint.mjs';
export function drawModel(ctx, tiles, rotation, project, anchor) {
  const faces = [];
  const transform = ([x, y, z]) => {
    const [a, b] = rotatePoint(x, y, tiles, rotation);
    return [a + anchor[0], b + anchor[1], z];
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

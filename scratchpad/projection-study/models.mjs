import { rotatePoint } from '../grid-buildings/footprint.mjs';

export function tint(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  return (
    '#' +
    [n >> 16, (n >> 8) & 255, n & 255]
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v * factor)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

// Deliberately explicit proxy geometry; no claim of recovering 3D from a bitmap.
export function buildingMesh(building, rotation, anchor, palette) {
  const faces = [],
    tiles = building.tiles;
  const point = ([x, y, z]) => {
    const [a, b] = rotatePoint(x, y, tiles, rotation);
    return [a + anchor[0], b + anchor[1], z];
  };
  const normal = ([x, y, z]) =>
    [
      [x, y, z],
      [-y, x, z],
      [-x, -y, z],
      [y, -x, z],
    ][rotation];
  function face(p, color, n = [0, 0, 1], bias = 0) {
    faces.push({ p: p.map(point), color, n: normal(n), bias });
  }
  function box(x, y, z, w, d, h, color) {
    face(
      [
        [x, y, z + h],
        [x + w, y, z + h],
        [x + w, y + d, z + h],
        [x, y + d, z + h],
      ],
      tint(color, 1.08),
    );
    face(
      [
        [x, y, z],
        [x + w, y, z],
        [x + w, y, z + h],
        [x, y, z + h],
      ],
      color,
      [0, -1, 0],
    );
    face(
      [
        [x, y + d, z],
        [x + w, y + d, z],
        [x + w, y + d, z + h],
        [x, y + d, z + h],
      ],
      color,
      [0, 1, 0],
    );
    face(
      [
        [x, y, z],
        [x, y + d, z],
        [x, y + d, z + h],
        [x, y, z + h],
      ],
      tint(color, 0.9),
      [-1, 0, 0],
    );
    face(
      [
        [x + w, y, z],
        [x + w, y + d, z],
        [x + w, y + d, z + h],
        [x + w, y, z + h],
      ],
      tint(color, 0.9),
      [1, 0, 0],
    );
  }
  function wallDetail(x, y, z, w, h, color, front = true) {
    face(
      [
        [x, y, z],
        [x + w, y, z],
        [x + w, y, z + h],
        [x, y, z + h],
      ],
      color,
      [0, front ? 1 : -1, 0],
      0.002,
    );
  }
  function gable(x, y, w, d, h, rise, wall = palette.wall) {
    box(x, y, 0, w, d, h, wall);
    const mid = y + d / 2;
    for (const end of [0, 1])
      face(
        [
          [x + end * w, y, h],
          [x + end * w, y + d, h],
          [x + end * w, mid, h + rise],
        ],
        wall,
        [end ? 1 : -1, 0, 0],
      );
    // Slate courses follow a rigid roof plane at every camera elevation.
    const cols = Math.ceil(w / 0.1),
      rows = 6;
    for (const side of [-1, 1])
      for (let u = 0; u < cols; u++)
        for (let v = 0; v < rows; v++) {
          const a = x + (w * u) / cols,
            b = x + (w * (u + 1)) / cols;
          const ya = mid + (side * d * 0.5 * v) / rows,
            yb = mid + (side * d * 0.5 * (v + 1)) / rows;
          const za = h + rise * (1 - v / rows),
            zb = h + rise * (1 - (v + 1) / rows);
          face(
            [
              [a, ya, za],
              [b, ya, za],
              [b, yb, zb],
              [a, yb, zb],
            ],
            tint(palette.roof, 0.9 + ((u * 13 + v * 7) % 9) * 0.024),
            [0, (side * rise) / (d / 2), 1],
          );
        }
    // Masonry texture in object coordinates, never screen coordinates.
    for (let row = 0; row < Math.floor(h / 0.09); row++)
      for (let col = 0; col < Math.floor(w / 0.13); col++) {
        const a = x + 0.012 + col * 0.13 + (row % 2) * 0.045;
        if (a + 0.11 > x + w) continue;
        for (const front of [false, true])
          wallDetail(
            a,
            y + (front ? d + 0.001 : -0.001),
            0.015 + row * 0.09,
            0.11,
            0.071,
            tint(wall, 0.94 + ((row * 3 + col) % 5) * 0.024),
            front,
          );
      }
    for (const front of [false, true]) {
      const wy = y + (front ? d + 0.003 : -0.003);
      wallDetail(x + w * 0.46, wy, 0, 0.13, 0.28, palette.door, front);
      for (let wx = x + 0.15; wx < x + w - 0.15; wx += 0.34) {
        if (Math.abs(wx - (x + w * 0.46)) < 0.15) continue;
        wallDetail(wx, wy, 0.3, 0.105, 0.14, '#bfae82', front);
        wallDetail(wx + 0.012, wy + (front ? 0.002 : -0.002), 0.312, 0.08, 0.114, '#35534d', front);
      }
    }
  }
  function cylinder(x, y, z, r, h, color) {
    const top = [];
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6,
        b = ((i + 1) * Math.PI) / 6;
      const p = [x + r * Math.cos(a), y + r * Math.sin(a)],
        q = [x + r * Math.cos(b), y + r * Math.sin(b)];
      top.push([...p, z + h]);
      face(
        [
          [...p, z],
          [...q, z],
          [...q, z + h],
          [...p, z + h],
        ],
        tint(color, 0.87 + 0.13 * Math.cos(a)),
        [Math.cos((a + b) / 2), Math.sin((a + b) / 2), 0],
      );
    }
    face(top, tint(color, 1.1));
  }
  const key = building.key;
  if (key === 'stations-farm') {
    gable(0.12, 0.15, 1.22, 0.65, 0.52, 0.32, tint(palette.wall, 0.88));
    cylinder(1.61, 0.4, 0, 0.21, 0.96, '#a59d7c');
    cylinder(1.61, 0.4, 0.96, 0.22, 0.065, palette.roof);
    for (let i = 0; i < 3; i++) box(1.35 + i * 0.14, 0.78, 0, 0.12, 0.12, 0.14, '#b99e58');
  } else if (key === 'stations-lumber') {
    gable(0.12, 0.12, 1.23, 0.58, 0.48, 0.23, '#94794f');
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 2; j++) box(1.43, 0.18 + i * 0.15, j * 0.11, 0.42, 0.12, 0.09, '#b19161');
  } else if (key === 'stations-quarry') {
    gable(0.12, 0.17, 0.82, 0.62, 0.56, 0.25);
    box(1.08, 0.28, 0, 0.73, 0.35, 0.25, '#8d9890');
    box(1.27, 0.35, 0.25, 0.3, 0.2, 0.35, palette.roof);
    for (let i = 0; i < 4; i++)
      box(1.03 + i * 0.2, 0.75, 0, 0.17, 0.16, 0.1 + (i % 2) * 0.04, '#b6b4a2');
  } else if (key === 'stations-pump') {
    gable(0.13, 0.16, 0.57, 0.56, 0.52, 0.2);
    cylinder(0.8, 0.67, 0, 0.1, 0.4, '#6b7b6c');
    box(0.63, 0.67, 0.13, 0.19, 0.07, 0.07, '#667b72');
  } else if (key === 'stations-town') {
    gable(0.12, 0.14, 1.76, 0.65, 0.98, 0.3);
    box(0.83, 0.58, 0, 0.36, 0.3, 1.24, palette.wall);
    box(0.79, 0.54, 1.24, 0.44, 0.37, 0.065, palette.roof);
    wallDetail(0.97, 0.885, 0.9, 0.1, 0.12, '#eee1ba');
    for (let i = 0; i < 3; i++)
      box(0.68 + i * 0.02, 0.86 + i * 0.035, 0, 0.64 - i * 0.04, 0.08, 0.09 - i * 0.025, '#b4a580');
    wallDetail(0.94, 0.886, 0.09, 0.14, 0.28, palette.door);
  } else {
    const height = key === 'stations-warehouse' ? 0.72 : 0.57;
    gable(0.12, 0.15, tiles - 0.24, 0.62, height, 0.29);
    if (key === 'station') {
      box(0.12, 0.76, 0.44, 1.75, 0.19, 0.045, '#c9bc96');
      for (const x of [0.17, 0.7, 1.25, 1.8]) box(x, 0.9, 0, 0.035, 0.035, 0.44, palette.door);
    }
    if (key === 'stations-warehouse')
      for (const x of [0.35, 1.18]) wallDetail(x, 0.775, 0, 0.31, 0.43, palette.door);
    for (const x of tiles === 2 ? [0.36, 1.6] : [0.46])
      box(x, 0.4, height + 0.18, 0.095, 0.1, 0.29, palette.wall);
  }
  return faces;
}

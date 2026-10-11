export const cameras = [
  {
    id: 'lower',
    name: 'Lower dimetric',
    elevation: Math.asin(Math.tan(Math.PI / 12)),
    note: '15° ground edges · 3.732:1 tiles',
  },
  {
    id: 'current',
    name: 'Current game · 2:1',
    elevation: Math.PI / 6,
    note: '26.565° ground edges · 2:1 tiles',
  },
  {
    id: 'isometric',
    name: 'True isometric',
    elevation: Math.asin(1 / Math.sqrt(3)),
    note: '30° ground edges · 1.732:1 tiles',
  },
];
// Equal world units on X/Y/Z. Azimuth is 45° for every camera.
// Width stays constant across comparisons; neither sprites nor scene are squashed.
export function project(camera, x, y, z = 0, scale = 32, origin = [420, 155]) {
  return [
    origin[0] + (x - y) * scale,
    origin[1] +
      (x + y) * scale * Math.sin(camera.elevation) -
      z * scale * Math.SQRT2 * Math.cos(camera.elevation),
  ];
}
export function depth(camera, [x, y, z]) {
  return ((x + y) * Math.cos(camera.elevation)) / Math.SQRT2 + z * Math.sin(camera.elevation);
}

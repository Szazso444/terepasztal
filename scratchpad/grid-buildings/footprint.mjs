export function dimensions(tiles, rotation) {
  if (![1, 2].includes(tiles)) throw new Error('Buildings occupy one or two cells');
  return tiles === 1 || rotation % 2 === 0 ? [tiles, 1] : [1, tiles];
}
export function rotatePoint(x, y, tiles, rotation) {
  switch (((rotation % 4) + 4) % 4) {
    case 0:
      return [x, y];
    case 1:
      return [1 - y, x];
    case 2:
      return [tiles - x, 1 - y];
    default:
      return [y, tiles - x];
  }
}
export function footprint(x, y, tiles, rotation) {
  const [w, h] = dimensions(tiles, rotation),
    cells = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.push([x + dx, y + dy]);
  return cells;
}
export function canPlace(x, y, tiles, rotation, blocked, bounds = 5) {
  return footprint(x, y, tiles, rotation).every(
    ([a, b]) => a >= 0 && b >= 0 && a < bounds && b < bounds && !blocked.has(`${a},${b}`),
  );
}

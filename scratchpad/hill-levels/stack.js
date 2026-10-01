// Preview only: bridge scenes for the textured style and the stacking options.
import { levelAt } from '/src/world/elevation.ts';

/** A dry patch of 24 x 11 tiles with nothing built on it (its terrain is rewritten). */
function findSite(g) {
  const m = g.map;
  for (let y = 24; y < m.h - 24; y++)
    for (let x = 12; x < m.w - 34; x++) {
      let ok = true;
      for (let dy = -5; dy <= 5 && ok; dy++)
        for (let dx = -2; dx < 22 && ok; dx++) {
          const k = (y + dy) * m.w + x + dx;
          ok =
            m.terrain[k] !== 3 &&
            !g.builder.decorAt?.(x + dx, y + dy) &&
            !g.track.has(x + dx, y + dy) &&
            !g.builder.buildingAt(x + dx, y + dy) &&
            !g.builder.stationAt(x + dx, y + dy);
        }
      if (ok) return { x0: x, y };
    }
  throw new Error('No open site');
}
function layRow(g, x0, y, from, to) {
  for (let i = from; i <= to; i++)
    for (const r of [0, 1]) {
      const x = x0 + i;
      g.map.props.delete(y * g.map.w + x);
      if (!g.builder.placeTrackKind(x, y, 'straight', r)) continue;
      const link = g.track.get(x, y).links[0];
      if (link.includes(1) && link.includes(3)) break;
      g.builder.removeTrack(x, y);
    }
}
/**
 * A river cutting through a level-2 ridge. `bridged` lists the tiles (by offset) that get
 * platforms; `stacks` extra platforms on top (each raises its deck a level above the bank rule).
 */
export function ridgeRiver(g, bridgeId, bridged, extra = 0, site = findSite(g)) {
  const w = g.world,
    m = g.map,
    { x0, y } = site;
  for (let dy = -5; dy <= 5; dy++)
    for (let dx = -2; dx < 22; dx++) {
      m.props.delete((y + dy) * m.w + x0 + dx);
      m.terrain[(y + dy) * m.w + x0 + dx] = 0;
    }
  for (let i = 1; i <= 17; i++)
    for (let dy = -2; dy <= 2; dy++) m.terrain[(y + dy) * m.w + x0 + i] = 2;
  for (let i = 8; i <= 10; i++)
    for (let dy = -5; dy <= 5; dy++) m.terrain[(y + dy) * m.w + x0 + i] = 3;
  for (let dy = -5; dy <= 5; dy++) for (let dx = -2; dx < 22; dx++) w.retile(x0 + dx, y + dy);
  const levels = Array.from({ length: 19 }, (_, i) => levelAt(m, x0 + i, y));
  for (const i of bridged)
    if (!g.builder.placeBuilding(x0 + i, y, bridgeId)) throw new Error('bridge ' + i);
  layRow(g, x0, y, -1, 19);
  return { x0, y, levels, site };
}
/** Explicit deck levels for bridge tiles (the stacking preview), then a rail refresh. */
export function setDecks(g, x0, y, decks) {
  g.bridgeDecks.clear();
  for (const [i, level] of Object.entries(decks))
    g.bridgeDecks.set(y * g.map.w + x0 + Number(i), level);
  g.railsDirty = true;
}
/** Remove everything a scene placed, so the next one starts from the same ground. */
export function clear(g, x0, y) {
  for (let i = -2; i <= 21; i++) {
    const x = x0 + i;
    if (g.track.has(x, y)) g.builder.removeTrack(x, y);
    const b = g.builder.buildingAt(x, y);
    if (b) g.builder.removeBuilding?.(x, y) ?? g.builder.demolish?.(x, y);
  }
  g.bridgeDecks.clear();
  g.railsDirty = true;
}

// Preview only: stamps the worked example from the incline rules into the review map (a climb
// 0 -> 1 -> 2, a bridged dip, a descent), lays it with the Builder and swaps trains onto it.
import { Train } from '/src/sim/trains.ts';
import { content } from '/src/data/content.ts';
import { levelAt } from '/src/world/elevation.ts';

export const LEVELS = [0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 1, 2, 2, 1, 0, 0];
export const BRIDGE = [11, 12, 13];
export const CONSISTS = {
  small: ['rocket', ['wooden_coach', 'wooden_coach']],
  medium: ['flying_scotsman', ['steel_coach', 'steel_coach', 'pullman']],
  large: ['big_boy', ['steel_hopper', 'steel_hopper', 'steel_hopper', 'steel_hopper']],
};

/** An open grass patch of 22 x 9 tiles with nothing on it. */
function findSite(g) {
  const m = g.map;
  for (let y = 20; y < m.h - 20; y++)
    for (let x = 12; x < m.w - 34; x++) {
      let ok = true;
      for (let dy = -4; dy <= 4 && ok; dy++)
        for (let dx = -2; dx < 20 && ok; dx++) {
          const k = (y + dy) * m.w + x + dx;
          ok = (m.terrain[k] === 0 || m.terrain[k] === 1) && !g.track.has(x + dx, y + dy) && !g.builder.buildingAt(x + dx, y + dy) && !g.builder.stationAt(x + dx, y + dy);
        }
      if (ok) return { x0: x, y };
    }
  throw new Error('No open site');
}

export async function stamp(g, bridgeId = 'bridge_stone') {
  const w = g.world,
    m = g.map,
    { x0, y } = findSite(g),
    hill = new Set();
  // Hill under every raised line tile and on both sides, grass north of the level-1 tiles that
  // must stay at 1 inside the hill (the terrain decides levels, as in the game).
  for (let i = 6; i <= 15; i++) for (let dy = -1; dy <= 2; dy++) hill.add(`${x0 + i},${y + dy}`);
  for (const i of [7, 8, 12]) hill.delete(`${x0 + i},${y - 1}`);
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -2; dx < 20; dx++) {
      m.props.delete((y + dy) * m.w + x0 + dx);
      m.terrain[(y + dy) * m.w + x0 + dx] = 0;
    }
  for (const key of hill) {
    const [x, yy] = key.split(',').map(Number);
    m.terrain[yy * m.w + x] = 2;
  }
  for (let dy = -3; dy <= 4; dy++) for (let dx = -1; dx < 20; dx++) w.retile(x0 + dx, y + dy);
  const levels = LEVELS.map((_, i) => levelAt(m, x0 + i, y));
  if (levels.join() !== LEVELS.join()) throw new Error('Stamp levels ' + levels.join());
  for (const i of BRIDGE) if (!g.builder.placeBuilding(x0 + i, y, bridgeId)) throw new Error('bridge ' + i);
  let laid = 0;
  for (let i = 0; i < LEVELS.length; i++)
    for (const r of [0, 1]) {
      const x = x0 + i;
      if (!g.builder.placeTrackKind(x, y, 'straight', r)) continue;
      const link = g.track.get(x, y).links[0];
      if (link.includes(1) && link.includes(3)) {
        laid++;
        break;
      }
      g.builder.removeTrack(x, y);
    }
  return { x0, y, laid, levels };
}

let uid = 89000;
/** A train with its head at tile `head`, heading east, its consist trailing west. */
export function place(g, site, size, head) {
  g.fleet.trains = g.fleet.trains.filter((t) => t.name !== 'Climber');
  if (!size) return;
  const [loco, wagons] = CONSISTS[size];
  const t = new Train([{ uid: ++uid, def: content.locomotives.find((d) => d.id === loco), level: 0 }], 'Climber', uid);
  t.wagons = wagons.map((id) => ({ uid: ++uid, def: content.wagons.find((d) => d.id === id), level: 0, cargo: null, amount: 0 }));
  if (!t.spawnAt(g.track, site.x0 + head, site.y, 3)) throw new Error('spawn failed ' + size);
  g.fleet.trains = [...g.fleet.trains, t];
}

/** A valley two levels deep between two level-2 hills, bridged at level 2 by platforms. */
export async function valley(g, bridgeId) {
  const w = g.world,
    m = g.map,
    { x0, y } = findSite(g);
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -2; dx < 20; dx++) {
      m.props.delete((y + dy) * m.w + x0 + dx);
      m.terrain[(y + dy) * m.w + x0 + dx] = 0;
    }
  for (let i = 2; i <= 14; i++) if (i !== 8) for (let dy = -2; dy <= 2; dy++) m.terrain[(y + dy) * m.w + x0 + i] = 2;
  for (let dy = -3; dy <= 4; dy++) for (let dx = -1; dx < 20; dx++) w.retile(x0 + dx, y + dy);
  const levels = Array.from({ length: 17 }, (_, i) => levelAt(m, x0 + i, y));
  for (const i of [7, 8, 9]) if (!g.builder.placeBuilding(x0 + i, y, bridgeId)) throw new Error('bridge ' + i);
  for (let i = 0; i < 17; i++)
    for (const r of [0, 1]) {
      const x = x0 + i;
      if (!g.builder.placeTrackKind(x, y, 'straight', r)) continue;
      const link = g.track.get(x, y).links[0];
      if (link.includes(1) && link.includes(3)) break;
      g.builder.removeTrack(x, y);
    }
  return { x0, y, levels };
}

/** A straight bridge over the widest short water crossing: platforms on the water, rails across. */
export function river(g, bridgeId) {
  const m = g.map;
  let best = null;
  for (let y = 16; y < m.h - 16; y++)
    for (let x = 8; x < m.w - 16; x++) {
      const at = (xx) => m.terrain[y * m.w + xx];
      if (at(x) === 3 || at(x + 1) !== 3) continue;
      let n = 0;
      while (at(x + 1 + n) === 3 && n < 8) n++;
      if (n < 2 || n > 6 || at(x + 1 + n) === 3) continue;
      let clear = true;
      for (let i = -1; i <= n + 2 && clear; i++) {
        const xx = x + i;
        clear = !g.track.has(xx, y) && !g.builder.buildingAt(xx, y) && ![4, 6].includes(at(xx));
      }
      if (clear && (!best || n > best.n)) best = { x0: x, y, n };
    }
  if (!best) throw new Error('No river crossing');
  const { x0, y, n } = best;
  for (let i = 1; i <= n; i++) if (!g.builder.placeBuilding(x0 + i, y, bridgeId)) throw new Error('bridge');
  for (let i = -1; i <= n + 2; i++)
    for (const r of [0, 1]) {
      const x = x0 + i;
      m.props.delete(y * m.w + x);
      if (!g.builder.placeTrackKind(x, y, 'straight', r)) continue;
      const link = g.track.get(x, y).links[0];
      if (link.includes(1) && link.includes(3)) break;
      g.builder.removeTrack(x, y);
    }
  return best;
}

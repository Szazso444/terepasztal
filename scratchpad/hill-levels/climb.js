// Preview only: lays a straight climb with the Builder and swaps small, medium and large trains
// onto it, so the tilt can be judged at different level heights.
import { Train } from '/src/sim/trains.ts';
import { content } from '/src/data/content.ts';
import { levelAt } from '/src/world/elevation.ts';

export const CONSISTS = {
  small: ['rocket', ['wooden_coach', 'wooden_coach']],
  medium: ['flying_scotsman', ['steel_coach', 'steel_coach', 'pullman']],
  large: ['big_boy', ['steel_hopper', 'steel_hopper', 'steel_hopper', 'steel_hopper']],
};

/** A straight east-west run of 16 free open tiles that climbs from ground to level 2 or more. */
function findClimb(g) {
  const map = g.map;
  let best = null;
  for (let y = 16; y < map.h - 16; y++)
    for (let x0 = 16; x0 < map.w - 32; x0++) {
      if (levelAt(map, x0, y) !== 0) continue;
      const levels = [];
      for (let x = x0; x < x0 + 16; x++) {
        if (g.track.has(x, y) || ![0, 2].includes(map.terrain[y * map.w + x]) || map.props.has(y * map.w + x)) break;
        levels.push(levelAt(map, x, y));
      }
      if (levels.length < 16) continue;
      const hi = Math.max(...levels),
        top = levels.indexOf(hi),
        score = hi * 10 - Math.abs(top - 9);
      if (hi >= 2 && top >= 6 && (!best || score > best.score)) best = { x0, y, len: 16, hi, score };
    }
  return best;
}

export function lay(g) {
  const run = findClimb(g);
  if (!run) throw new Error('No climb found');
  let laid = 0;
  for (let i = 0; i < run.len; i++)
    for (const r of [0, 1]) {
      const x = run.x0 + i;
      if (!g.builder.placeTrackKind(x, run.y, 'straight', r)) continue;
      const link = g.track.get(x, run.y).links[0];
      if (link.includes(1) && link.includes(3)) {
        laid++;
        break;
      }
      g.builder.removeTrack(x, run.y);
    }
  run.laid = laid;
  run.levels = Array.from({ length: run.len }, (_, i) => levelAt(g.map, run.x0 + i, run.y));
  return run;
}

let uid = 88000;
export function place(g, run, size) {
  g.fleet.trains = g.fleet.trains.filter((t) => t.name !== 'Climber');
  if (!size) return null;
  const [loco, wagons] = CONSISTS[size];
  const t = new Train([{ uid: ++uid, def: content.locomotives.find((d) => d.id === loco), level: 0 }], 'Climber', uid);
  t.wagons = wagons.map((id) => ({ uid: ++uid, def: content.wagons.find((d) => d.id === id), level: 0, cargo: null, amount: 0 }));
  // Head on the first tile of the top level, heading east (uphill), consist trailing down the bank.
  const top = run.levels.indexOf(run.hi);
  const head = run.x0 + Math.max(top, 6);
  if (!t.spawnAt(g.track, head, run.y, 3)) throw new Error('spawn failed ' + size);
  g.fleet.trains = [...g.fleet.trains, t];
  return head;
}

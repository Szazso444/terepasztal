// Preview only: lays a straight line of real track over a hill with the Builder and puts a train
// on the climb, so the rails-on-hills rules can be seen in the game renderer.
import { Train } from '/src/sim/trains.ts';
import { content } from '/src/data/content.ts';

/** Longest straight run along +x of tiles that carry a climbing rail and actually climb. */
function findClimb(g) {
  const w = g.world,
    map = g.map;
  let best = null;
  for (let y = 12; y < map.h - 12; y++)
    for (let x0 = 8; x0 < map.w - 20; x0++) {
      let x = x0,
        lo = Infinity,
        hi = -Infinity;
      while (
        x < map.w - 8 &&
        !g.track.has(x, y) &&
        [0, 1, 2].includes(map.terrain[y * map.w + x]) &&
        w.groundAllows(x, y, 'straight')
      ) {
        const z = w.elevationOf(x, y);
        lo = Math.min(lo, z);
        hi = Math.max(hi, z);
        x++;
      }
      const len = x - x0,
        rise = hi - lo;
      if (len >= 8 && rise > 15 && (!best || rise * len > best.rise * best.len))
        best = { x0, y, len: Math.min(len, 14), rise };
    }
  return best;
}

export function climb(g) {
  const run = findClimb(g);
  if (!run) throw new Error('No climbable hill line found');
  let laid = 0;
  for (let i = 0; i < run.len; i++) {
    const x = run.x0 + i;
    // The straight rotation that runs east-west (links E and W) along the climb.
    for (const r of [0, 1]) {
      if (!g.builder.placeTrackKind(x, run.y, 'straight', r)) continue;
      const link = g.track.get(x, run.y).links[0];
      if (link.includes(1) && link.includes(3)) {
        laid++;
        break;
      }
      g.builder.removeTrack(x, run.y);
    }
  }
  const t = new Train(
    [{ uid: 87001, def: content.locomotives.find((d) => d.id === 'rocket'), level: 0 }],
    'Climber',
    87001,
  );
  t.wagons = [1, 2].map((k) => ({
    uid: 87001 + k,
    def: content.wagons.find((d) => d.id === 'wooden_coach'),
    level: 0,
    cargo: null,
    amount: 0,
  }));
  // Head of the train where the line climbs most, with room for the consist behind it.
  const z = (i) => g.world.elevationOf(run.x0 + i, run.y);
  let steepest = 5;
  for (let i = 5; i < run.len; i++)
    if (Math.abs(z(i) - z(i - 3)) > Math.abs(z(steepest) - z(steepest - 3))) steepest = i;
  const head = run.x0 + steepest;
  if (!t.spawnAt(g.track, head, run.y, 3)) throw new Error('Train spawn on the climb failed');
  g.fleet.trains = [...g.fleet.trains, t];
  return { ...run, laid, head };
}

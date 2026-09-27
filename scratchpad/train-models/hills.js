// A consist standing on a real climbing line in the generated review world
// (scratchpad/terrain-production/): each body part and bogie should stand on the surface under it.
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
      if (len >= 10 && rise > 15 && (!best || rise * len > best.rise * best.len))
        best = { x0, y, len: Math.min(len, 16), rise };
    }
  return best;
}

let run = null;
export function layClimb(g) {
  if (run) return run;
  run = findClimb(g);
  if (!run) throw new Error('No climbable hill line found');
  let laid = 0;
  for (let i = 0; i < run.len; i++) {
    const x = run.x0 + i;
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
  const z = (i) => g.world.elevationOf(run.x0 + i, run.y);
  let steepest = 6;
  for (let i = 6; i < run.len; i++)
    if (Math.abs(z(i) - z(i - 3)) > Math.abs(z(steepest) - z(steepest - 3))) steepest = i;
  run = { ...run, laid, head: run.x0 + steepest };
  return run;
}

let base = null;
export function standOnClimb(g, locoIds, wagonIds) {
  const r = layClimb(g);
  // the review world's own train stays (its scene checks it on every render)
  base ??= [...g.fleet.trains];
  for (const old of g.fleet.trains) if (!base.includes(old)) g.trainRenderer.remove(old.id);
  const t = new Train(
    locoIds.map((id, i) => ({
      uid: 87001 + i,
      def: content.locomotives.find((d) => d.id === id),
      level: 0,
    })),
    'Climber',
    87001,
  );
  t.wagons = wagonIds.map((id, k) => ({
    uid: 87101 + k,
    def: content.wagons.find((d) => d.id === id),
    level: 0,
    cargo: null,
    amount: 0,
  }));
  if (!t.spawnAt(g.track, r.head, r.y, 3)) throw new Error('Train spawn on the climb failed');
  g.fleet.trains = [...base, t];
  const p = t.vehiclePoses[0];
  return { ...r, x: p.x, y: p.y };
}

// frames the rendered atlases supply, so the current look can be shown at the same pose
const supplied = new Map();
export async function loadSupplied(g) {
  for (const group of ['rolling', 'wagons']) {
    const res = await fetch(`/assets/${group}.json`);
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) continue;
    for (const key of Object.keys((await res.json()).frames))
      supplied.set(key, g.atlas.frames.get(key));
  }
  return supplied.size;
}
export function useNew(g, on) {
  for (const [k, v] of supplied) {
    if (on) g.atlas.frames.set(k, v);
    else g.atlas.frames.delete(k);
  }
}

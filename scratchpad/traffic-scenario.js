import { Train } from '/src/sim/trains.ts';
import { content } from '/src/data/content.ts';
import { findPath } from '/src/world/pathfinding.ts';
import { Dir } from '/src/engine/iso.ts';

export function scenario(count = 3, pinned = false) {
  const g = window.game;
  g.closeMenus();
  g.settings.autosave = false;
  g.clock.setSpeed(0);
  g.app.ticker.stop();
  const y = 110;
  for (let x = 20; x <= 125; x++) g.track.place(x, y, 'straight', 1);
  for (const x of count > 3 && !pinned ? [50, 60, 70, 80, 90, 100] : [100]) {
    g.track.place(x, y, 'switch', 1);
    for (let sy = y + 1; sy <= y + 8; sy++) g.track.place(x, sy, 'straight', 0);
  }
  const trains = [];
  const destinations = new Map();
  const finished = new Set();
  const make = (id, head, entry, dest) => {
    const def = content.locomotives.find((d) => d.id === 'f7');
    const train = new Train([{ uid: 1000 + id, def, level: 0 }], 'Traffic test ' + id, 100 + id);
    train.spawnAt(g.track, head, y, entry);
    train.oil = 1e6;
    train.coal = 1e6;
    train.water = 1e6;
    const path = findPath(g.track, { x: head, y, in: entry }, (x, sy) => x === dest && sy === y);
    if (!path) throw new Error('Missing fixture route');
    train.setPath(path, g.map, g.track);
    train.trackVersion = g.track.version;
    train.state = 'moving';
    trains.push(train);
    g.fleet.trains.push(train);
    destinations.set(train.id, dest);
  };
  make(1, 103, Dir.W, 120);
  make(2, 109, Dir.E, 92);
  make(3, 97, Dir.W, 120);
  for (let id = 4; id <= count; id++)
    if (pinned && id === 4) make(id, 115, Dir.E, 92);
    else make(id, 97 - (id - 3) * 5, Dir.W, 120);
  const before = trains.map((t) => ({ id: t.id, x: t.headTile.x, y: t.headTile.y }));
  let maxActive = 0,
    tick = 0,
    maxTickMs = 0;
  const frames = [];
  for (; tick < 4800; tick++) {
    const now = tick / 20;
    // One-shot virtual exits keep this fixture focused on traffic, not platform loading.
    // A yielded train resumes its original trip only when a clear route exists; arrivals
    // leave the fixture so an intentionally missing station cannot become a permanent jam.
    for (const train of trains) {
      if (finished.has(train.id) || train.state !== 'yielding') continue;
      const avoid = (x, sy) =>
        g.fleet.occupied(x, sy, train.id) || g.traffic.claimedBy(x, sy, train.id) !== null;
      for (const flip of [false, true]) {
        const preview = Object.assign(Object.create(Object.getPrototypeOf(train)), train);
        if (flip) preview.reverseConsist();
        const head = preview.trail.at(-1).seg;
        const path = findPath(
          g.track,
          head,
          (x, sy) => x === destinations.get(train.id) && sy === y,
          10000,
          avoid,
        );
        if (!path) continue;
        if (flip) train.reverseConsist();
        train.setPath(path, g.map, g.track);
        train.state = 'moving';
        train.trackVersion = g.track.version;
        break;
      }
    }
    const start = performance.now();
    g.fleet.tick(0.05, now);
    maxTickMs = Math.max(maxTickMs, performance.now() - start);
    maxActive = Math.max(maxActive, g.traffic.recoveries?.active.size ?? 0);
    for (const t of trains)
      if (t.state === 'noRoute' && !finished.has(t.id)) {
        finished.add(t.id);
        g.fleet.trains.splice(g.fleet.trains.indexOf(t), 1);
      }
    if (tick % 100 === 0)
      frames.push({
        time: now,
        trains: trains.map((t) => ({
          id: t.id,
          state: t.state,
          head: t.headTile,
          distance: t.distance,
          holding: t.holding,
          blocker: t.blockedBy ?? t.claimBlocker,
        })),
      });
    if (trains[1].headTile.x < 99 && trains.some((t) => t.yieldCount > 0)) break;
  }
  // TrackGraph placement bypasses the build UI; refresh its sprites for the evidence image.
  g.regions.unlocked.fill(true);
  g.world.rebuildFog();
  for (const tile of g.track.tiles()) g.onTrackChanged(tile.x, tile.y);
  g.camera.zoom = 2;
  g.camera.update = () => {};
  g.camera.centerOn((100 - y) * 32, (100 + y) * 16);
  g.trainRenderer.update(g.fleet.trains, 1);
  g.app.ticker.start();
  return {
    seconds: tick / 20,
    before,
    passed: trains[1].headTile.x < 99,
    yielded: trains.map((t) => ({ id: t.id, yields: t.yieldCount })),
    maxActive,
    maxTickMs,
    count,
    pinned,
    traffic: g.traffic.report(g.fleet.trains),
    frames,
  };
}

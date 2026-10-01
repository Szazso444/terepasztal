// Terrain paint benchmark: time from Game.init until every landscape chunk is painted, then
// fixed camera views for pixel comparison. node scratchpad/perf/run.mjs drives it.
import { Game } from '/src/game.ts';
import { generateMap } from '/src/world/mapgen.ts';
import { levelFromMap } from '/src/world/level.ts';
import { tileToWorld } from '/src/engine/iso.ts';

const seed = 7412,
  map = generateMap(seed, { w: 128, h: 128 });
const g = new Game({ kind: 'level', seed, level: levelFromMap(map, 'Benchmark 128 x 128') });
window.game = g;
const started = performance.now();
await g.init();
g.loop.stop();
g.app.ticker.stop();
g.closeMenus();
Object.assign(g.settings, { autosave: false, weather: false, dayNight: false, smoke: false });
g.clock.setSpeed(0);
const l = g.world.landscape;
const frame = () => new Promise(requestAnimationFrame);
// Paint progress as a player sees it: the camera's view first.
let viewMs = 0,
  firstMs = 0;
const initStart = performance.now();
const viewPainted = () =>
  [...l.chunks.values()].every(
    (c) => (l.rank ? l.rank(c) >= 1e9 : true) || c.base !== c.sprite.texture.constructor.EMPTY,
  );
for (let i = 0; i < g.regions.unlocked.length; i++) g.regions.own(i);
g.world.rebuildFog();
g.render(1, 0);
while (!l.ready) {
  if (l.failed) throw Error('worker failed');
  g.render(1, 0);
  if (!firstMs && l.paintCount) firstMs = performance.now() - started;
  if (!viewMs && l.chunkCount && viewPainted()) viewMs = performance.now() - started;
  await frame();
}
const ready = performance.now() - started;
window.bench = {
  report: {
    readyMs: Math.round(ready),
    viewMs: Math.round(viewMs),
    firstPaintMs: Math.round(firstMs),
    initMs: Math.round(initStart - started),
    viewChunks: [...l.chunks.values()].filter((c) => l.rank && l.rank(c) < 1e9).length,
    workers: l.slots?.length ?? 1,
    chunks: l.chunkCount,
    paints: l.paintCount,
    workerPaintMs: Math.round(l.paintMilliseconds),
  },
  /** Centre the camera on tile (x, y) at a zoom step and wait for every wanted paint. */
  async view(x, y, zoomIndex) {
    g.camera.zoomIndex = zoomIndex;
    g.camera.zoom = g.camera.targetZoom;
    const p = tileToWorld(x, y);
    g.camera.centerOn(p.x, p.y);
    const t = performance.now(),
      sharp = l.sharpPaintCount;
    g.render(1, 0);
    await frame();
    while (!l.sharpReady) {
      g.render(1, 0);
      await frame();
    }
    g.render(1, 0);
    g.app.renderer.render(g.app.stage);
    return { ms: Math.round(performance.now() - t), sharpPaints: l.sharpPaintCount - sharp };
  },
};
/** Median main-thread cost of a frame (simulation render + Pixi submit) while panning. */
window.bench.frames = async (n = 120) => {
  g.camera.zoomIndex = 2;
  g.camera.zoom = 1;
  const times = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    g.camera.x += 3;
    g.render(1, 1 / 60);
    g.app.renderer.render(g.app.stage);
    times.push(performance.now() - t);
    await frame();
  }
  times.sort((a, b) => a - b);
  return { median: +times[n >> 1].toFixed(2), p90: +times[Math.floor(n * 0.9)].toFixed(2) };
};
/**
 * Track edits on raised ground while paints are in flight: three straight rails on hill tiles,
 * one removed again at once. Returns the repaint count once everything settles.
 */
window.bench.edit = async () => {
  g.builder.free = true;
  const w = g.world,
    paints = l.paintCount,
    placed = [];
  for (let k = 0; k < g.map.terrain.length && placed.length < 3; k++) {
    const x = k % 128,
      y = Math.floor(k / 128);
    if (g.map.terrain[k] !== 2 || x < 50 || y < 50 || x > 80 || y > 80 || g.track.has(x, y))
      continue;
    if (w.elevationOf(x, y) > -5) continue;
    if (g.builder.placeTrackKind(x, y, 'straight', 0)) placed.push([x, y]);
  }
  g.render(1, 0);
  g.builder.removeTrack(...placed[2]);
  while (!l.sharpReady) {
    g.render(1, 0);
    await frame();
  }
  g.render(1, 0);
  g.app.renderer.render(g.app.stage);
  return { placed, repaints: l.paintCount - paints };
};

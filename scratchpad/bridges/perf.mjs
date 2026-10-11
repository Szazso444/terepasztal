// How long the bridge renderer takes: rebuilding every platform's meshes (which happens when the
// ground repaints), describing them (every rail refresh), and a frame with trains on bridges.
import { launch } from '../runtime.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto('http://127.0.0.1:5183/scratchpad/bridges/decks.html');
await page.waitForFunction(() => window.qa, null, { timeout: 240000 });
const out = await page.evaluate(() => {
  const g = qa.g,
    w = g.world,
    n = w.bridges.size,
    time = (f, reps = 5) => {
      const t0 = performance.now();
      for (let i = 0; i < reps; i++) f();
      return +((performance.now() - t0) / reps).toFixed(2);
    };
  const rebuild = time(() => {
    for (const r of w.bridges.values()) w.buildBridge(r);
  });
  const describe = time(() => g.refreshBridges());
  const rails = time(() => {
    g.railsDirty = true;
    g.refreshRails();
  });
  qa.clearTrains();
  let placed = 0;
  for (const s of qa.sites)
    if (s.lines.some((l) => l.w === 0 && l.track) && s.pattern.length >= 9)
      placed += qa.trainAt(s.id, 0, 6.3, 'big_boy', ['steel_coach', 'wooden_coach']) ? 1 : 0;
  const frame = time(() => g.trainRenderer.update(g.fleet.trains, 1, 0), 20);
  let slices = 0;
  for (const cars of g.trainRenderer.cars.values()) for (const c of cars) slices += c.slices.filter((s) => s.visible).length;
  return { platforms: n, rebuildAllMs: rebuild, describeAllMs: describe, refreshRailsMs: rails, trains: placed, trainUpdateMs: frame, slices };
});
console.log(JSON.stringify(out));
await browser.close();

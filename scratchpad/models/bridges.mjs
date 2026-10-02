// Scratch: how bridges look today: a stone and a wooden bridge over a land dip and over water.
import { launch } from '../runtime.mjs';
const b = await launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://127.0.0.1:5182/scratchpad/models/?rows=');
await p.waitForFunction(() => typeof window.qa?.shot === 'function', null, { timeout: 180000 });
const info = await p.evaluate(async () => {
  const g = qa.g, m = g.map, w = g.world;
  const inc = await import('/scratchpad/hill-levels/incline.js');
  const out = {};
  out.valley = await inc.valley(g, 'bridge_stone');
  // water: a river four tiles wide across a new line
  const y = 60, x0 = 30;
  for (let dy = -3; dy <= 3; dy++) for (let x = x0 + 6; x < x0 + 10; x++) m.terrain[(y + dy) * m.w + x] = 3;
  for (let dy = -4; dy <= 4; dy++) for (let x = x0; x < x0 + 16; x++) w.retile(x, y + dy);
  for (let x = x0 + 6; x < x0 + 10; x++) if (!g.builder.placeBuilding(x, y, 'bridge_wood')) out.fail = 'bridge ' + x;
  for (let x = x0; x < x0 + 16; x++)
    for (const r of [0, 1]) {
      if (!g.builder.placeTrackKind(x, y, 'straight', r)) continue;
      const link = g.track.get(x, y).links[0];
      if (link.includes(1) && link.includes(3)) break;
      g.builder.removeTrack(x, y);
    }
  out.river = { x0, y };
  return out;
});
console.log(JSON.stringify(info), errs);
const settle = () => p.evaluate(async () => {
  const g = qa.g;
  for (let i = 0; i < 100; i++) { g.render(1, 0); if (g.world.landscape.ready) break; await new Promise((r) => setTimeout(r, 100)); }
});
const shoot = async (x, y, zoom, path) => {
  await p.evaluate(([x, y, zoom]) => {
    const g = qa.g, T = window.__iso;
    const wx = (x - y) * 32, wy = (x + y) * 16;
    g.camera.centerOn(wx, wy); g.camera.zoom = zoom; g.render(1, 0); g.app.renderer.render(g.app.stage);
  }, [x, y, zoom]);
  await settle();
  await p.evaluate(() => { qa.g.render(1, 0); qa.g.app.renderer.render(qa.g.app.stage); });
  await p.screenshot({ path, clip: { x: 270, y: 200, width: 900, height: 600 } });
};
await shoot(info.valley.x0 + 8, info.valley.y, 3, 'scratchpad/models/bridge-valley.png');
await shoot(info.river.x0 + 8, info.river.y, 3, 'scratchpad/models/bridge-river.png');
await b.close();

import { launch, openGame } from './runtime.mjs';
import { writeFile } from 'node:fs/promises';
const label = process.argv[2] ?? 'after';
const browser = await launch();
const page = await openGame(browser, label);
const result = await page.evaluate(() => {
  const g = window.game;
  g.closeMenus();
  g.settings.autosave = false;
  g.builder.free = true;
  g.clock.setSpeed(0);
  const placed = [];
  for (let x = 81; x <= 86; x++)
    placed.push(g.builder.placeTrack(x, 79, { kind: 'straight', cls: 'high_speed' }, 1));
  placed.push(g.builder.placeTrack(87, 79, { kind: 'curve', cls: 'high_speed' }, 2));
  for (let y = 81; y <= 88; y++)
    placed.push(g.builder.placeTrack(88, y, { kind: 'straight', cls: 'high_speed' }, 0));
  const st = g.builder.placeStation(89, 87, 'quarry');
  if (!st) return { placed, error: 'station' };
  const uid = g.inventory.add('dda40x', 0).uid;
  const t = g.fleet.create([uid], [], [st.id, 1], 'Curve verification', 'schedule', 1);
  if (typeof t === 'string') return { placed, error: t };
  window.testTrain = t;
  t.oil = 500;
  t.water = 500;
  t.coal = 500;
  let now = g.clock.time;
  for (let i = 0; i < 2400; i++) {
    g.fleet.tick(1 / 60, (now += 1 / 60));
    const p = t.vehiclePoses[0]?.segments[0];
    if (p && p.angle > 0.7 && p.angle < 1.2) break;
  }
  const p = t.vehiclePoses[0];
  g.camera.update = () => {};
  g.camera.zoom = 4;
  g.camera.centerOn((p.x - p.y) * 32, (p.x + p.y) * 16);
  g.trainRenderer.update(g.fleet.trains, 1);
  return { placed, pose: p, status: t.state };
});
console.log(result);
if (result.error || !result.pose || result.pose.segments[0].angle < 0.7)
  throw new Error(JSON.stringify(result));
await writeFile(`scratchpad/rollout-${label}.json`, JSON.stringify(result, null, 2));
await page.mouse.move(1400, 980);
await page.waitForTimeout(1000);
await page.screenshot({ path: `scratchpad/rollout-${label}.png` });
await browser.close();

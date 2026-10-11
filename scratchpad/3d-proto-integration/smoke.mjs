// Scratch (resumed run): where smoke puffs and the headlamp glow appear against the engine sprite,
// on the level and on top of the hill (the emitters use the vehicle centre and ignore rail height).
import { launch } from '../runtime.mjs';
import { writeFileSync } from 'node:fs';
const out = 'scratchpad/3d-proto-integration/out';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://127.0.0.1:5177/scratchpad/3d-proto-integration/index.html?sprites=B&ladder=B');
await page.waitForFunction(() => typeof window.qa?.tests?.busy === 'function' && window.qa.settled(), null, { timeout: 180000, polling: 200 });
const report = {};
for (const [name, p] of [['level', 3.2], ['top', 12]]) {
  await page.evaluate(([pp]) => qa.frame(pp, 3), [p]);
  report[name] = await page.evaluate(() => {
    const g = qa.g, t = qa.t;
    // a fresh puff and the night glow, as game.render would make them
    g.smoke.acc.set(t.id, 10);
    g.smoke.update(g.fleet.trains, 0.001, true);
    g.glows.update(g.builder.stations, g.fleet.trains, 1);
    g.app.renderer.render(g.app.stage);
    const puff = g.smoke.puffs[g.smoke.puffs.length - 1].s;
    const glow = g.glows.trainGlows.get(t.id);
    const eng = t.vehiclePoses[0].segments[0], car = t.poses[0];
    const sprite = g.trainRenderer.cars.get(t.id)[0].parts[0];
    return {
      vehicleCentre: { x: car.x, y: car.y }, engineCentre: { x: eng.x, y: eng.y, L: eng.L },
      engineSprite: { x: sprite.x, y: sprite.y }, puff: { x: puff.x, y: puff.y }, glow: { x: glow.x, y: glow.y },
      railDzAtEngine: g.world.railAt(eng.x, eng.y).dz,
      puffParent: puff.parent === g.world.overlay, glowParent: glow.parent === g.world.overlay,
    };
  });
  await page.screenshot({ path: `${out}/smoke-${name}.png`, clip: { x: 440, y: 250, width: 400, height: 300 } });
}
console.log(JSON.stringify(report, null, 1));
writeFileSync(`${out}/smoke.json`, JSON.stringify(report, null, 1));
await browser.close();

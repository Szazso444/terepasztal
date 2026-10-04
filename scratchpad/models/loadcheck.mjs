// The showcase save through the real game: put it where the game keeps its save, open the game,
// press Continue on the main menu, let it run, and look (day, dusk, night).
import { launch } from '../runtime.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const json = readFileSync('G:/DEV/Terepasztal/saves/engine-models-demo.json', 'utf8');
const b = await launch();
const errs = [];
try {
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript((j) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('terepasztal.save', j);
      sessionStorage.setItem('seeded', '1');
    }
  }, json);
  await p.goto('http://127.0.0.1:5182/');
  await p.getByText('Continue', { exact: true }).click({ timeout: 240000 });
  await p.waitForFunction(() => window.game?.fleet?.trains?.length > 0, null, { timeout: 120000 });
  await p.evaluate(() => window.game.clock.setSpeed(1));
  await p.waitForTimeout(10000);
  const info = await p.evaluate(() => ({
    trains: window.game.fleet.trains.length,
    running: window.game.fleet.trains.filter((t) => t.schedule?.length).map((t) => `${t.name}:${t.state}:${t.lastMessage}`),
    parkedStates: [...new Set(window.game.fleet.trains.filter((t) => !t.schedule?.length).map((t) => t.state))],
    money: window.game.economy.money,
    items: window.game.inventory.items.length,
    dayNight: window.game.settings.dayNight, smoke: window.game.settings.smoke,
    notices: document.querySelector('#ui-root')?.innerText?.match(/NOTICES[\s\S]{0,300}/)?.[0],
  }));
  console.log(JSON.stringify(info, null, 1));
  await p.screenshot({ path: 'scratchpad/models/out/load-1.png' });
  const dist = () => p.evaluate(() => window.game.fleet.trains.filter((t) => t.schedule?.length).map((t) => t.distance));
  const d0 = await dist();
  await p.evaluate(() => window.game.clock.setSpeed(3));
  await p.waitForTimeout(45000);
  const d1 = await dist();
  console.log('moved', d1.map((d, i) => Math.round(d - d0[i])).join(' '), 'time', await p.evaluate(() => window.game.clock.dayFraction.toFixed(2)));
  await p.evaluate(() => window.game.clock.setSpeed(1));
  await p.screenshot({ path: 'scratchpad/models/out/load-2.png' });
  // the regular loop's hill, then the narrow loop, at night
  for (const [name, x, y, z] of [['load-hill', 43, 20, 2], ['load-narrow', 102, 26, 2]]) {
    await p.evaluate(([x, y, z]) => { const g = window.game; const w = { x: (x - y) * 32, y: (x + y) * 16 }; g.camera.centerOn(w.x, w.y); g.camera.zoom = z; }, [x, y, z]);
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `scratchpad/models/out/${name}.png` });
  }
  const end = await p.evaluate(() => window.game.fleet.trains.filter((t) => t.schedule?.length).map((t) => `${t.name}:${t.state}:${t.lastMessage}`));
  console.log(JSON.stringify(end));
} finally {
  await b.close();
  console.log(errs.length ? errs.slice(0, 5) : 'no errors');
}

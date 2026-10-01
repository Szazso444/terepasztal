// The demo save through the real game: put it where the game keeps its save, open the game,
// press Continue on the main menu, let it run, and look.
import { launch } from '../runtime.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const json = readFileSync('G:/DEV/Terepasztal/saves/rail-system-demo.json', 'utf8');
const browser = await launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((j) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('terepasztal.save', j);
      sessionStorage.setItem('seeded', '1');
    }
  }, json);
  await page.goto('http://127.0.0.1:5176/');
  await page.getByText('Continue', { exact: true }).click({ timeout: 240000 });
  await page.waitForFunction(() => window.game?.fleet?.trains?.length > 0, null, { timeout: 120000 });
  // run the clock at normal speed for a while
  await page.evaluate(() => window.game.clock.setSpeed(1));
  await page.waitForTimeout(12000);
  const info = await page.evaluate(() => ({
    trains: window.game.fleet.trains.map((t) => `${t.name}:${t.state}`),
    depots: window.game.builder.depots().map((d) => `${d.name}:${d.def.id}`),
  }));
  console.log(JSON.stringify(info));
  await page.screenshot({ path: 'scratchpad/rails/out/realload.png' });
  writeFileSync('scratchpad/rails/out/realload.json', JSON.stringify({ info, errors }, null, 1));
} finally {
  await browser.close();
  console.log(errors.length ? errors.slice(0, 3) : 'no errors');
}

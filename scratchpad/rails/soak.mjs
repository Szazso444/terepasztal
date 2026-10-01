// Load the demo save through the real main menu and watch the trains at the fastest speed.
import { launch } from '../runtime.mjs';
import { readFileSync } from 'node:fs';
const json = readFileSync('scratchpad/rails/out/demo-save.json', 'utf8');
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', (e) => console.log('ERR', e.message));
  await page.addInitScript((j) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('terepasztal.save', j);
      sessionStorage.setItem('seeded', '1');
    }
  }, json);
  await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:5176/');
  await page.getByText('Continue', { exact: true }).click({ timeout: 240000 });
  await page.waitForFunction(() => window.game?.fleet?.trains?.length > 0, null, {
    timeout: 120000,
  });
  await page.evaluate(() => window.game.clock.setSpeed(3));
  const snap = () =>
    page.evaluate(() => ({
      t: Math.round(window.game.clock.time),
      trains: window.game.fleet.trains.map(
        (t) =>
          `${t.name}:${t.state}:d${Math.round(t.distance)}:c${Math.round(t.totalCargo())}:${t.lastMessage}`,
      ),
      stations: window.game.builder.stations
        .filter((s) => !s.def.depot)
        .map((s) => `${s.name}:${JSON.stringify(Object.fromEntries(s.storage))}`),
    }));
  for (let i = 0; i < Number(process.env.SAMPLES ?? 6); i++) {
    console.log(JSON.stringify(await snap()));
    await page.waitForTimeout(20000);
  }
  console.log(JSON.stringify(await snap()));
} finally {
  await browser.close();
}

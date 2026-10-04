// The loader page as the owner uses it: open it, land in the game, press Continue.
import { launch } from '../runtime.mjs';
const b = await launch();
const errs = [];
try {
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://127.0.0.1:5182/scratchpad/models/load-save.html');
  await p.waitForURL(/\/#seed=/, { timeout: 60000 });
  await p.getByText('Continue', { exact: true }).click({ timeout: 240000 });
  await p.waitForFunction(() => window.game?.fleet?.trains?.length > 0, null, { timeout: 120000 });
  await p.waitForTimeout(6000);
  console.log(JSON.stringify(await p.evaluate(() => ({ url: location.href, trains: window.game.fleet.trains.length, money: window.game.economy.money, dayNight: window.game.settings.dayNight, smoke: window.game.settings.smoke, speed: window.game.clock.speed }))));
  await p.screenshot({ path: 'scratchpad/models/out/loader-1.png' });
} finally {
  await b.close();
  console.log(errs.length ? errs.slice(0, 5) : 'no errors');
}

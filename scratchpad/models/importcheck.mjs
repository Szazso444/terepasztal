// The showcase save through the game's own Settings > Import from text, as the owner would do it.
import { launch } from '../runtime.mjs';
import { readFileSync } from 'node:fs';
const json = readFileSync('G:/DEV/Terepasztal/saves/engine-models-demo.json', 'utf8');
const b = await launch();
const errs = [];
try {
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto('http://127.0.0.1:5182/');
  await p.getByText('Continue', { exact: true }).waitFor({ timeout: 240000 }).catch(() => {});
  const mode0 = await p.evaluate(() => ({ mode: window.game?.mode, autosave: window.game?.settings?.autosave, trains: window.game?.fleet?.trains?.length }));
  console.log('before', JSON.stringify(mode0));
  if (process.env.NOAUTO) await p.evaluate(() => { window.game.settings.autosave = false; });
  // the title menu's Settings
  const buttons = await p.getByText('Settings', { exact: true }).all();
  console.log('settings buttons', buttons.length);
  await buttons[0].click();
  await p.waitForTimeout(800);
  const areas = await p.locator('textarea').all();
  console.log('textareas', areas.length);
  let done = false;
  for (const a of areas) {
    if (!(await a.isVisible())) continue;
    await a.fill(json);
    done = true;
  }
  console.log('filled', done);
  await p.screenshot({ path: 'scratchpad/models/out/import-0.png' });
  await p.getByText('Import from text', { exact: true }).first().click();
  await p.waitForTimeout(8000);
  const cont = p.getByText('Continue', { exact: true });
  console.log('continue', await cont.count());
  if (await cont.count()) await cont.first().click();
  await p.waitForTimeout(8000);
  const info = await p.evaluate(() => ({ trains: window.game?.fleet?.trains?.length, money: window.game?.economy?.money, level: window.game?.map?.w }));
  console.log('after import', JSON.stringify(info));
  await p.screenshot({ path: 'scratchpad/models/out/import-1.png' });
} finally {
  await b.close();
  console.log(errs.length ? errs.slice(0, 5) : 'no errors');
}

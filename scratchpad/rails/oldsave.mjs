// Make the old save on main (5181), render it there, then open it in this branch (5176).
import { launch } from '../runtime.mjs';
import { writeFileSync } from 'node:fs';
const out = 'scratchpad/rails/out';
const browser = await launch();
const errors = [];
try {
  const old = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  old.on('pageerror', (e) => errors.push('main: ' + e.message));
  await old.goto('http://127.0.0.1:5181/scratchpad/rails/oldsave/');
  await old.waitForFunction(() => typeof window.qa?.saveJson === 'function', null, {
    timeout: 240000,
  });
  await old.evaluate(() => qa.step(600));
  console.log('main trains', await old.evaluate(() => qa.states()));
  await old.evaluate(() => qa.view());
  await old.screenshot({
    path: `${out}/oldsave-main.png`,
    clip: { x: 220, y: 150, width: 1000, height: 700 },
  });
  writeFileSync(`${out}/old-save.json`, await old.evaluate(() => qa.saveJson()));
  const now = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  now.on('pageerror', (e) => errors.push('branch: ' + e.message));
  await now.goto('http://127.0.0.1:5176/scratchpad/rails/load/?file=old-save');
  await now.waitForFunction(() => typeof window.qa?.info === 'function', null, { timeout: 240000 });
  await now.evaluate(() => qa.step(600));
  const info = await now.evaluate(() => qa.info());
  console.log('branch', JSON.stringify(info));
  await now.evaluate(() => qa.view(30, 26, 1.3));
  await now.screenshot({
    path: `${out}/oldsave-branch.png`,
    clip: { x: 220, y: 150, width: 1000, height: 700 },
  });
  writeFileSync(`${out}/oldsave-report.json`, JSON.stringify({ info, errors }, null, 1));
} finally {
  await browser.close();
  console.log(errors.length ? errors : 'no errors');
}

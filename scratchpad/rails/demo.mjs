// Build the playable demo on the showcase map, save it, and open the save like Continue does.
import { launch } from '../runtime.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
const out = 'scratchpad/rails/out';
const errors = [];
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => errors.push('yard: ' + e.message));
  await page.goto('http://127.0.0.1:5176/scratchpad/rails/yard/');
  await page.waitForFunction(() => typeof window.qa?.buildDemo === 'function', null, { timeout: 240000 });
  console.log('rolled out', await page.evaluate(() => qa.buildDemo()));
  await page.evaluate(() => qa.step(900));
  console.log('after 15 s', await page.evaluate(() => qa.states()));
  const json = await page.evaluate(() => qa.saveJson());
  writeFileSync(`${out}/demo-save.json`, json);
  mkdirSync('G:/DEV/Terepasztal/saves', { recursive: true });
  writeFileSync('G:/DEV/Terepasztal/saves/rail-system-demo.json', json);
  const load = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  load.on('pageerror', (e) => errors.push('load: ' + e.message));
  await load.goto('http://127.0.0.1:5176/scratchpad/rails/load/?file=demo-save');
  await load.waitForFunction(() => typeof window.qa?.info === 'function', null, { timeout: 240000 });
  for (let k = 0; k < 4; k++) await load.evaluate(() => qa.step(900));
  const info = await load.evaluate(() => qa.info());
  console.log('loaded', JSON.stringify(info));
  writeFileSync(`${out}/demo-report.json`, JSON.stringify({ info, errors, bytes: json.length }, null, 1));
} finally {
  await browser.close();
  console.log(errors.length ? errors : 'no errors');
}

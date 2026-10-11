import fs from 'node:fs';
import { chromium } from 'file:///C:/Users/Zso/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const root = 'C:/Users/Zso/terepasztal/scratchpad/full-style-stills';
fs.mkdirSync(root + '/renders', { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [],
  reports = [];
try {
  for (const mode of ['village', 'industry', 'countryside', 'desert', 'taiga', 'wetlands']) {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1200 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => {
      errors.push(mode + ': ' + e.message);
      console.log('ERROR ' + e.message);
    });
    await page.goto('http://127.0.0.1:5190/scratchpad/full-style-stills/?scene=' + mode);
    await page.waitForFunction(() => typeof window.stills?.render === 'function', {
      timeout: 90000,
    });
    await page.screenshot({ path: root + '/renders/' + mode + '.png' });
    reports.push(await page.evaluate(() => stills.report()));
    if (mode === 'village') {
      await page.evaluate(() => stills.render(26, 25, 4));
      await page.screenshot({ path: root + '/renders/station-detail.png' });
    }
    await context.close();
    console.log('CAPTURED ' + mode);
  }
  fs.writeFileSync(root + '/renders/report.json', JSON.stringify({ reports, errors }, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
}

import fs from 'node:fs';
import { chromium } from 'file:///C:/Users/Zso/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const root = 'C:/Users/Zso/terepasztal/scratchpad/terrain-v4';
fs.mkdirSync(root + '/renders', { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1200 } }),
    page = await context.newPage();
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.log('ERROR ' + e.message);
  });
  await page.goto('http://127.0.0.1:5190/scratchpad/terrain-v4/');
  await page.waitForFunction(() => typeof window.terrainReview?.render === 'function', null, {
    timeout: 180000,
  });
  const views = await page.evaluate(() => terrainReview.views);
  for (const view of views) {
    await page.evaluate((v) => terrainReview.render(v), view);
    await page.screenshot({ path: root + '/renders/' + view.id + '.png' });
    console.log('CAPTURED ' + view.id);
  }
  const report = await page.evaluate(() => terrainReview.report);
  fs.writeFileSync(
    root + '/renders/report.json',
    JSON.stringify({ ...report, views, errors }, null, 2),
  );
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
}

import { launch } from './runtime.mjs';
import { writeFileSync } from 'node:fs';
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/scratchpad/station-pipeline/index.html');
  await page.waitForFunction(() => window.stationDemoReady, {}, { timeout: 30000 });
  await page
    .locator('#scene')
    .screenshot({ path: 'scratchpad/station-pipeline/adjacent-rails.png' });
  await page.selectOption('#context', 'neighbours');
  await page
    .locator('#scene')
    .screenshot({ path: 'scratchpad/station-pipeline/adjacent-buildings.png' });
  for (const projection of ['original', 'corrected'])
    for (const ground of ['game', 'neutral']) {
      await page.selectOption('#projection', projection);
      await page.selectOption('#ground', ground);
    }
  const images = await page
    .locator('article img')
    .evaluateAll((imgs) =>
      imgs.map((i) => ({ src: i.getAttribute('src'), loaded: i.complete && i.naturalWidth > 0 })),
    );
  const report = { errors, images };
  writeFileSync('scratchpad/station-pipeline/verification.json', JSON.stringify(report, null, 2));
  console.log(report);
  if (errors.length || images.some((i) => !i.loaded)) process.exitCode = 1;
} finally {
  await browser.close();
}

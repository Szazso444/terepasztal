import fs from 'node:fs';
import { chromium } from 'file:///C:/Users/Zso/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const root = 'C:/Users/Zso/terepasztal/scratchpad/terrain-v4';
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1200 } }),
    page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5190/scratchpad/cozy-v3/');
  await page.waitForFunction(() => !!window.worldReview?.render, null, { timeout: 180000 });
  const report = await page.evaluate(() => {
    const r = worldReview,
      g = r.g;
    if (!g.world.ground.visible || g.world.landscape)
      throw Error('Illustrated ground rollback failed');
    const hill = [...g.map.terrain].findIndex(
      (t, k) => t === 2 && !g.world.isFlattened(k % 128, Math.floor(k / 128)),
    );
    const mountain = [...g.map.terrain].findIndex((t) => t === 6);
    for (const [k, e] of [
      [hill, -10],
      [mountain, -20],
    ]) {
      const x = k % 128,
        y = Math.floor(k / 128);
      if (g.world.elevationOf(x, y) !== e || g.world.elevationOf(x + 0.2, y - 0.2) !== e)
        throw Error('Elevation alignment failed');
    }
    const hx = hill % 128,
      hy = Math.floor(hill / 128);
    g.world.setFlattened(hx, hy, true);
    if (g.world.elevationOf(hx, hy) !== 0) throw Error('Flattened hill not at rail level');
    g.world.setFlattened(hx, hy, false);
    if (g.world.elevationOf(-1, -1) !== 0) throw Error('Out-of-map elevation');
    const candidates = [...g.map.terrain].flatMap((t, k) => (t === 6 ? [k] : []));
    const score = (k) => {
      const x = k % 128,
        y = Math.floor(k / 128);
      if (x < 12 || y < 12 || x > 116 || y > 116) return -1;
      let hills = 0,
        mountains = 0;
      for (let dy = -5; dy <= 5; dy++)
        for (let dx = -5; dx <= 5; dx++) {
          const t = g.map.terrain[(y + dy) * 128 + x + dx];
          hills += t === 2;
          mountains += t === 6;
        }
      return hills * 2 - Math.abs(mountains - 18);
    };
    candidates.sort((a, b) => score(b) - score(a));
    r.views.push({
      id: '11-restored-hill-art',
      title: 'Restored illustrated hills and mountains',
      x: candidates[0] % 128,
      y: Math.floor(candidates[0] / 128),
      zoom: 2,
    });
    return {
      ...r.report,
      rollback: {
        groundVisible: true,
        noLandscapeReplacement: true,
        hillOffset: -10,
        mountainOffset: -20,
        fractionalAnchorsChecked: true,
        flatteningChecked: true,
      },
    };
  });
  const ids = ['01-whole-map', '03-town-station', '11-restored-hill-art'];
  for (const id of ids) {
    await page.evaluate((id) => worldReview.render(worldReview.views.find((v) => v.id === id)), id);
    await page.screenshot({ path: root + '/renders/world-' + id + '.png' });
    console.log('CAPTURED world-' + id);
  }
  fs.writeFileSync(
    root + '/renders/world-report.json',
    JSON.stringify({ ...report, errors }, null, 2),
  );
  if (errors.length) throw Error(errors.join('\n'));
} finally {
  await browser.close();
}

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cameras, project } from './projection.mjs';
import { launch } from '../runtime.mjs';
const root = 'scratchpad/projection-study/review';
mkdirSync(root, { recursive: true });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
for (const camera of cameras) {
  const o = project(camera, 0, 0),
    x = project(camera, 1, 0),
    y = project(camera, 0, 1),
    z = project(camera, 0, 0, 1);
  near(x[0] - o[0], o[0] - y[0]);
  near(x[1] - o[1], y[1] - o[1]);
  near(z[0], o[0]);
  const a = project(camera, 7, 4, 2),
    b = project(camera, 8, 4, 2);
  near(b[0] - a[0], x[0] - o[0]);
  near(b[1] - a[1], x[1] - o[1]);
  if (camera.id === 'current') near((x[1] - o[1]) / (x[0] - o[0]), 0.5);
  if (camera.id === 'lower') near((x[1] - o[1]) / (x[0] - o[0]), Math.tan(Math.PI / 12));
  if (camera.id === 'isometric')
    near(Math.hypot(x[0] - o[0], x[1] - o[1]), Math.hypot(z[0] - o[0], z[1] - o[1]));
}
const browser = await launch(),
  errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1800, height: 1300 },
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  await page.goto('http://127.0.0.1:5173/scratchpad/projection-study/index.html');
  await page.waitForFunction(() => window.projectionStudy?.ready);
  assert.equal(await page.locator('#scenes canvas').count(), 3);
  assert.equal(await page.locator('#originals canvas').count(), 4);
  const assets = await page
    .locator('#asset option')
    .evaluateAll((options) => options.map((o) => o.value));
  for (const asset of assets) {
    await page.selectOption('#asset', asset);
    const placements = await page.evaluate(() => window.projectionStudy.placements);
    assert.equal(new Set(placements.map((p) => p.rotation)).size, 4);
    assert.ok(placements.every((p) => p.anchor.every(Number.isInteger)));
    await page.locator('#scenes').screenshot({ path: `${root}/${asset}-comparison.png` });
  }
  await page.selectOption('#asset', 'stations-farm');
  await page.selectOption('#view', 'close');
  await page.locator('#scenes').screenshot({ path: `${root}/farm-close-up.png` });
  await page.selectOption('#view', 'wide');
  await page.locator('#rotate').click();
  assert.equal(await page.evaluate(() => window.projectionStudy.rotation), 1);
  await page.selectOption('#layout', 'mixed');
  assert.equal(await page.evaluate(() => window.projectionStudy.placements.length), assets.length);
  await page.uncheck('#grid');
  await page.uncheck('#axes');
  await page.screenshot({ path: `${root}/mixed-clean.png`, fullPage: true });
  await page.check('#grid');
  await page.check('#axes');
  await page.selectOption('#layout', 'rotations');
  await page.setViewportSize({ width: 540, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${root}/mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  const report = {
    cameras: 3,
    buildings: assets.length,
    rotationsPerBuilding: 4,
    geometryInvariants: true,
    integerAnchors: true,
    controls: true,
    responsive: true,
    errors,
    artworkReprojection: false,
  };
  writeFileSync(`${root}/verification.json`, JSON.stringify(report, null, 2));
  console.log(report);
} finally {
  await browser.close();
}

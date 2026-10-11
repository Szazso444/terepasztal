import { launch, openGame } from './runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const output = 'scratchpad/illustrated-hd';
mkdirSync(output, { recursive: true });
const browser = await launch();
try {
  const page = await openGame(browser, 'hd-after', 900);
  const report = await page.evaluate(async () => {
    const { Sprite } = await import('/scratchpad/illustrated-browser.js');
    const { AtlasRegistry } = await import('/src/engine/atlas.ts');
    const { spriteDataUrl } = await import('/src/ui/spritePreview.ts');
    const g = window.game;
    const failures = [];
    let highResolution = 0;
    for (const key of g.atlas.keys('')) {
      const f = g.atlas.get(key),
        s = new Sprite(f.texture);
      s.anchor.set(f.anchorX, f.anchorY);
      const bounds = s.getLocalBounds();
      if (Math.abs(bounds.width - f.w) > 1e-5 || Math.abs(bounds.height - f.h) > 1e-5)
        failures.push(`${key}: logical size`);
      if (
        Math.abs(bounds.x + f.anchorX * f.w) > 1e-5 ||
        Math.abs(bounds.y + f.anchorY * f.h) > 1e-5
      )
        failures.push(`${key}: anchor`);
      if (f.texture.frame.width > f.w) {
        highResolution++;
        if (Math.abs(f.texture.frame.width / f.w - 4) > 1e-5) failures.push(`${key}: density`);
      }
      s.destroy();
    }
    // Backward compatibility and overlay semantics, exercised through public load().
    const make = (key, w = 8) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = w;
      canvas.getContext('2d').fillRect(0, 0, w, w);
      return { image: canvas, frames: { [key]: { x: 0, y: 0, w, h: w, ax: w / 2, ay: w } } };
    };
    const fallback = make('test/fallback'),
      hd = make('test/hd', 32);
    const reg = new AtlasRegistry();
    // Scoped test substitute for file I/O; the actual shipped files are checked above.
    reg.tryLoadFile = async () => ({ ...hd, resolution: 4, partial: true });
    await reg.load([{ name: 'test', generate: () => fallback }]);
    if (!reg.has('test/fallback') || reg.get('test/hd').w !== 8)
      failures.push('partial override loses fallback or changes size');
    const legacy = new AtlasRegistry();
    legacy.tryLoadFile = async () => hd;
    await legacy.load([{ name: 'test', generate: () => fallback }]);
    if (legacy.has('test/fallback') || legacy.get('test/hd').w !== 32)
      failures.push('legacy override contract changed');
    // A UI crop must use logical dimensions, not return a 4x oversized thumbnail.
    const key = 'icons/wheat',
      f = g.atlas.get(key),
      url = spriteDataUrl(g.atlas, key, 2);
    const preview = new Image();
    preview.src = url;
    await preview.decode();
    if (preview.width !== Math.round(f.w * 2) || preview.height !== Math.round(f.h * 2))
      failures.push('UI crop uses physical size');
    for (const key of ['terrain/cursor', 'terrain/ghost_ok', 'fx/glow', 'people/walker_0_f0']) {
      if (g.atlas.has(key) && g.atlas.get(key).texture.frame.width !== g.atlas.get(key).w)
        failures.push(`${key}: unsafe study installed`);
    }
    for (const key of g.atlas.keys('rolling/'))
      if (g.atlas.get(key).w !== g.atlas.get(key).texture.frame.width)
        failures.push(`${key}: single-view art replaced moving vehicle`);
    // Geometry stays fixed across all texture densities and camera zoom levels.
    const { ZOOM_STEPS } = await import('/src/engine/camera.ts');
    return {
      highResolution,
      frameCount: g.atlas.keys('').length,
      groups: Object.fromEntries(g.atlas.groupOrigin),
      zoomSteps: ZOOM_STEPS,
      failures,
    };
  });
  const retinaContext = await browser.newContext({ deviceScaleFactor: 2 });
  const retinaPage = await openGame(retinaContext, 'hd-after', 900);
  report.highDpi = await retinaPage.evaluate(() => {
    const g = window.game;
    return {
      resolution: g.app.renderer.resolution,
      logicalWidth: g.app.screen.width,
      canvasWidth: g.app.canvas.width,
      viewportWidth: window.innerWidth,
    };
  });
  assert.equal(report.highDpi.resolution, 2);
  assert.equal(report.highDpi.logicalWidth, report.highDpi.viewportWidth);
  assert.equal(report.highDpi.canvasWidth, report.highDpi.logicalWidth * 2);
  await retinaContext.close();
  await page.goto('http://127.0.0.1:5173/scratchpad/illustrated-hd/index.html');
  for (const button of await page.locator('button[data-src]').all()) {
    await button.click();
    await page.waitForFunction(() => {
      const img = document.getElementById('scene');
      return img.complete && img.naturalWidth > 0;
    });
  }
  report.comparisonViews = await page.locator('button[data-src]').count();
  writeFileSync(`${output}/runtime-report.json`, JSON.stringify(report, null, 2) + '\n');
  assert.equal(report.failures.length, 0, report.failures.join('\n'));
  assert.equal(report.highResolution, 288);
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}

// Dump the game's live atlases (procedural or file-backed, whichever loaded) as PNG + frame
// tables in the pack-atlas contract, so a node-side tool can start from every frame the game
// needs and substitute the ones it has better art for.
// usage: node scratchpad/dump-atlases.mjs <outDir>
import { launch, openGame } from './runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'scratchpad/atlas-dump';
mkdirSync(outDir, { recursive: true });

const browser = await launch();
try {
  const page = await openGame(browser, 'after');
  const groups = await page.evaluate(() => {
    const g = window.game;
    g.settings.autosave = false;
    const out = [];
    for (const [name, image] of g.atlas.images) {
      const frames = {};
      for (const key of g.atlas.keys('')) {
        const f = g.atlas.get(key);
        if (f.image !== image) continue;
        const r = f.texture.frame;
        frames[key] = {
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          ax: Math.round(f.anchorX * f.w),
          ay: Math.round(f.anchorY * f.h),
        };
      }
      let canvas = image;
      if (!(image instanceof HTMLCanvasElement)) {
        canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);
      }
      out.push({
        name,
        origin: g.atlas.groupOrigin.get(name),
        png: canvas.toDataURL('image/png'),
        frames,
      });
    }
    return out;
  });
  for (const gr of groups) {
    writeFileSync(join(outDir, `${gr.name}.png`), Buffer.from(gr.png.split(',')[1], 'base64'));
    writeFileSync(join(outDir, `${gr.name}.json`), JSON.stringify({ frames: gr.frames }, null, 1));
    console.log(gr.name, gr.origin, Object.keys(gr.frames).length, 'frames');
  }
} finally {
  await browser.close();
}

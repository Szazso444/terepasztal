// Every atlas group's generator, run in the game: frame count, canvas size and generation time
// (three runs), and each frame's size, anchor and a hash of its pixels. Given an earlier table,
// prints which of its frames went missing, moved (size or anchor) or changed pixels, and the
// frames added since.
// usage: node scratchpad/atlas-frames.mjs <out.json> [earlier.json]   (BASE_URL picks the server)
import { launch, openGame } from './runtime.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const [out, earlier] = process.argv.slice(2);
const browser = await launch();
try {
  const page = await openGame(browser, 'after');
  const res = await page.evaluate(async () => {
    window.game.settings.autosave = false;
    const { ATLAS_GROUPS } = await import('/src/art/index.ts');
    const groups = [];
    const frames = {};
    for (const group of ATLAS_GROUPS) {
      const ms = [];
      let a;
      for (let i = 0; i < 3; i++) {
        const t = performance.now();
        a = group.generate();
        ms.push(+(performance.now() - t).toFixed(1));
      }
      const { width, height } = a.image;
      groups.push({ name: group.name, ms, width, height, frames: Object.keys(a.frames).length });
      const px = a.image.getContext('2d').getImageData(0, 0, width, height).data;
      for (const [k, f] of Object.entries(a.frames)) {
        let h = 2166136261;
        for (let y = f.y; y < f.y + f.h; y++)
          for (let x = f.x; x < f.x + f.w; x++)
            for (let c = 0; c < 4; c++) h = Math.imul(h ^ px[(y * width + x) * 4 + c], 16777619);
        frames[k] = [group.name, f.w, f.h, f.ax, f.ay, (h >>> 0).toString(16)];
      }
    }
    return { groups, frames };
  });
  writeFileSync(out, JSON.stringify(res, null, 1));
  for (const g of res.groups)
    console.log(g.name, g.frames, 'frames', `${g.width}x${g.height}`, g.ms.join(' / '), 'ms');
  if (earlier) {
    const was = JSON.parse(readFileSync(earlier, 'utf8')).frames;
    const missing = [];
    const moved = [];
    const repainted = [];
    for (const [k, v] of Object.entries(was)) {
      const now = res.frames[k];
      if (!now) missing.push(k);
      else if (v.slice(0, 5).join() !== now.slice(0, 5).join()) moved.push(k);
      else if (v[5] !== now[5]) repainted.push(k);
    }
    const added = Object.keys(res.frames).filter((k) => !was[k]);
    console.log(
      `${Object.keys(was).length} frames before, ${Object.keys(res.frames).length} after:`,
      `${missing.length} missing, ${moved.length} moved, ${repainted.length} repainted,`,
      `${added.length} added`,
    );
    for (const [what, keys] of Object.entries({ missing, moved, repainted }))
      if (keys.length) console.log(what, keys.slice(0, 20).join(' '));
  }
} finally {
  await browser.close();
}

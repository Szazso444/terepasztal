// Regenerates docs/art-direction/frame-inventory.json from the live atlas, the way
// scratchpad/build-art-guide.mjs does (same entries, same group rule, same file format), without
// rewriting the catalog page, the definitions list or the sheets.
//   npm run dev     (another terminal; BASE_URL when it is not on 5173)
//   node scratchpad/frame-inventory.mjs [outFile]     default docs/art-direction/frame-inventory.json
import { writeFile } from 'node:fs/promises';
import { launch, openGame } from './runtime.mjs';

const out =
  process.argv[2] ?? new URL('../docs/art-direction/frame-inventory.json', import.meta.url);
const browser = await launch();
try {
  const page = await openGame(browser, 'after');
  const entries = await page.evaluate(() => {
    const g = window.game;
    const found = [];
    for (const key of g.atlas.keys('')) {
      const f = g.atlas.get(key);
      const group =
        [...g.atlas.images].find(([, image]) => image === f.image)?.[0] ?? key.split('/')[0];
      found.push({
        key,
        group,
        width: f.w,
        height: f.h,
        anchorX: Math.round(f.anchorX * f.w),
        anchorY: Math.round(f.anchorY * f.h),
      });
    }
    return found;
  });
  if (entries.length < 1000) throw new Error(`only ${entries.length} frames in the atlas`);
  await writeFile(out, JSON.stringify(entries, null, 2));
  console.log(`wrote ${entries.length} frames`);
} finally {
  await browser.close();
}

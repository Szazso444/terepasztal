// The wheat field in the running game: seed 4242's start coast, at zoom 2 and 3, under a chosen
// season's prop tint (SEASON_FX in src/sim/weather.ts; the real calendar picks the season on a new
// game, so the tint is set by hand to compare like with like).
//   BASE_URL=http://127.0.0.1:5173 node scratchpad/wheat-live.mjs <outDir> <label> [season ...]
// Writes <outDir>/<label>-<season>-z2.png and -z3.png. Needs the dev server on BASE_URL and
// Playwright (see runtime.mjs).
import { mkdirSync } from 'node:fs';
import { launch, openGame } from './runtime.mjs';

const [outDir, label = 'shot', ...seasons] = process.argv.slice(2);
if (!outDir) throw new Error('usage: wheat-live.mjs <outDir> <label> [season ...]');
mkdirSync(outDir, { recursive: true });
const TINT = {
  spring: [0xf4fff0, 0xffffff],
  summer: [0xfff4dc, 0xf8f2dc],
  autumn: [0xffe2bc, 0xf0c088],
  winter: [0xd8e4f0, 0xc4d2e4],
};
const browser = await launch();
try {
  const page = await openGame(browser, 'after');
  for (const season of seasons.length ? seasons : ['summer'])
    for (const [zoom, zoomIndex] of [
      [2, 4],
      [3, 5],
    ]) {
      await page.evaluate(
        ({ zoomIndex, tint }) => {
          const g = window.game;
          g.settings.autosave = false;
          g.settings.dayNight = false;
          g.regions.unlocked.fill(true);
          g.world.rebuildFog();
          g.clock.setSpeed(0);
          g.camera.zoomIndex = zoomIndex;
          // the start coast, where #310's wheat stands on seed 4242
          g.camera.x = (118.5 - 43.5) * 32;
          g.camera.y = (118.5 + 43.5) * 16;
          g.world.setSeasonTint(tint[0], tint[1]);
        },
        { zoomIndex, tint: TINT[season] },
      );
      await page.waitForTimeout(1500);
      await page.screenshot({
        path: `${outDir}/${label}-${season}-z${zoom}.png`,
        clip: { x: 420, y: 250, width: 600, height: 500 },
      });
    }
} finally {
  await browser.close();
}

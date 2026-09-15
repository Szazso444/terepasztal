// Whole-world art review on one seed: play zoom, close-up, far, night, overview and two panels.
// usage: node scratchpad/art-world-shots.mjs <label>
import { launch, openGame } from './runtime.mjs';
import { mkdirSync } from 'node:fs';

const label = process.argv[2] ?? 'after';
const out = new URL(`./shots/${label}/`, import.meta.url);
mkdirSync(out, { recursive: true });

const browser = await launch();
try {
  const page = await openGame(browser, label, 900);
  const shot = async (name) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: new URL(`${name}.png`, out).pathname });
    console.log('wrote', name);
  };
  await page.evaluate(() => {
    const g = window.game;
    g.settings.autosave = false;
    g.closeMenus();
    g.clock.setSpeed(0);
  });
  await page.mouse.move(700, 700);
  await shot('play');
  await page.evaluate(() => window.game.camera.zoomBy(2));
  await shot('close');
  await page.evaluate(() => window.game.camera.zoomBy(-3));
  await shot('far');
  await page.evaluate(() => window.game.camera.zoomBy(1));
  // night: 23:00 of the current day (the clock counts in-game seconds)
  await page.evaluate(async () => {
    const g = window.game;
    const { daySeconds } = await import('/src/sim/rules.ts');
    g.settings.dayNight = true;
    g.applySettings();
    const d = daySeconds();
    g.clock.time = Math.floor(g.clock.time / d) * d + d * 0.96;
  });
  await page.waitForTimeout(1500);
  await shot('night');
  await page.evaluate(async () => {
    const g = window.game;
    const { daySeconds } = await import('/src/sim/rules.ts');
    const d = daySeconds();
    g.clock.time = Math.floor(g.clock.time / d) * d + d * 0.5;
  });
  await page.keyboard.press('m');
  await shot('overview');
  await page.keyboard.press('m');
  await page.click('text=STATIONS');
  await shot('build-stations');
  await page.keyboard.press('Escape');
  await page.keyboard.press('g');
  await shot('craft');
} finally {
  await browser.close();
}

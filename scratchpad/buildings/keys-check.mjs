// Demo check: the keys that switch the depot's look, size, age and rails.
import { launch, openGame } from '../runtime.mjs';
const browser = await launch();
try {
  const page = await openGame(browser, 'after');
  const state = () =>
    page.evaluate(() => {
      const g = window.game;
      return { look: g.depotLook, size: g.depotSize, age: g.depotAge, rails: g.depotRails };
    });
  console.log(JSON.stringify(await state()));
  await page.mouse.move(700, 400);
  for (const key of ['b', 'n', 'l', 'l', 't']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(200);
    console.log(key, JSON.stringify(await state()));
  }
} finally {
  await browser.close();
}

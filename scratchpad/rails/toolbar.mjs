// The track toolbar as the player sees it in a new game. TAG names the picture.
import { launch, openGame } from '../runtime.mjs';
const tag = process.env.TAG ?? 'after';
const browser = await launch();
try {
  const page = await openGame(browser, 'after');
  await page
    .locator('button', { hasText: /^track$/i })
    .first()
    .click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `scratchpad/rails/out/toolbar-${tag}.png` });
} finally {
  await browser.close();
}

import { launch, openGame } from './runtime.mjs';
const browser = await launch();
try {
  const page = await openGame(browser, 'rigid-after', 1060);
  await page.evaluate(async () => (await import('/scratchpad/bogie-sequence.js')).sequence());
  await page.screenshot({ path: 'scratchpad/bogie-sequence.png' });
} finally {
  await browser.close();
}

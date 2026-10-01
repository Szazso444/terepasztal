// The first close-up is taken before the camera settles after the catalogue shot: shoot it again.
import { launch } from '../runtime.mjs';
const browser = await launch();
try {
  for (const [base, out] of [
    ['http://127.0.0.1:5176', 'scratchpad/rails/out/after'],
    ['http://127.0.0.1:5181', 'C:/Users/Zso/terepasztal-main/scratchpad/rails/out/before'],
  ]) {
    const page = await browser.newPage({ viewport: { width: 2000, height: 1300 } });
    await page.goto(`${base}/scratchpad/rails/yard/`);
    await page.waitForFunction(() => typeof window.qa?.shoot === 'function', null, {
      timeout: 240000,
    });
    for (let k = 0; k < 2; k++) {
      await page.evaluate(() => qa.shoot(1));
      await page.waitForTimeout(400);
      await page.evaluate(() => qa.shoot(0));
      await page.waitForTimeout(600);
    }
    await page.screenshot({
      path: `${out}/cell-0.png`,
      clip: { x: 740, y: 460, width: 520, height: 380 },
    });
    await page.close();
    console.log('shot', out);
  }
} finally {
  await browser.close();
}

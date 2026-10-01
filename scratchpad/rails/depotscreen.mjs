// The depot screen with the demo save: a narrow engine picked while the regular depot was the
// one selected. The roll-out box must move to the narrow depot by itself.
import { launch } from '../runtime.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const json = readFileSync('scratchpad/rails/out/demo-save.json', 'utf8');
const browser = await launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((j) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('terepasztal.save', j);
      sessionStorage.setItem('seeded', '1');
    }
  }, json);
  await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:5176/');
  await page.getByText('Continue', { exact: true }).click({ timeout: 240000 });
  await page.waitForFunction(() => window.game?.fleet?.trains?.length > 0, null, {
    timeout: 120000,
  });
  await page.evaluate(() => {
    const inv = window.game.inventory;
    for (const id of ['mk48', 'mine_tub', 'mine_tub', 'narrow_coach', 'f7', 'boxcar'])
      inv.add(id, 0);
  });
  await page
    .locator('button', { hasText: /^depot$/i })
    .first()
    .click();
  await page.waitForTimeout(800);
  const rollout = () => page.locator('.rollout').innerText();
  // select the regular depot first, as a player who last built a regular train would have
  await page.locator('.rollout button', { hasText: /^Depot$/ }).click();
  await page.waitForTimeout(400);
  const before = await rollout();
  await page.screenshot({ path: 'scratchpad/rails/out/depotscreen-0-regular.png' });
  await page.locator('.item', { hasText: 'Mk48' }).last().click();
  await page.waitForTimeout(600);
  const after = await rollout();
  await page.screenshot({ path: 'scratchpad/rails/out/depotscreen-1-narrow.png' });
  // and back: a regular engine instead
  await page.locator('.item', { hasText: 'Mk48' }).last().click();
  await page.locator('.item', { hasText: 'F7' }).last().click();
  await page.waitForTimeout(600);
  const back = await rollout();
  const report = { before, after, back, errors };
  console.log(JSON.stringify(report, null, 1));
  writeFileSync('scratchpad/rails/out/depotscreen.json', JSON.stringify(report, null, 1));
} finally {
  await browser.close();
}

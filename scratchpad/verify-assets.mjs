import { launch, openGame } from './runtime.mjs';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const label = process.argv[2] ?? 'after';
const browser = await launch();
const page = await openGame(browser, label, 1360);
try {
  const timings = await page.evaluate(async (label) => {
    const m = await import('/scratchpad/art-board.js');
    return m.assets(label);
  }, label);
  assert.ok(timings.every((t) => t.invalid === 0));
  console.log(timings);
  await page.screenshot({ path: `scratchpad/assets-${label}.png` });
  await writeFile(`scratchpad/assets-${label}.json`, JSON.stringify(timings, null, 2));
} finally {
  await browser.close();
}

import { launch, openGame } from './runtime.mjs';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const label = process.argv[2] ?? 'after';
const browser = await launch();
const page = await openGame(browser, label);
try {
  const report = await page.evaluate(async (label) => {
    const m = await import('/scratchpad/browser-check.js');
    return m.check(label);
  }, label);
  await page.screenshot({ path: `scratchpad/curves-${label}.png` });
  for (const r of report) {
    assert.equal(r.verdict.ok, true, r.id + ' must pass ' + r.cls);
    if (r.id === 'dda40x' || r.id === 'gg1') {
      assert.equal(r.regular.ok, false);
      assert.ok(r.verdict.lateral < 0.35);
    }
  }
  await writeFile(`scratchpad/compat-${label}.json`, JSON.stringify(report, null, 2));
  console.log(
    report.map((r) => ({
      id: r.id,
      highSpeed: r.verdict.ok,
      regular: r.regular.ok,
      lateral: r.verdict.lateral,
    })),
  );
} finally {
  await browser.close();
}

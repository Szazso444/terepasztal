import { launch, openGame } from './runtime.mjs';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const label = process.argv[2] ?? 'after';
const count = Number(process.argv[3] ?? 3);
const pinned = process.argv[4] === 'blocked';
const suffix = (count > 3 ? `-${count}` : '') + (pinned ? '-blocked' : '');
const browser = await launch();
try {
  const page = await openGame(browser, label);
  // The same fixture can run against a prior checkout served on a different BASE_URL.
  const source = await (
    await import('node:fs/promises')
  ).readFile('scratchpad/traffic-scenario.js', 'utf8');
  await page.evaluate(async (source) => {
    source = source.replaceAll("from '/src/", `from '${location.origin}/src/`);
    const module = await import(
      URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    );
    window.trafficScenario = module.scenario;
  }, source);
  const report = await page.evaluate(({ count, pinned }) => window.trafficScenario(count, pinned), {
    count,
    pinned,
  });
  await writeFile(`scratchpad/traffic-${label}${suffix}.json`, JSON.stringify(report, null, 2));
  await page.waitForTimeout(label === 'after' ? 2500 : 500);
  await page.mouse.move(1400, 980);
  await page.screenshot({ path: `scratchpad/traffic-${label}${suffix}.png` });
  console.log(
    JSON.stringify({
      seconds: report.seconds,
      passed: report.passed,
      yielded: report.yielded,
      counters: report.traffic.counters,
      maxTickMs: report.maxTickMs,
    }),
  );
  if (label === 'after') {
    const diagnostics = await (
      await page.request.get(new URL('/__traffic', page.url()).href)
    ).json();
    assert.ok(
      diagnostics.some((entry) => entry.report?.traffic?.episodes?.some((e) => e.kind === 'yield')),
      'Local dev server must receive traffic episodes from the running browser',
    );
    assert.equal(report.passed, true, 'Oncoming train must pass the refuge');
    assert.equal(report.traffic.counters.overlaps, 0, 'No train footprints may overlap');
    assert.ok(report.maxActive > 0, 'Scenario must exercise coordinated recovery');
  }
} finally {
  await browser.close();
}

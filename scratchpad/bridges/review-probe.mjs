// Review: load the review scene on both axes and print what was built.
import { launch } from '../runtime.mjs';
const browser = await launch();
for (const axis of process.argv.slice(2).length ? process.argv.slice(2) : ['x', 'y']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  await page.goto(`http://127.0.0.1:5183/scratchpad/bridges/review.html?axis=${axis}`);
  await page.waitForFunction(() => window.qa, null, { timeout: 300000 });
  const info = await page.evaluate(() => ({
    origin: qa.origin,
    step: qa.step,
    problems: qa.problems,
    sites: qa.sites.map((s) => ({ id: s.id, cx: s.cx, cy: s.cy, facts: qa.facts(s) })),
  }));
  console.log('axis', axis, 'origin', info.origin, 'step', info.step);
  console.log('problems', JSON.stringify(info.problems, null, 0));
  for (const s of info.sites)
    console.log(
      s.id.padEnd(14),
      s.facts.map((f) => `${f.w ? f.w + ':' : ''}g${f.ground}${f.water ? 'w' : ''}/d${f.deck}${f.set === 'auto' ? 'a' : ''}/r${f.rail}`).join(' '),
    );
  console.log('errors', JSON.stringify(errors));
  await page.close();
}
await browser.close();

// Loads the scene and prints what was built (problems, levels, deck facts).
import { launch } from '../runtime.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
const q = process.argv[2] ?? 'axis=x';
await page.goto('http://127.0.0.1:5183/scratchpad/bridges/index.html?' + q);
await page.waitForFunction(() => window.qa, null, { timeout: 180000 });
const out = await page.evaluate(() => ({
  kit: qa.kit, origin: qa.origin, step: qa.step, problems: qa.problems,
  sites: qa.sites.map((s) => ({ id: s.id, cx: s.cx, cy: s.cy, levels: s.levels.join(''), bridge: s.bridge.join(','), facts: qa.facts(s) })),
  pads: qa.pads.map((p) => ({ id: p.id, placed: p.placed, rot: p.rot, tries: p.tries, cx: p.cx, cy: p.cy, facts: p.placed ? qa.facts(p) : [] })),
}));
console.log(JSON.stringify(out, null, 1));
console.log('ERRORS', errors);
await browser.close();

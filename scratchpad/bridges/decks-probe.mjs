// Boot the decks scene and print what could not be built, and the deck/rail facts per site.
//   node scratchpad/bridges/decks-probe.mjs [axis=x] [site filter regexp]
import { launch } from '../runtime.mjs';
const [axis = 'x', filter = '.'] = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
await page.goto(`http://127.0.0.1:5183/scratchpad/bridges/decks.html?axis=${axis}`);
await page.waitForFunction(() => window.qa, null, { timeout: 240000 });
const info = await page.evaluate(() => ({
  origin: qa.origin,
  problems: qa.problems,
  sites: qa.sites.map((s) => ({ id: s.id, facts: qa.facts(s) })),
  pads: qa.pads.map((p) => ({ id: p.id, placed: p.placed, rot: p.rot, tries: p.tries })),
}));
console.log('origin', info.origin);
console.log('problems', JSON.stringify(info.problems, null, 1));
const re = new RegExp(filter);
for (const s of info.sites)
  if (re.test(s.id))
    console.log(
      s.id.padEnd(18),
      s.facts.map((f) => `${f.set ?? 'a'}/${f.deck}${f.rail === null ? '' : '@' + f.rail}`).join(' '),
    );
for (const p of info.pads) console.log(p.id, p.placed, p.rot, JSON.stringify(p.tries));
console.log('errors', errors);
await browser.close();

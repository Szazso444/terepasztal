// Side-by-side game renders of rendered rolling stock against the current procedural look.
//   node scratchpad/train-models/capture.mjs rocket --locos rocket --wagons wooden_coach
// Needs the dev server (npm run dev) and PLAYWRIGHT_MODULE as scratchpad/runtime.mjs describes.
// Writes scratchpad/train-models/renders/<name>/<scenario>-{new,current}.png and report.json.
import { launch, baseURL } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const [name, ...rest] = process.argv.slice(2);
const opt = {
  locos: name,
  wagons: '',
  zoom: '3',
  headings: '',
  kind: 'loco',
  bogies: '',
  loop: 'yes',
};
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, '')] = rest[i + 1];
const out = `scratchpad/train-models/renders/${name}`;
mkdirSync(out, { recursive: true });

const browser = await launch();
const errors = [];
const report = { name, locos: opt.locos, wagons: opt.wagons, scenarios: [], errors };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(
    `${baseURL('after')}/scratchpad/train-models/?locos=${opt.locos}&wagons=${opt.wagons}`,
  );
  await page.waitForFunction(() => typeof window.qa?.advanceTo === 'function', null, {
    timeout: 120000,
  });
  report.supplied = await page.evaluate(() => qa.supplied.length);
  const zoom = Number(opt.zoom);
  const clip = { x: 720 - 380, y: 500 - 250, width: 760, height: 460 };
  const both = async (scenario) => {
    for (const which of ['new', 'current']) {
      await page.evaluate(([on, z]) => (qa.useNew(on), qa.render(z)), [which === 'new', zoom]);
      await page.screenshot({ path: `${out}/${scenario}-${which}.png`, clip });
    }
  };
  if (opt.loop !== 'no') {
    for (const [arc, scenario] of [
      [2, '01-straight'],
      [6.45, '02-switch-enter'],
      [6.9, '03-switch-middle'],
      [7.5, '04-switch-leave'],
      [16.7, '05-curve'],
      [26.5, '06-curve'],
      [36.25, '07-curve'],
    ]) {
      report.scenarios.push(await page.evaluate(([a, s]) => qa.advanceTo(a, s), [arc, scenario]));
      await both(scenario);
    }
    const rev = await page.evaluate(() => qa.reverse());
    report.reversalError = rev.reversalError;
    report.scenarios.push(rev);
    await both('08-reversed');
    report.scenarios.push(
      await page.evaluate(() => qa.advanceTo(qa.pose().progress + 3, 'reversed-running')),
    );
    await both('09-reversed-running');
    report.facingsCovered = await page.evaluate(() => qa.facings);
  }

  // every heading of each listed vehicle, on the game's rail centres
  const sheet =
    opt.headings === 'none' ? [] : opt.headings ? opt.headings.split(',') : opt.locos.split(',');
  await page.setViewportSize({ width: 2400, height: 1500 });
  for (const id of sheet) {
    const [kind, vid] = id.includes(':') ? id.split(':') : [opt.kind, id];
    const info = await page.evaluate(([v, k]) => qa.headings(v, k), [vid, kind]);
    for (const which of ['new', 'current']) {
      await page.evaluate(([on, z]) => (qa.useNew(on), qa.render(z)), [which === 'new', info.zoom]);
      await page.screenshot({ path: `${out}/headings-${vid}-${which}.png` });
    }
    report.headings = { ...(report.headings ?? {}), [vid]: info };
    await page.evaluate(() => qa.clearHeadings());
  }
  // every heading of each listed bogie style, alone on its rails
  for (const id of opt.bogies ? opt.bogies.split(',') : []) {
    const [style, kind] = id.split(':');
    for (const which of ['new', 'current']) {
      await page.evaluate(([on]) => qa.useNew(on), [which === 'new']);
      await page.evaluate(([st, k]) => qa.bogies(st, k ?? 'bogie'), [style, kind]);
      await page.evaluate(() => qa.render(3));
      await page.screenshot({
        path: `${out}/bogie-${style}-${which}.png`,
        clip: { x: 100, y: 180, width: 2200, height: 1140 },
      });
    }
    await page.evaluate(() => qa.clearHeadings());
  }
} finally {
  await browser.close();
}
// a sheets-only run keeps the loop run's report
writeFileSync(
  `${out}/${opt.loop === 'no' ? 'report-sheets' : 'report'}.json`,
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    name,
    scenarios: report.scenarios.length,
    reversalError: report.reversalError,
    facings: report.facingsCovered?.length,
    errors: errors.length,
  }),
);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}

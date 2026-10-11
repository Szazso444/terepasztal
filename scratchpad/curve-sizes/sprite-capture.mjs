// Scratch: every engine as the pipeline renders it (sprite sets now / A / B from pipeline-out-ladder),
// side by side on straight track and through its first curve.
//   node scratchpad/curve-sizes/sprite-capture.mjs [lineup|curve|all]   (ladder-explore on 5177)
import { launch } from '../runtime.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const what = process.argv[2] ?? 'all';
const out = 'scratchpad/curve-sizes/sprites';
mkdirSync(out, { recursive: true });
const BASE = 'http://127.0.0.1:5177/scratchpad/curve-sizes/';
const ROOT = 'G:/DEV/Terepasztal/pipeline-out-ladder';
const LEN = Object.fromEntries(['now', 'A', 'B'].map((s) => [s, JSON.parse(readFileSync(`${ROOT}/lengths-${s}.json`, 'utf8'))]));
const HAVE = Object.fromEntries(['now', 'A', 'B'].map((s) => [s, new Set(JSON.parse(readFileSync(`${ROOT}/packed/${s}/have.json`, 'utf8')).have.map((h) => h.split('@')[0]))]));
const mainLocos = JSON.parse(readFileSync('C:/Users/Zso/terepasztal-mainview/src/data/locomotives.json', 'utf8'));
const LARGE_NOW = new Set(mainLocos.filter((d) => d.size === 'large').map((d) => d.id));
const NARROW = new Set(['rocket', 'bm50', 'muki', 'c50', 'mav490', 'mk45', 'mk48', 'rezet']);
const SPREAD = 'spread=koutetsujou:0.125';
const Q = {
  now: `len=${Object.entries(LEN.now).map(([id, L]) => `${id}:${L}`).join(',')}&${SPREAD}&sprites=now`,
  A: `ladder=A&len=crocodile:2.5&${SPREAD}&sprites=A`,
  B: `ladder=B&len=crocodile:3&${SPREAD}&sprites=B`,
};
const GROUPS = {
  overview: { zoom: 2, rows: ['rocket', 'muki', '', 'john_bull', 'class08', '', 'general', 'sw1', '', 'black_five', 'f7', '', 'nine_f', 'sd40', '', 'big_boy', 'koutetsujou'], B: true },
  corvette: { zoom: 3, rows: ['rocket', 'muki', 'bm50'] },
  frigate: { zoom: 2.5, rows: ['mk45', 'mk48', 'rezet', 'mav490', 'c50', 'adler', 'john_bull', 'mav375', 'j94', 'class08'] },
  destroyer: { zoom: 3, rows: ['sw1', 'kando_v40', 'general', 'jupiter'] },
  cruiser: { zoom: 2.2, rows: ['k4s', 'flying_scotsman', 'drg01', 'taurus', 'v63', 'm62', 're460', 'black_five', 'deltic', 'f7', 'mallard', 'ice1', 'tgv'] },
  battleship: { zoom: 2.2, rows: ['crocodile', 'nine_f', 'gg1', 'daylight', 'sd40', 'dda40x', 'mav424'], B: true },
  juggernaut: { zoom: 2.5, rows: ['big_boy', 'koutetsujou'], B: true },
};
const W = 1800, H = 1100;
const browser = await launch();
const report = { errors: [], lineups: {}, curves: [] };
const shown = (set, id) => id && LEN[set][id] !== undefined && HAVE[set].has(id);
try {
  if (what !== 'curve')
    for (const [name, grp] of Object.entries(GROUPS)) {
      const shots = [];
      for (const set of ['now', 'A', ...(grp.B ? ['B'] : [])]) {
        const rows = grp.rows.map((id) => (shown(set, id) ? id : ''));
        const page = await browser.newPage({ viewport: { width: W, height: H } });
        page.on('pageerror', (e) => report.errors.push(`${name} ${set}: ${e.message}`));
        await page.goto(`${BASE}lineup.html?${Q[set]}&rows=${rows.join(',')}&zoom=${grp.zoom}`);
        await page.waitForFunction(() => typeof window.qa?.shot === 'function', null, { timeout: 180000 });
        const placed = await page.evaluate(() => qa.shot());
        const sprited = await page.evaluate(() => qa.sprited);
        const full = PNG.sync.read(await page.screenshot());
        await page.evaluate(() => qa.bare());
        const bare = PNG.sync.read(await page.screenshot());
        shots.push({ set, full, bare, placed, sprited, rows });
        await page.close();
      }
      let x0 = W, y0 = H, x1 = 0, y1 = 0;
      for (const { full, bare } of shots)
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            if (Math.abs(full.data[i] - bare.data[i]) + Math.abs(full.data[i + 1] - bare.data[i + 1]) + Math.abs(full.data[i + 2] - bare.data[i + 2]) > 30) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
      if (x1 < x0) {
        console.log('lineup', name, 'empty: no engine of it has a sprite yet');
        continue;
      }
      const pad = 28;
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
      for (const { set, full, placed, sprited, rows } of shots) {
        const crop = new PNG({ width: cw, height: ch });
        PNG.bitblt(full, crop, x0, y0, cw, ch, 0, 0);
        writeFileSync(`${out}/lineup-${name}-${set}.png`, PNG.sync.write(crop));
        (report.lineups[name] ??= { rows: grp.rows, crop: [x0, y0, cw, ch], sets: {} }).sets[set] = { rows, placed, sprited };
      }
      console.log('lineup', name, cw, ch);
    }
  if (what !== 'lineup') {
    // [set, query, ids] per page; the curve each engine runs on
    const curveRuns = [];
    const nowIds = Object.keys(LEN.now).filter((id) => HAVE.now.has(id));
    curveRuns.push(['now', `${Q.now}&cls=high_speed&hsn=1`, nowIds.filter((id) => !LARGE_NOW.has(id))]);
    curveRuns.push(['now', `${Q.now}&cls=regular`, nowIds.filter((id) => LARGE_NOW.has(id))]);
    const aIds = Object.keys(LEN.A).filter((id) => HAVE.A.has(id));
    curveRuns.push(['A', `${Q.A}&cls=regular`, aIds.filter((id) => !NARROW.has(id))]);
    curveRuns.push(['A', `${Q.A}&cls=high_speed&hsn=1`, aIds.filter((id) => NARROW.has(id))]);
    const bIds = Object.keys(LEN.B).filter((id) => HAVE.B.has(id) && LEN.B[id] !== LEN.A[id]);
    curveRuns.push(['B', `${Q.B}&cls=regular`, bIds]);
    curveRuns.push(['B3', `${Q.B}&cls=high_speed&hsn=3`, bIds]);
    for (const [name, query, ids] of curveRuns) {
      if (!ids.length) continue;
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.on('pageerror', (e) => report.errors.push(`curve ${name}: ${e.message}`));
      await page.goto(`${BASE}?${query}&ids=${ids.join(',')}`);
      await page.waitForFunction(() => typeof window.qa?.show === 'function', null, { timeout: 180000 });
      const order = await page.evaluate(() => qa.ids);
      const sprited = await page.evaluate(() => qa.sprited);
      for (let i = 0; i < order.length; i++) {
        const r = await page.evaluate(([i]) => qa.show(i, 'loco', 2), [i]);
        const file = `curve-${order[i]}-${name}.png`;
        await page.screenshot({ path: `${out}/${file}`, clip: { x: 340, y: 220, width: 640, height: 480 } });
        report.curves.push({ id: order[i], name, file, loco: r.lengths.loco, sprited: sprited.includes(order[i]), n: query.match(/hsn=(\d)/)?.[1] ?? '2' });
      }
      await page.close();
      console.log('curves', name, order.length);
    }
  }
} finally {
  await browser.close();
  writeFileSync(`${out}/report-${what}.json`, JSON.stringify(report, null, 1));
  console.log(report.errors.length ? report.errors : 'no errors');
}

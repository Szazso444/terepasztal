// Scratch: every class standing side by side on straight track, today (main) and on Ladders A and B.
//   node scratchpad/curve-sizes/lineup-capture.mjs   (ladder-explore on 5177, main-view on 5178)
import { launch } from '../runtime.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const out = 'scratchpad/curve-sizes/lineup';
mkdirSync(out, { recursive: true });
const LADDER = 'http://127.0.0.1:5177/scratchpad/curve-sizes/lineup.html';
const MAIN = 'http://127.0.0.1:5178/scratchpad/sizes-now/lineup.html';
const mainLocos = JSON.parse(readFileSync('C:/Users/Zso/terepasztal-mainview/src/data/locomotives.json', 'utf8'));
const LARGE = mainLocos.filter((d) => d.size === 'large').map((d) => d.id);
const GROUPS = {
  overview: { zoom: 2, rows: ['rocket', 'muki', '', 'john_bull', 'class08', '', 'general', 'sw1', '', 'black_five', 'f7', '', 'nine_f', 'sd40', '', 'big_boy', 'koutetsujou'] },
  corvette: { zoom: 3, rows: ['rocket', 'muki', 'bm50'] },
  frigate: { zoom: 2.5, rows: ['mk45', 'mk48', 'rezet', 'mav490', 'c50', 'adler', 'john_bull', 'mav375', 'j94', 'class08'] },
  destroyer: { zoom: 3, rows: ['sw1', 'kando_v40', 'general', 'jupiter'] },
  cruiser: { zoom: 2.2, rows: ['k4s', 'flying_scotsman', 'drg01', 'taurus', 'v63', 'm62', 're460', 'black_five', 'deltic', 'f7', 'mallard', 'ice1', 'tgv'] },
  battleship: { zoom: 2.2, rows: ['crocodile', 'nine_f', 'gg1', 'daylight', 'sd40', 'dda40x', 'mav424'], B: true },
  juggernaut: { zoom: 2.5, rows: ['big_boy', 'koutetsujou'], B: true },
};
GROUPS.overview.B = true;
const SCRATCH = 'spread=koutetsujou:0.125';
const RUNS = (grp) => [
  ['now', MAIN, `hs=${LARGE.join(',')}`],
  ['A', LADDER, `ladder=A&len=crocodile:2.5&${SCRATCH}`],
  ...(grp.B ? [['B', LADDER, `ladder=B&len=crocodile:3&${SCRATCH}`]] : []),
];
const W = 1800, H = 1100;
const browser = await launch();
const report = { errors: [], groups: {} };
try {
  for (const [name, grp] of Object.entries(GROUPS)) {
    const shots = [];
    for (const [run, base, query] of RUNS(grp)) {
      const page = await browser.newPage({ viewport: { width: W, height: H } });
      page.on('pageerror', (e) => report.errors.push(`${name} ${run}: ${e.message}`));
      await page.goto(`${base}?${query}&rows=${grp.rows.join(',')}&zoom=${grp.zoom}`);
      await page.waitForFunction(() => typeof window.qa?.shot === 'function', null, { timeout: 180000 });
      const placed = await page.evaluate(() => qa.shot());
      const full = PNG.sync.read(await page.screenshot());
      await page.evaluate(() => qa.bare());
      const bare = PNG.sync.read(await page.screenshot());
      shots.push({ run, full, bare, placed });
      await page.close();
    }
    // one crop for every run of a group, so the lengths compare frame to frame
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (const { full, bare } of shots)
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const d = Math.abs(full.data[i] - bare.data[i]) + Math.abs(full.data[i + 1] - bare.data[i + 1]) + Math.abs(full.data[i + 2] - bare.data[i + 2]);
          if (d > 30) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
    const pad = 28;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    for (const { run, full, placed } of shots) {
      const crop = new PNG({ width: cw, height: ch });
      PNG.bitblt(full, crop, x0, y0, cw, ch, 0, 0);
      writeFileSync(`${out}/${name}-${run}.png`, PNG.sync.write(crop));
      (report.groups[name] ??= { rows: grp.rows, crop: [x0, y0, cw, ch], runs: {} }).runs[run] = placed;
    }
    console.log(name, cw, ch);
  }
} finally {
  await browser.close();
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
  console.log(report.errors.length ? report.errors : 'no errors');
}

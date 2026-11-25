// An icicle flame graph (root on top), coloured by source area, as a static SVG page, from the
// collapsed stacks summarize.mjs writes (<file>.folded).
//
//   node tools/perf/flame.mjs <in.folded> <out.html> ["<title>"] [focusPrefix]
//
// focusPrefix roots the graph at the first frame of each stack that starts with it (for example
// `run sim/step.ts` for the simulation only). The harness's own wrapper frames are left out.
import { readFileSync, writeFileSync } from 'node:fs';

const [inp, outp, title = '', focus] = process.argv.slice(2);
if (!inp || !outp) {
  console.error(
    'usage: node tools/perf/flame.mjs <in.folded> <out.html> ["<title>"] [focusPrefix]',
  );
  process.exit(2);
}

const root = { n: 'all', v: 0, c: new Map() };
for (const line of readFileSync(inp, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const i = line.lastIndexOf(' ');
  const v = Number(line.slice(i + 1));
  let frames = line
    .slice(0, i)
    .split(';')
    .filter((f) => !f.includes('__perf/harness'));
  if (focus) {
    const k = frames.findIndex((f) => f.startsWith(focus));
    if (k < 0) continue;
    frames = frames.slice(k);
  }
  root.v += v;
  let node = root;
  for (const f of frames) {
    let c = node.c.get(f);
    if (!c) node.c.set(f, (c = { n: f, v: 0, c: new Map() }));
    c.v += v;
    node = c;
  }
}

const W = 1800;
const RH = 18;
const TOP = 54;
let maxD = 0;
const rects = [];
const color = (n) => {
  if (/(^| )(sim|world)\//.test(n)) return ['#e8a33d', '#c7862a'];
  if (/(^| )(render|art)\//.test(n)) return ['#4fa3d9', '#3a87ba'];
  if (/npm:pixi/.test(n)) return ['#9b7fd1', '#7f64b5'];
  if (/(^| )(ui)\//.test(n)) return ['#6cbf6a', '#53a252'];
  if (/(^| )(engine)\/|game\.ts/.test(n)) return ['#d9d26a', '#bdb653'];
  if (/garbage/.test(n)) return ['#e05a5a', '#c04545'];
  return ['#9a9a9a', '#858585'];
};
const walk = (node, x, w, d) => {
  if (w < 0.5) return;
  maxD = Math.max(maxD, d);
  if (d > 0) rects.push({ x, w, d, n: node.n, pct: (100 * node.v) / root.v });
  let cx = x;
  for (const ch of [...node.c.values()].sort((a, b) => b.v - a.v)) {
    const cw = (w * ch.v) / node.v;
    walk(ch, cx, cw, d + 1);
    cx += cw;
  }
};
walk(root, 0, W, 0);

const H = TOP + (maxD + 1) * RH + 10;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const svg = rects
  .map(({ x, w, d, n, pct }) => {
    const [c1, c2] = color(n);
    const y = TOP + (d - 1) * RH;
    const label = `${n} ${pct.toFixed(1)}%`;
    const fit = Math.floor((w - 6) / 6.2);
    const txt = fit > 3 ? (label.length > fit ? label.slice(0, fit - 1) + '…' : label) : '';
    const rect = `<rect x="${x.toFixed(1)}" y="${y}" width="${Math.max(0.5, w - 0.6).toFixed(1)}" height="${RH - 1}" fill="${d % 2 ? c1 : c2}"/>`;
    const text = txt ? `<text x="${(x + 3).toFixed(1)}" y="${y + 13}">${esc(txt)}</text>` : '';
    return `<g><title>${esc(label)}</title>${rect}${text}</g>`;
  })
  .join('');
const legend = [
  ['sim / world', '#e8a33d'],
  ['render / art', '#4fa3d9'],
  ['pixi.js', '#9b7fd1'],
  ['ui', '#6cbf6a'],
  ['engine / game.ts', '#d9d26a'],
  ['other / native', '#9a9a9a'],
]
  .map(
    ([l, c], i) =>
      `<rect x="${10 + i * 150}" y="30" width="12" height="12" fill="${c}"/><text x="${28 + i * 150}" y="40">${l}</text>`,
  )
  .join('');
writeFileSync(
  outp,
  `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#16181c}text{font:11px system-ui,sans-serif;fill:#111}.t{font:bold 15px system-ui;fill:#eee}.l text{fill:#ddd}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><text class="t" x="10" y="20">${esc(title)} — ${(root.v / 1000).toFixed(0)} ms sampled</text><g class="l">${legend}</g>${svg}</svg>`,
);
console.log(outp, 'depth', maxD, 'height', H);

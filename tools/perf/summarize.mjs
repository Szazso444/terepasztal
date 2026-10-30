// Self and total time per function of a V8 CPU profile (`cdp.mjs profile`, or the scale
// benchmark's PERF_PROF), with the production bundle's minified frames resolved through its
// source maps, plus a collapsed-stack file for flame.mjs.
//
//   node tools/perf/summarize.mjs <file.cpuprofile> [distDir] [--from ms] [--to ms] [--n 30]
//                                 [--total | --areas]
//
// distDir is the build the profile ran (default `dist`); frames from the dev server or Node
// already carry their source paths. It writes <file>.resolved.json (self, total, by area) and
// <file>.folded, and prints the top `--n` rows by self time (--total: by total, --areas: by
// source area). `--from`/`--to` keep only the samples in that window, in ms from the start.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const file = args[0];
if (!file) {
  console.error(
    'usage: node tools/perf/summarize.mjs <file.cpuprofile> [distDir] [--from ms] [--to ms]',
  );
  process.exit(2);
}
const dist = args[1] && !args[1].startsWith('--') ? args[1] : 'dist';
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : null;
};
const from = opt('--from');
const to = opt('--to');
const profile = JSON.parse(readFileSync(file, 'utf8'));

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VAL = {};
for (let i = 0; i < 64; i++) VAL[B64[i]] = i;
function vlq(s) {
  const out = [];
  let v = 0;
  let sh = 0;
  for (const c of s) {
    const d = VAL[c];
    v += (d & 31) << sh;
    if (d & 32) sh += 5;
    else {
      out.push(v & 1 ? -(v >> 1) : v >> 1);
      v = 0;
      sh = 0;
    }
  }
  return out;
}

const maps = new Map();
/** The decoded source map of a bundle path such as `/assets/index-abc.js`, or null. */
function loadMap(path) {
  if (maps.has(path)) return maps.get(path);
  let m = null;
  try {
    const sm = JSON.parse(readFileSync(join(dist, path + '.map'), 'utf8'));
    const lines = [];
    let src = 0;
    let sl = 0;
    let nm = 0;
    for (const ln of sm.mappings.split(';')) {
      let col = 0;
      const segs = [];
      if (ln)
        for (const s of ln.split(',')) {
          const v = vlq(s);
          col += v[0];
          if (v.length > 1) {
            src += v[1];
            sl += v[2];
            let name = null;
            if (v.length > 4) {
              nm += v[4];
              name = sm.names[nm];
            }
            segs.push([col, src, sl, name]);
          }
        }
      lines.push(segs);
    }
    m = { sm, lines };
  } catch {
    // no map for this file: its frames keep their minified names
  }
  maps.set(path, m);
  return m;
}

const cleanSource = (p) =>
  p
    .split('\\')
    .join('/')
    .replace(/^(\.\.\/)+/, '')
    .replace(/^.*node_modules\//, 'npm:');

/** A profile frame as { fn, file, line }, through the source map when it is in the bundle. */
function resolve(cf) {
  const url = cf.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '');
  if (/^\/assets\/.*\.js$/.test(url)) {
    const m = loadMap(url);
    const segs = m?.lines[cf.lineNumber];
    if (segs?.length) {
      let best = 0;
      for (let i = 0; i < segs.length; i++)
        if (segs[i][0] <= cf.columnNumber) best = i;
        else break;
      const s = segs[best];
      return {
        fn: cf.functionName || s[3] || '(anon)',
        file: cleanSource(m.sm.sources[s[1]]),
        line: s[2] + 1,
      };
    }
  }
  // the dev server's `/src/...` and Node's file:// URLs already name the source
  const path = url
    .replace(/^file:\/\/\/?/, '')
    .replace(/^.*?\/(src|tools)\//, '$1/')
    .replace(/^\//, '');
  return { fn: cf.functionName || '(anon)', file: cleanSource(path), line: cf.lineNumber + 1 };
}

const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const lab = new Map();
for (const n of profile.nodes) {
  const r = resolve(n.callFrame);
  lab.set(n.id, { key: `${r.fn} ${r.file}${r.file ? ':' + r.line : ''}`, fn: r.fn, file: r.file });
}

const dt = profile.timeDeltas;
let t = profile.startTime;
const selfBy = new Map();
const totalBy = new Map();
const areaSelf = new Map();
const folded = new Map();
let total = 0;
const add = (m, k, v) => m.set(k, (m.get(k) ?? 0) + v);
for (let i = 0; i < profile.samples.length; i++) {
  t += dt[i];
  const at = (t - profile.startTime) / 1000;
  if ((from != null && at < from) || (to != null && at > to)) continue;
  const w = (dt[i + 1] ?? 0) / 1000;
  total += w;
  const nid = profile.samples[i];
  const L = lab.get(nid);
  add(selfBy, L.key, w);
  const area = L.file.startsWith('npm:')
    ? L.file.split('/')[0]
    : L.file.startsWith('src/')
      ? L.file.split('/').slice(0, 2).join('/')
      : L.file || L.fn;
  add(areaSelf, area, w);
  const chain = [];
  const seen = new Set();
  for (let p = nid; p != null; p = parent.get(p)) {
    const l = lab.get(p);
    chain.push(l.fn + (l.file ? ' ' + l.file.replace(/^src\//, '') : ''));
    if (!seen.has(l.key)) {
      seen.add(l.key);
      add(totalBy, l.key, w);
    }
  }
  const stack = chain
    .reverse()
    .filter((x) => x !== '(root)')
    .join(';');
  add(folded, stack, w);
}

const fmt = (m, n) =>
  [...m]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(
      ([k, v]) =>
        `${v.toFixed(0).padStart(7)} ms ${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`,
    );
const out = {
  windowMs: Math.round(total),
  self: fmt(selfBy, 50),
  total: fmt(totalBy, 70),
  areas: fmt(areaSelf, 25),
};
const stem = file.replace(/\.cpuprofile$/, '');
writeFileSync(`${stem}.resolved.json`, JSON.stringify(out, null, 1));
writeFileSync(
  `${stem}.folded`,
  [...folded].map(([k, v]) => `${k} ${Math.round(v * 1000)}`).join('\n'),
);
const show = args.includes('--total') ? out.total : args.includes('--areas') ? out.areas : out.self;
console.log(`window ${out.windowMs} ms (${stem}.resolved.json, ${stem}.folded)`);
console.log(show.slice(0, opt('--n') ?? 30).join('\n'));

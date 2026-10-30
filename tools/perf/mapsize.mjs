// What a built bundle is made of: bytes of the minified file attributed to its sources through
// the source map, by area (`src/<dir>`, each npm package, JSON) and the 15 largest source files.
//
//   node tools/perf/mapsize.mjs dist/assets/index-<hash>.js
import { readFileSync } from 'node:fs';

const js = process.argv[2];
if (!js) {
  console.error('usage: node tools/perf/mapsize.mjs <bundle.js>   (its .map must sit beside it)');
  process.exit(2);
}
const code = readFileSync(js, 'utf8');
const sm = JSON.parse(readFileSync(js + '.map', 'utf8'));

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VAL = {};
for (let i = 0; i < 64; i++) VAL[B64[i]] = i;
function decode(s) {
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

// bytes per source index: each segment owns the columns up to the next one (-1: unmapped)
const lines = code.split('\n');
const bytes = new Map();
const add = (m, k, v) => m.set(k, (m.get(k) ?? 0) + v);
let src = 0;
sm.mappings.split(';').forEach((ln, li) => {
  let col = 0;
  const marks = [];
  for (const s of ln ? ln.split(',').map(decode) : []) {
    col += s[0];
    if (s.length > 1) {
      src += s[1];
      marks.push([col, src]);
    } else marks.push([col, -1]);
  }
  const lineLen = (lines[li] ?? '').length;
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1][0] : lineLen;
    add(bytes, marks[i][1], end - marks[i][0]);
  }
});

const sourcePath = (k) => sm.sources[k].split('\\').join('/');
const groups = new Map();
let total = 0;
for (const [k, b] of bytes) {
  total += b;
  if (k < 0) {
    add(groups, '(unmapped)', b);
    continue;
  }
  const p = sourcePath(k);
  let g = p.includes('node_modules/')
    ? 'node_modules/' + p.split('node_modules/')[1].split('/')[0]
    : p
        .replace(/^(\.\.\/)+/, '')
        .split('/')
        .slice(0, 2)
        .join('/');
  if (!p.includes('node_modules/') && (g.startsWith('src/data') || p.endsWith('.json')))
    g = 'src/data + json';
  add(groups, g, b);
}
const kB = (b) => (b / 1024).toFixed(1).padStart(8) + ' kB';
console.log('total', kB(total));
for (const [g, b] of [...groups].sort((a, b) => b[1] - a[1]).slice(0, 20))
  console.log(kB(b), ((100 * b) / total).toFixed(1).padStart(5) + '%', g);
const files = new Map();
for (const [k, b] of bytes)
  if (k >= 0 && !sourcePath(k).includes('node_modules')) add(files, sourcePath(k), b);
console.log('--- the largest source files');
for (const [f, b] of [...files].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(kB(b), f);

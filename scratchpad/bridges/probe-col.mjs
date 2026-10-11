// node scratchpad/bridges/probe-col.mjs <src> col <x> | row <y>   dark-outline runs along a column or row
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const [src, kind, at] = process.argv.slice(2);
const p = PNG.sync.read(readFileSync(`assets/source/bridges-v1/${src}.png`));
const n = kind === 'col' ? p.height : p.width;
const px = (i) => {
  const x = kind === 'col' ? +at : i, y = kind === 'col' ? i : +at, k = (y * p.width + x) * 4;
  const a = p.data[k + 3], l = (p.data[k] + p.data[k + 1] + p.data[k + 2]) / 3;
  return a < 150 ? ' ' : l < 120 ? '#' : l < 185 ? '+' : '.';
};
let out = [], cur = null, start = 0;
for (let i = 0; i <= n; i++) {
  const c = i < n ? px(i) : null;
  if (c !== cur) { if (cur !== null && cur !== ' ') out.push(`${cur}${start}-${i - 1}`); cur = c; start = i; }
}
console.log(src, kind, at, out.join(' '));

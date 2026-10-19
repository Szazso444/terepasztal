import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
const root = 'assets/source/fuel-2026-10-11';
const [mode, view, number, source] = process.argv.slice(2);
const hash = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
if (mode === 'save') {
  const dst = `${root}/raw/fuel_pump-a1-${view}-attempt-${number}.png`;
  if (existsSync(dst)) throw Error('Refusing to overwrite a painting');
  copyFileSync(source, dst);
  if (hash(source) !== hash(dst)) throw Error('Copy differs');
  const p = PNG.sync.read(readFileSync(dst));
  console.log(JSON.stringify({ file: dst, returned: [p.width, p.height], sha256: hash(dst) }));
}
if (mode === 'finish') {
  const path = `${root}/prompts.json`;
  const records = JSON.parse(readFileSync(path, 'utf8'));
  const a = records.attempts.find((x) => x.view === view && x.attempt === Number(number));
  const info = JSON.parse(readFileSync(`${root}/${view}-${number}-metadata.json`, 'utf8'));
  const m = a.measured;
  m.height.required = view === 'r2' ? [0.43, 0.47] : [0.39, 0.47];
  m.height.pass = m.height.ratio >= m.height.required[0] && m.height.ratio <= m.height.required[1];
  m.houseWidthFraction = m.height.houseWidth / a.returned[0];
  m.crane = info.crane;
  m.accepted = info.accepted;
  m.failure = info.failure;
  if (view === 'r3') {
    m.step = 'r3 step 1';
    const baseline = { w: [381, 1009], s: [562, 1107], e: [1057, 846] };
    const delta = Object.fromEntries(
      Object.keys(baseline).map((k) => [k, m.plan.used[k].map((v, i) => v - baseline[k][i])]),
    );
    const widthDelta = m.height.houseWidth - 676;
    m.footprint = {
      baseline,
      delta,
      widthDelta,
      pass:
        Object.values(delta)
          .flat()
          .every((v) => Math.abs(v) <= 10) && Math.abs(widthDelta) <= 10,
    };
    m.light.directionalRatioPass = m.light.pass;
    m.light.referenceMedians = [118.7276, 117.8576];
    m.light.deltas = m.light.walls.map((w, i) => w.median - m.light.referenceMedians[i]);
    m.light.pass = m.light.deltas.every((d) => Math.abs(d) <= 8);
  } else {
    m.light.pass =
      m.light.pass &&
      m.light.walls[0].median >= 100 &&
      m.light.walls[0].median <= 150 &&
      m.light.walls[1].median >= 60 &&
      m.light.walls[1].median <= 85;
  }
  a.sha256 = hash(`${root}/${a.file}`);
  a.source = info.source;
  const p = PNG.sync.read(readFileSync(`${root}/${a.file}`));
  const grass = new PNG({ width: p.width, height: p.height });
  for (let i = 0; i < p.data.length; i += 4) {
    const alpha = p.data[i + 3] / 255;
    for (let c = 0; c < 3; c++)
      grass.data[i + c] = Math.round(p.data[i + c] * alpha + [109, 133, 73][c] * (1 - alpha));
    grass.data[i + 3] = 255;
  }
  writeFileSync(`${root}/${m.grassReview}`, PNG.sync.write(grass));
  writeFileSync(path, JSON.stringify(records, null, 2) + '\n');
  console.log(JSON.stringify({ view, number, measured: m }, null, 2));
}

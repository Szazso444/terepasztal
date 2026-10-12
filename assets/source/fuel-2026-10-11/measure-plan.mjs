import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { measureBase } from '../../../tools/building-fit.mjs';

for (const file of process.argv.slice(2)) {
  const png = PNG.sync.read(readFileSync(file));
  const base = measureBase(png);
  if (!base) throw new Error(`Cannot measure ${file}`);
  const left = base.s[0] - base.w[0];
  const right = base.e[0] - base.s[0];
  const difference = Math.max(left, right) / Math.min(left, right) - 1;
  console.log(
    JSON.stringify(
      {
        file,
        returned: [png.width, png.height],
        w: base.w,
        s: base.s,
        e: base.e,
        sure: base.sure,
        slopes: base.slopes,
        lowerLeftSpan: left,
        lowerRightSpan: right,
        difference,
        withinFivePercent: difference <= 0.05,
      },
      null,
      2,
    ),
  );
}

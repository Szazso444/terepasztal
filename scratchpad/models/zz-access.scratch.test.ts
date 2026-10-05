// Scratch (not for commit): measures candidate gear and lengths on each track class.
// ACCESS_IN = JSON [{ id, tiles, gear }], ACCESS_OUT = where the verdicts go.
import { it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { measure } from './compat';
import { vehicleSpec } from './body';
import { TRACK_CLASSES } from '../world/track';
import type { Gear } from './gear';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

it('measures the candidates', () => {
  const input = process.env.ACCESS_IN;
  if (!input) return;
  const rows = JSON.parse(readFileSync(input, 'utf8')) as { id: string; tiles: number; gear: Gear }[];
  const out = rows.map((r) => {
    const spec = vehicleSpec({ gear: r.gear, lengthTiles: r.tiles });
    const gauge = (r.gear as { gauge?: string }).gauge ?? 'regular';
    const res: Record<string, unknown> = { id: r.id, tiles: r.tiles };
    for (const cls of TRACK_CLASSES) {
      if ((cls === 'narrow') !== (gauge === 'narrow')) continue;
      const v = measure(spec, cls);
      res[cls] = {
        ok: v.ok,
        foreAft: +v.foreAft.toFixed(3),
        sideways: +v.sideways.toFixed(3),
        gap: +v.gap.toFixed(3),
        gapLimit: +(0.25 * spec.L).toFixed(3),
        lateral: +v.lateral.toFixed(3),
      };
    }
    return res;
  });
  writeFileSync(process.env.ACCESS_OUT!, JSON.stringify(out, null, 1));
});

// Site measurement behind the rare-landmarks spec (2026-10-18-rare-landmarks-design.md, section 1).
// Not part of the build. To rerun, copy it to src/world/_landmark_measure.test.ts and run:
//   LM_MARGIN=3 LM_SEEDS=40 LM_RING=4 LM_OUT=out.txt npx vitest run src/world/_landmark_measure.test.ts
import { it } from 'vitest';
import { appendFileSync } from 'node:fs';
const log = (s: string) => appendFileSync(process.env.LM_OUT ?? 'lm.txt', s + '\n');
import { generateMap } from './mapgen';
import { tileLevels } from './elevation';
import { Biome, Terrain, climateAtIndex } from './tiles';

const C = 32;
const RING = Number(process.env.LM_RING ?? 4);
const SEEDS = Number(process.env.LM_SEEDS ?? 30);
const MARGIN = Number(process.env.LM_MARGIN ?? 2);

type Ctx = {
  w: number;
  h: number;
  terrain: Uint8Array;
  lv: Uint8Array;
  clim: (i: number) => number;
  biome: Uint8Array;
  deposit: Uint8Array;
  coal: Uint8Array;
};

function legal(c: Ctx, x: number, y: number, fw: number, fd: number) {
  const l0 = c.lv[y * c.w + x];
  for (let j = y; j < y + fd; j++)
    for (let i = x; i < x + fw; i++) {
      const k = j * c.w + i;
      const t = c.terrain[k];
      if (t === Terrain.Water || t === Terrain.Rock || t === Terrain.Mountain) return false;
      if (c.lv[k] !== l0) return false;
      if (c.deposit[k]) return false;
    }
  return true;
}
function around(
  c: Ctx,
  x: number,
  y: number,
  fw: number,
  fd: number,
  r: number,
  f: (k: number) => void,
) {
  for (let j = Math.max(0, y - r); j < Math.min(c.h, y + fd + r); j++)
    for (let i = Math.max(0, x - r); i < Math.min(c.w, x + fw + r); i++) f(j * c.w + i);
}
const water = (c: Ctx, k: number) => c.biome[k] === Biome.Lake || c.biome[k] === Biome.River;

type Rule = { id: string; fw: number; fd: number; ok: (c: Ctx, x: number, y: number) => boolean };
const rules: Rule[] = [
  { id: 'free3x2', fw: 3, fd: 2, ok: () => true },
  {
    id: 'merchant:plains',
    fw: 3,
    fd: 2,
    ok: (c, x, y) => {
      let n = 0;
      around(c, x, y, 3, 2, 0, (k) => {
        if (c.clim(k) !== Biome.Plains) n++;
      });
      return n === 0;
    },
  },
  {
    id: 'bath:freshwater<=3',
    fw: 4,
    fd: 3,
    ok: (c, x, y) => {
      let n = 0;
      around(c, x, y, 4, 3, 3, (k) => {
        if (water(c, k)) n++;
      });
      return n > 0;
    },
  },
  { id: 'bell:free1x1', fw: 1, fd: 1, ok: () => true },
  { id: 'bell:hilltop', fw: 1, fd: 1, ok: (c, x, y) => c.lv[y * c.w + x] >= 2 },
  {
    id: 'archive:freshwater<=2',
    fw: 4,
    fd: 4,
    ok: (c, x, y) => {
      let n = 0;
      around(c, x, y, 4, 4, 2, (k) => {
        if (water(c, k)) n++;
      });
      return n > 0;
    },
  },
  {
    id: 'root:forest>=8in2',
    fw: 2,
    fd: 2,
    ok: (c, x, y) => {
      let n = 0;
      around(c, x, y, 2, 2, 2, (k) => {
        if (c.terrain[k] === Terrain.Forest) n++;
      });
      return n >= 8;
    },
  },
  {
    id: 'cable:+2level<=2',
    fw: 3,
    fd: 2,
    ok: (c, x, y) => {
      const l0 = c.lv[y * c.w + x];
      let n = 0;
      around(c, x, y, 3, 2, 2, (k) => {
        if (c.lv[k] >= l0 + 2) n++;
      });
      return n > 0;
    },
  },
  { id: 'storm:level>=2', fw: 2, fd: 2, ok: (c, x, y) => c.lv[y * c.w + x] >= 2 },
  {
    id: 'ashen:desert<=3',
    fw: 4,
    fd: 2,
    ok: (c, x, y) => {
      let n = 0;
      around(c, x, y, 4, 2, 3, (k) => {
        if (c.clim(k) === Biome.Desert) n++;
      });
      return n > 0;
    },
  },
  { id: 'manor:free3x3', fw: 3, fd: 3, ok: () => true },
  {
    id: 'foundry:rock<=3',
    fw: 5,
    fd: 4,
    ok: (c, x, y) => {
      let n = 0;
      around(c, x, y, 5, 4, 3, (k) => {
        if (c.terrain[k] === Terrain.Rock || c.terrain[k] === Terrain.Mountain) n++;
      });
      return n > 0;
    },
  },
  {
    id: 'moon:lake<=3',
    fw: 2,
    fd: 2,
    ok: (c, x, y) => {
      let n = 0;
      around(c, x, y, 2, 2, 3, (k) => {
        if (c.biome[k] === Biome.Lake) n++;
      });
      return n > 0;
    },
  },
  {
    id: 'hbs:P+F+D+T<=3',
    fw: 4,
    fd: 4,
    ok: (c, x, y) => {
      const s = new Set<number>();
      around(c, x, y, 4, 4, 3, (k) => s.add(c.clim(k)));
      return [Biome.Plains, Biome.Forest, Biome.Desert, Biome.Taiga].every((b) => s.has(b));
    },
  },
  {
    id: 'hbs:P+F+D+T<=6',
    fw: 4,
    fd: 4,
    ok: (c, x, y) => {
      const s = new Set<number>();
      around(c, x, y, 4, 4, 6, (k) => s.add(c.clim(k)));
      return [Biome.Plains, Biome.Forest, Biome.Desert, Biome.Taiga].every((b) => s.has(b));
    },
  },
  ...[4, 8, 10, 12].map((r) => ({
    id: 'hbs:P+F+D+T<=' + r,
    fw: 4,
    fd: 4,
    ok: (c: Ctx, x: number, y: number) => {
      const s = new Set<number>();
      around(c, x, y, 4, 4, r, (k) => s.add(c.clim(k)));
      return [Biome.Plains, Biome.Forest, Biome.Desert, Biome.Taiga].every((b) => s.has(b));
    },
  })),
  {
    id: 'hbs:any4land<=3',
    fw: 4,
    fd: 4,
    ok: (c, x, y) => {
      const s = new Set<number>();
      around(c, x, y, 4, 4, 3, (k) => {
        const b = c.clim(k);
        if (b <= Biome.Swamp) s.add(b);
      });
      return s.size >= 4;
    },
  },
  {
    id: 'hbs:any4land<=6',
    fw: 4,
    fd: 4,
    ok: (c, x, y) => {
      const s = new Set<number>();
      around(c, x, y, 4, 4, 6, (k) => {
        const b = c.clim(k);
        if (b <= Biome.Swamp) s.add(b);
      });
      return s.size >= 4;
    },
  },
  {
    id: 'hbs:any3land<=3',
    fw: 4,
    fd: 4,
    ok: (c, x, y) => {
      const s = new Set<number>();
      around(c, x, y, 4, 4, 3, (k) => {
        const b = c.clim(k);
        if (b <= Biome.Swamp) s.add(b);
      });
      return s.size >= 3;
    },
  },
];

it('measure landmark sites', { timeout: 3_600_000 }, () => {
  const hits = new Map<string, number>();
  let chunks = 0;
  const climPairs = new Map<string, number>();
  for (let s = 0; s < SEEDS; s++) {
    const seed = 1000 + s * 7919;
    const w = 96 + 64 * RING;
    const map = generateMap(seed, { w, h: w, originX: -32 * RING, originY: -32 * RING });
    const lv = tileLevels(map);
    const deposit = new Uint8Array(w * w);
    const coal = new Uint8Array(w * w);
    for (const [k, ps] of map.props)
      for (const p of ps) {
        if (p.kind === 'coal' || p.kind === 'oil' || p.kind === 'wheat') deposit[k] = 1;
        if (p.kind === 'coal') coal[k] = 1;
      }
    const c: Ctx = {
      w,
      h: w,
      terrain: map.terrain,
      lv,
      clim: (i) => climateAtIndex(map, i),
      biome: map.biome,
      deposit,
      coal,
    };
    const n = w / C;
    const startC = (n - 1) / 2;
    for (let cy = 0; cy < n; cy++)
      for (let cx = 0; cx < n; cx++) {
        if (cx === startC && cy === startC) continue;
        chunks++;
        const present = new Set<number>();
        for (let y = cy * C; y < cy * C + C; y++)
          for (let x = cx * C; x < cx * C + C; x++) {
            const b = c.clim(y * w + x);
            if (b <= Biome.Swamp) present.add(b);
          }
        const key = [...present].sort().join('');
        climPairs.set(key, (climPairs.get(key) ?? 0) + 1);
        for (const r of rules) {
          let found = false;
          for (let y = cy * C + MARGIN; !found && y + r.fd <= cy * C + C - MARGIN; y++)
            for (let x = cx * C + MARGIN; !found && x + r.fw <= cx * C + C - MARGIN; x++)
              if (legal(c, x, y, r.fw, r.fd) && r.ok(c, x, y)) found = true;
          if (found) hits.set(r.id, (hits.get(r.id) ?? 0) + 1);
        }
      }
  }
  const out = rules.map(
    (r) => `${r.id.padEnd(24)} ${(((hits.get(r.id) ?? 0) / chunks) * 100).toFixed(2)}%`,
  );
  log(`chunks=${chunks} seeds=${SEEDS} ring=${RING}\n` + out.join('\n'));
  log(
    'climate sets per chunk (0P 1F 2D 3T 4S):\n' +
      [...climPairs]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([k, v]) => `${k.padEnd(6)} ${((v / chunks) * 100).toFixed(1)}%`)
        .join('\n'),
  );
});

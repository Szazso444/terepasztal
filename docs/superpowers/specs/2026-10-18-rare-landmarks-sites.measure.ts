// Site measurement behind the rare-landmarks spec (2026-10-18-rare-landmarks-design.md, section 1).
// Not part of the build. To rerun, copy it to src/world/_landmark_measure.test.ts and run:
//   LM_SEEDS=40 LM_RING=4 LM_OUT=out.txt npx vitest run src/world/_landmark_measure.test.ts
// It counts, for each landmark, the share of chunks (start chunk left out) holding at least one
// legal footprint that meets the landmark's site rule, with the footprint 3 tiles inside the chunk.
// Footprints are W x D, W along +x. Revised 2026-10-23: footprints follow the pictures at the
// game's door scale.
import { it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { generateMap } from './mapgen';
import { tileLevels } from './elevation';
import { Biome, Terrain, climateAtIndex } from './tiles';

const C = 32;
const RING = Number(process.env.LM_RING ?? 4);
const SEEDS = Number(process.env.LM_SEEDS ?? 40);
const MARGIN = 3;
const log = (s: string) => appendFileSync(process.env.LM_OUT ?? 'lm.txt', s + '\n');

type Ctx = {
  w: number;
  terrain: Uint8Array;
  lv: Uint8Array;
  clim: (i: number) => number;
  biome: Uint8Array;
  deposit: Uint8Array;
};
function legal(c: Ctx, x: number, y: number, fw: number, fd: number) {
  const l0 = c.lv[y * c.w + x];
  for (let j = y; j < y + fd; j++)
    for (let i = x; i < x + fw; i++) {
      const k = j * c.w + i;
      const t = c.terrain[k];
      if (t === Terrain.Water || t === Terrain.Rock || t === Terrain.Mountain) return false;
      if (c.lv[k] !== l0 || c.deposit[k]) return false;
    }
  return true;
}
/** tiles in the footprint grown by r that pass f */
function count(
  c: Ctx,
  x: number,
  y: number,
  fw: number,
  fd: number,
  r: number,
  f: (k: number) => boolean,
) {
  let n = 0;
  for (let j = y - r; j < y + fd + r; j++)
    for (let i = x - r; i < x + fw + r; i++) if (f(j * c.w + i)) n++;
  return n;
}
const fresh = (c: Ctx, k: number) => c.biome[k] === Biome.Lake || c.biome[k] === Biome.River;
const rock = (c: Ctx, k: number) =>
  c.terrain[k] === Terrain.Rock || c.terrain[k] === Terrain.Mountain;
const SEASONS = [Biome.Plains, Biome.Desert, Biome.Forest, Biome.Taiga];

type Rule = { id: string; fw: number; fd: number; ok: (c: Ctx, x: number, y: number) => boolean };
const rules: Rule[] = [
  {
    id: 'merchants_last_stop',
    fw: 2,
    fd: 2,
    ok: (c, x, y) => count(c, x, y, 2, 2, 0, (k) => c.clim(k) !== Biome.Plains) === 0,
  },
  {
    id: 'overgrown_bathhouse',
    fw: 3,
    fd: 2,
    ok: (c, x, y) => count(c, x, y, 3, 2, 3, (k) => fresh(c, k)) > 0,
  },
  { id: 'bellkeepers_refuge', fw: 1, fd: 1, ok: (c, x, y) => c.lv[y * c.w + x] >= 2 },
  {
    id: 'flooded_archive',
    fw: 2,
    fd: 2,
    ok: (c, x, y) => count(c, x, y, 2, 2, 2, (k) => fresh(c, k)) > 0,
  },
  {
    id: 'rootbound_workshop',
    fw: 1,
    fd: 1,
    ok: (c, x, y) => count(c, x, y, 1, 1, 2, (k) => c.terrain[k] === Terrain.Forest) >= 8,
  },
  {
    id: 'cliffside_cable_station',
    fw: 2,
    fd: 2,
    ok: (c, x, y) => {
      const l0 = c.lv[y * c.w + x];
      return count(c, x, y, 2, 2, 2, (k) => c.lv[k] >= l0 + 2) > 0;
    },
  },
  { id: 'stormglass_observatory', fw: 1, fd: 1, ok: (c, x, y) => c.lv[y * c.w + x] >= 2 },
  {
    id: 'ashen_conservatory',
    fw: 2,
    fd: 1,
    ok: (c, x, y) => count(c, x, y, 2, 1, 3, (k) => c.clim(k) === Biome.Desert) > 0,
  },
  { id: 'inverted_manor', fw: 1, fd: 1, ok: () => true },
  {
    id: 'sleeping_foundry',
    fw: 3,
    fd: 2,
    ok: (c, x, y) => count(c, x, y, 3, 2, 3, (k) => rock(c, k)) > 0,
  },
  {
    id: 'moonwell_pavilion',
    fw: 1,
    fd: 1,
    ok: (c, x, y) => count(c, x, y, 1, 1, 3, (k) => c.biome[k] === Biome.Lake) > 0,
  },
  {
    id: 'house_between_seasons',
    fw: 3,
    fd: 3,
    ok: (c, x, y) => {
      const s = new Set<number>();
      count(c, x, y, 3, 3, 3, (k) => (s.add(c.clim(k)), false));
      return SEASONS.every((b) => s.has(b));
    },
  },
];

it('measure landmark sites', { timeout: 3_600_000 }, () => {
  const hits = new Map<string, number>();
  let chunks = 0;
  for (let s = 0; s < SEEDS; s++) {
    const seed = 1000 + s * 7919;
    const w = 96 + 64 * RING;
    const map = generateMap(seed, { w, h: w, originX: -32 * RING, originY: -32 * RING });
    const deposit = new Uint8Array(w * w);
    for (const [k, ps] of map.props)
      if (ps.some((p) => p.kind === 'coal' || p.kind === 'oil' || p.kind === 'wheat'))
        deposit[k] = 1;
    const c: Ctx = {
      w,
      terrain: map.terrain,
      lv: tileLevels(map),
      clim: (i) => climateAtIndex(map, i),
      biome: map.biome,
      deposit,
    };
    const n = w / C;
    const startC = (n - 1) / 2;
    for (let cy = 0; cy < n; cy++)
      for (let cx = 0; cx < n; cx++) {
        if (cx === startC && cy === startC) continue;
        chunks++;
        for (const r of rules) {
          let found = false;
          for (let y = cy * C + MARGIN; !found && y + r.fd <= cy * C + C - MARGIN; y++)
            for (let x = cx * C + MARGIN; !found && x + r.fw <= cx * C + C - MARGIN; x++)
              if (legal(c, x, y, r.fw, r.fd) && r.ok(c, x, y)) found = true;
          if (found) hits.set(r.id, (hits.get(r.id) ?? 0) + 1);
        }
      }
  }
  log(`chunks=${chunks} seeds=${SEEDS} ring=${RING} margin=${MARGIN}`);
  for (const r of rules)
    log(
      `${r.id.padEnd(26)} ${r.fw}x${r.fd} ${(((hits.get(r.id) ?? 0) / chunks) * 100).toFixed(2)}%`,
    );
});

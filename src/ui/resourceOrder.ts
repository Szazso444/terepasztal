import { CARGO } from '../sim/cargo';
import { STATION_DEFS } from '../sim/stations';
import { BUILDING_DEFS } from '../sim/buildings';
import { DECOR_DEFS } from '../sim/build';
import { inSupplyMode } from '../sim/supply';

/**
 * The resource bar's groups, left to right: funds, building materials, fuel and power, food,
 * people. A resource sits where it belongs here, whether or not it is shown yet (`barGroups`).
 */
export const RESOURCE_GROUPS: readonly (readonly string[])[] = [
  ['money'],
  ['wood', 'stone', 'sand', 'iron_ore', 'iron', 'copper_ore', 'wire'],
  ['coal', 'water', 'crude', 'oil', 'diesel', 'power'],
  ['wheat', 'food'],
  ['passengers', 'population'],
];

/** One thing in the game that makes, uses or hands out a resource, and the age it opens in. */
export interface BuildRef {
  kind: 'station' | 'building' | 'decor';
  id: string;
  name: string;
  tier: number;
}

/** On the bar from the start; not in `CARGO` or not a cargo at all. */
const ALWAYS = new Set(['money', 'passengers', 'population']);
/** Not in `CARGO`, but a resource in every production-chain mode. */
const NOT_CARGO = new Set(['power']);

/** What a service flag on a decor def hands to trains. */
const SERVICE_CARGO = { water: 'water', fuel: 'coal' } as const;

/** Whether the resource exists in the running production-chain mode. */
function exists(id: string): boolean {
  if (ALWAYS.has(id) || NOT_CARGO.has(id)) return true;
  const def = CARGO.find((c) => c.id === id);
  return !!def && inSupplyMode(def);
}

/** Stations and works of the running mode that make `id`. */
export function makersOf(id: string): BuildRef[] {
  const out: BuildRef[] = [];
  for (const s of STATION_DEFS) {
    if (!inSupplyMode(s) || !s.produces.some((p) => p.cargo === id)) continue;
    out.push({ kind: 'station', id: s.id, name: s.name, tier: s.tier ?? 0 });
  }
  for (const b of BUILDING_DEFS) {
    if (!inSupplyMode(b) || !((b.recipe.out[id] ?? 0) > 0)) continue;
    out.push({ kind: 'building', id: b.id, name: b.name, tier: b.tier });
  }
  return out;
}

/** Works of the running mode that use `id`, from their recipe or the alternative they fall back on. */
export function usersOf(id: string): BuildRef[] {
  const out: BuildRef[] = [];
  for (const b of BUILDING_DEFS) {
    if (!inSupplyMode(b)) continue;
    if (!((b.recipe.in[id] ?? 0) > 0 || (b.altIn?.[id] ?? 0) > 0)) continue;
    out.push({ kind: 'building', id: b.id, name: b.name, tier: b.tier });
  }
  return out;
}

/** Service stops (decor with a radius) that hand `id` to trains: water towers, coaling stages. */
export function takenAt(id: string): BuildRef[] {
  const out: BuildRef[] = [];
  for (const d of DECOR_DEFS) {
    if (!d.radius) continue;
    const gives = (Object.keys(SERVICE_CARGO) as (keyof typeof SERVICE_CARGO)[]).some(
      (flag) => d[flag] && SERVICE_CARGO[flag] === id,
    );
    if (gives) out.push({ kind: 'decor', id: d.id, name: d.name, tier: 0 });
  }
  return out;
}

/**
 * The groups the bar shows in this age: a resource that exists in the running mode and is either in
 * stock or has a maker open by `tier`. Funds and people always show; empty groups are dropped.
 */
export function barGroups(tier: number, has: (id: string) => number): string[][] {
  const shown = (id: string) =>
    exists(id) && (ALWAYS.has(id) || has(id) > 0 || makersOf(id).some((m) => m.tier <= tier));
  return RESOURCE_GROUPS.map((g) => g.filter(shown)).filter((g) => g.length > 0);
}

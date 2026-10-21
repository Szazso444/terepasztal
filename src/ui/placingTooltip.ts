/**
 * The placing tooltip (#336): the root of the tooltip stack while a harvest station's tool is in
 * hand, and the rows a station's panel shares with it. Every figure is read from one
 * `harvestBreakdown` (src/sim/stations.ts); nothing here works a yield out again. DOM-free;
 * `renderTip` draws the document.
 */
import { STR } from '../strings';
import { BIOME_DEFS } from '../sim/biomes';
import type { HarvestBreakdown } from '../sim/stations';
import type { Biome } from '../world/tiles';
import { biomeTerm } from './biomeTooltip';
import { contribution, multiplier, weekly } from './tooltipFormat';
import {
  bad,
  fill,
  hint,
  num,
  quiet,
  res,
  row,
  title,
  type Block,
  type Inline,
  type TipDoc,
  type Tone,
} from './tooltipDoc';

/** A harvest station's tool over a tile. */
export interface PlacingSnapshot {
  /** the kind's name (`StationDef.name`) */
  name: string;
  /** why it cannot stand there (`Builder.checkStation`'s reason), null when it can */
  refusal: string | null;
  /** what a level 1 station would make there; read only where it can stand */
  breakdown: HarvestBreakdown | null;
  /** what it makes, by cargo id */
  cargo: readonly string[];
  /** the tuned level 1 weekly output the biome's station tooltips print (`StationSnapshot`) */
  weeklyAtLevel1: number;
}

/** A station's ground, as its panel shows it. */
export interface GroundSnapshot {
  /** the biome of its own tile */
  biome: Biome;
  /** what it makes at its level, season and tuning; null for a station that harvests nothing */
  breakdown: HarvestBreakdown | null;
  /** what it makes, by cargo id */
  cargo: readonly string[];
  weeklyAtLevel1: number;
}

/**
 * `<Station> here`, then where it cannot stand only the reason in red; where it can, the yield
 * rows (`harvestRows`) and how to place it.
 */
export function placingTip(s: PlacingSnapshot): TipDoc {
  const head = title(STR.placing.title(s.name));
  if (s.refusal !== null) return [head, bad(s.refusal)];
  if (!s.breakdown) return [head, hint(STR.placing.click)];
  return [head, ...harvestRows(s.breakdown, s.cargo, s.weeklyAtLevel1), hint(STR.placing.click)];
}

/**
 * What each kind of tile adds, then the multipliers, then the total: one row per distance with
 * matching ground (its raw weighted share, so the rows add up to the sum and not to Placement),
 * Placement, the biome as a term, a Season and a Game tuning row where they are not 1, and the
 * total a week.
 */
export function harvestRows(
  b: HarvestBreakdown,
  cargo: readonly string[],
  weeklyAtLevel1: number,
): Block[] {
  const ground = STR.tile.phrase[b.terrain];
  const out: Block[] = [];
  for (const r of b.rings) {
    if (r.n === 0) continue;
    const tiles = ground ? (r.n === 1 ? ground.one : ground.many) : b.terrain;
    out.push(
      row(
        fill(STR.placing.ring, { n: num(r.n), tiles, d: num(r.d) }),
        num(contribution(r.contribution)),
      ),
    );
  }
  const held =
    b.clamped === 'ceil' ? STR.placing.atMost : b.clamped === 'floor' ? STR.placing.atLeast : null;
  out.push(
    row(
      STR.placing.placement,
      held ? [quiet(held), ' ', num(multiplier(b.factor))] : num(multiplier(b.factor)),
      { tone: b.factor >= 1 ? 'good' : 'bad' },
    ),
  );
  const biome = biomeOf(b.biome);
  out.push(
    row(
      biome === null ? b.biome : biomeTerm(biome, weeklyAtLevel1),
      num(multiplier(b.biomeMul)),
      toned(b.biomeMul),
    ),
  );
  if (b.seasonMul !== 1)
    out.push(
      row(
        STR.placing.season[b.season] ?? b.season,
        num(multiplier(b.seasonMul)),
        toned(b.seasonMul),
      ),
    );
  if (b.rulesMul !== 1)
    out.push(row(STR.placing.tuning, num(multiplier(b.rulesMul)), toned(b.rulesMul)));
  out.push(
    row(resources(cargo), fill(STR.placing.perWeek, { amount: num(weekly(b.perWeek)) }), {
      total: true,
    }),
  );
  return out;
}

/**
 * A station panel's ground rows: a harvest station's yield rows (`harvestRows`), which name the
 * biome as their term; any other station's Biome row, the biome as a term.
 */
export function groundRows(s: GroundSnapshot): Block[] {
  if (s.breakdown) return harvestRows(s.breakdown, s.cargo, s.weeklyAtLevel1);
  return [row(STR.station.biome, biomeTerm(s.biome, s.weeklyAtLevel1))];
}

/** The yield label over the tile: whole units a week. */
export function yieldLabel(perWeek: number): string {
  return STR.placing.label(Math.round(perWeek));
}

/** Green above 1, red below, plain at 1. */
function toned(m: number): { tone?: Tone } {
  return m > 1 ? { tone: 'good' } : m < 1 ? { tone: 'bad' } : {};
}

/** The biome of a `BiomeDef.id` (its index in the data), null for an id the data does not know. */
function biomeOf(id: string): Biome | null {
  const i = BIOME_DEFS.findIndex((d) => d.id === id);
  return i < 0 ? null : (i as Biome);
}

/** Each resource with its icon, a comma between them. */
function resources(cargo: readonly string[]): Inline[] {
  const out: Inline[] = [];
  for (const c of cargo) {
    if (out.length) out.push(', ');
    out.push(res(c));
  }
  return out;
}

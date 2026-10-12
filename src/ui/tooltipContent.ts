/**
 * The content of the hover tooltips (#337): one pure function for each, from a plain snapshot of
 * what it shows to a `TipDoc` (tooltipDoc.ts). `src/game.ts` fills the snapshots (#361); nothing
 * here reads the simulation, so Node tests run these on literals. The tile tooltip has its own file,
 * tileTooltip.ts, which the tile redesign (#360) replaces.
 *
 * Each tooltip's lines are today's text, with every number in bold and every resource an icon with
 * its name underlined, and the biome named as a term.
 */
import type { Cost } from '../data/content';
import { STR } from '../strings';
import type { Biome } from '../world/tiles';
import { biomeTerm } from './biomeTooltip';
import { fmtMoney } from './numberFormat';
import {
  fill,
  hint,
  num,
  res,
  richText,
  row,
  text,
  title,
  type Block,
  type Inline,
  type TipDoc,
} from './tooltipDoc';

/** An upgrade under way: the level it ends at and the hours left. */
export interface WorkSnapshot {
  to: number;
  hoursLeft: number;
}

/** A station the pointer is on in the field. */
export interface StationSnapshot {
  name: string;
  level: number;
  work: WorkSnapshot | null;
  /** everything in storage (shown rounded down) */
  stored: number;
  capacity: number;
  /** the biome of the station's own tile */
  biome: Biome;
}

/** A works (a building that makes goods). */
export interface WorksSnapshot {
  name: string;
  /** what it turns into what (`BuildingDef.recipe`), and the inputs it falls back on (`altIn`) */
  recipe: { in: Cost; out: Cost };
  altIn?: Cost;
  /** the status line (`BuildingPanel.status`) */
  status: string;
  work: WorkSnapshot | null;
  /** units a week now */
  rate: number;
}

/** A train, from the field or the overview. */
export interface TrainSnapshot {
  name: string;
  /** the key of `STR.depot.state` */
  state: string;
  /** held up behind another train (read only while the train is moving) */
  blocked: boolean;
  /** the name of the station it heads for, if it has a route */
  next: string | null;
  /** units aboard */
  cargo: number;
  /** hauled weight and engine power, in tonnes */
  weight: number;
  power: number;
}

/** What the overview picked under the pointer. */
export type PickSnapshot =
  | { kind: 'station'; name: string; level: number; stored: number; capacity: number }
  | ({ kind: 'train' } & TrainSnapshot)
  /** a station or train that is gone */
  | { kind: 'gone'; of: 'station' | 'train'; id: number };

/** An uncharted chunk the overview points at. */
export interface ChunkSnapshot {
  price: number;
}

// ---------------------------------------------------------------- shared lines

/** A line of text out of a string from `STR`, its numbers in bold. */
export function line(s: string): Block {
  return text(...richText(s));
}

const storageLine = (stored: number, capacity: number) =>
  line(`${STR.station.storage}: ${Math.floor(stored)} / ${capacity}`);

const runningLine = (w: WorkSnapshot) => line(STR.upgrade.running(w.to, w.hoursLeft));

// ---------------------------------------------------------------- the tooltips

/** A station in the field: its level, an upgrade under way, its storage, then its biome. */
export function stationTip(s: StationSnapshot): TipDoc {
  return [
    title(s.name),
    line(STR.station.level(s.level)),
    ...(s.work ? [line(STR.upgrade.closed), runningLine(s.work)] : []),
    storageLine(s.stored, s.capacity),
    row(STR.station.biome, biomeTerm(s.biome)),
  ];
}

/** A works: its recipe, its status, an upgrade under way, its rate. */
export function worksTip(w: WorksSnapshot): TipDoc {
  const { altIn } = w;
  const slots = {
    input: amounts(w.recipe.in),
    alt: amounts(altIn ?? {}),
    output: amounts(w.recipe.out),
  };
  return [
    title(w.name),
    text(...fill(altIn ? STR.building.recipeAlt : STR.building.recipeLine, slots)),
    line(w.status),
    ...(w.work ? [runningLine(w.work)] : []),
    line(`${STR.building.rate}: ${STR.station.perWeek(Math.round(w.rate * 10) / 10)}`),
  ];
}

/** A train: where it is in its trip, what it carries, its weight against its power. */
export function trainTip(t: TrainSnapshot, clickHint: boolean): TipDoc {
  return [title(t.name), ...trainLines(t), ...(clickHint ? [hint(STR.train.clickHint)] : [])];
}

/** What the overview picked: a station (level, storage), a train, or a pick that is gone. */
export function pickTip(p: PickSnapshot): TipDoc {
  switch (p.kind) {
    case 'station':
      return [title(p.name), line(STR.station.level(p.level)), storageLine(p.stored, p.capacity)];
    case 'train':
      return trainTip(p, false);
    case 'gone':
      return [title(STR.overview.gone(p.of, p.id))];
  }
}

/** An uncharted chunk in the overview: its price and how to buy it. */
export function chunkTip(c: ChunkSnapshot): TipDoc {
  return [title(STR.overview.chunkTitle), ...STR.overview.chunkLines(fmtMoney(c.price)).map(line)];
}

// ---------------------------------------------------------------- parts

function trainLines(t: TrainSnapshot): Block[] {
  const state = t.blocked && t.state === 'moving' ? 'held' : t.state;
  const said = richText(STR.depot.state[state] ?? state);
  return [
    text(...(t.next ? fill(STR.train.toward, { state: said, station: t.next }) : said)),
    line(STR.depot.cargo(Math.round(t.cargo))),
    line(STR.train.weightPower(Math.round(t.weight), Math.round(t.power))),
  ];
}

/** "30 wood, 10 stone": each amount in bold, each resource with its icon. */
function amounts(cost: Cost): Inline[] {
  const out: Inline[] = [];
  for (const [cargo, v] of Object.entries(cost)) {
    if (v <= 0) continue;
    if (out.length) out.push(', ');
    out.push(num(Math.ceil(v)), ' ', res(cargo));
  }
  return out.length ? out : [STR.build.free];
}

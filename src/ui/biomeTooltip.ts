/**
 * The biome tooltip and the station tooltip it opens (#337). Both read src/data/biomes.json and the
 * station data, so a biome added to the data is listed with its effects and nothing here changes.
 * DOM-free; `renderTip` draws the document.
 */
import { STR } from '../strings';
import { behavesAs } from '../data/content';
import { biomeDef } from '../sim/biomes';
import { HARVEST_RADIUS, STATION_DEFS } from '../sim/stations';
import type { Biome } from '../world/tiles';
import {
  dim,
  fill,
  num,
  percent,
  res,
  richText,
  row,
  term,
  text,
  title,
  type Block,
  type Parts,
  type TermPart,
  type TipDoc,
} from './tooltipDoc';

/** The level the weekly figure of the snapshots is for. */
const FIRST_LEVEL = 1;

/**
 * The biome as a term: its name, with the biome tooltip as its nested tooltip. `weeklyAtLevel1`
 * is the figure the station tooltips below it print (`StationSnapshot.weeklyAtLevel1`).
 */
export function biomeTerm(b: Biome, weeklyAtLevel1: number): TermPart {
  return term(biomeDef(b).name, () => biomeTip(b, weeklyAtLevel1));
}

/**
 * `<Name> biome`, its description, one row per production entry in the order of the data, then
 * the track cost, the steam engines' water use and the train speed, each only when it is not 1.
 * Green is good for the player and red bad.
 */
export function biomeTip(b: Biome, weeklyAtLevel1: number): TipDoc {
  const def = biomeDef(b);
  const out: Block[] = [title(STR.biome.title(def.name)), dim(...richText(def.desc))];
  for (const [stationId, m] of Object.entries(def.production))
    out.push(productionRow(stationId, m, weeklyAtLevel1));
  if (def.trackCostMul !== 1)
    out.push(
      row(STR.biome.trackCost, percent(def.trackCostMul), {
        tone: def.trackCostMul > 1 ? 'bad' : 'good',
      }),
    );
  if (def.waterUseMul !== 1)
    out.push(
      row(fill(STR.biome.waterUse, { res: res('water') }), percent(def.waterUseMul), {
        tone: def.waterUseMul > 1 ? 'bad' : 'good',
      }),
    );
  if (def.speedMul !== 1)
    out.push(
      row(STR.biome.speed, percent(def.speedMul), { tone: def.speedMul < 1 ? 'bad' : 'good' }),
    );
  return out;
}

/**
 * `[icon] wheat from farm halts and big farm halts` and its percent; a station id the data does not
 * know stays plain. The biome names a kind of station, so a def that behaves as it (`behavesAs`,
 * the Big Farm Halt) is listed beside it, each as a term of its own.
 */
function productionRow(stationId: string, m: number, weeklyAtLevel1: number): Block {
  const kind = STATION_DEFS.find((d) => d.id === stationId);
  const cargo = kind?.produces[0]?.cargo;
  const plural = STR.station.plural[stationId] ?? stationId;
  const kinds = kind
    ? STATION_DEFS.filter((d) => d === kind || behavesAs(d) === stationId).map((d) =>
        term(STR.station.plural[d.id] ?? d.id, () => stationKindTip(d.id, weeklyAtLevel1)),
      )
    : [];
  const stations: Parts = kinds.flatMap((t, i) => (i ? [STR.biome.and, t] : [t]));
  const label = fill(STR.biome.production, {
    res: cargo ? res(cargo) : stationId,
    station: kind ? stations : plural,
  });
  return row(label, percent(m), m === 1 ? {} : { tone: m > 1 ? 'good' : 'bad' });
}

/**
 * What a kind of harvesting station makes: the station's name, then its output a week at level 1
 * and the ground within `HARVEST_RADIUS` tiles that adds to it. The output is the tuned figure the
 * game worked out (`weeklyAtLevel1`), printed as given: the data's base is not read here, because
 * the player's tuning changes what the game will do.
 */
export function stationKindTip(stationId: string, weeklyAtLevel1: number): TipDoc {
  const def = STATION_DEFS.find((d) => d.id === stationId);
  if (!def) return [title(stationId)];
  const cargo = def.produces[0]?.cargo;
  if (!cargo) return [title(def.name), dim(...richText(def.flavor))];
  const ground = def.terrain ? STR.tile.phrase[def.terrain] : undefined;
  return [
    title(def.name),
    text(
      ...fill(ground ? STR.station.makes : STR.station.makesAnywhere, {
        res: res(cargo),
        amount: num(Math.round(weeklyAtLevel1 * 10) / 10),
        level: num(FIRST_LEVEL),
        tiles: ground?.many ?? '',
        radius: num(HARVEST_RADIUS),
      }),
    ),
  ];
}

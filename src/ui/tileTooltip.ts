/**
 * The tile tooltip (#337, #360): what a bare tile is and what sits on it. The terrain's name for a
 * title, the biome as a term, the elevation, the snow line on a snow tile, one line about the
 * terrain, what the tile gives, then the game's own lines (what is built on it, what track costs).
 * A pure function over a snapshot, DOM-free; `renderTip` draws the document.
 */
import { biomeAt, biomeDef } from '../sim/biomes';
import { BUILDING_DEFS } from '../sim/buildings';
import { CARGO } from '../sim/cargo';
import { STATION_DEFS, harvests } from '../sim/stations';
import { inSupplyMode } from '../sim/supply';
import { STR } from '../strings';
import { levelAt } from '../world/elevation';
import {
  TERRAIN_NAMES,
  Terrain,
  climateAt,
  terrainAt,
  type GameMap,
  type PropKind,
} from '../world/tiles';
import { biomeTerm, productionLabel } from './biomeTooltip';
import { line } from './tooltipContent';
import {
  dim,
  fill,
  icon,
  num,
  res,
  richText,
  row,
  term,
  text,
  title,
  type Block,
  type Inline,
  type TipDoc,
} from './tooltipDoc';

/**
 * A tile and what is known of it. The map is read only: the terrain, biome and level are read
 * from it here. The rest is what only the game knows.
 */
export interface TileSnapshot {
  map: Readonly<GameMap>;
  x: number;
  y: number;
  /** false: the chunk is still uncharted */
  charted: boolean;
  /** the kind of track piece on it, if any */
  track: string | null;
  /** the decor on it: its name and the lines its panel shares with the tooltip (`DecorPanel.lines`) */
  decor: { name: string; lines: readonly string[] } | null;
  /** the kind of each prop on it */
  props: readonly string[];
  powered: boolean;
  /** what the ground does to the cost of track here (`Builder.terrainMul`): 0 none can be laid */
  trackCostFactor: number;
  /** the tuned level 1 weekly output the biome's station tooltips print (`StationSnapshot`) */
  weeklyAtLevel1: number;
}

/**
 * The level where snow starts on a tile: the `snowLevel` of its climate (`climateAt`), which is
 * not always the biome it reads as (a mountain keeps the climate it rose from).
 */
export function snowLevelAt(map: Readonly<GameMap>, x: number, y: number): number {
  return biomeDef(climateAt(map, x, y)).snowLevel;
}

/** What a tile gives: a good, and the kind of station or works that gets it out of the ground. */
export interface TileGood {
  cargo: string;
  /** `station`: a harvesting station that counts the tile; `works`: one tied to this ground */
  by: 'station' | 'works';
  id: string;
}

/**
 * What a tile gives in the running production chain: the good of every harvesting station that
 * counts its terrain (`StationDef.terrain`, `harvests`), of every works that must stand on that
 * terrain (`BuildingDef.terrain`), and of every works that needs a deposit lying on it
 * (`BuildingDef.deposit`).
 */
export function tileGoods(terrain: Terrain, props: readonly string[] = []): TileGood[] {
  const out: TileGood[] = [];
  for (const d of STATION_DEFS) {
    const cargo = d.produces[0]?.cargo;
    if (cargo && d.terrain && inSupplyMode(d) && harvests(d.terrain, terrain))
      out.push({ cargo, by: 'station', id: d.id });
  }
  for (const b of BUILDING_DEFS) {
    const tied = b.terrain === TERRAIN_NAMES[terrain] || (!!b.deposit && props.includes(b.deposit));
    if (!tied || !inSupplyMode(b)) continue;
    for (const cargo of Object.keys(b.recipe.out)) out.push({ cargo, by: 'works', id: b.id });
  }
  return out;
}

/** A tile's good: `[icon] wood from lumber yards`, the maker a term with its own tooltip. */
function goodLine(g: TileGood, weeklyAtLevel1: number): Block {
  if (g.by === 'station') return text(...productionLabel(g.id, weeklyAtLevel1));
  const def = BUILDING_DEFS.find((b) => b.id === g.id);
  const name = STR.station.plural[g.id] ?? def?.name ?? g.id;
  return text(
    ...fill(STR.biome.production, {
      res: res(g.cargo),
      station: term(name, () => [title(def?.name ?? g.id), dim(...richText(def?.flavor ?? ''))]),
    }),
  );
}

/** The good a field or a deposit on a tile is made of, by `PropKind`. */
export const PROP_GOOD: Partial<Record<PropKind, string>> = {
  wheat: 'wheat',
  coal: 'coal',
  oil: 'crude',
};

/** The good a prop holds, if it holds one of the running production chain. */
function propGood(kind: string): string | null {
  const id = PROP_GOOD[kind as PropKind];
  const def = id ? CARGO.find((c) => c.id === id) : undefined;
  return def && inSupplyMode(def) ? def.id : null;
}

/**
 * The terrain's name (with ", snow" on a snow tile), the Biome row, the Elevation row, the Snow
 * line row on a snow tile, one dim line about the terrain, what the tile gives, then everything
 * standing on it.
 */
export function tileTip(s: TileSnapshot): TipDoc {
  const { map, x, y } = s;
  const T = STR.tile;
  const terrain = terrainAt(map, x, y);
  const name = TERRAIN_NAMES[terrain];
  const level = levelAt(map, x, y);
  const snowLevel = snowLevelAt(map, x, y);
  const snow = terrain !== Terrain.Water && level >= snowLevel;
  const terrainName = T.terrain[name] ?? name;
  const out: Block[] = [
    title(snow ? T.snow(terrainName) : terrainName),
    row(T.biome, biomeTerm(biomeAt(map, x, y), s.weeklyAtLevel1)),
    row(T.elevationRow, richText(T.level(level))),
  ];
  if (snow) out.push(row(T.snowLine, richText(T.aboveLevel(snowLevel - 1))));
  const about = terrain === Terrain.Water ? T.water : T.about[name];
  if (about) out.push(dim(...richText(about)));
  for (const g of tileGoods(terrain, s.props)) out.push(goodLine(g, s.weeklyAtLevel1));
  if (!s.charted) out.push(line(T.uncharted));
  if (s.track) out.push(line(T.track(s.track)));
  if (s.decor) {
    out.push(text(s.decor.name));
    for (const l of s.decor.lines) out.push(line(l));
  }
  if (s.props.length) out.push(text(...propsText(s.props)));
  if (s.powered) out.push(line(T.powered));
  if (s.trackCostFactor === 0) out.push(line(T.noTrack));
  else if (s.trackCostFactor !== 1)
    out.push(line(T.trackCost(Math.round(s.trackCostFactor * 100) / 100)));
  return out;
}

/**
 * "2× oak, bush": a count before a kind seen more than once, in the order first seen, by name; a
 * field or a deposit has the icon of its good before its name.
 */
function propsText(kinds: readonly string[]): Inline[] {
  const counts = new Map<string, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  const out: Inline[] = [];
  for (const [k, n] of counts) {
    if (out.length) out.push(', ');
    if (n > 1) out.push(num(`${n}×`), ' ');
    const good = propGood(k);
    if (good) out.push(icon(good));
    out.push(STR.tile.prop[k] ?? k);
  }
  return out;
}

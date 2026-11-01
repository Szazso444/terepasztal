/**
 * The tile tooltip (#337, #360): what a bare tile is and what sits on it. The terrain's name for a
 * title, the biome as a term, the elevation, the snow line on a snow tile, one line about the
 * terrain, then the game's own lines (what is built on it, what track costs). A pure function over
 * a snapshot, DOM-free; `renderTip` draws the document.
 */
import { biomeAt, biomeDef } from '../sim/biomes';
import { STR } from '../strings';
import { levelAt } from '../world/elevation';
import { TERRAIN_NAMES, Terrain, climateAt, terrainAt, type GameMap } from '../world/tiles';
import { Headwater, MAX_DROP, headwaterAt, waterfallAt } from '../world/waterfalls';
import { biomeTerm } from './biomeTooltip';
import { line } from './tooltipContent';
import {
  dim,
  num,
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

/**
 * The tile's name, by the first that holds: Waterfall, Headwater, the terrain's name (with ", snow"
 * on a snow tile). The Biome row, the Elevation row, the Snow line row on a snow tile, a river's
 * Drop, Source and Flow rows, one dim line about the terrain, then everything standing on it. The
 * river's planes are the map's: a chunk stored without them shows none of these.
 */
export function tileTip(s: TileSnapshot): TipDoc {
  const { map, x, y } = s;
  const T = STR.tile;
  const terrain = terrainAt(map, x, y);
  const name = TERRAIN_NAMES[terrain];
  const level = levelAt(map, x, y);
  const snowLevel = snowLevelAt(map, x, y);
  const snow = terrain !== Terrain.Water && terrain !== Terrain.Ice && level >= snowLevel;
  const terrainName = T.terrain[name] ?? name;
  const fall = waterfallAt(map, x, y);
  const head = headwaterAt(map, x, y);
  const flow = map.flow?.[y * map.w + x] ?? 0;
  const heading = fall
    ? T.waterfall
    : head
      ? T.headwater
      : snow
        ? T.snow(terrainName)
        : terrainName;
  const out: Block[] = [
    title(heading),
    row(T.biome, biomeTerm(biomeAt(map, x, y), s.weeklyAtLevel1)),
    row(T.elevationRow, richText(T.level(level))),
  ];
  if (snow) out.push(row(T.snowLine, richText(T.aboveLevel(snowLevel - 1))));
  if (fall) {
    const about = T.dropAbout(fall.drop, MAX_DROP);
    const tip = () => [title(T.waterfall), dim(...richText(about))];
    out.push(row(T.dropRow, term(T.drop(fall.drop), tip)));
  }
  if (head) out.push(row(T.sourceRow, head === Headwater.Melt ? T.source.melt : T.source.spring));
  if (flow) out.push(row(T.flowRow, richText(T.flow(flow))));
  const water = !fall && head ? T.aboutHeadwater : T.water;
  const about = terrain === Terrain.Water ? water : T.about[name];
  if (about) out.push(dim(...richText(about)));
  if (!s.charted) out.push(line(T.uncharted));
  if (s.track) out.push(line(T.track(s.track)));
  if (s.decor) {
    out.push(text(s.decor.name));
    for (const l of s.decor.lines) out.push(line(l));
  }
  if (s.props.length) out.push(text(...propsText(s.props)));
  if (s.powered) out.push(line(T.powered));
  if (s.trackCostFactor === 0) out.push(line(T.noTrack));
  else if (s.trackCostFactor !== 1) out.push(line(T.trackCost(s.trackCostFactor)));
  return out;
}

/** "2× oak, bush": a count before a kind seen more than once, in the order first seen, by name. */
function propsText(kinds: readonly string[]): Inline[] {
  const counts = new Map<string, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  const out: Inline[] = [];
  for (const [k, n] of counts) {
    if (out.length) out.push(', ');
    if (n > 1) out.push(num(`${n}×`), ' ');
    out.push(STR.tile.prop[k] ?? k);
  }
  return out;
}

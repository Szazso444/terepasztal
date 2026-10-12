/**
 * The tile tooltip (#337): what a bare tile is and what sits on it. Today's `Game.tileInfo` as a
 * pure function over a snapshot, with the biome named as a term; the tile redesign (#360) replaces
 * the rows of `tileTip` and keeps the snapshot. DOM-free; `renderTip` draws the document.
 */
import { biomeAt } from '../sim/biomes';
import { STR } from '../strings';
import { levelAt } from '../world/elevation';
import { TERRAIN_NAMES, Terrain, terrainAt, type GameMap } from '../world/tiles';
import { biomeTerm } from './biomeTooltip';
import { line } from './tooltipContent';
import {
  dim,
  num,
  richText,
  row,
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
}

/** The terrain's name and biome, its level, then everything standing on it. */
export function tileTip(s: TileSnapshot): TipDoc {
  const { map, x, y } = s;
  const T = STR.tile;
  const terrain = terrainAt(map, x, y);
  const name = TERRAIN_NAMES[terrain];
  const out: Block[] = [
    title(T.terrain[name] ?? name),
    row(T.biome, biomeTerm(biomeAt(map, x, y))),
    line(T.elevation(levelAt(map, x, y))),
  ];
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
  if (terrain === Terrain.Water) out.push(dim(...richText(T.water)));
  return out;
}

/** "2× oak, bush": a count before a kind seen more than once, in the order first seen. */
function propsText(kinds: readonly string[]): Inline[] {
  const counts = new Map<string, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  const out: Inline[] = [];
  for (const [k, n] of counts) {
    if (out.length) out.push(', ');
    if (n > 1) out.push(num(`${n}×`), ' ');
    out.push(k);
  }
  return out;
}

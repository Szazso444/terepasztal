import { Graphics } from 'pixi.js';
import { HALF_H, HALF_W } from '../engine/iso';
import { HarvestCells, harvestBreakdown, type HarvestBreakdown } from '../sim/stations';
import { rules } from '../sim/rules';
import type { Season } from '../sim/weather';
import type { GameMap } from '../world/tiles';

/** A counted tile's fill: the UI's cyan (`--cyan` in src/ui/style.css). */
export const LIT_COLOR = 0x66ccd6;
/**
 * A counted tile is lit at LIT_BASE + LIT_GAIN × its weight 1 / (1 + d), so nearer tiles show
 * brighter: 0.48, 0.38, 0.33 and 0.30 at distance 1 to 4.
 */
export const LIT_BASE = 0.18;
export const LIT_GAIN = 0.6;

/**
 * The hovered tile's outline: cream with no station tool in hand, amber with one on a tile where
 * the station can stand, red where it cannot.
 */
export const OUTLINE = { plain: 0xe4d5b5, fits: 0xe8aa48, refused: 0xe0675b } as const;

/** One lit tile and how strongly it is lit. */
export interface LitTile {
  x: number;
  y: number;
  alpha: number;
}

/** The tiles a harvest breakdown counted, in its order, each with its fill's alpha; none for null. */
export function litTiles(b: Pick<HarvestBreakdown, 'cells'> | null): LitTile[] {
  const out: LitTile[] = [];
  if (!b) return out;
  const c = b.cells;
  for (let i = 0; i < c.count; i++)
    out.push({ x: c.x[i], y: c.y[i], alpha: LIT_BASE + LIT_GAIN * c.weight[i] });
  return out;
}

/** What the layer follows: the tool in hand, its turn and the selected station. */
export interface HarvestFocus {
  readonly tool: { readonly kind: string; readonly defId?: string };
  readonly rot: number;
  readonly selected: {
    readonly x: number;
    readonly y: number;
    readonly def: { readonly id: string };
  } | null;
}

type Tile = { readonly x: number; readonly y: number };

/**
 * The tiles a harvest station counts, lit on the map: one Graphics of flat diamonds, each on its
 * own tile's top face, cyan and brighter the nearer it lies. The station's own tile never counts,
 * so it is never lit. The layer sits between the night overlay and the objects, so the night does
 * not darken it and objects, trains, stations and the hover outline draw over it. It is drawn
 * again only when the tile it lights changes.
 */
export class HarvestHighlight {
  readonly layer = new Graphics();
  /** The hovered tile's outline colour for the tool in hand, as `follow` last found it. */
  outline: number = OUTLINE.plain;
  /**
   * Whether a station of `defId` turned to `rot` may stand on (x, y), as the builder answers it.
   * Until the game sets it, nothing is lit while placing.
   */
  canStand: (x: number, y: number, defId: string, rot: number) => boolean = () => false;
  private readonly cells = new HarvestCells();
  /** the station kind whose harvest is lit, null while nothing is, and where and when */
  private litId: string | null = null;
  private litX = 0;
  private litY = 0;
  private litSeason: Season = 'spring';

  constructor(
    private readonly map: GameMap,
    private readonly surface: (x: number, y: number) => { x: number; y: number },
  ) {
    this.layer.label = 'harvest-highlight';
    this.layer.visible = false;
  }

  /**
   * Called every frame once the build controller has run. With a station tool in hand it lights
   * what that station would count on `placing` (the hovered tile unless something holds another)
   * where it can stand there, and nothing where it cannot; with any other tool or none, what the
   * selected station counts. The outline colour always follows `hover`, which is null while the
   * pointer is off the field.
   */
  follow(hover: Tile | null, focus: HarvestFocus, season: Season, placing: Tile | null = hover) {
    const { tool } = focus;
    if (tool.kind === 'station' && tool.defId !== undefined) {
      const id = tool.defId;
      const fits = !!hover && this.canStand(hover.x, hover.y, id, focus.rot);
      this.outline = fits ? OUTLINE.fits : OUTLINE.refused;
      const lit =
        placing === hover ? fits : !!placing && this.canStand(placing.x, placing.y, id, focus.rot);
      if (lit && placing) this.light(placing.x, placing.y, id, season);
      else this.clear();
      return;
    }
    this.outline = OUTLINE.plain;
    const s = focus.selected;
    if (s) this.light(s.x, s.y, s.def.id, season);
    else this.clear();
  }

  /** Light what a `defId` on (x, y) counts; nothing is drawn when that is already lit. */
  light(x: number, y: number, defId: string, season: Season) {
    if (this.litId === defId && this.litX === x && this.litY === y && this.litSeason === season)
      return;
    this.litId = defId;
    this.litX = x;
    this.litY = y;
    this.litSeason = season;
    this.draw();
  }

  /** Light nothing. */
  clear() {
    if (this.litId === null) return;
    this.litId = null;
    this.draw();
  }

  /** Draw the lit tiles again where their ground lies now, after the relief under them moved. */
  refresh() {
    if (this.litId !== null) this.draw();
  }

  private draw() {
    const g = this.layer.clear();
    // which tiles count depends on neither the level nor the tuning, so level 1 stands for any
    const tiles = litTiles(
      this.litId === null
        ? null
        : harvestBreakdown(
            this.map,
            this.litX,
            this.litY,
            this.litId,
            1,
            this.litSeason,
            rules,
            this.cells,
          ),
    );
    for (const t of tiles) {
      const p = this.surface(t.x, t.y);
      g.poly([p.x, p.y - HALF_H, p.x + HALF_W, p.y, p.x, p.y + HALF_H, p.x - HALF_W, p.y]).fill({
        color: LIT_COLOR,
        alpha: t.alpha,
      });
    }
    this.layer.visible = tiles.length > 0;
  }
}

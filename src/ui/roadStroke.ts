import type { Cost } from '../data/content';
import type { Builder, PlacementCheck } from '../sim/build';
import { fmtCost } from '../sim/stockpile';
import { STR } from '../strings';

/**
 * The road tool's drag (#328), DOM-free: the tiles a stroke covers, and what its release comes to,
 * judged tile by tile in the order the release lays them (`Builder.placeRoad`, one tile after
 * another). The rules are the builder's (`checkRoad`) and the roads' (`Roads.trackRefusal`); this
 * module only adds them up. The free spur the game lays to a street door after a tile (#408) is not
 * part of the stroke, nor of its price.
 */

type Tile = { x: number; y: number };

/**
 * The tiles of a stroke from `start` to `end`, the start first: a straight along the axis `end` is
 * further along (x on a tie), as the straight-track drag lays its line. `end` is wherever the drag
 * ends; the tool hands in the tile under the cursor, which #409 may replace with a snapped end.
 */
export function strokeTiles(start: Tile, end: Tile): Tile[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const alongX = Math.abs(dx) >= Math.abs(dy);
  const s = Math.sign(alongX ? dx : dy) || 1;
  const n = Math.abs(alongX ? dx : dy);
  return Array.from({ length: n + 1 }, (_, i) =>
    alongX ? { x: start.x + i * s, y: start.y } : { x: start.x, y: start.y + i * s },
  );
}

/** What one tile of a stroke comes to on release. */
export interface RoadStep extends Tile {
  /**
   * `lay`: laid and paid for; `have`: a road lies there already and stays as it is; `refused`: not
   * laid, for `reason`
   */
  state: 'lay' | 'have' | 'refused';
  /** what laying it costs, for a tile laid; nothing for any other */
  cost: Cost;
  reason?: string;
}

/** A stroke's verdict. */
export interface RoadStrokeCheck {
  /** each tile's, in the stroke's order */
  steps: RoadStep[];
  /** how many tiles the release lays */
  laid: number;
  /** what they cost together */
  cost: Cost;
  /** how many tiles it refuses */
  refused: number;
  /** each reason a tile is refused for, once, in the stroke's order */
  reasons: string[];
}

/** What a stroke is judged by: the builder's rules and the stock (`builderJudge`). */
export interface StrokeJudge {
  /** a road lies on the tile already */
  has(t: Tile): boolean;
  /** the verdict on laying a road on `t`, every tile `lay` was given before standing */
  check(t: Tile): PlacementCheck;
  /** `t` is laid: the tiles after it are checked with its road there */
  lay(t: Tile): void;
  /** the stock pays `total` */
  canPay(total: Cost): boolean;
  /** why the stock does not pay `total` */
  short(total: Cost): string;
}

function plus(a: Cost, b: Cost): Cost {
  const out: Cost = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}

/**
 * Judge a stroke's tiles in order, as its release lays them: a tile with a road is kept, any other
 * is laid when `check` takes it and the stock still pays for it after the tiles before it. A tile
 * the stock no longer pays for is refused for what the stroke is short of, all of it laid.
 */
export function judgeStroke(tiles: readonly Tile[], judge: StrokeJudge): RoadStrokeCheck {
  const steps: RoadStep[] = [];
  let cost: Cost = {};
  /** the stroke's total were the stock to pay all of it */
  let wanted: Cost = {};
  const unpaid: RoadStep[] = [];
  for (const t of tiles) {
    const at = { x: t.x, y: t.y };
    if (judge.has(t)) {
      steps.push({ ...at, state: 'have', cost: {} });
      continue;
    }
    const c = judge.check(t);
    if (!c.ok) {
      steps.push({ ...at, state: 'refused', cost: {}, reason: c.reason ?? '' });
      continue;
    }
    wanted = plus(wanted, c.cost);
    if (!judge.canPay(plus(cost, c.cost))) {
      const step: RoadStep = { ...at, state: 'refused', cost: {} };
      unpaid.push(step);
      steps.push(step);
      continue;
    }
    cost = plus(cost, c.cost);
    judge.lay(t);
    steps.push({ ...at, state: 'lay', cost: c.cost });
  }
  if (unpaid.length) {
    const why = judge.short(wanted);
    for (const s of unpaid) s.reason = why;
  }
  const refused = steps.filter((s) => s.state === 'refused');
  return {
    steps,
    laid: steps.filter((s) => s.state === 'lay').length,
    cost,
    refused: refused.length,
    reasons: [...new Set(refused.map((s) => s.reason ?? ''))],
  };
}

/**
 * The judge of `builder`'s roads: `checkRoad` on each tile, and the roads' track rule
 * (`Roads.trackRefusal`) once more on a copy of the roads that holds the stroke's tiles laid before
 * it, as the builder judges a spur (`Builder.laySpur`): a stroke that runs along a line of track
 * makes one crossing on it, and its release refuses the next tile of that line, which this shows.
 * A tile `checkRoad` refuses only for its price (the stock is short of even that one tile) passes
 * here with that price, so `judgeStroke` says what the whole stroke is short of.
 */
export function builderJudge(builder: Builder): StrokeJudge {
  const tried = builder.roads.copy();
  return {
    has: (t) => builder.roads.has(t.x, t.y),
    check: (t) => {
      const c = builder.checkRoad(t.x, t.y);
      // the rules take the tile when only its price refuses it: a refusal of the rules carries no
      // price, which any stock pays
      const rulesTake = c.ok || !builder.stock.canAfford(c.cost);
      if (!rulesTake) return c;
      const why = tried.trackRefusal(t.x, t.y);
      return why ? { ok: false, cost: {}, reason: why } : { ok: true, cost: c.cost };
    },
    lay: (t) => {
      tried.add(t.x, t.y);
    },
    canPay: (total) => builder.stock.canAfford(total),
    short: (total) => STR.build.needResources(fmtCost(builder.stock.missing(total))),
  };
}

/** The status line of a stroke under way: what it lays at what cost, and what it leaves out, why. */
export function strokeStatus(c: RoadStrokeCheck): string {
  const parts: string[] = [];
  if (c.laid || !c.refused) parts.push(STR.build.roadLine(c.laid, fmtCost(c.cost)));
  if (c.refused) parts.push(STR.build.roadNotLaid(c.refused, c.reasons));
  return parts.join('   ');
}

/**
 * The status line over one tile before a drag: its price or its refusal, and the drag hint. A tile
 * laid on a bridge platform (`onBridge`) says so beside its price.
 */
export function hoverStatus(step: RoadStep, onBridge = false): string {
  const what =
    step.state === 'lay'
      ? [onBridge ? STR.build.roadOnBridge : '', STR.build.cost(fmtCost(step.cost))]
          .filter(Boolean)
          .join(' · ')
      : step.state === 'have'
        ? STR.build.roadHere
        : (step.reason ?? '');
  return [what, STR.build.dragHint].filter(Boolean).join('   ');
}

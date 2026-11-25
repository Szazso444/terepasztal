import type { Building } from './buildings';
import { buildingDef, buildingLevel } from './buildings';
import type { Builder } from './build';
import { Dir, opposite } from '../engine/iso';

export type BridgeMaterial = 'wood' | 'stone';
/**
 * Share of a bridge's capacity a consist may weigh and still cross at full speed. Anything
 * heavier (strictly above `capacity * BRIDGE_SLOW_SHARE`) slows to `BRIDGE_SLOW_FACTOR`, both
 * under the span and on the approach to it. Above the capacity itself the bridge is closed.
 */
export const BRIDGE_SLOW_SHARE = 0.8;
/** Speed multiplier for a consist heavier than `BRIDGE_SLOW_SHARE` of a bridge's capacity. */
export const BRIDGE_SLOW_FACTOR = 0.5;
/** Whether a consist of `mass` tonnes crosses a bridge of `capacity` tonnes at the slow factor. */
export function slowsOnBridge(mass: number, capacity: number): boolean {
  return mass > capacity * BRIDGE_SLOW_SHARE;
}
export function bridgeCapacity(b: Building): number | null {
  const base = buildingDef(b.id).bridge?.capacity;
  return base ? base * (1 + (buildingLevel(b) - 1) * 0.25) : null;
}
/**
 * The span a platform belongs to: its material, its axis (1 runs east to west, 0 north to south),
 * its place along the span and the span's length. Straight, connected rail unifies consecutive
 * platforms into a span, regardless of class. A platform carrying a road and no rail joins the
 * road platforms of its material beside it along its axis (`roadSpan`, #493); a platform with
 * neither is a span of one.
 */
export function bridgeSpan(builder: Builder, b: Building) {
  const material = buildingDef(b.id).bridge?.material ?? 'wood';
  if (!builder.track.has(b.x, b.y) && builder.roads.has(b.x, b.y))
    return roadSpan(builder, b, material);
  const p = builder.track.get(b.x, b.y);
  const link = p?.links.find(([a, c]) => opposite(a) === c);
  const axis = link?.includes(Dir.E) ? 1 : 0;
  const dx = axis ? 1 : 0,
    dy = axis ? 0 : 1;
  const joins = (x: number, y: number, nx: number, ny: number) => {
    const n = builder.buildingAt(nx, ny);
    const np = builder.track.get(nx, ny);
    return (
      !!n &&
      buildingDef(n.id).bridge?.material === material &&
      !!np?.links.some(
        ([a, c]) =>
          opposite(a) === c && (axis ? a === Dir.E || a === Dir.W : a === Dir.N || a === Dir.S),
      ) &&
      builder.track.connected(x, y, nx > x ? Dir.E : nx < x ? Dir.W : ny > y ? Dir.S : Dir.N)
    );
  };
  let before = 0,
    after = 0;
  if (link) {
    while (
      joins(b.x - before * dx, b.y - before * dy, b.x - (before + 1) * dx, b.y - (before + 1) * dy)
    )
      before++;
    while (
      joins(b.x + after * dx, b.y + after * dy, b.x + (after + 1) * dx, b.y + (after + 1) * dy)
    )
      after++;
  }
  return { material, axis, index: before, length: before + after + 1 };
}

/** A bridge platform with no rail on it stands on (x, y). */
function bareDeck(builder: Builder, x: number, y: number) {
  return !!builder.bridgeAt(x, y) && !builder.track.has(x, y);
}

/**
 * The axis of a road on the platform at (x, y), as the road reads (#493): the way along which it
 * runs on to a road or to a platform with no rail on both sides; else the way it runs on to one
 * side; north to south (0) where both ways or neither do, as for a rail platform with no straight.
 */
export function roadDeckAxis(builder: Builder, x: number, y: number): 0 | 1 {
  const on = (nx: number, ny: number) => builder.roads.has(nx, ny) || bareDeck(builder, nx, ny);
  const ns = +on(x, y - 1) + +on(x, y + 1),
    ew = +on(x - 1, y) + +on(x + 1, y);
  if (ns === 2 || ew === 2) return ew === 2 && ns < 2 ? 1 : 0;
  return ew > ns ? 1 : 0;
}

/**
 * `bridgeSpan` of a platform that carries a road and no rail: the run of such platforms of its
 * material beside it along its axis, every one of them on that axis too, so the span is the same
 * from each of its platforms.
 */
function roadSpan(builder: Builder, b: Building, material: BridgeMaterial) {
  const axis = roadDeckAxis(builder, b.x, b.y);
  const dx = axis ? 1 : 0,
    dy = axis ? 0 : 1;
  const joins = (x: number, y: number) => {
    const n = builder.buildingAt(x, y);
    return (
      !!n &&
      buildingDef(n.id).bridge?.material === material &&
      !builder.track.has(x, y) &&
      builder.roads.has(x, y) &&
      roadDeckAxis(builder, x, y) === axis
    );
  };
  let before = 0,
    after = 0;
  while (joins(b.x - (before + 1) * dx, b.y - (before + 1) * dy)) before++;
  while (joins(b.x + (after + 1) * dx, b.y + (after + 1) * dy)) after++;
  return { material, axis, index: before, length: before + after + 1 };
}

/**
 * What a walk reads of the road bridges (#502): the platforms that carry a road and no rail, the
 * only bridge tiles a walker sets foot on (`walkable`, `findWalk` in people.ts).
 */
export interface RoadDecks {
  /** the axis of the road deck on (x, y), as `roadDeckAxis` reads it; null where there is none */
  axis(x: number, y: number): 0 | 1 | null;
  /** the length of the span of the road deck on (x, y) (`bridgeSpan`); 0 where there is none */
  length(x: number, y: number): number;
}

/** The road decks of what `builder` has built, read as it stands at each call. */
export function roadDecks(builder: Builder): RoadDecks {
  const deck = (x: number, y: number) =>
    builder.roads.has(x, y) && !builder.track.has(x, y) ? builder.bridgeAt(x, y) : undefined;
  return {
    axis: (x, y) => (deck(x, y) ? roadDeckAxis(builder, x, y) : null),
    length: (x, y) => {
      const b = deck(x, y);
      return b ? bridgeSpan(builder, b).length : 0;
    },
  };
}

import type { Building } from './buildings';
import { buildingDef, buildingLevel } from './buildings';
import type { Builder } from './build';
import { Dir, opposite } from '../engine/iso';

export type BridgeMaterial = 'wood' | 'stone';
export function bridgeCapacity(b: Building): number | null {
  const base = buildingDef(b.id).bridge?.capacity;
  return base ? base * (1 + (buildingLevel(b) - 1) * 0.25) : null;
}
/** Straight, connected rail unifies consecutive platforms into a span, regardless of class. */
export function bridgeSpan(builder: Builder, b: Building) {
  const material = buildingDef(b.id).bridge?.material ?? 'wood';
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

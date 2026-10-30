import { inBounds, startRegion, terrainAt, type GameMap } from '../world/tiles';
import { networkOf, type TrackClass, type TrackItem, type TrackPiece } from '../world/track';
import { DIRS, DIR_DX, DIR_DY } from '../engine/iso';
import type { Gauge } from '../data/content';
import { STR } from '../strings';
import { rules } from './rules';
import { unbuildable, type Builder } from './build';
import { stationDef, stationFootprint, stationGates, type Station } from './stations';
import { rotationAxis } from './rotation';
import { gaugeLine, gaugeNetwork, gaugeOf, pieceClassFor } from './compat';

/** How far from the start chunk's middle a depot is looked for, in tiles (Chebyshev). */
export const START_DEPOT_REACH = 24;

/** A new game's depot: narrow, for the narrow starter engines, unless tuning bars narrow gauge. */
export function startDepotKind(): string {
  return rules.narrowUnlocked ? 'narrow_depot' : 'depot';
}

/** The middle tile of the start chunk, where the search for a depot site begins. */
export function startDepotCentre(map: GameMap): { x: number; y: number } {
  const rs = map.regionSize;
  const { rx, ry } = startRegion(map);
  return { x: Math.floor((rx + 0.5) * rs), y: Math.floor((ry + 0.5) * rs) };
}

/**
 * The straight across a depot's gate: of its gauge, along the tracks through the shed, which
 * follow the axis of the shed's rotation.
 */
function gateTrack(defId: string, rot: number): { item: TrackItem; rot: number } {
  const cls = gaugeLine(stationDef(defId).gauge ?? 'regular');
  return { item: { kind: 'straight', cls, cls2: cls }, rot: rotationAxis(rot) === 0 ? 1 : 0 };
}

/**
 * The class a piece already on a gate presents to a train of the shed, read the way
 * `Fleet.depotClasses` reads a placed depot's gate: the piece's link toward the shed when it has
 * one, else its first link, through `pieceClassFor` (a crossing gives the class of the axis that
 * runs into the shed). The shed does not stand yet, so the edge facing it is found from `shed`,
 * the tiles of the site's footprint. A piece with no links (the unused tile of a wide curve or
 * switch) is judged by its own `cls`.
 */
function gateClass(
  piece: TrackPiece,
  gate: { x: number; y: number },
  shed: { x: number; y: number }[],
) {
  const toShed = DIRS.find((d) =>
    shed.some((t) => t.x === gate.x + DIR_DX[d] && t.y === gate.y + DIR_DY[d]),
  );
  const entry =
    toShed !== undefined && piece.links.some((l) => l.includes(toShed))
      ? toShed
      : piece.links[0]?.[0];
  return entry === undefined ? piece.cls : pieceClassFor(piece, entry);
}

/** Does stock of `gauge` run on line `cls`'s network? */
function inGauge(cls: TrackClass, gauge: Gauge) {
  return networkOf(cls) === gaugeNetwork(gauge);
}

/** Run `fn` with the builder granting: no cost, age, supply or depot-count limits. */
function granting<T>(builder: Builder, fn: () => T): T {
  const was = builder.free;
  builder.free = true;
  try {
    return fn();
  } finally {
    builder.free = was;
  }
}

/**
 * Why a depot of kind `defId` with its corner at (x, y), turned to `rot`, cannot be granted, or
 * null when it can: the shed passes `Builder.checkStation` on owned ground, and every gate is on
 * owned, clear ground and is served: either track of the depot's gauge is already there, or the
 * gate takes the gate straight (`Builder.checkTrack`), so no gate is left bare. Track already on a
 * gate counts only in the depot's gauge (a narrow depot takes Narrow Gauge, a regular one the
 * standard lines), judged by the class a train leaving the shed would meet (`gateClass`); other-gauge
 * track there gives `STR.build.gaugeBreak`, as no train of the depot could leave by that gate.
 */
export function depotSiteBlocked(
  builder: Builder,
  defId: string,
  x: number,
  y: number,
  rot: number,
): string | null {
  const { map, regions, track } = builder;
  // granting lifts the chunk lock too; the depot still stands only on ground the player owns
  const unowned = (tx: number, ty: number) => {
    if (!inBounds(map, tx, ty)) return STR.build.offMap;
    return regions.isTileUnlocked(tx, ty) ? null : STR.build.locked;
  };
  const footprint = stationFootprint(defId, x, y, rot);
  for (const t of footprint) {
    const why = unowned(t.x, t.y);
    if (why) return why;
  }
  const gauge = gaugeOf(stationDef(defId));
  return granting(builder, () => {
    const shed = builder.checkStation(x, y, defId, rot);
    if (!shed.ok) return shed.reason ?? STR.build.occupied;
    const gate = gateTrack(defId, rot);
    for (const g of stationGates(defId, x, y, rot)) {
      const why = unowned(g.x, g.y);
      if (why) return why;
      const bad = unbuildable(terrainAt(map, g.x, g.y));
      if (bad) return bad;
      if (builder.stationAt(g.x, g.y) || builder.decorAt(g.x, g.y) || builder.buildingAt(g.x, g.y))
        return STR.build.occupied;
      const there = track.get(g.x, g.y);
      if (there) {
        if (!inGauge(gateClass(there, g, footprint), gauge)) return STR.build.gaugeBreak;
        continue;
      }
      const rail = builder.checkTrack(g.x, g.y, gate.item, gate.rot);
      if (!rail.ok) return rail.reason ?? STR.build.occupied;
    }
    return null;
  });
}

/**
 * Grant a depot at a site `depotSiteBlocked` passes: the shed, then the gate straight on every gate
 * without track. Track already on a gate is of the depot's gauge, as the site check requires, and
 * is kept as it is: not replaced and not laid again. A regular depot is named
 * `STR.station.depotName`; a narrow one keeps its kind's name, as one the player builds does.
 * Announced again once named and served. Null, with nothing left behind, when the site cannot take
 * it.
 */
export function grantDepot(
  builder: Builder,
  defId: string,
  x: number,
  y: number,
  rot: number,
): Station | null {
  if (depotSiteBlocked(builder, defId, x, y, rot) !== null) return null;
  return granting(builder, () => {
    const d = builder.placeStation(x, y, defId, rot);
    if (!d) return null;
    const gate = gateTrack(defId, rot);
    const laid: { x: number; y: number }[] = [];
    for (const g of d.gateTiles()) {
      if (builder.track.has(g.x, g.y)) continue;
      if (builder.placeTrack(g.x, g.y, gate.item, gate.rot)) {
        laid.push(g);
        continue;
      }
      // the check foresaw this gate; should laying still refuse it, no depot is left without one
      for (const t of laid) builder.removeTrack(t.x, t.y);
      builder.removeStation(d);
      return null;
    }
    if (gate.item.cls === 'branch') d.name = STR.station.depotName;
    builder.onStationChanged?.(d, false);
    return d;
  });
}

/**
 * Every game has a depot: a new game is granted one near the middle of the start chunk, an older
 * save without one gets one on load. Returns the depot already standing, if any; otherwise grants
 * one of kind `defId` at the first site, ring by ring out to `START_DEPOT_REACH` from `centre`
 * (both turns at each corner), whose shed and gate track can both be laid. A gate counts as served
 * only by track of the depot's gauge, so a site with other-gauge track on a gate is passed over
 * and the track left as it was. Null when no site in reach can take one.
 */
export function ensureStartDepot(
  builder: Builder,
  defId: string,
  centre = startDepotCentre(builder.map),
): Station | null {
  const have = builder.depots()[0];
  if (have) return have;
  for (let r = 0; r <= START_DEPOT_REACH; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        for (const rot of [0, 1]) {
          const d = grantDepot(builder, defId, centre.x + dx - 1, centre.y + dy - 1, rot);
          if (d) return d;
        }
      }
  return null;
}

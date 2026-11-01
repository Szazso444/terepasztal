import { Terrain } from './tiles';
import { MAX_LEVEL, levelTarget, maxStep, type Elevated } from './elevation';

/** What Raise or Lower does to the ground: the tiles that change level, or the tiles that refuse. */
export interface Reshape {
  /**
   * Every tile the action sets in GameMap.groundLevel, in tile order, with the level it gets;
   * empty when any tile refuses. Written in full they leave the map settled: tileLevels and
   * levelAt both read exactly these levels, and nothing else changes. A tile that only holds the
   * level it has (see below) is among them with `to` equal to its level in `levels`, so a caller
   * that counts changes or prices levels compares `to` with `levels`.
   */
  moved: { x: number; y: number; to: number }[];
  /** Every tile that must move and cannot; the action does nothing when this is not empty. */
  refused: { x: number; y: number }[];
}

/**
 * What a raise or lower of `tiles` by one level moves. `levels` is tileLevels(map), the levels
 * the map stands at now. Each tile of `tiles` moves by `delta`; a neighbour moves when the step to
 * it would grow past what it was, with a floor of one level, so a raise lifts the ground around it
 * to one level short of itself and a lower takes it down, while a cliff of up to 4 that generated
 * ground has stays as steep as it was. That runs on from tile to tile until the slope holds.
 *
 * A tile refuses, and with it the whole action, when it has to move to a level above MAX_LEVEL or
 * below 0 or `least`, above 1 on the map's border, or when `fixed` says it may not move. Water
 * never moves either: its level is its surface, which a plane level would override. A tile of
 * `tiles` off the map refuses too, as it can never move.
 *
 * Ground that no plane sets reads its terrain's level, held down by its neighbours. A raise can
 * free such a tile to rise (a mountain tile at 1 beside flat ground that comes up); to keep the
 * action to what the caller asked for, that tile is held in `moved` at the level it has now. Water
 * that would rise this way refuses.
 */
export function reshape(
  map: Elevated,
  levels: Uint8Array,
  tiles: readonly { x: number; y: number }[],
  delta: 1 | -1,
  fixed: (x: number, y: number) => boolean,
  least: (x: number, y: number) => number,
): Reshape {
  const { w, h } = map,
    step = maxStep(map),
    next = Uint8Array.from(levels),
    changed = new Set<number>(),
    refused = new Set<number>(),
    outside: { x: number; y: number }[] = [],
    queue: number[] = [];
  const onBorder = (x: number, y: number) => x === 0 || y === 0 || x === w - 1 || y === h - 1;
  const neighbours = (k: number) => {
    const x = k % w,
      out: number[] = [];
    if (x) out.push(k - 1);
    if (x < w - 1) out.push(k + 1);
    if (k >= w) out.push(k - w);
    if (k < w * h - w) out.push(k + w);
    return out;
  };
  // Sets tile k to level v, and queues it, or refuses it when it may not take v.
  const move = (k: number, v: number) => {
    if (next[k] === v) return;
    const x = k % w,
      y = Math.floor(k / w);
    if (
      v < 0 ||
      v > MAX_LEVEL ||
      v > (onBorder(x, y) ? 1 : MAX_LEVEL) ||
      v < least(x, y) ||
      map.terrain[k] === Terrain.Water ||
      fixed(x, y)
    ) {
      refused.add(k);
      return;
    }
    next[k] = v;
    changed.add(k);
    queue.push(k);
  };

  for (const { x, y } of tiles) {
    if (x < 0 || y < 0 || x >= w || y >= h) {
      if (!outside.some((t) => t.x === x && t.y === y)) outside.push({ x, y });
      continue;
    }
    const k = y * w + x;
    // a tile asked for twice moves once
    if (!changed.has(k)) move(k, levels[k] + delta);
  }
  for (let head = 0; head < queue.length; head++) {
    const t = queue[head];
    for (const n of neighbours(t)) {
      const allowed = Math.max(1, Math.abs(levels[t] - levels[n]));
      move(
        n,
        delta > 0 ? Math.max(next[n], next[t] - allowed) : Math.min(next[n], next[t] + allowed),
      );
    }
  }

  // Tiles that no plane holds at their level might rise now that a neighbour has: hold them.
  const held = new Set<number>();
  for (const t of changed)
    for (const k of neighbours(t)) {
      if (changed.has(k) || held.has(k)) continue;
      const x = k % w,
        y = Math.floor(k / w);
      let v = onBorder(x, y) ? Math.min(levelTarget(map, k), 1) : levelTarget(map, k);
      for (const n of neighbours(k)) v = Math.min(v, next[n] + step);
      if (v <= levels[k]) continue;
      if (map.terrain[k] === Terrain.Water) refused.add(k);
      else held.add(k);
    }

  const at = (k: number) => ({ x: k % w, y: Math.floor(k / w) });
  if (refused.size || outside.length)
    return { moved: [], refused: [...outside, ...[...refused].sort((a, b) => a - b).map(at)] };
  return {
    moved: [...changed, ...held].sort((a, b) => a - b).map((k) => ({ ...at(k), to: next[k] })),
    refused: [],
  };
}

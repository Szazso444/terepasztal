/** How the Game tuning screen lays its rules out: pure, so it is tested under Node. */

export interface RuleGroup<R> {
  name: string;
  rules: R[];
}

/** The rules by `group`, the groups in the order they first appear and the rules in theirs. */
export function groupRules<R extends { group: string }>(rules: readonly R[]): RuleGroup<R>[] {
  const groups = new Map<string, RuleGroup<R>>();
  for (const r of rules) {
    let g = groups.get(r.group);
    if (!g) groups.set(r.group, (g = { name: r.group, rules: [] }));
    g.rules.push(r);
  }
  return [...groups.values()];
}

/**
 * Where blocks of the given heights are cut in two columns that read in order: the number of
 * blocks the left column takes, chosen so the taller column is as short as it can be (the earlier
 * cut when two tie).
 */
export function splitInTwo(heights: readonly number[]): number {
  const total = heights.reduce((a, b) => a + b, 0);
  let best = heights.length;
  let bestTall = Infinity;
  let left = 0;
  for (let k = 0; k <= heights.length; k++) {
    const tall = Math.max(left, total - left);
    if (tall < bestTall) {
      bestTall = tall;
      best = k;
    }
    left += heights[k] ?? 0;
  }
  return best;
}

/** A rule is changed when it is not what the shipped rules say. */
export function isChanged(value: number, shipped: number): boolean {
  return value !== shipped;
}

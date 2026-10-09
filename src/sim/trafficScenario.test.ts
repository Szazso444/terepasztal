import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rules, DEFAULT_RULES } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY } from './supply';
import { resetTrainIds } from './trains';
import {
  runTrafficScenario,
  sharedTiles,
  SCENARIO_MAX_TICKS,
  type ScenarioResult,
} from '../testing/trafficScenario';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(DEFAULT_SUPPLY);
  resetTrainIds();
});

/**
 * The cases scratchpad/verify-traffic.mjs runs in a browser. The twelve-train queue may record a
 * stuck episode while it drains, so only the two short cases must be free of them.
 */
const CASES = [
  { count: 3, pinned: false, stuckFree: true },
  { count: 4, pinned: true, stuckFree: true },
  { count: 12, pinned: false, stuckFree: false },
];

const nameOf = (count: number, pinned: boolean) => `${count} trains${pinned ? ', pinned' : ''}`;

/** Enough of a run to see what went wrong without rerunning it. */
function summary(r: ScenarioResult, firstShared: string | null): string {
  const trains = r.trains
    .map(
      (t) =>
        `#${t.id} ${t.state} at ${t.head?.x},${t.head?.y}, yields ${t.yields}, ` +
        `longest hold ${t.maxBlockedTime.toFixed(2)} s, left at ${t.arrivedAt ?? '-'}`,
    )
    .join('; ');
  const episodes = r.traffic.episodes
    .filter((e) => e.kind !== 'yield' && e.kind !== 'recovery')
    .slice(0, 8)
    .map((e) => `${e.t.toFixed(2)} s ${e.kind}: ${e.text}`)
    .join('; ');
  return [
    `${nameOf(r.count, r.pinned)}: ${r.ticks} of ${SCENARIO_MAX_TICKS} ticks, last at ${r.time} s`,
    `counters ${JSON.stringify(r.traffic.counters)}`,
    `first shared tile ${firstShared ?? 'none'}`,
    `trains ${trains}`,
    `episodes ${episodes || 'none'}`,
  ].join('\n');
}

describe('the refuge traffic scenario, run headless', () => {
  for (const { count, pinned, stuckFree } of CASES) {
    const also = stuckFree ? ', nobody stuck' : '';
    it(`${nameOf(count, pinned)}: train 2 passes, no overlap, no deadlock${also}`, () => {
      // An oracle beside the counter: the counter samples at the start of each tick, this after
      // every tick, the last one included.
      let firstShared: string | null = null;
      const r = runTrafficScenario(count, pinned, {
        afterStep: (s, now) => {
          if (firstShared !== null) return;
          const found = sharedTiles(s.fleet.trains, s.track.w);
          if (found.length) firstShared = `${JSON.stringify(found)} after the tick at ${now} s`;
        },
      });
      const { overlaps, deadlocks, stuck } = r.traffic.counters;

      // One comparison, so a failure shows every property that broke, not only the first.
      expect(
        {
          passed: r.passed,
          overlaps,
          sharedTile: firstShared,
          deadlocks,
          ...(stuckFree ? { stuck } : {}),
          // As the browser check: a run that never needed a coordinated recovery proves nothing.
          recovered: r.maxActive > 0,
        },
        summary(r, firstShared),
      ).toEqual({
        passed: true,
        overlaps: 0,
        sharedTile: null,
        deadlocks: 0,
        ...(stuckFree ? { stuck: 0 } : {}),
        recovered: true,
      });
    }, 20_000);
  }
});

/**
 * What the station, works and house panels show for an upgrade, from the simulation's own check:
 * the button with the next level, its cost (none when there is nothing to pay) and its time; the
 * age that opens a level the current age does not allow; the top level; or the work under way with
 * its progress and time left.
 * DOM-free so it runs under Node; `upgradeRow` in upgradeRow.ts turns it into elements.
 */
import { STR } from '../strings';
import type { PlacementCheck } from '../sim/build';
import { fmtCost } from '../sim/stockpile';
import { hoursLeft, upgradeSeconds, workProgress, type Work } from '../sim/upgrade';

export type UpgradeView =
  /** a work under way: `label` is the level it brings and the time left, `progress` 0..1 */
  | { kind: 'work'; label: string; progress: number }
  /** the Upgrade button; `title` is its hover text */
  | { kind: 'button'; label: string; enabled: boolean; title: string }
  /** nothing further to upgrade to */
  | { kind: 'top'; label: string };

/** The reasons a check gives when there is no next level at all. */
const TOP = new Set<string>([STR.station.maxed, STR.house.maxed]);

/** Game hours the upgrade to `level` takes; 0 when it is instant (a depot, the editor, the rules). */
export function upgradeHours(level: number, instant: boolean): number {
  const total = instant ? 0 : upgradeSeconds(level);
  return total > 0 ? hoursLeft({ to: level, left: total, total }) : 0;
}

/** Whether `reason` is the age keeping `level` shut (`STR.build.levelOpens`, any age). */
function opensInLaterAge(reason: string, level: number): boolean {
  return Object.values(STR.ages.name).some((age) => reason === STR.build.levelOpens(level, age));
}

/**
 * The upgrade of a building at `level`, from its check (`Builder.canUpgrade`,
 * `Builder.canUpgradeBuilding`, `HouseRegistry.canUpgrade`) and its work under way.
 */
export function upgradeView(o: {
  check: PlacementCheck;
  level: number;
  work?: Work | null;
  /** the upgrade takes no time: a depot's, or any in the editor */
  instant: boolean;
}): UpgradeView {
  const w = o.work;
  if (w)
    return {
      kind: 'work',
      label: STR.upgrade.running(w.to, hoursLeft(w)),
      progress: workProgress(w),
    };
  const { ok, cost, reason = '' } = o.check;
  if (!ok && TOP.has(reason)) return { kind: 'top', label: reason };
  const next = o.level + 1;
  // nothing to pay (a depot's, the editor's, an all-zero cost): the button names no cost at all
  const price = Object.values(cost).some((v) => v > 0) ? fmtCost(cost) : '';
  const label = STR.upgrade.button(next, price, upgradeHours(next, o.instant));
  if (ok) return { kind: 'button', label, enabled: true, title: '' };
  // the age keeps the level shut: the button names the age that opens it, the hover what it costs
  if (opensInLaterAge(reason, next))
    return { kind: 'button', label: reason, enabled: false, title: label };
  return { kind: 'button', label, enabled: false, title: reason };
}

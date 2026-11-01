/**
 * The game's sentences that name a number of the rules. The number is read here, from where the
 * sim keeps it, so the sentence cannot drift from what the game does. DOM-free.
 */
import { content } from '../data/content';
import { AGE_CHECKS_PER_DAY } from '../sim/ages';
import { BRIDGE_SLOW_FACTOR, BRIDGE_SLOW_SHARE } from '../sim/bridges';
import { CARGO, cargoName } from '../sim/cargo';
import { HEADWAY, type SignalLevel } from '../sim/signals';
import { inSupplyMode } from '../sim/supply';
import { DRIFT_MAX, DRIFTING } from '../sim/trade';
import { STR } from '../strings';

const HOURS_PER_DAY = 24;
const wholePercent = (share: number) => Math.round(share * 100);

/** The engine modes, with what two engines of different kinds pull together. */
export function modesHint() {
  const doubled = wholePercent(content.track.physics.doubleHeadEfficiency);
  return STR.modes.hint.replace('{doubled}', String(doubled));
}

/** The fuels of this game's chain whose price wanders, and how far. */
export function driftHint() {
  const fuels = CARGO.filter((c) => DRIFTING.includes(c.id) && inSupplyMode(c));
  return STR.market.driftHint(
    fuels.map((c) => cargoName(c.id).toLowerCase()).join(', '),
    wholePercent(DRIFT_MAX - 1),
  );
}

/** What a signalling level does: stock without in-cab keeps the gap of an absolute block. */
export function signalHint(level: SignalLevel) {
  return STR.settings.signalHint[level](HEADWAY[level], HEADWAY.absolute_block);
}

/** A bridge's capacity, and the weight from which trains cross it slowly. */
export function bridgeLimit(capacity: number) {
  return STR.building.bridgeLimit(
    capacity,
    Math.round(capacity * BRIDGE_SLOW_SHARE),
    wholePercent(BRIDGE_SLOW_FACTOR),
  );
}

/** How an age begins, and how often its goals are asked. */
export function ageHint() {
  return STR.ages.hint(HOURS_PER_DAY / AGE_CHECKS_PER_DAY);
}

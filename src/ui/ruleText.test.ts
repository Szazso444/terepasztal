import { afterEach, describe, expect, it } from 'vitest';
import { content } from '../data/content';
import { BRIDGE_SLOW_FACTOR, BRIDGE_SLOW_SHARE } from '../sim/bridges';
import { HEADWAY, SIGNAL_LEVELS } from '../sim/signals';
import { DEFAULT_SUPPLY, setSupplyMode } from '../sim/supply';
import { DRIFT_MAX } from '../sim/trade';
import { STR } from '../strings';
import { ageHint, bridgeLimit, driftHint, modesHint, signalHint } from './ruleText';

afterEach(() => setSupplyMode(DEFAULT_SUPPLY));

describe('a sentence that names a number of the rules', () => {
  it('reads what two engines pull together from the physics', () => {
    const physics = content.track.physics;
    const shipped = physics.doubleHeadEfficiency;
    expect(modesHint()).toContain(`${Math.round(shipped * 100)}%`);
    physics.doubleHeadEfficiency = 0.5;
    expect(modesHint()).toContain('50%');
    physics.doubleHeadEfficiency = shipped;
    expect(modesHint()).not.toContain('{');
  });

  it("names the fuels of this game's chain, and how far their price wanders", () => {
    setSupplyMode('simple');
    expect(driftHint()).toContain('oil');
    expect(driftHint()).not.toMatch(/diesel|crude/);
    setSupplyMode('full');
    expect(driftHint()).toMatch(/diesel/);
    expect(driftHint()).toContain(`±${Math.round((DRIFT_MAX - 1) * 100)}%`);
  });

  it('gives every signalling level its gap', () => {
    for (const level of SIGNAL_LEVELS) {
      const line = signalHint(level);
      expect(line, level).not.toMatch(/undefined|\{/);
      if (HEADWAY[level]) expect(line, level).toContain(String(HEADWAY[level]));
    }
    // stock with no in-cab set keeps the gap of an absolute block
    expect(signalHint('in_cab')).toContain(String(HEADWAY.absolute_block));
  });

  it('says from what weight a bridge slows a train, and to what', () => {
    expect(bridgeLimit(1000)).toBe(
      STR.building.bridgeLimit(1000, 1000 * BRIDGE_SLOW_SHARE, BRIDGE_SLOW_FACTOR * 100),
    );
  });

  it('says how often the goals of an age are asked, and that no age locks a vehicle', () => {
    expect(ageHint()).toContain('every hour');
    expect(STR.ages.hint(3)).toContain('every 3 hours');
    expect(ageHint()).toContain('no age locks them');
  });
});

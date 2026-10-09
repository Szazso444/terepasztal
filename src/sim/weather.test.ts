import { describe, it, expect, beforeEach } from 'vitest';
import { Weather, setSeasonOffset } from './weather';
import { rules, DEFAULT_RULES, daySeconds } from './rules';
import { SIM_STEP } from './time';
import { Rng } from '../engine/rng';
import { forAll } from '../testing/property';

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSeasonOffset(0);
});

/** Share of the gap to the target the visible strength closes per game second of `dt`. */
const EASE_PER_SECOND = 0.6;

describe('Weather eases by the game seconds it is given', () => {
  it('each tick of dt closes min(1, 0.6 dt) of the gap to the target, and never passes it', () => {
    let eased = 0;
    forAll(
      (rng) => ({
        seed: rng.int(1, 2 ** 31 - 1),
        season: rng.int(0, 3),
        dt: rng.pick([SIM_STEP, 0.01, 0.25, 1, 2]),
      }),
      ({ seed, season, dt }) => {
        setSeasonOffset(season);
        const weather = new Weather(new Rng(seed));
        const keep = 1 - Math.min(1, dt * EASE_PER_SECOND);
        // The closed form: `ticks` ticks after the target last changed, from where it stood then.
        let target = weather.intensity;
        let from = weather.visible;
        let ticks = 0;
        for (let k = 1; k * dt <= 2 * daySeconds(); k++) {
          const now = k * dt;
          const before = weather.visible;
          weather.tick(now, Math.floor(now / daySeconds()) + 1, dt);
          if (weather.intensity !== target) {
            target = weather.intensity;
            from = before;
            ticks = 0;
          }
          ticks++;
          const v = weather.visible;
          const expected = target + (from - target) * keep ** ticks;
          const where = `tick ${k} at ${now} s (${weather.kind} ${target})`;
          if (!(Math.abs(v - expected) <= 1e-9))
            throw new Error(`${where}: visible ${v}, closed form ${expected}`);
          if (v < Math.min(before, target) || v > Math.max(before, target))
            throw new Error(`${where}: visible went from ${before} to ${v}, past its target`);
          const f = weather.speedFactor();
          if (!(f >= 0.88 && f <= 1)) throw new Error(`${where}: speedFactor ${f}`);
          if (target > 0 && Math.abs(v - before) > 0) eased++;
        }
      },
    );
    // Not vacuous: rain or fog came and the strength moved towards it.
    expect(eased).toBeGreaterThan(1000);
  });
});

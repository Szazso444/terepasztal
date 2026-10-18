import { describe, it, expect, beforeEach } from 'vitest';
import {
  windAt,
  windSeedOf,
  windLevelOf,
  WIND_LEVELS,
  WIND_WEIGHTS,
  WIND_LEVEL_STRENGTH,
  type WindLevel,
  type WindState,
} from './wind';
import { Weather, setSeasonOffset } from './weather';
import { rules, DEFAULT_RULES, daySeconds } from './rules';
import { SIM_STEP } from './time';
import { Rng } from '../engine/rng';
import { tileToWorld } from '../engine/iso';
import { forAll } from '../testing/property';

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSeasonOffset(0);
});

const CLEAR = { rain: 0, fog: 0 };

/** Share of the time spent at each level over a stream of states. */
function shares(states: Iterable<WindState>): Record<WindLevel, number> {
  const count: Record<WindLevel, number> = { calm: 0, breeze: 0, windy: 0, storm: 0 };
  let n = 0;
  for (const s of states) {
    count[s.level]++;
    n++;
  }
  for (const l of WIND_LEVELS) count[l] /= n;
  return count;
}

/** A Weather driven the way Game drives it: one call per `dt` game seconds. */
function runWeather(seed: number, days: number, dt: number, each: (w: Weather, t: number) => void) {
  const w = new Weather(new Rng(seed ^ 0x77ea));
  const end = days * daySeconds();
  for (let t = 0; t <= end; t += dt) {
    w.tick(t, Math.floor(t / daySeconds()) + 1, dt);
    each(w, t);
  }
  return w;
}

describe('windAt is a pure function of (seed, time, weather)', () => {
  it('gives the same wind for the same inputs, whatever was asked in between', () => {
    forAll(
      (rng) => ({
        seed: rng.int(1, 2 ** 31 - 1),
        t: rng.range(0, 400 * daySeconds()),
        other: rng.range(0, 400 * daySeconds()),
        rain: rng.next(),
        fog: rng.next(),
      }),
      ({ seed, t, other, rain, fog }) => {
        const wx = { rain, fog };
        const first = windAt(seed, t, wx);
        windAt(seed, other, wx);
        windAt(seed + 1, t, wx);
        expect(windAt(seed, t, wx)).toEqual(first);
      },
    );
  });

  it('differs between seeds', () => {
    const at = (seed: number) => windAt(seed, 5 * daySeconds(), CLEAR).fromRad;
    const seen = new Set(Array.from({ length: 20 }, (_, i) => at(i + 1).toFixed(6)));
    expect(seen.size).toBeGreaterThan(15);
  });

  it('takes its seed from the world: the same number gives the same seed, nearby ones differ', () => {
    expect(windSeedOf(12345)).toBe(windSeedOf(12345));
    const seeds = new Set(Array.from({ length: 200 }, (_, i) => windSeedOf(i)));
    expect(seeds.size).toBe(200);
  });

  it('does not touch the clock or Math.random', () => {
    const real = Math.random;
    Math.random = () => {
      throw new Error('Math.random called');
    };
    try {
      windAt(7, 1234.5, CLEAR);
    } finally {
      Math.random = real;
    }
  });
});

describe('wind through a save and load of the weather', () => {
  it('adds nothing to what the weather saves', () => {
    const w = new Weather(new Rng(5));
    expect(Object.keys(w.toJSON()).sort()).toEqual(['intensity', 'kind', 'nextChangeAt', 'rng']);
  });

  it('is the same after a load: the same function of the saved state at once, and the same once the easing settles', () => {
    forAll(
      (rng) => ({ seed: rng.int(1, 2 ** 31 - 1), days: rng.range(2, 40) }),
      ({ seed, days }) => {
        const make = () => new Weather(new Rng(seed ^ 0x77ea));
        const a = runWeather(seed, days, SIM_STEP * 20, () => {});
        const nowT = days * daySeconds();
        const b = make();
        b.load(JSON.parse(JSON.stringify(a.toJSON())));
        expect(b.windSeed).toBe(a.windSeed);
        // The same target and time give the same wind, whatever the eased strength was.
        const target = (w: Weather) => ({
          rain: w.kind === 'rain' ? w.intensity : 0,
          fog: w.kind === 'fog' ? w.intensity : 0,
        });
        expect(windAt(b.windSeed, nowT, target(b))).toEqual(windAt(a.windSeed, nowT, target(a)));
        // Both go on for a minute of game time: the easing has settled, the winds agree.
        let t = nowT;
        for (let k = 0; k < 1200; k++) {
          t += SIM_STEP;
          const day = Math.floor(t / daySeconds()) + 1;
          a.tick(t, day, SIM_STEP);
          b.tick(t, day, SIM_STEP);
        }
        expect(b.wind.strength).toBeCloseTo(a.wind.strength, 9);
        expect(b.wind.level).toBe(a.wind.level);
        expect(b.wind.fromRad).toBeCloseTo(a.wind.fromRad, 12);
      },
      { seeds: Array.from({ length: 30 }, (_, i) => i + 1) },
    );
  });

  it('Weather.tick leaves weather.wind equal to windAt for its own state', () => {
    runWeather(11, 5, 1, (w, t) => {
      expect(w.wind).toEqual(
        windAt(w.windSeed, t, {
          rain: w.kind === 'rain' ? w.visible : 0,
          fog: w.kind === 'fog' ? w.visible : 0,
        }),
      );
    });
  });

  it('keeps the wind going while the weather setting is off, with no rain or fog in it', () => {
    const w = new Weather(new Rng(3));
    w.load({ kind: 'rain', intensity: 1, nextChangeAt: 1e9, rng: 1 });
    w.updateWind(100, false);
    expect(w.wind).toEqual(windAt(w.windSeed, 100, CLEAR));
  });
});

describe('the levels and how often they come', () => {
  it('names calm, breeze, windy and storm, and the nominal strengths map back to them', () => {
    expect([...WIND_LEVELS]).toEqual(['calm', 'breeze', 'windy', 'storm']);
    for (const l of WIND_LEVELS) expect(windLevelOf(WIND_LEVEL_STRENGTH[l])).toBe(l);
    expect(windLevelOf(0)).toBe('calm');
    expect(windLevelOf(1)).toBe('storm');
  });

  it('the target weights sum to 1 and favour the lighter levels', () => {
    const sum = WIND_LEVELS.reduce((s, l) => s + WIND_WEIGHTS[l], 0);
    expect(sum).toBeCloseTo(1, 12);
    expect(WIND_WEIGHTS.calm).toBeGreaterThan(WIND_WEIGHTS.breeze);
    expect(WIND_WEIGHTS.breeze).toBeGreaterThan(WIND_WEIGHTS.windy);
    expect(WIND_WEIGHTS.windy).toBeGreaterThan(WIND_WEIGHTS.storm);
  });

  it('over a long span with the weather running, the share of each level is near its weight', () => {
    // 2000 game days at 6 s steps, four seeds, the seasons turning (the season sets the rain odds).
    const states: WindState[] = [];
    for (const seed of [1, 2, 3, 4]) {
      runWeather(seed, 2000, 6, (w) => states.push(w.wind));
    }
    const got = shares(states);
    for (const l of WIND_LEVELS) {
      expect(
        Math.abs(got[l] - WIND_WEIGHTS[l]),
        `${l}: ${got[l]} vs ${WIND_WEIGHTS[l]}`,
      ).toBeLessThan(0.04);
    }
  });

  it('without any rain or fog the wind is at most as strong as the target mix (and calmer)', () => {
    const states: WindState[] = [];
    for (let seed = 1; seed <= 4; seed++)
      for (let t = 0; t < 2000 * daySeconds(); t += 30) states.push(windAt(seed, t, CLEAR));
    const got = shares(states);
    expect(got.calm).toBeGreaterThanOrEqual(WIND_WEIGHTS.calm - 0.02);
    expect(got.storm).toBeLessThanOrEqual(WIND_WEIGHTS.storm + 0.01);
    // every level still occurs
    for (const l of WIND_LEVELS) expect(got[l]).toBeGreaterThan(0.01);
  });

  it('strength is within 0..1, and gust and the level agree with it', () => {
    forAll(
      (rng) => ({
        seed: rng.int(1, 2 ** 31 - 1),
        t: rng.range(0, 1000 * daySeconds()),
        rain: rng.next(),
        fog: rng.next(),
      }),
      ({ seed, t, rain, fog }) => {
        const s = windAt(seed, t, { rain, fog });
        expect(s.strength).toBeGreaterThanOrEqual(0);
        expect(s.strength).toBeLessThanOrEqual(1);
        expect(s.gust).toBeGreaterThanOrEqual(0);
        expect(s.gust).toBeLessThanOrEqual(1);
        expect(s.level).toBe(windLevelOf(s.strength));
        if (s.strength === 0) expect(s.gust).toBe(0);
        else expect(s.gust).toBeGreaterThan(0.7 * s.strength - 1e-12);
      },
    );
  });
});

describe('the wind changes smoothly', () => {
  // Slow: 3 seeds x 300 game days at one query per 0.05 s tick, about 1 s alone; limit 20 s.
  it('moves by a bounded step per simulation tick: strength, gust and direction', () => {
    // The base wind (clear weather): slow by itself.
    let maxS = 0;
    let maxG = 0;
    let maxD = 0;
    for (const seed of [1, 2, 3]) {
      let prev = windAt(seed, 0, CLEAR);
      for (let k = 1; k * SIM_STEP < 300 * daySeconds(); k++) {
        const s = windAt(seed, k * SIM_STEP, CLEAR);
        maxS = Math.max(maxS, Math.abs(s.strength - prev.strength));
        maxG = Math.max(maxG, Math.abs(s.gust - prev.gust));
        maxD = Math.max(maxD, Math.abs(s.fromRad - prev.fromRad));
        prev = s;
      }
    }
    expect(maxS).toBeLessThan(0.0015);
    expect(maxG).toBeLessThan(0.02);
    expect(maxD).toBeLessThan(0.0005);
  }, 20_000);

  it('moves by a bounded step per tick with the weather coming and going, at every game speed', () => {
    for (const dt of [SIM_STEP, SIM_STEP * 3]) {
      let prev: WindState | undefined;
      let maxS = 0;
      let rained = 0;
      runWeather(9, 120, dt, (w) => {
        if (prev) maxS = Math.max(maxS, Math.abs(w.wind.strength - prev.strength));
        prev = w.wind;
        if (w.kind === 'rain' && w.visible > 0.3) rained++;
      });
      expect(rained).toBeGreaterThan(1000); // not vacuous: it did rain
      // the rain easing closes 0.6 dt of its gap a tick, which the wind follows
      expect(maxS).toBeLessThan(0.06 * (dt / SIM_STEP));
    }
  });

  it('the direction drifts slowly but does wander over the days', () => {
    const seed = 21;
    const dirs: number[] = [];
    for (let d = 0; d < 300; d += 0.25) dirs.push(windAt(seed, d * daySeconds(), CLEAR).fromRad);
    const mean = dirs.reduce((a, b) => a + b, 0) / dirs.length;
    const sd = Math.sqrt(dirs.reduce((a, b) => a + (b - mean) ** 2, 0) / dirs.length);
    expect(sd).toBeGreaterThan(0.2);
    // a quarter of a day apart it has not turned far
    for (let i = 1; i < dirs.length; i++) expect(Math.abs(dirs[i] - dirs[i - 1])).toBeLessThan(0.5);
  });
});

describe('the direction', () => {
  it('is a compass heading in [0, 2 pi) and a unit vector that blows away from it', () => {
    forAll(
      (rng) => ({ seed: rng.int(1, 2 ** 31 - 1), t: rng.range(0, 500 * daySeconds()) }),
      ({ seed, t }) => {
        const s = windAt(seed, t, CLEAR);
        expect(s.fromRad).toBeGreaterThanOrEqual(0);
        expect(s.fromRad).toBeLessThan(2 * Math.PI);
        expect(Math.hypot(s.dir.x, s.dir.y)).toBeCloseTo(1, 12);
        // wind from north (0) blows down the screen, from east blows to the left
        expect(s.dir.x).toBeCloseTo(-Math.sin(s.fromRad), 12);
        expect(s.dir.y).toBeCloseTo(Math.cos(s.fromRad), 12);
        expect(Math.hypot(s.tile.x, s.tile.y)).toBeCloseTo(1, 12);
      },
    );
  });

  it('the tile-space direction projected by the iso formula is the screen direction', () => {
    forAll(
      (rng) => ({ seed: rng.int(1, 2 ** 31 - 1), t: rng.range(0, 500 * daySeconds()) }),
      ({ seed, t }) => {
        const s = windAt(seed, t, CLEAR);
        const p = tileToWorld(s.tile.x, s.tile.y);
        const len = Math.hypot(p.x, p.y);
        expect(p.x / len).toBeCloseTo(s.dir.x, 9);
        expect(p.y / len).toBeCloseTo(s.dir.y, 9);
      },
    );
  });
});

describe('storm goes with rain', () => {
  it('rain makes the wind stronger and fog makes it lighter, at the same seed and time', () => {
    forAll(
      (rng) => ({ seed: rng.int(1, 2 ** 31 - 1), t: rng.range(0, 500 * daySeconds()) }),
      ({ seed, t }) => {
        const clear = windAt(seed, t, CLEAR).strength;
        const rain = windAt(seed, t, { rain: 1, fog: 0 }).strength;
        const fog = windAt(seed, t, { rain: 0, fog: 1 }).strength;
        expect(rain).toBeGreaterThanOrEqual(clear);
        expect(fog).toBeLessThanOrEqual(clear);
        // and it is monotone in how much rain shows
        let prev = clear;
        for (const v of [0.25, 0.5, 0.75, 1]) {
          const r = windAt(seed, t, { rain: v, fog: 0 }).strength;
          expect(r).toBeGreaterThanOrEqual(prev - 1e-12);
          prev = r;
        }
      },
    );
  });

  it('most storms come in rain, and a storm is far likelier in rain than out of it', () => {
    let storms = 0;
    let stormsInRain = 0;
    let rainTicks = 0;
    let stormsDry = 0;
    let dryTicks = 0;
    for (const seed of [1, 2, 3, 4]) {
      runWeather(seed, 2000, 6, (w) => {
        const raining = w.kind === 'rain' && w.visible > 0.3;
        if (raining) rainTicks++;
        else dryTicks++;
        if (w.wind.level === 'storm') {
          storms++;
          if (raining) stormsInRain++;
          else stormsDry++;
        }
      });
    }
    expect(storms).toBeGreaterThan(1000);
    expect(stormsInRain / storms).toBeGreaterThan(0.6);
    expect(stormsInRain / rainTicks).toBeGreaterThan(4 * (stormsDry / dryTicks));
  });

  it('rain is not required for the wind: dry days can be windy', () => {
    const dry = shares(Array.from({ length: 20000 }, (_, i) => windAt(2, i * 40, CLEAR)));
    expect(dry.windy + dry.storm).toBeGreaterThan(0.05);
  });
});

import type { Rng } from '../engine/rng';
import { rules, daySeconds } from './rules';
import { windAt, windSeedOf, type WindState } from './wind';

export type WeatherKind = 'clear' | 'rain' | 'fog';
/** default season length; the live value comes from rules.seasonDays */
export const SEASON_DAYS = 6;
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

/** Which season day 1 falls in (set from the player's calendar on a new game). */
let seasonOffset = 0;
export function setSeasonOffset(i: number) {
  seasonOffset = ((i % 4) + 4) % 4;
}
export function getSeasonOffset() {
  return seasonOffset;
}
/** Season of the real calendar: month-based, northern hemisphere; spring when unknown. */
export function seasonFromDate(d = new Date()): number {
  const m = d.getMonth();
  if (Number.isNaN(m)) return 0;
  return m >= 2 && m <= 4 ? 0 : m >= 5 && m <= 7 ? 1 : m >= 8 && m <= 10 ? 2 : 3;
}
export function seasonOf(day: number): Season {
  return SEASONS[(Math.floor((day - 1) / rules.seasonDays) + seasonOffset) % 4];
}
export function daysUntilNextSeason(day: number) {
  return rules.seasonDays - ((day - 1) % rules.seasonDays);
}

/** Multiply tints for ground / props and a production multiplier per station type. */
export const SEASON_FX: Record<Season, { ground: number; props: number; label: string }> = {
  spring: { ground: 0xf4fff0, props: 0xffffff, label: 'Spring' },
  summer: { ground: 0xfff4dc, props: 0xf8f2dc, label: 'Summer' },
  autumn: { ground: 0xffe2bc, props: 0xf0c088, label: 'Autumn' },
  winter: { ground: 0xd8e4f0, props: 0xc4d2e4, label: 'Winter' },
};
const PRODUCTION: Record<string, [number, number, number, number]> = {
  farm: [1.0, 1.1, 1.35, 0.5],
  lumber: [1.0, 1.0, 1.0, 0.8],
  quarry: [1.0, 1.0, 1.0, 0.85],
};
export function productionMul(stationDefId: string, season: Season) {
  const row = PRODUCTION[stationDefId];
  return row ? row[SEASONS.indexOf(season)] : 1;
}

/** Slow-changing weather driven by a seeded RNG; the season biases the odds. */
export class Weather {
  kind: WeatherKind = 'clear';
  /** 0..1 target strength of the current weather */
  intensity = 0;
  /** smoothed strength used by renderers */
  visible = 0;
  private nextChangeAt = 0;
  /**
   * The wind goes with the weather (wind.ts): a function of the world, the time and the rain and
   * fog showing, evaluated each tick and kept here for the renderers. None of it is saved; the
   * seed comes from the RNG's start, which the world's seed fixes, before a load moves the RNG.
   */
  readonly windSeed: number;
  wind: WindState;
  /** eased shares of the target that rain and fog show, which the wind follows (not saved) */
  private rainShown = 0;
  private fogShown = 0;
  constructor(readonly rng: Rng) {
    this.windSeed = windSeedOf(rng.state);
    this.wind = windAt(this.windSeed, 0);
  }

  /**
   * Bring `wind` to game time `now`. The weather setting being off stills the rain and fog, not
   * the wind, so Step calls this with `withWeather` false then and the wind blows without them.
   */
  updateWind(now: number, withWeather = true) {
    this.wind = windAt(
      this.windSeed,
      now,
      withWeather ? { rain: this.rainShown, fog: this.fogShown } : undefined,
    );
  }

  /**
   * `dt` is game seconds, so the eased strength, and the train speed it feeds, follow game time
   * the same way at every game speed.
   */
  tick(now: number, day: number, dt: number) {
    if (now >= this.nextChangeAt) {
      const s = seasonOf(day);
      const r = this.rng.next();
      const rainP = (s === 'summer' ? 0.18 : s === 'winter' ? 0.22 : 0.3) * rules.rainChanceMul;
      const fogP = (s === 'autumn' ? 0.28 : s === 'winter' ? 0.22 : 0.1) * rules.fogChanceMul;
      if (r < rainP) {
        this.kind = 'rain';
        this.intensity = 0.4 + this.rng.next() * 0.6;
      } else if (r < rainP + fogP) {
        this.kind = 'fog';
        this.intensity = 0.35 + this.rng.next() * 0.5;
      } else {
        this.kind = 'clear';
        this.intensity = 0;
      }
      this.nextChangeAt = now + (0.25 + this.rng.next() * 1.0) * daySeconds();
    }
    // ease the visible strength towards the target
    const ease = Math.min(1, dt * 0.6);
    this.visible += (this.intensity - this.visible) * ease;
    // the same easing split by kind, so a change of kind lets the old one fade rather than cut
    this.rainShown += ((this.kind === 'rain' ? this.intensity : 0) - this.rainShown) * ease;
    this.fogShown += ((this.kind === 'fog' ? this.intensity : 0) - this.fogShown) * ease;
    this.updateWind(now);
  }
  /** Train speed multiplier from the weather. */
  speedFactor() {
    if (this.kind === 'rain') return 1 - 0.12 * this.visible;
    if (this.kind === 'fog') return 1 - 0.06 * this.visible;
    return 1;
  }
  label() {
    return this.kind === 'clear' ? 'Clear' : this.kind === 'rain' ? 'Rain' : 'Fog';
  }
  toJSON() {
    return {
      kind: this.kind,
      intensity: this.intensity,
      nextChangeAt: this.nextChangeAt,
      rng: this.rng.state,
    };
  }
  load(j: ReturnType<Weather['toJSON']>) {
    this.kind = j.kind;
    this.intensity = j.intensity;
    this.visible = j.intensity;
    this.rainShown = j.kind === 'rain' ? j.intensity : 0;
    this.fogShown = j.kind === 'fog' ? j.intensity : 0;
    this.nextChangeAt = j.nextChangeAt;
    this.rng.state = j.rng;
  }
}

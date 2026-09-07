import type { Rng } from '../engine/rng';
import { rules, daySeconds } from './rules';

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
  summer: { ground: 0xfff0d0, props: 0xf6f0d8, label: 'Summer' },
  autumn: { ground: 0xffd2a0, props: 0xe8a868, label: 'Autumn' },
  winter: { ground: 0xd0dcec, props: 0xbccbe0, label: 'Winter' },
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
  constructor(readonly rng: Rng) {}

  tick(now: number, day: number, realDt: number) {
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
    this.visible += (this.intensity - this.visible) * Math.min(1, realDt * 0.6);
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
    this.nextChangeAt = j.nextChangeAt;
    this.rng.state = j.rng;
  }
}

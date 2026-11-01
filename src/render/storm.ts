import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { ease, lot } from './lifeMotion';

/** How fast a storm comes on and goes, in seconds. */
const STORM_EASE = 1.1;
/** A flash's length in seconds, and how long its bolt shows. */
const FLASH_LENGTH = 0.38;
const BOLT_LENGTH = 0.16;
/** Seconds between two flashes: never closer than the first, up to the two together. */
const FLASH_GAP = 6.5;
const FLASH_SPREAD = 8;
/** A bolt's points, its height in screen px, and how far it wanders from side to side. */
const BOLT_POINTS = 9;
const BOLT_HEIGHT = 170;
const BOLT_WANDER = 36;

/** The time of flash `k` in seconds of storm: the same on every run. */
export function flashTime(k: number) {
  let t = 0;
  for (let i = 0; i < k; i++) t += FLASH_GAP + FLASH_SPREAD * lot(i, 77, 4242);
  return t;
}

/** The brightening `u` seconds into a flash: up in 0.06 s, then one fade, with no flicker. */
export function flashLevel(u: number) {
  if (u < 0 || u >= FLASH_LENGTH) return 0;
  return u < 0.06 ? u / 0.06 : (1 - (u - 0.06) / (FLASH_LENGTH - 0.06)) ** 2;
}

/** The overcast multiplied over the view at storm strength `k`, as 0xRRGGBB: darker, cooler. */
export function overcastColour(k: number) {
  const r = Math.round(255 - 52 * k),
    g = Math.round(255 - 40 * k),
    b = Math.round(255 - 24 * k);
  return (r << 16) | (g << 8) | b;
}

/** The flash added over the view at level `l`, as 0xRRGGBB. */
export function flashColour(l: number) {
  return (Math.round(44 * l) << 16) | (Math.round(50 * l) << 8) | Math.round(66 * l);
}

/** The points of bolt `k`, top to foot, in a view `w` x `h` screen px wide. */
export function boltPoints(k: number, w: number, h: number) {
  const scale = Math.max(0.35, Math.min(1, h / 640)),
    x = (0.1 + 0.8 * lot(k, 10, 703)) * w,
    y = (0.12 + 0.1 * lot(k, 11, 704)) * h + 60 + BOLT_HEIGHT * scale * 0.4,
    points: [number, number][] = [];
  for (let j = 0; j <= BOLT_POINTS; j++)
    points.push([
      x +
        (j === BOLT_POINTS
          ? 0
          : (lot(k, j, 705) - 0.5) * BOLT_WANDER * scale * (1 - (0.4 * j) / BOLT_POINTS)),
      y - BOLT_HEIGHT * scale * (1 - j / BOLT_POINTS),
    ]);
  return points;
}

/**
 * A storm over the whole view: a darker, cooler light, and now and then a far bolt with a gentle
 * brightening, at most once in several seconds. It is drawn over the world from the wind's level,
 * and asks for no setting. A player who asked for less motion gets the overcast and no lightning.
 */
export class Storm {
  /** multiplied over the world */
  readonly shade = new Sprite(Texture.WHITE);
  /** added over the world, with the bolt on it */
  readonly flash = new Container();
  private readonly light = new Sprite(Texture.WHITE);
  private readonly bolt = new Graphics();
  private readonly still =
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  private k = 0;
  /** seconds of storm so far, and the flash that comes next */
  private t = 0;
  private next = 0;
  private lit = -1;

  constructor() {
    this.shade.blendMode = 'multiply';
    this.shade.visible = false;
    this.light.blendMode = 'screen';
    this.flash.addChild(this.light, this.bolt);
    this.flash.visible = false;
  }

  /** `dt` seconds on (0 while paused); `storm` says the wind is at its stormy level. */
  update(dt: number, storm: boolean, w: number, h: number) {
    this.k = ease(this.k, storm ? 1 : 0, Math.min(dt, 0.2), STORM_EASE);
    if (!storm && this.k < 0.004) this.k = 0;
    const k = this.k;
    this.shade.visible = k > 0;
    this.flash.visible = false;
    if (!k) return;
    this.shade.setSize(w, h);
    this.shade.tint = overcastColour(k);
    if (this.still) return;
    this.t += dt;
    while (flashTime(this.next) <= this.t) {
      this.lit = this.next;
      this.next++;
    }
    if (this.lit < 0) return;
    const u = this.t - flashTime(this.lit),
      level = flashLevel(u) * k;
    if (level <= 0) return;
    this.flash.visible = true;
    this.light.setSize(w, h);
    this.light.tint = flashColour(level);
    this.bolt.clear();
    const a = 1 - u / BOLT_LENGTH;
    if (a <= 0) return;
    const points = boltPoints(this.lit, w, h).flat();
    this.bolt
      .poly(points, false)
      .stroke({ width: 4, color: 0xbed0ff, alpha: 0.16 * a })
      .poly(points, false)
      .stroke({ width: 1.3, color: 0xf6f9ff, alpha: 0.9 * a });
  }
}

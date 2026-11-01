import { Container, ImageSource, Sprite, Texture } from 'pixi.js';
import { depthKey, tileToWorld, worldToTile } from '../engine/iso';
import type { WindLevel, WindState } from '../sim/wind';
import { gustAt, lot } from './lifeMotion';

/** How close a lane may come to ground that is not open desert, in tiles. */
const LANE_CLEAR = 0.2;
/** Lanes across the wind are this far apart, and their ground is read this often, in tiles. */
const LANE_GAP = 0.45;
const LANE_STEP = 0.2;
/** A lane shorter than this, in tiles, is not worth rolling down. */
const LANE_MIN = 1.2;
/** Lanes are found again when the view has moved this many tiles, or the wind has turned. */
const LANE_MOVE = 4;
const LANE_TURN = 0.2;
/** The view is widened by this many tiles, so that a tumbleweed comes in from outside it. */
const LANE_REACH = 6;
const LANE_REACH_PX = 96;
/** How many tumbleweeds may be out at once, their tiles a second, and their rest between runs. */
const TUMBLE: Record<WindLevel, readonly [number, number, number]> = {
  calm: [0, 0, 0],
  breeze: [1, 0.5, 9],
  windy: [5, 0.95, 3],
  storm: [14, 1.5, 1.2],
};
/** How many streaks of sand drift at once. */
const SAND: Record<WindLevel, number> = { calm: 0, breeze: 12, windy: 30, storm: 56 };
/** A tumbleweed's picture: its radius in canvas px. */
const BALL_R = 20;
const BALLS = 3;
/** A streak's picture in canvas px. */
const STREAK_W = 96;
const STREAK_H = 16;

/** A straight run of open desert down the wind, in tile coordinates. */
export interface Lane {
  x: number;
  y: number;
  /** the wind's direction in tile space, unit length */
  ux: number;
  uy: number;
  length: number;
}

/** A rectangle of tiles. */
interface TileRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The runs of open desert down the wind in `rect`, parallel lines a little apart: `open` says
 * whether a point in tiles is desert with nothing standing on it, and a lane keeps `LANE_CLEAR` from
 * anything that is not.
 */
export function desertLanes(
  open: (x: number, y: number) => boolean,
  rect: TileRect,
  wind: { x: number; y: number },
): Lane[] {
  const clear = (x: number, y: number) =>
    open(x, y) &&
    open(x + LANE_CLEAR, y) &&
    open(x - LANE_CLEAR, y) &&
    open(x, y + LANE_CLEAR) &&
    open(x, y - LANE_CLEAR);
  const cx = (rect.x0 + rect.x1) / 2,
    cy = (rect.y0 + rect.y1) / 2,
    reach = Math.hypot(rect.x1 - rect.x0, rect.y1 - rect.y0) / 2,
    lanes: Lane[] = [];
  for (let c = -reach; c <= reach; c += LANE_GAP) {
    const ox = cx - wind.y * c,
      oy = cy + wind.x * c;
    let start = NaN,
      last = NaN;
    const finish = () => {
      if (last - start >= LANE_MIN)
        lanes.push({
          x: ox + wind.x * start,
          y: oy + wind.y * start,
          ux: wind.x,
          uy: wind.y,
          length: last - start,
        });
      start = last = NaN;
    };
    for (let s = -reach; s <= reach; s += LANE_STEP) {
      if (clear(ox + wind.x * s, oy + wind.y * s)) {
        if (Number.isNaN(start)) start = s;
        last = s;
      } else if (!Number.isNaN(start)) finish();
    }
    if (!Number.isNaN(start)) finish();
  }
  return lanes;
}

/** Where a tumbleweed is on its run. */
export interface Tumble {
  x: number;
  y: number;
  /** world px */
  radius: number;
  /** 0 where it enters and leaves the desert */
  alpha: number;
  /** world px above the ground */
  bounce: number;
  /** radians it has rolled */
  spin: number;
  variant: number;
}

/**
 * Tumbleweed `j` at time `t`, or null while it rests: each picks a lane for each run and rolls down
 * it, bouncing more in a harder wind and a gust, fading in and out at the lane's ends.
 */
export function tumbleAt(
  lanes: readonly Lane[],
  j: number,
  level: WindLevel,
  strength: number,
  gust: number,
  t: number,
): Tumble | null {
  const [count, speed, rest] = TUMBLE[level];
  if (j >= count || !lanes.length) return null;
  const longest = Math.max(...lanes.map((l) => l.length)),
    v = speed * (0.75 + 0.5 * lot(j, 7, 480)),
    period = longest / v + rest * (0.6 + 0.8 * lot(j, 8, 480)),
    time = t + period * lot(j, 9, 480),
    run = Math.floor(time / period),
    d = (time - run * period) * v,
    lane = lanes[Math.floor(lot(j, run, 481) * lanes.length)];
  if (d > lane.length) return null;
  const edge = Math.min(1, Math.min(d, lane.length - d) / 0.35),
    fade = edge * edge * (3 - 2 * edge),
    radius = (3.3 + 1.5 * lot(j, run, 482)) * (0.8 + 0.2 * fade),
    hop = 0.55 + 0.5 * lot(j, run, 483);
  return {
    x: lane.x + lane.ux * d,
    y: lane.y + lane.uy * d,
    radius,
    alpha: fade,
    bounce:
      (1.2 + 3.2 * strength * (0.4 + 0.6 * gust)) *
      Math.abs(Math.sin((Math.PI * d) / hop + lot(j, run, 484) * 3)),
    spin: (d * 45) / radius,
    variant: (j + run) % BALLS,
  };
}

/** An airy ball of dry twigs, a denser tangle in its middle that the ground shows through. */
function ballCanvas(variant: number) {
  const size = 2 * BALL_R + 8,
    o = size / 2,
    c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!,
    h = (q: number, k: number) => lot(variant * 97 + q, k, 490),
    middle = g.createRadialGradient(o, o, 0, o, o, BALL_R * 0.82);
  middle.addColorStop(0, 'rgba(104,80,52,0.62)');
  middle.addColorStop(0.65, 'rgba(120,94,62,0.36)');
  middle.addColorStop(1, 'rgba(120,94,62,0)');
  g.fillStyle = middle;
  g.beginPath();
  g.arc(o, o, BALL_R * 0.82, 0, 6.2832);
  g.fill();
  g.lineCap = 'round';
  for (let q = 0; q < 64; q++) {
    const a = h(q, 1) * 6.2832,
      d = BALL_R * 0.5 * Math.sqrt(h(q, 2)),
      from = h(q, 4) * 6.2832,
      tone = h(q, 6);
    g.strokeStyle =
      tone < 0.3 ? 'rgb(106,82,54)' : tone < 0.78 ? 'rgb(158,130,90)' : 'rgb(192,168,124)';
    g.lineWidth = 1.3 + 1.3 * h(q, 7);
    g.beginPath();
    g.arc(
      o + Math.cos(a) * d,
      o + Math.sin(a) * d,
      BALL_R * (0.3 + 0.45 * h(q, 3)),
      from,
      from + 0.6 + 1.2 * h(q, 5),
    );
    g.stroke();
  }
  return c;
}

/** The light on a ball, which does not turn with it: upper left, dark to the lower right. */
function lightCanvas() {
  const size = 2 * BALL_R + 8,
    o = size / 2,
    c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!,
    light = g.createRadialGradient(o - 8, o - 9, 0, o - 8, o - 9, BALL_R * 1.7);
  light.addColorStop(0, 'rgba(244,228,186,0.4)');
  light.addColorStop(0.35, 'rgba(244,228,186,0.06)');
  light.addColorStop(0.55, 'rgba(58,44,30,0)');
  light.addColorStop(0.9, 'rgba(58,44,30,0.42)');
  g.fillStyle = light;
  g.beginPath();
  g.arc(o, o, BALL_R * 0.9, 0, 6.2832);
  g.fill();
  return c;
}

/** A soft ground shadow. */
function shadowCanvas() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 16;
  const g = c.getContext('2d')!,
    dark = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  dark.addColorStop(0, 'rgba(26,30,33,1)');
  dark.addColorStop(1, 'rgba(26,30,33,0)');
  g.setTransform(1, 0, 0, 0.5, 0, 0);
  g.fillStyle = dark;
  g.fillRect(0, 0, 32, 32);
  return c;
}

/** A wisp of pale sand with feathered ends, a fainter strand under it. */
function streakCanvas(variant: number) {
  const c = document.createElement('canvas');
  c.width = STREAK_W;
  c.height = STREAK_H;
  const g = c.getContext('2d')!,
    image = g.createImageData(STREAK_W, STREAK_H),
    d = image.data,
    ph = lot(variant, 1, 498) * 6.2832;
  for (let i = 0; i < STREAK_W; i++) {
    const u = (i + 0.5) / STREAK_W,
      env = Math.pow(Math.sin(Math.PI * u), 0.9),
      c1 = 8 + 1.8 * Math.sin(2 * Math.PI * u * (0.8 + 0.6 * lot(variant, 3, 498)) + ph) - 1.2 * u,
      w1 = 0.9 + 1.5 * Math.sin(Math.PI * u),
      c2 = c1 + 3.3,
      w2 = 0.6 + 0.7 * Math.sin(Math.PI * u);
    for (let j = 0; j < STREAK_H; j++) {
      const y1 = (j + 0.5 - c1) / w1,
        y2 = (j + 0.5 - c2) / w2,
        a = Math.min(1, Math.exp(-y1 * y1) + 0.42 * Math.exp(-y2 * y2)) * env,
        p = (j * STREAK_W + i) * 4;
      d[p] = 244;
      d[p + 1] = 230;
      d[p + 2] = 192;
      d[p + 3] = Math.round(255 * a);
    }
  }
  g.putImageData(image, 0, 0);
  return c;
}

const textureOf = (resource: HTMLCanvasElement) =>
  new Texture({
    source: new ImageSource({ resource, scaleMode: 'linear', autoGenerateMipmaps: true }),
  });

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Weed {
  shadow: Sprite;
  ball: Sprite;
  light: Sprite;
}

/**
 * The wind in the desert (#516): tumbleweeds rolling down the open sand, and streaks of sand
 * drifting in the gusts. Nothing is drawn in a calm, away from a desert, or for a player who asked
 * for less motion.
 */
export class DesertWind {
  private readonly still =
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  private lanes: Lane[] = [];
  private found: { x: number; y: number; from: number } | null = null;
  private weeds: Weed[] = [];
  private streaks: Sprite[] = [];
  private pictures: { balls: Texture[]; light: Texture; shadow: Texture; sand: Texture[] } | null =
    null;
  private t = 0;

  constructor(
    private readonly layer: Container,
    /** a point in tiles is open desert: sand of the desert, with nothing standing on it */
    private readonly open: (x: number, y: number) => boolean,
    /** where a tile's ground is, in world px */
    private readonly surface: (x: number, y: number) => { x: number; y: number },
  ) {}

  /** Something was built or cleared: the lanes are found again. */
  invalidate() {
    this.found = null;
  }

  private art() {
    return (this.pictures ??= {
      balls: Array.from({ length: BALLS }, (_, i) => textureOf(ballCanvas(i))),
      light: textureOf(lightCanvas()),
      shadow: textureOf(shadowCanvas()),
      sand: Array.from({ length: BALLS }, (_, i) => textureOf(streakCanvas(i))),
    });
  }

  private findLanes(wind: WindState, view: View) {
    const c = worldToTile(view.x + view.w / 2, view.y + view.h / 2),
      f = this.found;
    if (
      f &&
      Math.hypot(f.x - c.x, f.y - c.y) < LANE_MOVE &&
      Math.abs(f.from - wind.fromRad) < LANE_TURN
    )
      return;
    const a = worldToTile(view.x, view.y),
      b = worldToTile(view.x + view.w, view.y + view.h),
      r = worldToTile(view.x + view.w, view.y),
      l = worldToTile(view.x, view.y + view.h),
      xs = [a.x, b.x, r.x, l.x],
      ys = [a.y, b.y, r.y, l.y];
    // what the wind does is only ever seen, so the lanes keep to the view and a little round it
    const seen = (x: number, y: number) => {
      const p = tileToWorld(x, y);
      return (
        p.x > view.x - LANE_REACH_PX &&
        p.x < view.x + view.w + LANE_REACH_PX &&
        p.y > view.y - LANE_REACH_PX &&
        p.y < view.y + view.h + LANE_REACH_PX &&
        this.open(x, y)
      );
    };
    this.lanes = desertLanes(
      seen,
      {
        x0: Math.min(...xs) - LANE_REACH,
        y0: Math.min(...ys) - LANE_REACH,
        x1: Math.max(...xs) + LANE_REACH,
        y1: Math.max(...ys) + LANE_REACH,
      },
      wind.tile,
    );
    this.found = { x: c.x, y: c.y, from: wind.fromRad };
  }

  private weed(j: number, art: NonNullable<DesertWind['pictures']>) {
    let weed = this.weeds[j];
    if (!weed) {
      weed = {
        shadow: new Sprite(art.shadow),
        ball: new Sprite(art.balls[0]),
        light: new Sprite(art.light),
      };
      for (const s of [weed.shadow, weed.ball, weed.light]) {
        s.anchor.set(0.5);
        this.layer.addChild(s);
      }
      this.weeds[j] = weed;
    }
    return weed;
  }

  /** Move it all `dt` seconds on (0 while the game is paused), `view` in world px. */
  update(dt: number, wind: WindState, view: View) {
    if (this.still) return;
    this.t += dt;
    const { strength: s, level, dir } = wind,
      t = this.t;
    if (s <= 0 || view.w > 6000) return this.hide(0, 0);
    this.findLanes(wind, view);
    if (!this.lanes.length) return this.hide(0, 0);
    const art = this.art(),
      count = TUMBLE[level][0];
    for (let j = 0; j < count; j++) {
      const lane = this.lanes[0],
        gust = gustAt(s, dir, lane.x * 32, lane.y * 16, t + j),
        w = tumbleAt(this.lanes, j, level, s, gust, t),
        weed = this.weed(j, art);
      for (const part of [weed.shadow, weed.ball, weed.light]) part.visible = !!w;
      if (!w) continue;
      const ground = this.surface(Math.round(w.x), Math.round(w.y)),
        centre = tileToWorld(Math.round(w.x), Math.round(w.y)),
        p = tileToWorld(w.x, w.y),
        x = p.x + ground.x - centre.x,
        y = p.y + ground.y - centre.y,
        z = depthKey(w.x, w.y, 15),
        lift = Math.max(0.35, 1 - w.bounce / 7),
        size = (w.radius * 2) / (2 * BALL_R + 8);
      weed.shadow.position.set(x + 0.6, y + 0.2);
      weed.shadow.scale.set((w.radius * 2.1 * lift) / 32);
      weed.shadow.alpha = 0.26 * w.alpha * lift;
      weed.shadow.zIndex = z - 0.02;
      weed.ball.texture = art.balls[w.variant];
      weed.ball.rotation = dir.x < 0 ? -w.spin : w.spin;
      for (const part of [weed.ball, weed.light]) {
        part.position.set(x, y - w.bounce - w.radius * 0.95);
        part.scale.set(size);
        part.alpha = w.alpha;
      }
      weed.ball.zIndex = z;
      weed.light.zIndex = z + 0.01;
    }
    const sand = SAND[level],
      angle = Math.atan2(dir.y, dir.x);
    for (let j = 0; j < sand; j++) {
      const life = 1.1 + 1.1 * lot(j, 1, 495),
        time = t + life * lot(j, 2, 495),
        run = Math.floor(time / life),
        tau = (time - run * life) / life,
        lane = this.lanes[Math.floor(lot(j, run, 496) * this.lanes.length)],
        travel = life * (0.5 + 1.3 * s) * (0.8 + 0.4 * lot(j, 3, 495)),
        along =
          (lane.length > travel ? lot(j, run, 497) * (lane.length - travel) : 0) + tau * travel,
        tx = lane.x + lane.ux * Math.min(along, lane.length),
        ty = lane.y + lane.uy * Math.min(along, lane.length),
        p = tileToWorld(tx, ty),
        gust = gustAt(s, dir, p.x, p.y, t),
        alpha = (0.22 + 0.42 * s) * (0.25 + 0.75 * gust) * Math.sin(Math.PI * tau);
      let streak = this.streaks[j];
      if (!streak) {
        streak = new Sprite(art.sand[j % art.sand.length]);
        streak.anchor.set(0.5);
        this.layer.addChild(streak);
        this.streaks[j] = streak;
      }
      streak.visible = alpha >= 0.008;
      if (!streak.visible) continue;
      const ground = this.surface(Math.round(tx), Math.round(ty)),
        centre = tileToWorld(Math.round(tx), Math.round(ty)),
        length = (18 + 36 * s) * (0.6 + 0.6 * lot(j, run, 499)) * (0.75 + 0.5 * tau);
      streak.position.set(p.x + ground.x - centre.x, p.y + ground.y - centre.y - 0.8);
      streak.rotation = angle;
      streak.scale.set(length / STREAK_W, (2 + 2.6 * s * lot(j, run, 500)) / 5);
      streak.alpha = alpha;
      streak.zIndex = depthKey(tx, ty, 3);
    }
    this.hide(count, sand);
  }

  /** Hide the tumbleweeds from `weeds` on and the streaks from `streaks` on. */
  private hide(weeds: number, streaks: number) {
    for (let j = weeds; j < this.weeds.length; j++) {
      const w = this.weeds[j];
      w.shadow.visible = w.ball.visible = w.light.visible = false;
    }
    for (let j = streaks; j < this.streaks.length; j++) this.streaks[j].visible = false;
  }
}

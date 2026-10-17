import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import {
  ARMS,
  CANVAS,
  CENTRE_X,
  FADE,
  HEIGHT,
  HIP_LINE,
  IDENTITY_CANVAS,
  IDENTITY_SHRINK,
  POSES,
  ROOT,
  SOLE_ROW,
  STEP,
  VIEWS,
  allGuides,
  bestFrame,
  camera,
  drawGuideFor,
  guideName,
  identityCrop,
  manifestOf,
  rowsOf,
} from './people-guides.mjs';

const sha = (png) => createHash('sha256').update(png.data).digest('hex');
const alpha = (png, x, y) => png.data[(y * png.width + x) * 4 + 3];

let guides;
let byName;
beforeAll(() => {
  guides = allGuides();
  byName = new Map(guides.map((g) => [g.name, g]));
}, 120000);

/** The body-space f of a foot's ground contact: the heel at stage 1 and 2, the toe at stage 2 and 3. */
const contact = (g, side, point) => g.joints[`${side}${point}`][0];

describe('people pose guides', () => {
  it('has the 32 guides: 2 views, 4 arm variants, 4 poses', () => {
    expect(guides).toHaveLength(VIEWS.length * ARMS.length * POSES.length);
    expect(new Set(guides.map((g) => g.name)).size).toBe(32);
  });

  it('draws each on the 1024 x 1536 canvas, transparent, with the lowest sole on row 1440', () => {
    for (const g of guides) {
      expect([g.png.width, g.png.height]).toEqual(CANVAS);
      for (const [x, y] of [
        [0, 0],
        [CANVAS[0] - 1, 0],
        [0, CANVAS[1] - 1],
        [CANVAS[0] - 1, CANVAS[1] - 1],
      ])
        expect(alpha(g.png, x, y)).toBe(0);
      expect(Math.abs(rowsOf(g.png).bottom - SOLE_ROW), g.name).toBeLessThanOrEqual(1);
    }
  });

  it('is 960 px from the ground point to the top of the head, in every pose', () => {
    for (const g of guides) {
      expect(g.groundPoint[0]).toBe(CENTRE_X);
      expect(Math.abs(g.groundPoint[1] - g.headTop - HEIGHT), g.name).toBeLessThanOrEqual(3);
      // the figure's own top is the head, unless a carried yoke reaches higher
      if (g.arm !== 'yoke')
        expect(Math.abs(rowsOf(g.png).top - g.headTop), g.name).toBeLessThanOrEqual(3);
    }
  });

  it('is projected by the game camera: a 2:1 ground, 30 degrees down', () => {
    for (const view of VIEWS) {
      const cam = camera(view);
      const o = cam.to([0, 0, 0]);
      const f = cam.to([1, 0, 0]),
        r = cam.to([0, 1, 0]),
        u = cam.to([0, 0, 1]);
      // along the walking direction and across it the ground runs at a slope of one half
      expect(Math.abs(f[1] - o[1]) / Math.abs(f[0] - o[0])).toBeCloseTo(0.5, 6);
      expect(Math.abs(r[1] - o[1]) / Math.abs(r[0] - o[0])).toBeCloseTo(0.5, 6);
      // a height of 1 is the figure's 960 px, straight up
      expect(u[0] - o[0]).toBeCloseTo(0, 6);
      expect(o[1] - u[1]).toBeCloseTo(HEIGHT, 6);
    }
    // back walks up and to the right, front down and to the right
    const o = camera('back').to([0, 0, 0]);
    expect(camera('back').to([1, 0, 0])[0]).toBeGreaterThan(o[0]);
    expect(camera('back').to([1, 0, 0])[1]).toBeLessThan(o[1]);
    expect(camera('front').to([1, 0, 0])[0]).toBeGreaterThan(o[0]);
    expect(camera('front').to([1, 0, 0])[1]).toBeGreaterThan(o[1]);
  });

  it('slides the planted foot back STEP of the height per pose, so the feet do not skate', () => {
    const at = (view, arm, pose) => byName.get(guideName(view, arm, pose));
    for (const view of VIEWS) {
      const unit = (() => {
        const cam = camera(view);
        const o = cam.to([0, 0, 0]),
          f = cam.to([1, 0, 0]);
        return [f[0] - o[0], f[1] - o[1]];
      })();
      // the right foot: heel at poses 1 and 2, toe at 2 and 3; the left: heel 3 and 4, toe 4 and 1
      const runs = [
        ['right', 'Heel', 1, 2],
        ['right', 'Toe', 2, 3],
        ['left', 'Heel', 3, 4],
        ['left', 'Toe', 4, 1],
      ];
      for (const [side, point, from, to] of runs) {
        const a = at(view, 'swing', from),
          b = at(view, 'swing', to);
        const slide = contact(a, side, point) - contact(b, side, point);
        expect(Math.abs(slide - STEP), `${view} ${side} ${point}`).toBeLessThanOrEqual(0.01);
        // and on the canvas: the foot moves back along the walking direction against the body
        const pa = a.screen[`${side}${point}`],
          pb = b.screen[`${side}${point}`];
        const dx = pa[0] - a.groundPoint[0] - (pb[0] - b.groundPoint[0]);
        const dy = pa[1] - a.groundPoint[1] - (pb[1] - b.groundPoint[1]);
        expect(Math.abs(dx - STEP * unit[0]), `${view} ${side} x`).toBeLessThanOrEqual(1.5);
        expect(Math.abs(dy - STEP * unit[1]), `${view} ${side} y`).toBeLessThanOrEqual(1.5);
      }
    }
  });

  it('puts the soles on the ground: planted feet touch it, the swing foot is clear by about 5%', () => {
    for (const g of guides.filter((x) => x.arm === 'swing')) {
      for (const side of ['right', 'left']) {
        const stage = g.joints[`${side}Stage`];
        const heel = g.joints[`${side}Heel`][2],
          toe = g.joints[`${side}Toe`][2];
        if (stage === 1) expect(heel).toBeCloseTo(0, 6);
        if (stage === 1) expect(toe).toBeGreaterThan(0.02); // toe up
        if (stage === 2) expect([heel, toe]).toEqual([expect.closeTo(0, 6), expect.closeTo(0, 6)]);
        if (stage === 3) expect(toe).toBeCloseTo(0, 6);
        if (stage === 3) expect(heel).toBeGreaterThan(0.04); // heel lifted
        if (stage === 4) expect(Math.min(heel, toe)).toBeGreaterThan(0.04);
        if (stage === 4) expect(Math.min(heel, toe)).toBeLessThan(0.06);
      }
    }
  });

  it('is a walk: contact has the leading foot ahead and arms against the legs, passing has the knee bent', () => {
    for (const view of VIEWS) {
      const p = (n) => byName.get(guideName(view, 'swing', n));
      // pelvis 1% of the height lower at contact than at passing
      expect(p(2).joints.pelvis[2] - p(1).joints.pelvis[2]).toBeCloseTo(0.01, 6);
      expect(p(4).joints.pelvis[2] - p(3).joints.pelvis[2]).toBeCloseTo(0.01, 6);
      // P1 right foot leads, P3 left foot leads; the arm opposite the lead foot swings forward
      expect(p(1).joints.rightAnkle[0]).toBeGreaterThan(p(1).joints.leftAnkle[0] + 0.1);
      expect(p(3).joints.leftAnkle[0]).toBeGreaterThan(p(3).joints.rightAnkle[0] + 0.1);
      expect(p(1).joints.leftHand[0]).toBeGreaterThan(p(1).joints.rightHand[0]);
      expect(p(3).joints.rightHand[0]).toBeGreaterThan(p(3).joints.leftHand[0]);
      // passing: the planted leg stands straight up, the swing leg's knee is bent about 55 degrees
      for (const [n, stance, swing] of [
        [2, 'right', 'left'],
        [4, 'left', 'right'],
      ]) {
        const j = p(n).joints;
        expect(Math.abs(j[`${stance}Ankle`][0] - j[`${stance}Hip`][0])).toBeLessThan(0.005);
        const hip = j[`${swing}Hip`],
          knee = j[`${swing}Knee`],
          ankle = j[`${swing}Ankle`];
        const a = [hip[0] - knee[0], hip[2] - knee[2]],
          b = [ankle[0] - knee[0], ankle[2] - knee[2]];
        const cos = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b));
        const bend = 180 - (Math.acos(cos) * 180) / Math.PI;
        expect(Math.abs(bend - 55)).toBeLessThan(3);
      }
    }
  });

  it('differs between the two contact poses in the lowest 40% by an overlap under 0.45', () => {
    // R7b's repeat test: alpha above 128, the lowest 40% of the figure, columns and soles aligned
    const mask = (png) => {
      const rows = rowsOf(png);
      const top = Math.ceil(rows.bottom + 1 - HEIGHT * 0.4);
      const set = new Set();
      for (let y = top; y <= rows.bottom; y++)
        for (let x = 0; x < png.width; x++)
          if (alpha(png, x, y) > 128) set.add((rows.bottom - y) * png.width + x);
      return set;
    };
    const iou = (a, b) => {
      let inter = 0;
      for (const k of a) if (b.has(k)) inter++;
      return inter / (a.size + b.size - inter);
    };
    for (const view of VIEWS)
      for (const arm of ARMS) {
        const a = byName.get(guideName(view, arm, 1)),
          b = byName.get(guideName(view, arm, 3));
        expect(iou(mask(a.png), mask(b.png)), `${view} ${arm}`).toBeLessThan(0.45);
        const c = byName.get(guideName(view, arm, 2)),
          d = byName.get(guideName(view, arm, 4));
        // the passing poses are each other's mirror in the legs (stance foot, swing foot), so
        // they overlap more; they must still not be one picture twice
        expect(iou(mask(c.png), mask(d.png)), `${view} ${arm} passing`).toBeLessThan(0.7);
      }
  });

  it('mirrors into the walk the other way: the up-left guide is the pixel mirror', () => {
    for (const [view, arm, pose] of [
      ['back', 'swing', 1],
      ['front', 'yoke', 3],
    ]) {
      const a = byName.get(guideName(view, arm, pose)).png;
      const b = drawGuideFor(view, arm, pose, { mirror: true }).png;
      let differ = 0;
      for (let y = 0; y < a.height; y++)
        for (let x = 0; x < a.width; x++) {
          const o = (y * a.width + x) * 4,
            m = (y * a.width + (a.width - 1 - x)) * 4;
          for (let c = 0; c < 4; c++) if (a.data[o + c] !== b.data[m + c]) differ++;
        }
      // rays are cast one way and the other: allow a pixel of rounding here and there
      expect(differ / (a.width * a.height * 4)).toBeLessThan(0.0005);
    }
  }, 120000);

  it('is deterministic: the same pictures twice, and the committed ones are these', () => {
    for (const [view, arm, pose] of [
      ['back', 'block', 2],
      ['front', 'shoulder', 4],
    ])
      expect(sha(drawGuideFor(view, arm, pose).png)).toBe(
        sha(byName.get(guideName(view, arm, pose)).png),
      );
    if (!existsSync(join(ROOT, 'manifest.json'))) return;
    for (const g of guides) {
      const committed = PNG.sync.read(readFileSync(join(ROOT, `${g.name}.png`)));
      expect(sha(committed), g.name).toBe(sha(g.png));
    }
    expect(JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'))).toEqual(
      JSON.parse(JSON.stringify(manifestOf(guides))),
    );
  }, 120000);
});

describe('people identity crops', () => {
  const strip = (frames) => {
    // four columns of 100 x 512: a body above the hip line and legs below it, frame by frame
    const png = new PNG({ width: 400, height: 512 });
    frames.forEach((spec, f) => {
      for (let y = 121; y < 480; y++)
        for (let x = 0; x < 100; x++) {
          const inBody = y < 300 && x >= spec.x0 && x < spec.x1;
          const inLegs = y >= 300 && x >= 35 && x < 65;
          if (!inBody && !inLegs) continue;
          png.data.set([200, 90, 40, 255], (y * 400 + f * 100 + x) * 4);
        }
    });
    return png;
  };

  // the guides' layout at 1 / IDENTITY_SHRINK
  const s = IDENTITY_SHRINK;
  const hipRow = SOLE_ROW / s - (HIP_LINE * HEIGHT) / s;
  const goneRow = Math.ceil(hipRow + (FADE * HEIGHT) / s);

  it('takes the legs away below the hip line and keeps the upper body on the guides layout', () => {
    const crop = identityCrop(strip([{ x0: 20, x1: 80 }]), 0);
    expect([crop.width, crop.height]).toEqual(IDENTITY_CANVAS);
    expect(IDENTITY_CANVAS).toEqual(CANVAS.map((n) => n / s));
    for (let y = goneRow; y < crop.height; y++)
      for (let x = 0; x < crop.width; x++) expect(alpha(crop, x, y)).toBe(0);
    // above the fade the body is opaque, centred on the pelvis column
    const mid = Math.floor(hipRow + (0.5 * FADE * HEIGHT) / s);
    expect(alpha(crop, CENTRE_X / s, Math.floor(hipRow - 50))).toBe(255);
    expect(alpha(crop, CENTRE_X / s, mid)).toBeGreaterThan(0);
    expect(alpha(crop, CENTRE_X / s, mid)).toBeLessThan(255);
    // the 360 px figure is drawn 960 / 2 px tall, so its head is where the guides' heads are
    expect(Math.abs(rowsOf(crop).top - (SOLE_ROW - HEIGHT) / s)).toBeLessThanOrEqual(3);
  });

  it('picks the frame whose upper body is the most typical of the four', () => {
    const plain = { x0: 20, x1: 80 };
    expect(bestFrame(strip([{ x0: 5, x1: 95 }, plain, plain, { x0: 30, x1: 70 }]))).not.toBe(0);
    expect(bestFrame(strip([plain, plain, { x0: 5, x1: 95 }, plain]))).not.toBe(2);
  });

  it('is committed for all 28 strips, with no leg left', () => {
    const dir = join(ROOT, 'identity');
    if (!existsSync(dir)) return;
    const info = JSON.parse(readFileSync(join(dir, 'identity.json'), 'utf8'));
    expect(info.crops).toHaveLength(28);
    const files = readdirSync(dir).filter((f) => f.endsWith('-upper.png'));
    expect(files).toHaveLength(28);
    expect(info.canvas).toEqual(IDENTITY_CANVAS);
    for (const c of info.crops) {
      expect(c.strip).toMatch(/^[a-z0-9-]+-(front|back)-(walk|carry)$/);
      expect(c.frame).toBeGreaterThanOrEqual(0);
      expect(c.frame).toBeLessThanOrEqual(3);
      const png = PNG.sync.read(readFileSync(join(dir, `${c.strip}-upper.png`)));
      expect([png.width, png.height]).toEqual(IDENTITY_CANVAS);
      expect(rowsOf(png).bottom).toBeLessThan(goneRow);
    }
    // the folder stays small: the two folders together are under 6 MB
    const size = (d) =>
      readdirSync(d, { withFileTypes: true }).reduce(
        (n, e) => n + (e.isDirectory() ? size(join(d, e.name)) : statSync(join(d, e.name)).size),
        0,
      );
    expect(size(ROOT)).toBeLessThan(5 * 1024 * 1024);
  });
});

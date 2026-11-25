import { describe, expect, it } from 'vitest';
import { FOLLOW_RATE, FollowCamera, closeOn, type CameraEvent, type Point } from './followCamera';

const AT: Point = { x: 500, y: -300 };
const follower = (id = 7) => {
  const f = new FollowCamera();
  f.start(id);
  return f;
};

describe('what ends the following', () => {
  it.each<[CameraEvent]>([['pan'], ['alert'], ['overview'], ['jump'], ['tool']])(
    '%s ends it',
    (event) => {
      const f = follower();
      f.note(event);
      expect(f.trainId).toBeNull();
    },
  );

  it('a zoom does not', () => {
    const f = follower();
    f.note('zoom');
    expect(f.trainId).toBe(7);
  });

  it('a train that is gone ends it, and the camera stays where it is', () => {
    const f = follower();
    expect(f.step({ x: 0, y: 0 }, () => undefined, 0.016)).toBeNull();
    expect(f.trainId).toBeNull();
  });

  it('a train not on the map yet leaves the camera and goes on being followed', () => {
    const f = follower();
    expect(f.step({ x: 0, y: 0 }, () => null, 0.016)).toBeNull();
    expect(f.trainId).toBe(7);
  });

  it('after it ended nothing moves the camera', () => {
    const f = follower();
    f.note('pan');
    expect(f.step({ x: 0, y: 0 }, () => AT, 0.016)).toBeNull();
  });
});

describe('the eye button', () => {
  it('turns it off and on', () => {
    const f = follower();
    f.toggle(7);
    expect(f.trainId).toBeNull();
    f.toggle(7);
    expect(f.trainId).toBe(7);
  });

  it('on another train moves it there', () => {
    const f = follower();
    f.toggle(9);
    expect(f.trainId).toBe(9);
  });

  it('asks for the train it follows', () => {
    const f = follower();
    const asked: number[] = [];
    f.step(
      { x: 0, y: 0 },
      (id) => {
        asked.push(id);
        return AT;
      },
      0.016,
    );
    expect(asked).toEqual([7]);
  });
});

describe('the camera closing on the train', () => {
  it('moves towards it and never past it', () => {
    let c: Point = { x: 0, y: 0 };
    for (let i = 0; i < 20; i++) {
      const next = closeOn(c, AT, 0.05);
      expect(next.x).toBeGreaterThan(c.x);
      expect(next.x).toBeLessThanOrEqual(AT.x);
      expect(next.y).toBeLessThan(c.y);
      expect(next.y).toBeGreaterThanOrEqual(AT.y);
      c = next;
    }
  });

  it('stands on it once it is near', () => {
    expect(closeOn({ x: AT.x + 0.2, y: AT.y - 0.2 }, AT, 0.016)).toEqual(AT);
  });

  it('covers the same ground at any frame rate', () => {
    const run = (frames: number) => {
      let c: Point = { x: 0, y: 0 };
      for (let i = 0; i < frames; i++) c = closeOn(c, AT, 1 / frames);
      return c;
    };
    expect(run(144).x).toBeCloseTo(run(30).x, 6);
    expect(run(30).x).toBeCloseTo(AT.x * (1 - Math.exp(-FOLLOW_RATE)), 6);
  });

  it('a long frame does not overshoot', () => {
    expect(closeOn({ x: 0, y: 0 }, AT, 10).x).toBeLessThanOrEqual(AT.x);
  });
});

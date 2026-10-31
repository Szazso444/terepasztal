import { describe, expect, it } from 'vitest';
import { FACINGS } from '../sim/body';
import { rarityClass } from './rarityClass';
import {
  DRAG_PX_PER_FACING,
  FACING_COUNT,
  FACING_DEGREES,
  facingDegrees,
  framesToForget,
  nextFacing,
  turnedBy,
} from './inspectView';

describe('the headings of Inspect 3D', () => {
  it('are the ones the game draws, 7.5 degrees apart', () => {
    expect(FACING_COUNT).toBe(FACINGS);
    expect(FACING_DEGREES).toBe(7.5);
    expect(facingDegrees(24)).toBe(180);
  });

  it('turn round the circle and come back to the first', () => {
    expect(nextFacing(0)).toBe(1);
    expect(nextFacing(FACING_COUNT - 1)).toBe(0);
    let at = 0;
    for (let i = 0; i < FACING_COUNT; i++) at = nextFacing(at);
    expect(at).toBe(0);
  });

  it('turn by a drag, towards zero, a heading for every eight pixels', () => {
    expect(turnedBy(DRAG_PX_PER_FACING)).toBe(1);
    expect(turnedBy(DRAG_PX_PER_FACING - 1)).toBe(0);
    expect(turnedBy(-17)).toBe(-2);
    expect(turnedBy(0)).toBe(0);
  });
});

describe('a rarity as the kit names it', () => {
  it('maps the models and the contracts onto the one scale of five', () => {
    expect(['N', 'R', 'SR', 'SSR', 'L'].map(rarityClass)).toEqual([
      'common',
      'uncommon',
      'rare',
      'epic',
      'legendary',
    ]);
    expect(['common', 'uncommon', 'rare', 'epic', 'legendary'].map(rarityClass)).toEqual([
      'common',
      'uncommon',
      'rare',
      'epic',
      'legendary',
    ]);
  });

  it('is common for anything else', () => {
    expect(rarityClass('')).toBe('common');
    expect(rarityClass('SSS')).toBe('common');
  });
});

describe('the frames Inspect 3D lets go of', () => {
  const keys = [
    'vehicle/mav490_f0@3',
    'vehicle/mav490_f47@3',
    'vehicle/mav490_f0@1',
    'vehicle/mav490b_f0@3',
    'vehicle/rocket_f0@3',
    'icons/coal@3',
  ];

  it('are every heading of that model at that scale', () => {
    expect(framesToForget(keys, 'mav490', 3)).toEqual([
      'vehicle/mav490_f0@3',
      'vehicle/mav490_f47@3',
    ]);
  });

  it('leave a thumbnail, a model with a longer name, another model and an icon', () => {
    const gone = framesToForget(keys, 'mav490', 3);
    for (const k of [
      'vehicle/mav490_f0@1',
      'vehicle/mav490b_f0@3',
      'vehicle/rocket_f0@3',
      'icons/coal@3',
    ])
      expect(gone).not.toContain(k);
  });

  it('are none for a model that was not drawn', () => {
    expect(framesToForget(keys, 'bigboy', 3)).toEqual([]);
    expect(framesToForget([], 'mav490', 3)).toEqual([]);
  });
});

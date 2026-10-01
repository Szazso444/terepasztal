import { expect, it } from 'vitest';
import atlas from '../../public/assets/structures.json';
import {
  DOOR_FRACTION,
  HUMAN_HEIGHT_PX,
  HUMAN_HEIGHT_M,
  DOOR_HEIGHT_M,
  structureScale,
  hasScaleReference,
} from './assetScale';

it('keeps a common human-relative door height across packed building levels', () => {
  let checked = 0;
  for (const [key, frame] of Object.entries(atlas.frames) as [string, { h: number }][]) {
    const family = key.replace('structures/', '').replace(/(_lv\d+|_s\d+|_\d+)$/, '');
    if (!DOOR_FRACTION[family]) continue;
    const height = frame.h / atlas.resolution;
    const door = height * DOOR_FRACTION[family] * structureScale(key, height);
    expect(door / HUMAN_HEIGHT_PX).toBeCloseTo(DOOR_HEIGHT_M / HUMAN_HEIGHT_M, 5);
    checked++;
  }
  expect(checked).toBeGreaterThan(20);
});

it('requires an explicit calibration or declared estimate for every illustrated structure', () => {
  for (const key of Object.keys(atlas.frames)) expect(hasScaleReference(key), key).toBe(true);
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TOAST_FLOOR } from './buildBar';

/** The rule of `selector` in `style.css`: its first block, as written. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('\n}', at));
}

describe("the player's saved layout (lwn17qbj)", () => {
  const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
  const minimap = readFileSync(new URL('./minimap.ts', import.meta.url), 'utf8');
  const px = (block: string, prop: string) =>
    Number(new RegExp(`\\b${prop}: (-?\\d+)px`).exec(block)?.[1]);

  it('keeps the survey map bottom right at 448 by 252, its canvas drawn at the size it shows', () => {
    const box = rule(css, '#minimap');
    expect([px(box, 'right'), px(box, 'bottom'), px(box, 'width'), px(box, 'height')]).toEqual([
      8, 8, 448, 252,
    ]);
    const canvas = rule(css, '#minimap canvas');
    expect(minimap).toContain(`const W = ${px(canvas, 'width')};`);
    expect(minimap).toContain(`const H = ${px(canvas, 'height')};`);
  });

  it('ends the outliner over the survey map and the build bar short of it', () => {
    const map = rule(css, '#minimap');
    const outliner = rule(css, '#outliner');
    expect(px(outliner, 'bottom')).toBeGreaterThan(px(map, 'bottom') + px(map, 'height'));
    expect(px(outliner, 'max-height')).toBe(560);
    const dock = rule(css, '#build-dock');
    expect(px(dock, 'right')).toBeGreaterThan(px(map, 'right') + px(map, 'width'));
  });

  it('puts the advisor beside the outliner, the panels top left, the toasts on their floor', () => {
    const advisor = rule(css, '#advisor');
    const outliner = rule(css, '#outliner');
    expect(px(advisor, 'right')).toBeGreaterThan(px(outliner, 'right') + px(outliner, 'width'));
    expect(px(advisor, 'width')).toBe(320);
    expect(px(advisor, 'max-height')).toBe(120);
    expect(px(rule(css, '#toasts'), 'bottom')).toBe(TOAST_FLOOR);
    const side = rule(css, '#train-panel,\n#station-panel');
    expect([px(side, 'left'), px(side, 'top'), px(side, 'width')]).toEqual([8, 62, 400]);
  });
});

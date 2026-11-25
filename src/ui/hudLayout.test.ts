import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TOAST_FLOOR } from './buildBar';

/** The rule of `selector` in `style.css`: its first block, as written. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('\n}', at));
}

describe('the music in the top bar', () => {
  const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
  /** The z-index of the last rule of `selector`, the one that holds. */
  const layer = (selector: string) => {
    const at = css.lastIndexOf(`\n${selector} {`);
    expect(at, selector).toBeGreaterThan(-1);
    return Number(/\bz-index: (\d+)/.exec(css.slice(at, css.indexOf('\n}', at)))?.[1]);
  };

  it('stands over the scrims, so a press on it closes no menu and no screen', () => {
    const widget = layer('#topbar .now-playing');
    expect(widget).toBeGreaterThan(layer('.menu-root'));
    expect(widget).toBeGreaterThan(layer('#modal-root'));
  });

  it('stands under the name prompt and the tooltips', () => {
    const widget = layer('#topbar .now-playing');
    expect(widget).toBeLessThan(layer('#name-prompt-root'));
    expect(widget).toBeLessThan(layer('.tt'));
  });

  it('leaves the top bar free of every frame: they stop at 90vh of 720, 36 px from the top', () => {
    const frame = rule(css, '.k-frame');
    expect(frame).toContain('max-height: 90vh');
    expect(rule(css, '#topbar')).toContain('height: 30px');
  });
});

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

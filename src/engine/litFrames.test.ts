import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import locomotives from '../data/locomotives.json';
import wagons from '../data/wagons.json';

/**
 * A rendered vehicle's window light (`..._lit_f<n>`, drawn at night by trainRenderer.drawModel)
 * is cut from the same canvas as its body frame (`..._f<n>`), with the same anchor. The pages
 * written by models3d/tools/lit_pack.py must keep that.
 */
const ASSETS = new URL('../../public/assets/', import.meta.url);

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number;
  ay: number;
}
interface Page {
  resolution?: number;
  format?: string;
  frames: Record<string, Frame>;
}
const readJson = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`${name}.json`, ASSETS), 'utf8')) as T;

const root = readJson<{ vehicles: Record<string, string[]> }>('rolling');
const lit = Object.entries(root.vehicles).filter(([, pages]) =>
  pages.some((p) => p.includes('-lit-')),
);
const loco = new Set(locomotives.map((l) => l.id));
const wagon = new Map(wagons.map((w) => [w.id, w]));

/** The drawModel rule: a body frame's lit twin. */
const litKey = (key: string) => key.replace(/(?:_w\d+)?_f(\d+)$/, '_lit_f$1');

describe('window light pages', () => {
  it('exist for engines and passenger wagons, never for freight wagons', () => {
    expect(lit.length).toBeGreaterThan(20);
    for (const [stem] of lit) {
      const id = stem.replace(/^(loco|wagon)_/, '');
      if (stem.startsWith('loco_')) expect(loco.has(id), stem).toBe(true);
      else {
        expect(wagon.has(id), stem).toBe(true);
        // people carriers and the brake van: the wagons with windows
        expect(['wooden_coach', 'steel_coach', 'pullman', 'brake_van'], stem).toContain(id);
      }
    }
  });

  it('are named rolling-<stem>-lit-<n>, WebP at resolution 2, and hold only lit frames', () => {
    for (const [stem, pages] of lit) {
      const mine = pages.filter((p) => p.includes('-lit-'));
      mine.forEach((p, i) => {
        expect(p).toBe(`rolling-${stem}-lit-${i + 1}`);
        const page = readJson<Page>(p);
        expect(page.format, p).toBe('webp');
        expect(page.resolution, p).toBe(2);
        for (const key of Object.keys(page.frames))
          expect(key, p).toMatch(new RegExp(`^rolling/${stem}_.+_lit_f\\d+$`));
      });
      // the lit pages follow the vehicle's own pages in the list
      expect(
        pages.findIndex((p) => p.includes('-lit-')),
        stem,
      ).toBe(pages.length - mine.length);
    }
  });

  it('sit on real body frames: every lit key has its body key, and its box lies inside the body box', () => {
    for (const [stem, pages] of lit) {
      const body = new Map<string, Frame>();
      for (const p of pages.filter((n) => !n.includes('-lit-')))
        for (const [k, f] of Object.entries(readJson<Page>(p).frames)) body.set(k, f);
      let n = 0;
      for (const p of pages.filter((q) => q.includes('-lit-'))) {
        for (const [k, f] of Object.entries(readJson<Page>(p).frames)) {
          const bk = k.replace(/_lit_f(\d+)$/, '_f$1');
          const b = body.get(bk);
          expect(b, `${k} has no body frame ${bk}`).toBeDefined();
          // the game's rule finds the lit key again from the body key
          expect(litKey(bk), k).toBe(k);
          // both frames are cut from the same canvas: box = (-ax, -ay) .. (w - ax, h - ay) about the anchor
          const slack = 1;
          expect(-f.ax, k).toBeGreaterThanOrEqual(-b!.ax - slack);
          expect(-f.ay, k).toBeGreaterThanOrEqual(-b!.ay - slack);
          expect(f.w - f.ax, k).toBeLessThanOrEqual(b!.w - b!.ax + slack);
          expect(f.h - f.ay, k).toBeLessThanOrEqual(b!.h - b!.ay + slack);
          n++;
        }
      }
      expect(n, stem).toBeGreaterThan(0);
    }
  });

  it('cover every heading of a sample vehicle on which a pane shows at the front', () => {
    const [stem, pages] = lit.find(([s]) => s === 'loco_m62') ?? lit[0];
    const keys = new Set<string>();
    for (const p of pages.filter((q) => q.includes('-lit-')))
      for (const k of Object.keys(readJson<Page>(p).frames)) keys.add(k);
    // m62 has cab windows at both ends: a pane is visible at nearly every one of its 192 headings
    expect(stem).toBe('loco_m62');
    expect(keys.size).toBeGreaterThan(150);
  });

  it('are left out for vehicles whose windows are paint, or that have none', () => {
    for (const stem of [
      'loco_rocket',
      'loco_jupiter',
      'loco_general',
      'loco_j94',
      'loco_k4s',
      'loco_sd40',
      'loco_taurus',
      'loco_tgv',
      'wagon_narrow_coach',
    ])
      expect(root.vehicles[stem]?.some((p) => p.includes('-lit-')) ?? false, stem).toBe(false);
  });
});

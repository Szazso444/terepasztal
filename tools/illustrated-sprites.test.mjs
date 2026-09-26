import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { trimSource, resample, groundTile, packFrames, projectionMatrix, rectifyProjection } from './illustrated-sprites.mjs';

describe('illustrated atlas conversion', () => {
  it('rectifies both ground axes to 2:1 without tilting vertical edges', () => {
    const m=projectionMatrix(.31,-.39);
    expect(m.shear+m.vertical*.31).toBeCloseTo(.5,12);
    expect(m.shear+m.vertical*(-.39)).toBeCloseTo(-.5,12);
    const p=new PNG({width:4,height:4});p.data.fill(255);
    const result=rectifyProjection(p,.31,-.39);
    expect(result.width).toBe(p.width);
    expect(result.height).toBeGreaterThan(p.height);
    expect(p.data.every(v=>v===255)).toBe(true);
  });
  it('retains source material contrast instead of fading every edge to a mean color', () => {
    const p=new PNG({width:100,height:100});
    for(let y=0;y<100;y++)for(let x=0;x<100;x++)p.data.set((Math.floor(x/8)+Math.floor(y/8))%2?[70,120,30,255]:[120,170,70,255],(y*100+x)*4);
    const result=groundTile(p);
    const red=[];for(let i=0;i<result.data.length;i+=4)if(result.data[i+3])red.push(result.data[i]);
    expect(Math.max(...red)-Math.min(...red)).toBeGreaterThan(45);
  });
  it('resamples in premultiplied alpha without opaque edges or transparent-color fringes', () => {
    const p = new PNG({ width: 2, height: 1 });
    p.data.set([200, 50, 25, 255, 0, 255, 0, 0]);
    expect([...resample(p, 1, 1).data]).toEqual([200, 50, 25, 128]);
  });
  it('removes glow while retaining edge coverage and leaves the source intact', () => {
    const p = new PNG({ width: 3, height: 1 });
    p.data.set([200, 0, 0, 30, 100, 80, 60, 128, 90, 80, 70, 255]);
    const clean = trimSource(p);
    expect(clean.width).toBe(2);
    expect(clean.data[3]).toBeGreaterThan(0);
    expect(clean.data[3]).toBeLessThan(255);
    expect(p.data[3]).toBe(30);
  });
  it('projects a flat opaque diamond without copying source-border colors', () => {
    const p = new PNG({ width: 100, height: 100 });
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 100; x++)
        p.data.set(
          x < 20 || y < 20 || x > 80 || y > 80 ? [255, 0, 0, 255] : [70, 100, 50, 255],
          (y * 100 + x) * 4,
        );
    const t = groundTile(p);
    expect([t.width, t.height]).toEqual([256, 128]);
    expect(t.data[3]).toBe(0);
    expect([...t.data.slice((64 * 256 + 128) * 4, (64 * 256 + 128) * 4 + 4)]).toEqual([
      70, 100, 50, 255,
    ]);
  });
  it('deduplicates artwork but preserves each frame anchor and extrudes the gutter', () => {
    const p = new PNG({ width: 2, height: 2 });
    p.data.fill(255);
    const packed = packFrames(
      [
        { key: 'a', png: p, ax: 1, ay: 2 },
        { key: 'b', png: p, ax: 7, ay: 8 },
      ],
      32,
    );
    expect(packed.unique).toBe(1);
    expect(packed.frames.a.x).toBe(packed.frames.b.x);
    expect(packed.frames.b.ax).toBe(7);
    const f = packed.frames.a;
    expect(packed.sheet.data[((f.y - 1) * packed.sheet.width + f.x - 1) * 4 + 3]).toBe(255);
  });
});

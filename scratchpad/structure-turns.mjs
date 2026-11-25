// Review sheet of the buildings' placeholder turns, drawn by the procedural structures generator
// (not the live atlas, whose illustrated file replaces many rotation-0 frames): one row per
// picture, r0 | r1 | r2 | r3, each standing on its footprint with its anchor marked in red.
// usage: node scratchpad/structure-turns.mjs [out.png] [scale]   (BASE_URL picks the server)
import { launch, openGame } from './runtime.mjs';
import { writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'scratchpad/structure-turns.png';
const scale = Number(process.argv[3] ?? 1);
const browser = await launch();
try {
  const page = await openGame(browser, 'after');
  const png = await page.evaluate(async (scale) => {
    window.game.settings.autosave = false;
    const { generateStructuresAtlas } = await import('/src/art/structures.ts');
    const a = generateStructuresAtlas();
    const keys = Object.keys(a.frames).sort();
    const bases = keys.filter((k) => [1, 2, 3].some((r) => a.frames[`${k}_r${r}`]));
    const per = 2; // pictures per sheet row
    const cell = { w: 150, h: 150 };
    const block = cell.w * 4 + 20;
    const c = document.createElement('canvas');
    c.width = block * per * scale;
    c.height = (cell.h + 14) * Math.ceil(bases.length / per) * scale;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#8fa27a';
    g.fillRect(0, 0, c.width, c.height);
    g.scale(scale, scale);
    g.font = '11px monospace';
    bases.forEach((k, i) => {
      const left = (i % per) * block;
      const top = Math.floor(i / per) * (cell.h + 14);
      g.fillStyle = '#1c2418';
      g.fillText(`${k.replace('structures/', '')}  r0 | r1 | r2 | r3`, left + 4, top + 12);
      const [tw, th] = /depot_narrow/.test(k) ? [1, 2] : /depot/.test(k) ? [2, 2] : [1, 1];
      ['', '_r1', '_r2', '_r3'].forEach((sfx, col) => {
        const f = a.frames[k + sfx];
        if (!f) return;
        const ox = left + col * cell.w + cell.w / 2;
        const oy = top + cell.h - 24;
        // the footprint, rot 0 and 2 along x for a long one; the anchor is its centre
        const along = /_r0$/.test(k);
        const [lx, ly] = along ? [th, tw] : [tw, th];
        const P = (tx, ty) => [ox + (tx - ty) * 32, oy + (tx + ty) * 16];
        g.strokeStyle = '#3a4a30';
        g.beginPath();
        for (const [tx, ty] of [
          [-lx / 2, -ly / 2],
          [lx / 2, -ly / 2],
          [lx / 2, ly / 2],
          [-lx / 2, ly / 2],
        ])
          g.lineTo(...P(tx, ty));
        g.closePath();
        g.stroke();
        g.drawImage(a.image, f.x, f.y, f.w, f.h, ox - f.ax, oy - f.ay, f.w, f.h);
        g.fillStyle = '#e01010';
        g.fillRect(ox - 1, oy - 1, 2, 2);
      });
    });
    return c.toDataURL('image/png');
  }, scale);
  writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
  console.log('wrote', out);
} finally {
  await browser.close();
}

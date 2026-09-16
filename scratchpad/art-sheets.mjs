// Contact sheet per atlas group, rendered from the live atlas through the game's own sprite
// preview. Frames are drawn over a checker so transparent margins and stray fringes show.
// usage: node scratchpad/art-sheets.mjs <label> [group...]
import { launch, openGame } from './runtime.mjs';
import { mkdirSync } from 'node:fs';

const label = process.argv[2] ?? 'after';
const only = process.argv.slice(3);
const outDir = new URL(`./shots/${label}/`, import.meta.url);
mkdirSync(outDir, { recursive: true });

/** Frame filters per sheet; each takes every atlas key and returns the ones to draw. */
const GROUPS = {
  terrain: (all) => all.filter((k) => k.startsWith('terrain/') && !/_f[123]$/.test(k)),
  props: (all) => all.filter((k) => k.startsWith('props/')),
  track: (all) => all.filter((k) => k.startsWith('track/') && !/_m\d/.test(k)),
  structures: (all) =>
    all.filter(
      (k) =>
        k.startsWith('structures/') &&
        !/span_|bridge_detail|semaphore_m[12]|semaphore_m[03]_d[12]/.test(k),
    ),
  bridges: (all) =>
    all.filter((k) => /structures\/(span_[a-z]+_1_3_[0-2]_[0-3]_(deck|rail)|bridge_)/.test(k)),
  icons: (all) => all.filter((k) => /^(icons|people|fx)\//.test(k)),
};

const browser = await launch();
try {
  const page = await openGame(browser, label);
  const want = only.length ? only : [...Object.keys(GROUPS), 'vehicles'];
  for (const group of want) {
    const html = await page.evaluate(
      async ({ group, filterSrc }) => {
        const g = window.game;
        g.settings.autosave = false;
        const { spriteDataUrl, frameForItem } = await import('/src/ui/spritePreview.ts');
        const { content } = await import('/src/data/content.ts');
        const items =
          group === 'vehicles'
            ? [...content.locomotives, ...content.wagons].map((d) => ({
                key: d.id,
                url: spriteDataUrl(g.atlas, frameForItem(d.id), 3),
              }))
            : new Function(`return ${filterSrc}`)()(g.atlas.keys('')).map((k) => ({
                key: k.replace(/^[a-z]+\//, ''),
                url: spriteDataUrl(g.atlas, k, 3),
              }));
        const cell = (i) =>
          `<div class="c"><img src="${i.url}" alt="${i.key}"><span>${i.key}</span></div>`;
        return `<!doctype html><meta charset="utf-8"><style>
          body{margin:0;background:#8fa27a;font:11px monospace;color:#222}
          main{display:flex;flex-wrap:wrap;gap:6px;padding:6px}
          .c{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;
             min-width:60px;padding:4px;
             background:repeating-conic-gradient(#7d8f6a 0% 25%,#87996f 0% 50%) 0 0/24px 24px}
          img{image-rendering:pixelated;display:block}
          span{margin-top:2px;background:rgba(255,255,255,.5)}
        </style><main>${items.map(cell).join('')}</main>`;
      },
      { group, filterSrc: group === 'vehicles' ? 'null' : GROUPS[group].toString() },
    );
    const sheet = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await sheet.setContent(html);
    await sheet.screenshot({ path: new URL(`${group}.png`, outDir).pathname, fullPage: true });
    await sheet.close();
    console.log('wrote', group);
  }
} finally {
  await browser.close();
}

// Contact sheet of the `bridges` atlas group as the game holds it: every material swatch, and the
// two bridge pictures composed from them (toolbar, build card), over a checker.
//   node scratchpad/bridges/bridge-sheet.mjs [label=after]
// Writes renders-<label>/sheet-kit.png (packed kit swatches) and sheet-proc.png (the generator's).
import { launch } from '../runtime.mjs';
import { mkdirSync } from 'node:fs';
const [label = 'after'] = process.argv.slice(2);
const out = `scratchpad/bridges/renders-${label}/`;
mkdirSync(out, { recursive: true });
const browser = await launch();
for (const mode of ['kit', 'proc']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`http://127.0.0.1:5183/scratchpad/bridges/decks.html${mode === 'proc' ? '?proc=1' : ''}`);
  await page.waitForFunction(() => window.qa, null, { timeout: 240000 });
  const { html, count } = await page.evaluate(async () => {
    const { spriteDataUrl } = await import('/src/ui/spritePreview.ts');
    const atlas = qa.g.atlas,
      keys = [...atlas.keys('structures/bridge_'), ...atlas.keys('bridgemat/')],
      cell = (k) => {
        const f = atlas.get(k);
        return `<div class="c"><img src="${spriteDataUrl(atlas, k, 3)}" alt=""><span>${k} · ${f.w}×${f.h} · anchor ${Math.round(f.anchorX * f.w)},${Math.round(f.anchorY * f.h)}</span></div>`;
      };
    return {
      count: keys.length,
      html: `<!doctype html><meta charset="utf-8"><style>
        body{margin:0;background:#8fa27a;font:11px monospace;color:#222}
        main{display:flex;flex-wrap:wrap;gap:8px;padding:8px;align-items:flex-end}
        .c{display:flex;flex-direction:column;align-items:center;padding:4px;
           background:repeating-conic-gradient(#7d8f6a 0% 25%,#87996f 0% 50%) 0 0/24px 24px}
        img{display:block} span{margin-top:3px;background:rgba(255,255,255,.6)}
      </style><main>${keys.map(cell).join('')}</main>`,
    };
  });
  const sheet = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await sheet.setContent(html);
  await sheet.screenshot({ path: `${out}sheet-${mode}.png`, fullPage: true });
  console.log('wrote', `sheet-${mode}.png`, count, 'frames');
  await sheet.close();
  await page.close();
}
await browser.close();

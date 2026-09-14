import { launch, openGame } from './runtime.mjs';
const browser = await launch();
try {
  const page = await openGame(browser, 'after');
  await page.evaluate(async () => {
    const g = window.game;
    g.clock.setSpeed(0);
    g.settings.autosave = false;
    const { spriteDataUrl } = await import('/src/ui/spritePreview.ts');
    const panel = document.createElement('div');
    panel.style =
      'position:fixed;inset:0;z-index:9999;background:#182a31;color:#eee;padding:36px;font:20px sans-serif';
    panel.innerHTML = '<h1>Bridge supports and construction previews</h1>';
    for (const material of ['wood', 'stone']) {
      const row = document.createElement('div');
      row.style = 'display:flex;align-items:center;gap:40px;height:350px';
      row.innerHTML = `<h2>${material}</h2>`;
      for (const key of [
        `structures/bridge_${material}`,
        ...[0, 1].map((axis) => `structures/span_${material}_${axis}_1_0_3_deck`),
      ]) {
        const img = document.createElement('img');
        img.src = spriteDataUrl(g.atlas, key, 3);
        img.style = 'image-rendering:pixelated;background:#305867';
        row.append(img);
      }
      panel.append(row);
    }
    document.body.append(panel);
  });
  await page.screenshot({ path: `scratchpad/bridge-art-${process.argv[2] ?? 'after'}.png` });
} finally {
  await browser.close();
}

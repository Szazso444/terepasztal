import { launch } from '../runtime.mjs';
const b = await launch();
const out = 'C:/Users/Zso/AppData/Local/Temp/claude/G--DEV-Terepasztal/be4c9dd5-0abf-4bab-ba76-aa9247377644/scratchpad/models-page';
for (const [w, scheme] of [[1280, 'light'], [400, 'dark']]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 }, colorScheme: scheme });
  await p.goto('http://127.0.0.1:5177/scratchpad/models-review/index.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => Promise.all([...document.images].map((i) => ((i.loading = 'eager'), i.decode().catch(() => 0)))));
  console.log(w, await p.evaluate(() => ({ docW: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight })));
  for (const sel of process.argv.slice(2)) {
    const el = await p.$(sel);
    if (el) await el.screenshot({ path: `${out}/chk-${w}-${sel.slice(1)}.png` });
  }
  await p.close();
}
await b.close();

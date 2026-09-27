const { chromium } = await import('/tmp/claude-0/-home-user-terepasztal/5d15a916-29ff-5ce3-8d79-4b98fa4fa891/scratchpad/pw/node_modules/playwright-core/index.mjs');
import fs from 'node:fs';
const [src, x, y, w, h, s, dst] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: w * s, height: h * s } });
const data = fs.readFileSync(src).toString('base64');
await p.setContent(`<body style="margin:0;overflow:hidden"><div style="width:${w * s}px;height:${h * s}px;background:url(data:image/jpeg;base64,${data}) -${x * s}px -${y * s}px/${1440 * s}px auto;image-rendering:pixelated"></div></body>`);
await p.screenshot({ path: dst });
await b.close();

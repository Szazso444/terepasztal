import { writeFileSync } from 'node:fs';
import { launch } from './runtime.mjs';
const p = (x, y, z) => [460 + (x - y) * 160, 210 + (x + y) * 80 - z * 140];
const face = (coords, color) =>
  `<polygon points="${coords.map((c) => p(...c).join(',')).join(' ')}" fill="${color}" stroke="#293c45" stroke-width="3"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="900"><rect width="100%" height="100%" fill="#ffffff"/>${face(
  [
    [0, 0, 0],
    [3, 0, 0],
    [3, 0, 1.2],
    [0, 0, 1.2],
  ],
  '#cfb98f',
)}${face(
  [
    [3, 0, 0],
    [3, 1.5, 0],
    [3, 1.5, 1.2],
    [3, 0.75, 1.9],
    [3, 0, 1.2],
  ],
  '#ebdab4',
)}${face(
  [
    [0, 0, 1.2],
    [3, 0, 1.2],
    [3, 0.75, 1.9],
    [0, 0.75, 1.9],
  ],
  '#667582',
)}${face(
  [
    [0, 0.75, 1.9],
    [3, 0.75, 1.9],
    [3, 1.5, 1.2],
    [0, 1.5, 1.2],
  ],
  '#8b98a0',
)}${face(
  [
    [0, 1.5, 0],
    [3, 1.5, 0],
    [3, 1.5, 1.2],
    [0, 1.5, 1.2],
  ],
  '#c4ac80',
)}</svg>`;
writeFileSync('scratchpad/station-pipeline/projection-guide.svg', svg);
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('http://127.0.0.1:5173/scratchpad/station-pipeline/projection-guide.svg');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'scratchpad/station-pipeline/projection-guide.png' });
} finally {
  await browser.close();
}

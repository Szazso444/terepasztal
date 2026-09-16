// Stack the before and after scene shots into one labelled comparison image, plus a detail crop
// of the station and the train. Run `art-scene.mjs before` and `art-scene.mjs after` first.
// usage: node scratchpad/art-compare.mjs
import { launch } from './runtime.mjs';
import { readFileSync } from 'node:fs';

const dataUrl = (p) =>
  `data:image/png;base64,${readFileSync(new URL(p, import.meta.url)).toString('base64')}`;
const before = dataUrl('./shots/scene-before/village.png');
const after = dataUrl('./shots/scene-after/village.png');
const dusk = dataUrl('./shots/scene-after/village-dusk.png');

const page = (body, w, h) => `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#1a251d;color:#e4d5b5;font:16px/1.4 Georgia,serif}
  figure{margin:0;padding:10px}
  figcaption{padding:6px 2px;letter-spacing:1px;text-transform:uppercase;font-size:14px;color:#e8aa48}
  img{display:block;image-rendering:pixelated}
  .row{display:flex}
  </style><body style="width:${w}px;height:${h}px">${body}</body>`;

const browser = await launch();
try {
  const shot = async (html, w, h, out) => {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    await p.setContent(html);
    await p.screenshot({ path: new URL(out, import.meta.url).pathname });
    await p.close();
    console.log('wrote', out);
  };
  // full scene, before over after
  await shot(
    page(
      `<figure><figcaption>Before &mdash; same seed, same tiles, same camera</figcaption>
       <img src="${before}" width="1440"></figure>
       <figure><figcaption>After &mdash; pastoral art direction</figcaption>
       <img src="${after}" width="1440"></figure>`,
      1460,
      1930,
    ),
    1460,
    1930,
    './art-scene-compare.png',
  );
  // detail: the station, the water tower and the train, magnified
  const crop = (src, label) =>
    `<figure><figcaption>${label}</figcaption>
     <div style="width:700px;height:400px;overflow:hidden">
       <img src="${src}" style="width:2880px;margin:-660px 0 0 -1300px">
     </div></figure>`;
  await shot(
    page(`<div class="row">${crop(before, 'Before')}${crop(after, 'After')}</div>`, 1460, 470),
    1460,
    470,
    './art-scene-detail.png',
  );
  await shot(
    page(
      `<figure><figcaption>After &mdash; dusk</figcaption><img src="${dusk}" width="1440"></figure>`,
      1460,
      960,
    ),
    1460,
    960,
    './art-scene-dusk.png',
  );
} finally {
  await browser.close();
}

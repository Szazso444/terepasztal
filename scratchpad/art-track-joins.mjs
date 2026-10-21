// Tile joins of the track atlas group, laid out the way the world lays them: the narrow straight,
// the narrow curve into a straight, the regular 2x2 curve and switch ends, and the transition.
// Each crop is 120 x 60 world pixels around a join, at the atlas resolution (4 texels per world
// pixel) over flat grass, so the spacing of the sleepers across it can be read by eye. Also lists
// every track frame's size and anchor, so a generator change can show they did not move.
//
// usage: BASE_URL=http://127.0.0.1:5173 node scratchpad/art-track-joins.mjs <label> [outDir]
//          writes <outDir>/<label>-<scene>.png and <outDir>/<label>-frames.json
//        node scratchpad/art-track-joins.mjs diff <a> <b> [outDir]
//          frames added, removed and moved between two labels; stacks <a> over <b> per scene
// BASE_URL is a running dev server (`npx vite`) of the checkout to draw. outDir defaults to
// scratchpad/shots/track-joins.
import { launch, baseURL } from './runtime.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const dirOf = (arg) =>
  new URL(`${arg ?? new URL('./shots/track-joins', import.meta.url).pathname}/`, 'file:///');
const SCENES = [
  'narrow-straight-ns',
  'narrow-straight-ew',
  'narrow-curve',
  'regular-curve-exit',
  'regular-curve-entry',
  'regular-switch-stem',
  'transition',
];

if (process.argv[2] === 'diff') {
  const [a, b, out] = process.argv.slice(3);
  const dir = dirOf(out);
  const read = (l) => JSON.parse(readFileSync(new URL(`${l}-frames.json`, dir), 'utf8'));
  const [fa, fb] = [read(a), read(b)];
  const same = (k) => JSON.stringify(fa[k]) === JSON.stringify(fb[k]);
  console.log('track frames', Object.keys(fa).length, '->', Object.keys(fb).length);
  console.log(
    'added',
    Object.keys(fb).filter((k) => !(k in fa)),
  );
  console.log(
    'removed',
    Object.keys(fa).filter((k) => !(k in fb)),
  );
  console.log(
    'moved (size or anchor)',
    Object.keys(fa).filter((k) => k in fb && !same(k)),
  );
  for (const scene of SCENES) {
    const [pa, pb] = [a, b].map((l) =>
      PNG.sync.read(readFileSync(new URL(`${l}-${scene}.png`, dir))),
    );
    const out = new PNG({ width: pa.width, height: pa.height + pb.height + 8 });
    out.data.fill(255);
    PNG.bitblt(pa, out, 0, 0, pa.width, pa.height, 0, 0);
    PNG.bitblt(pb, out, 0, 0, pb.width, pb.height, 0, pa.height + 8);
    writeFileSync(new URL(`${a}-vs-${b}-${scene}.png`, dir), PNG.sync.write(out));
  }
  console.log('stacked', SCENES.map((s) => `${a}-vs-${b}-${s}.png`).join(' '));
  process.exit(0);
}

const label = process.argv[2] ?? 'after';
const dir = dirOf(process.argv[3]);
mkdirSync(dir, { recursive: true });
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on('pageerror', (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  // any same-origin page will do: only the module graph is needed, not the game
  await page.goto(`${baseURL(label)}/assets/illustrated-report.json`);
  const result = await page.evaluate(async () => {
    const { generateIllustratedTrackAtlas } = await import('/src/art/trackIllustrated.ts');
    const atlas = generateIllustratedTrackAtlas();
    const R = atlas.resolution ?? 1;
    const frames = {};
    for (const [k, f] of Object.entries(atlas.frames))
      frames[k] = { w: f.w, h: f.h, ax: f.ax, ay: f.ay };

    // each crop: the frames to lay, as [key, tx, ty] with the tile the anchor sits on, and the tile
    // coordinate the crop is centred on (a join is where two tiles meet: x.5 or y.5)
    const row = (key, tiles) => tiles.map(([tx, ty]) => [key, tx, ty]);
    const block = (key) => [0, 1, 2, 3].map((m) => [`${key}_m${m}`, m % 2, Math.floor(m / 2)]);
    const scenes = {
      'narrow-straight-ns': {
        at: [0, 1.5],
        tiles: row('straight_narrow_0', [
          [0, 0],
          [0, 1],
          [0, 2],
          [0, 3],
        ]),
      },
      'narrow-straight-ew': {
        at: [1.5, 0],
        tiles: row('straight_narrow_1', [
          [0, 0],
          [1, 0],
          [2, 0],
          [3, 0],
        ]),
      },
      'narrow-curve': {
        at: [0.25, -0.25],
        tiles: [
          ...row('straight_narrow_0', [
            [0, -2],
            [0, -1],
          ]),
          ['curve_narrow_0', 0, 0],
          ...row('straight_narrow_1', [
            [1, 0],
            [2, 0],
          ]),
        ],
      },
      'regular-curve-exit': {
        at: [1.5, 1],
        tiles: [
          ...row('straight_regular_0', [
            [0, -2],
            [0, -1],
          ]),
          ...block('curve_regular_0'),
          ...row('straight_regular_1', [
            [2, 1],
            [3, 1],
          ]),
        ],
      },
      'regular-curve-entry': {
        at: [0, -0.5],
        tiles: [
          ...row('straight_regular_0', [
            [0, -2],
            [0, -1],
          ]),
          ...block('curve_regular_0'),
          ...row('straight_regular_1', [
            [2, 1],
            [3, 1],
          ]),
        ],
      },
      'regular-switch-stem': {
        at: [0.5, 0.5],
        tiles: [
          ...row('straight_regular_0', [
            [0, -2],
            [0, -1],
            [0, 2],
            [0, 3],
          ]),
          ...block('switch_regular_0'),
        ],
      },
      transition: {
        at: [0, 0],
        tiles: [
          ...row('straight_regular_0', [
            [0, -2],
            [0, -1],
          ]),
          ['transition_regular_0', 0, 0],
          ...row('straight_high_speed_0', [
            [0, 1],
            [0, 2],
          ]),
        ],
      },
    };
    const png = {};
    const W = 60 * R,
      H = 30 * R;
    for (const [name, { at, tiles }] of Object.entries(scenes)) {
      const cx = (at[0] - at[1]) * 32 * R,
        cy = (at[0] + at[1]) * 16 * R;
      const canvas = document.createElement('canvas');
      canvas.width = 2 * W;
      canvas.height = 2 * H;
      const c = canvas.getContext('2d');
      c.fillStyle = '#7d8f6a';
      c.fillRect(0, 0, canvas.width, canvas.height);
      for (const [key, tx, ty] of tiles) {
        const f = atlas.frames[`track/${key}`];
        if (!f) throw new Error(`no frame track/${key}`);
        c.drawImage(
          atlas.image,
          f.x,
          f.y,
          f.w,
          f.h,
          Math.round((tx - ty) * 32 * R - cx + W - f.ax),
          Math.round((tx + ty) * 16 * R - cy + H - f.ay),
          f.w,
          f.h,
        );
      }
      png[name] = canvas.toDataURL('image/png');
    }
    return { frames, png };
  });
  for (const [name, url] of Object.entries(result.png))
    writeFileSync(
      new URL(`${label}-${name}.png`, dir),
      Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'),
    );
  writeFileSync(new URL(`${label}-frames.json`, dir), JSON.stringify(result.frames, null, 1));
  console.log(
    'wrote',
    Object.keys(result.png).length,
    'scenes and',
    Object.keys(result.frames).length,
    'frames to',
    dir.pathname,
  );
} finally {
  await browser.close();
}

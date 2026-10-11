import { ATLAS_GROUPS } from '/src/art/index.ts';
import { content } from '/src/data/content.ts';
import { locoFrame, wagonFrame } from '/src/art/frames.ts';
export function assets(label) {
  const g = window.game;
  g.closeMenus();
  g.settings.autosave = false;
  g.clock.setSpeed(0);
  g.app.ticker.stop();
  const timings = [];
  for (const group of ATLAS_GROUPS) {
    const start = performance.now();
    const a = group.generate();
    let invalid = 0;
    for (const f of Object.values(a.frames))
      if (
        f.x < 0 ||
        f.y < 0 ||
        f.x + f.w > a.image.width ||
        f.y + f.h > a.image.height ||
        !Number.isFinite(f.ax + f.ay)
      )
        invalid++;
    timings.push({
      name: group.name,
      ms: +(performance.now() - start).toFixed(1),
      width: a.image.width,
      height: a.image.height,
      frames: Object.keys(a.frames).length,
      invalid,
    });
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1440;
  canvas.height = 1360;
  const c = canvas.getContext('2d');
  c.fillStyle = '#203238';
  c.fillRect(0, 0, 1440, 1360);
  c.imageSmoothingEnabled = false;
  c.fillStyle = '#f5dda9';
  c.font = '26px sans-serif';
  c.fillText('TEREPASZTAL / PROCEDURAL ART / ' + label.toUpperCase(), 28, 40);
  const all = g.atlas.keys('');
  const sections = [
    [
      'Terrain & water',
      [
        'grass_0',
        'plains_0',
        'taiga_0',
        'forest_0',
        'swamp_0',
        'desert_0',
        'hill_0',
        'mountain_0',
        'water_0_f0',
      ].map((s) => 'terrain/' + s),
    ],
    [
      'Trees & ground details',
      all
        .filter((k) => k.startsWith('props/'))
        .filter((_, i) => i % 5 === 0)
        .slice(0, 12),
    ],
    [
      'Stations & industry',
      [
        'station_3',
        'depot_r0',
        'farm_3',
        'quarry_3',
        'lumber_3',
        'ironworks',
        'refinery',
        'warehouse_3',
        'town_3',
      ].map((s) => 'structures/' + s),
    ],
    [
      'Works, homes & services',
      all
        .filter(
          (k) =>
            k.startsWith('structures/') &&
            !/station|depot|semaphore|supply|signal|warn|note|alert/.test(k),
        )
        .filter((_, i) => i % 4 === 0)
        .slice(0, 11),
    ],
    [
      'Locomotives',
      ['j94', 'mav424', 'dda40x', 'gg1', 'big_boy', 'crocodile', 'gmam', 'tgv'].map((id) => {
        const d = content.locomotives.find((d) => d.id === id);
        return d
          ? locoFrame(
              g.atlas,
              d,
              0,
              d.plan === 'tender' || d.plan === 'garratt'
                ? 'engine'
                : d.plan === 'meyer'
                  ? 'frame'
                  : 'body',
            )
          : '';
      }),
    ],
    [
      'Wagons',
      content.wagons
        .filter((_, i) => i % 2 === 0)
        .slice(0, 11)
        .map((d) => wagonFrame(g.atlas, d, 0)),
    ],
    [
      'Track & utilities',
      [
        'track/straight_regular_1',
        'track/curve_regular_0',
        'track/straight_high_speed_1',
        'track/curve_high_speed_2_m0',
        'structures/water_tower',
        'structures/signal',
        'structures/substation',
        'structures/power_line',
        'structures/supply_catenary_ew',
      ],
    ],
    [
      'Cargo, crew & effects',
      [
        ...all.filter((k) => k.startsWith('icons/')).slice(0, 16),
        ...all
          .filter((k) => k.startsWith('people/person') || k.startsWith('people/walker'))
          .slice(0, 3),
        ...all.filter((k) => k.startsWith('fx/')).slice(0, 2),
      ],
    ],
  ];
  sections.forEach(([title, keys], row) => {
    const y = 72 + row * 160;
    c.fillStyle = '#afc5bf';
    c.font = '15px sans-serif';
    c.fillText(title.toUpperCase(), 28, y);
    const valid = keys.filter((k) => g.atlas.has(k));
    valid.forEach((key, i) => {
      const f = g.atlas.get(key),
        t = f.texture,
        fr = t.frame;
      const cell = 1380 / valid.length;
      const scale = Math.min(2.3, (cell - 8) / fr.width, 110 / fr.height);
      const x = 28 + i * cell + (cell - fr.width * scale) / 2;
      c.drawImage(
        t.source.resource,
        fr.x,
        fr.y,
        fr.width,
        fr.height,
        x,
        y + 15 + (110 - fr.height * scale),
        fr.width * scale,
        fr.height * scale,
      );
      c.fillStyle = '#b0b9ac';
      c.font = '10px sans-serif';
      const name = key.split('/')[1].replace('loco_', '').replace('wagon_', '').replace(/_f0$/, '');
      c.fillText(name.slice(0, 25), 28 + i * cell, y + 145);
    });
  });
  canvas.id = 'artboard';
  canvas.style = 'position:absolute;left:0;top:0;z-index:999999';
  document.body.append(canvas);
  return timings;
}

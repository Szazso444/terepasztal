import { Application, Container, Graphics, Sprite, Texture, Rectangle, Assets } from 'pixi.js';
import { AtlasRegistry } from '/src/engine/atlas.ts';
import { generateTrackAtlas } from '/src/art/track.ts';
import { generateTerrainAtlas } from '/src/art/terrain.ts';
const meta = await (await fetch('./metadata.json')).json();
// Load original generators directly: unrelated experimental atlas overrides stay out of this study.
const registry = new AtlasRegistry();
registry.register(generateTrackAtlas());
registry.register(generateTerrainAtlas());
const corrected = await Assets.load('./sprite.png');
const original = await Assets.load('./uncorrected-sprite.png');
const previous = await Assets.load('./previous-sprite.png');
function logical(texture) {
  return new Texture({
    source: texture.source,
    frame: texture.frame,
    orig: new Rectangle(0, 0, texture.width / 4, texture.height / 4),
  });
}
const textures = {
  corrected: logical(corrected),
  original: logical(original),
  previous: logical(previous),
};
const app = new Application();
await app.init({ width: 1120, height: 630, background: 0x202e30, antialias: true, resolution: 1 });
document.querySelector('#scene').append(app.canvas);
const f = meta.frame;
document.querySelector('#metrics').textContent =
  `${f.w} × ${f.h} texels; ${f.w / 4} × ${f.h / 4} world pixels. 4× density; rendered 20% wider at unchanged height. Ground anchor (${f.ax / 4}, ${f.ay / 4}).`;
const pos = (x, y) => [(x - y) * 32, (x + y) * 16];
const diamond = (g, x, y) => g.poly([x, y - 16, x + 32, y, x, y + 16, x - 32, y]);
function draw() {
  app.stage.removeChildren().forEach((c) => c.destroy({ children: true }));
  const root = new Container();
  root.position.set(560, 325);
  root.scale.set(Number(document.querySelector('#zoom').value));
  app.stage.addChild(root);
  const grid = document.querySelector('#grid').checked;
  const ground = document.querySelector('#ground').value;
  const mode = document.querySelector('#context').value;
  const projection = document.querySelector('#projection').value;
  const sprite = (key, x, y) => {
    const f = registry.get(key),
      s = new Sprite(f.texture);
    s.anchor.set(f.anchorX, f.anchorY);
    s.position.set(...pos(x, y));
    root.addChild(s);
  };
  for (let sum = -6; sum <= 6; sum++)
    for (let x = -3; x <= 3; x++) {
      const y = sum - x;
      if (y < -3 || y > 3) continue;
      const [px, py] = pos(x, y);
      if (ground === 'game') sprite('terrain/grass_0', x, y);
      else {
        const g = new Graphics();
        diamond(g, px, py).fill((x + y) % 2 ? 0x526761 : 0x566c65);
        root.addChild(g);
      }
      if (grid) {
        const g = new Graphics();
        diamond(g, px, py).stroke({ width: 0.35, color: 0x91aaa0 });
        root.addChild(g);
      }
    }
  if (mode === 'rail') {
    const key = registry.keys('track/').find((k) => /^track\/straight_regular_1$/.test(k));
    if (!key) throw Error('Original straight rail frame missing');
    for (let x = -3; x <= 3; x++) sprite(key, x, 1);
  }
  const buildings =
    mode === 'neighbours'
      ? [
          [-1, 0],
          [0, -1],
          [0, 0],
          [1, 0],
          [0, 1],
        ]
      : [[0, 0]];
  buildings.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  for (const [x, y] of buildings) {
    const s = new Sprite(textures[projection]);
    const activeFrame = projection === 'previous' ? meta.previousFrame : f;
    const height = projection === 'original' ? meta.uncorrectedHeight : activeFrame.h;
    s.anchor.set(
      activeFrame.ax / activeFrame.w,
      (height - (activeFrame.h - activeFrame.ay)) / height,
    );
    s.position.set(...pos(x, y));
    // Widen the accepted sprite about its existing anchor; preserve its height.
    if (projection === 'corrected') s.scale.x = meta.widthScale;
    root.addChild(s);
  }
  if (grid) {
    const g = new Graphics();
    diamond(g, 0, 0).stroke({ width: 0.65, color: 0xf3c36e });
    for (const [x, y] of buildings) {
      const [px, py] = pos(x, y);
      g.moveTo(px - 2, py)
        .lineTo(px + 2, py)
        .moveTo(px, py - 2)
        .lineTo(px, py + 2);
    }
    g.stroke({ width: 0.6, color: 0x8effe2 });
    root.addChild(g);
  }
  document.querySelector('#status').textContent =
    `${projection === 'corrected' ? 'Wider contracted candidate' : 'Original proportions'} · ${buildings.length} station sprite(s) · 64 × 32 tile grid · original rails · no save data accessed.`;
  window.stationDemoReady = true;
}
document.querySelectorAll('select,input').forEach((el) => el.addEventListener('change', draw));
draw();

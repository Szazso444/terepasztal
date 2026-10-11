// Scratch (read-only probe of today's mouse behaviour around bridge platforms): the real Game with
// its UI and loop running, on an empty map with three sites:
//   valley  hills 2-1-0-1-2 along y=40, stone platforms on the three dip tiles, straight rail over
//   river   three water tiles along y=52, wood platforms, straight rail over
//   bare    a stone platform on plain grass and a wood platform on water, no rail on either
// qa.screen(x, y, lift) gives the canvas pixel of a tile centre (lift in world px above ground).
import { Game } from '/src/game.ts';
import { emptyMap } from '/src/world/mapgen.ts';
import { levelFromMap } from '/src/world/level.ts';
import { levelAt } from '/src/world/elevation.ts';
import { tileToWorld } from '/src/engine/iso.ts';

const level = levelFromMap(emptyMap(7412, 96, 96), 'Bridge input');
const g = new Game({ kind: 'level', seed: 7412, level });
window.game = g;
await g.init();
g.closeMenus();
g.settings.autosave = false;
g.settings.weather = false;
g.settings.dayNight = false;
g.settings.edgeScroll = false;
g.clock.setSpeed(0);
for (let i = 0; i < g.regions.unlocked.length; i++) g.regions.own(i);
g.world.rebuildFog();
g.cheat();
const m = g.map;
for (const k of [...m.props.keys()]) {
  m.props.delete(k);
  g.world.removeProps(k % m.w, Math.floor(k / m.w));
}
const set = (x, y, t) => (m.terrain[y * m.w + x] = t);
const VALLEY = { x0: 30, y: 40 };
for (let i = 2; i <= 14; i++) if (i !== 8) for (let dy = -2; dy <= 2; dy++) set(VALLEY.x0 + i, VALLEY.y + dy, 2);
const RIVER = { x0: 34, y: 52 };
for (let i = 3; i <= 5; i++) for (let dy = -3; dy <= 3; dy++) set(RIVER.x0 + i, RIVER.y + dy, 3);
const BARE = { land: { x: 40, y: 60 }, water: { x: 38, y: 55 } };
for (let y = 30; y < 66; y++) for (let x = 26; x < 52; x++) g.world.retile(x, y);

const lay = (x, y) => {
  for (const r of [0, 1]) {
    if (!g.builder.placeTrackKind(x, y, 'straight', r)) continue;
    const link = g.track.get(x, y).links[0];
    if (link.includes(1) && link.includes(3)) return true;
    g.builder.removeTrack(x, y);
  }
  return false;
};
g.builder.free = true;
for (const i of [7, 8, 9]) g.builder.placeBuilding(VALLEY.x0 + i, VALLEY.y, 'bridge_stone');
for (let i = 0; i < 17; i++) lay(VALLEY.x0 + i, VALLEY.y);
for (const i of [3, 4, 5]) g.builder.placeBuilding(RIVER.x0 + i, RIVER.y, 'bridge_wood');
for (let i = 0; i < 9; i++) lay(RIVER.x0 + i, RIVER.y);
g.builder.placeBuilding(BARE.land.x, BARE.land.y, 'bridge_stone');
g.builder.placeBuilding(BARE.water.x, BARE.water.y, 'bridge_wood');
g.builder.free = false;

const centre = (x, y, zoom = 2) => {
  const p = tileToWorld(x, y);
  g.camera.zoomIndex = [0.5, 0.75, 1, 1.5, 2, 3, 4].indexOf(zoom);
  g.camera.zoom = zoom;
  g.camera.centerOn(p.x, p.y);
};
window.qa = {
  VALLEY,
  RIVER,
  BARE,
  centre,
  levels: (x0, y, n) => Array.from({ length: n }, (_, i) => levelAt(m, x0 + i, y)),
  /** canvas pixel of a tile centre: on the ground, or `lift` world px above it */
  screen: (x, y, lift = 0) => {
    const p = g.world.surfacePoint(x, y);
    return g.camera.worldToScreen(p.x, p.y - lift);
  },
  deckLift: (x, y) => g.world.deckLift(x, y),
  state: (x, y) => ({
    tool: g.build.tool,
    status: document.querySelector('#toolbar .tb-statusrow .tb-status')?.textContent ?? '',
    hover: g.tileUnderMouse(),
    overUi: g.input.overUi,
    bridge: !!g.builder.bridgeAt(x, y),
    bridgeLevel: g.builder.bridgeAt(x, y)?.level ?? null,
    track: g.track.get(x, y)?.kind ?? null,
    panel: g.buildingPanel.building
      ? g.buildingPanel.root.querySelector('.panel-title').textContent +
        ' | buttons: ' +
        [...g.buildingPanel.root.querySelectorAll('button')].map((b) => b.textContent).join(' / ')
      : null,
    tooltip: g.tooltip.root.classList.contains('show')
      ? [...g.tooltip.root.children].map((c) => c.textContent).join(' | ')
      : null,
    stone: Math.round(g.stock.get('stone')),
    wood: Math.round(g.stock.get('wood')),
    iron: Math.round(g.stock.get('iron')),
  }),
  ready: false,
};
const wait = async () => {
  while (!g.world.landscape.ready) await new Promise((r) => setTimeout(r, 50));
  window.qa.ready = true;
};
wait();

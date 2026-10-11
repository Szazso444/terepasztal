// Scratch for decks-input.mjs: the real Game with its UI and loop running, on an empty flat map
// with a pond. The script drives the real mouse; qa only reports state and screen positions.
import { Game } from '/src/game.ts';
import { emptyMap } from '/src/world/mapgen.ts';
import { levelFromMap } from '/src/world/level.ts';
import { levelAt } from '/src/world/elevation.ts';
import { tileToWorld } from '/src/engine/iso.ts';

const level = levelFromMap(emptyMap(7412, 96, 96), 'Bridge deck input');
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
// A pond of 3 x 3 water tiles.
const POND = { x: 52, y: 44 };
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m.terrain[(POND.y + dy) * m.w + POND.x + dx] = 3;
for (let y = 36; y < 56; y++) for (let x = 36; x < 60; x++) g.world.retile(x, y);

const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3, 4];
/** Centre the camera on a tile at one of the game's own zoom steps. */
function centre(x, y, zoom = 2) {
  const p = tileToWorld(x, y);
  g.camera.zoomIndex = ZOOMS.indexOf(zoom);
  g.camera.zoom = zoom;
  g.camera.centerOn(p.x, p.y);
}
/** Canvas pixel of tile (x, y)'s ground centre, `lift` world pixels above the ground. */
function screen(x, y, lift = 0) {
  const p = tileToWorld(x, y),
    s = g.camera.worldToScreen(p.x, p.y + g.world.elevationOf(x, y) - lift),
    r = g.app.canvas.getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}
/** What the game holds for tile (x, y), and what its status line says. */
function state(x, y) {
  const b = g.builder.bridgeAt(x, y),
    piece = g.track.get(x, y);
  return {
    tile: [x, y],
    platform: b ? { id: b.id, deck: b.deck ?? 'automatic', height: g.builder.deckLevel(b) } : null,
    track: piece ? piece.kind : null,
    ground: levelAt(m, x, y),
    hover: [g.hoverTile.x, g.hoverTile.y],
    tool: g.build.tool.kind === 'building' ? g.build.tool.defId : g.build.tool.kind,
    status: document.querySelector('#toolbar .tb-statusrow')?.firstElementChild?.textContent ?? '',
    selected: g.build.selectedBuilding ? [g.build.selectedBuilding.x, g.build.selectedBuilding.y] : null,
    stone: Math.floor(g.stock.get('stone')),
    wood: Math.floor(g.stock.get('wood')),
  };
}
const ready = async () => {
  for (let i = 0; i < 400 && !g.world.landscape.ready; i++) await new Promise((r) => setTimeout(r, 50));
  return g.world.landscape.ready;
};
centre(44, 44, 2);
await ready();
window.qa = { g, centre, screen, state, POND, step: g.world.landscape.step, ready: true };

// Opens a save file the way the main menu's Continue does: the world from the save, then the save.
//   /scratchpad/rails/load/?file=demo-save   (reads scratchpad/rails/out/<file>.json)
import { Game } from '/src/game.ts';
import { parseSave } from '/src/sim/save.ts';
import { tileToWorld } from '/src/engine/iso.ts';

const label = document.getElementById('qa-label');
const file = new URLSearchParams(location.search).get('file') ?? 'demo-save';
const text = await (await fetch(`/scratchpad/rails/out/${file}.json`)).text();
const save = parseSave(text);
if (!save) throw new Error('not a save');
const g = new Game(save.world, save.supply);
window.game = g;
await g.init();
g.applySave(save);
g.loop.stop();
g.app.ticker.stop();
g.closeMenus?.();
g.settings.weather = false;
g.settings.dayNight = false;
g.clock.setSpeed(0);
let now = g.clock.time;
window.qa = {
  g,
  info: () => ({
    version: save.version,
    loadedFrom: save.loadedFrom,
    notes: save.migrationNotes,
    trains: g.fleet.trains.map((t) => `${t.name}:${t.state}`),
    narrowPieces: [...g.track.tiles()].filter((t) => t.piece.cls === 'narrow').length,
  }),
  step(ticks) {
    for (let i = 0; i < ticks; i++) g.fleet.tick(1 / 60, (now += 1 / 60));
  },
  view(x, y, zoom, text = '') {
    const at = tileToWorld(x, y);
    g.camera.centerOn(at.x, at.y);
    g.camera.zoom = zoom;
    g.render(1, 0);
    g.app.renderer.render(g.app.stage);
    label.textContent = text;
  },
};

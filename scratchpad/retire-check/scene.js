// Scratch: a fresh game, to look at the starter kit and the retired tag in the UI.
import { Game } from '/src/game.ts';
import { emptyMap } from '/src/world/mapgen.ts';
import { levelFromMap } from '/src/world/level.ts';
const level = levelFromMap(emptyMap(7412, 96, 96), 'Retire check');
const g = new Game({ kind: 'level', seed: 7412, level });
window.game = g;
await g.init();
g.closeMenus();
window.qa = {
  g,
  inventory: () => g.inventory.items.map((i) => `${i.defId}`),
  give: (id) => g.inventory.add(id, 0).defId,
  roster: () => g.screens.toggle(g.rosterScreen),
};

// Scratch for decks-reload.mjs: bridges built live, then the same world loaded from its own save.
//   (no query)  builds the scene through the builder, as a player would
//   ?load=1     boots the world from the save the first run left in sessionStorage, through the
//               game's own load path (parseSave, applySave)
//   ?level=1    boots the world from the editor level the first run collected (Editor.collect),
//               through the level path (placeLevelContent)
import { Game } from '/src/game.ts';
import { emptyMap } from '/src/world/mapgen.ts';
import { levelFromMap } from '/src/world/level.ts';
import { levelAt } from '/src/world/elevation.ts';
import { tileToWorld } from '/src/engine/iso.ts';
import { railLevel } from '/src/world/railProfile.ts';
import { parseSave } from '/src/sim/save.ts';
import { rules } from '/src/sim/rules.ts';
import { Editor } from '/src/editor/editor.ts';

const KEY = 'decks-reload';
// ?load=13: the same save as the previous format wrote it (version 13, no deck heights).
const OLD = new URLSearchParams(location.search).get('load') === '13';
const LOAD = OLD || new URLSearchParams(location.search).get('load') === '1';
const LEVEL = new URLSearchParams(location.search).get('level') === '1';
const label = document.getElementById('qa-label');
const W = 96;
// Sites along row ROW (and around it), all terrain stamped before the world exists.
const SITES = {
  // A dip in a hill: land under an automatic bridge, which a load used to turn into water.
  dip: { x: 30, y: 30 },
  // A ramp on flat land, decks set by hand.
  ramp: { x: 50, y: 30 },
  // Platforms in a forest, track over them, trees all around.
  forest: { x: 30, y: 44 },
  // A pond crossed two heights up, one platform upgraded.
  pond: { x: 50, y: 44 },
  // Bare platforms at set heights, on land and on water; a curve on a raised pad.
  bare: { x: 30, y: 58 },
  pad: { x: 52, y: 58 },
};
let game, save, stored;
if (LEVEL) {
  stored = JSON.parse(sessionStorage.getItem(KEY + '-level'));
  if (!stored) throw new Error('no level to load');
  game = new Game({ kind: 'level', seed: stored.seed, level: stored });
} else if (LOAD) {
  let text = sessionStorage.getItem(KEY);
  if (OLD) {
    const j = JSON.parse(text);
    j.version = 13;
    j.buildings = j.buildings.map((e) => e.slice(0, 5));
    text = JSON.stringify(j);
  }
  save = parseSave(text);
  if (!save) throw new Error('no save to load');
  game = new Game(save.world);
} else {
  const map = emptyMap(7412, W, W);
  const stamp = (x0, y0, x1, y1, t) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) map.terrain[y * W + x] = t;
  };
  const { dip, forest, pond, bare } = SITES;
  stamp(dip.x - 6, dip.y - 3, dip.x + 6, dip.y + 3, 2);
  stamp(dip.x, dip.y - 4, dip.x, dip.y + 4, 0);
  stamp(forest.x - 5, forest.y - 3, forest.x + 5, forest.y + 3, 1);
  stamp(pond.x - 2, pond.y - 2, pond.x + 2, pond.y + 2, 3);
  stamp(bare.x + 3, bare.y - 1, bare.x + 5, bare.y + 1, 3);
  game = new Game({ kind: 'level', seed: 7412, level: levelFromMap(map, 'Bridge reload') });
}
window.game = game;
await game.init();
game.loop.stop();
game.app.ticker.stop();
if (LOAD) game.applySave(save);
if (LEVEL) game.applyLevelStart(stored);
game.closeMenus();
game.settings.autosave = false;
game.settings.weather = false;
game.settings.dayNight = false;
game.settings.smoke = false;
game.clock.setSpeed(0);
const m = game.map,
  b = game.builder;
const problems = [];
if (LEVEL) {
  for (let i = 0; i < game.regions.unlocked.length; i++) game.regions.own(i);
  game.world.rebuildFog();
}
if (!LOAD && !LEVEL) {
  b.free = true;
  rules.narrowUnlocked = true;
  for (let i = 0; i < game.regions.unlocked.length; i++) game.regions.own(i);
  game.world.rebuildFog();
  const platform = (x, y, id = 'bridge_stone') => {
    const p = b.placeBuilding(x, y, id);
    if (!p) problems.push({ what: 'platform', x, y, reason: b.checkBuilding(x, y, id).reason });
    return p;
  };
  const rail = (x0, x1, y) => {
    for (let x = x0; x <= x1; x++)
      if (!b.placeTrackKind(x, y, 'straight', 1))
        problems.push({ what: 'track', x, y, reason: b.checkTrack(x, y, { kind: 'straight', cls: 'regular', cls2: 'regular' }, 1).reason });
  };
  /** Click a platform up or down to a deck height (a new one beside a set deck starts at that deck's). */
  const raise = (p, to) => {
    for (let k = 0; k < 8 && b.deckLevel(p) !== to; k++) {
      const d = Math.sign(to - b.deckLevel(p));
      if (!b.changeDeck(p, d)) {
        problems.push({ what: 'deck', x: p.x, y: p.y, to, reason: b.checkDeck(p, d).reason });
        break;
      }
    }
  };
  const { dip, ramp, forest, pond, bare, pad } = SITES;
  // dip: three automatic spans over the dip and its shoulders
  for (const dx of [-1, 0, 1]) platform(dip.x + dx, dip.y);
  rail(dip.x - 6, dip.x + 6, dip.y);
  // ramp: 1 2 3 3 2 1, set on the finished bridge
  const spans = [-3, -2, -1, 0, 1, 2].map((dx) => platform(ramp.x + dx, ramp.y, 'bridge_wood'));
  rail(ramp.x - 5, ramp.x + 4, ramp.y);
  for (let pass = 0; pass < 3; pass++)
    [1, 2, 3, 3, 2, 1].forEach((h, i) => {
      if (b.deckLevel(spans[i]) < h && b.checkDeck(spans[i], 1).ok) b.changeDeck(spans[i], 1);
    });
  // forest: three platforms among the trees, one of them raised, track through
  for (const dx of [-1, 0, 1]) platform(forest.x + dx, forest.y);
  rail(forest.x - 4, forest.x + 4, forest.y);
  raise(b.bridgeAt(forest.x, forest.y), 1);
  // pond: five spans at height 2 with ramp spans on the banks; one upgraded twice
  const over = [-3, -2, -1, 0, 1, 2, 3].map((dx) => platform(pond.x + dx, pond.y));
  [1, 2, 2, 2, 2, 2, 1].forEach((h, i) => raise(over[i], h));
  rail(pond.x - 5, pond.x + 5, pond.y);
  b.upgradeBuilding(over[3]);
  b.upgradeBuilding(over[3]);
  // bare: platforms without rail at set heights, on land and on water
  [0, 1, 2].forEach((dx) => raise(platform(bare.x + dx, bare.y, 'bridge_wood'), dx + 1));
  [3, 4, 5].forEach((dx) => raise(platform(bare.x + dx, bare.y), dx - 2));
  // pad: a narrow curve on one platform at height 2, a deck at that height on each side
  for (const [dx, dy] of [
    [0, 0],
    [0, -1],
    [1, 0],
  ])
    raise(platform(pad.x + dx, pad.y + dy), 2);
  for (const [x, y, kind, rot] of [
    [pad.x, pad.y - 1, 'straight', 0],
    [pad.x + 1, pad.y, 'straight', 1],
    [pad.x, pad.y, 'curve', 0],
  ])
    if (!b.placeTrack(x, y, { kind, cls: 'narrow' }, rot))
      problems.push({ what: kind, x, y, reason: b.checkTrack(x, y, { kind, cls: 'narrow' }, rot).reason });
  b.free = false;
  // A load makes sure a depot stands; so does this world, before it is saved.
  game.ensureDepot();
}

async function settle() {
  game.render(1, 0);
  let n = 0;
  while (!game.world.landscape.ready && n++ < 400) {
    await new Promise((r) => setTimeout(r, 50));
    game.render(1, 0);
  }
  game.render(1, 0);
  return game.world.landscape.ready;
}
/** Wait until the terrain under the current view is painted at its close-up resolution too. */
async function sharp() {
  for (let n = 0; n < 400; n++) {
    game.render(1, 0);
    if (game.world.landscape.sharpReady) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  game.render(1, 0);
  game.app.renderer.render(game.app.stage);
  return game.world.landscape.sharpReady;
}
function view(cx, cy, zoom, text = '') {
  const at = tileToWorld(cx, cy);
  game.camera.centerOn(at.x, at.y);
  game.camera.zoom = zoom;
  game.render(1, 0);
  game.app.renderer.render(game.app.stage);
  label.textContent = text;
}
/** Everything a reload has to bring back: terrain, levels, platforms, decks and rail heights. */
function facts() {
  const out = {};
  for (const [name, s] of Object.entries(SITES)) {
    const rows = [];
    for (let y = s.y - 2; y <= s.y + 2; y++) {
      const row = [];
      for (let x = s.x - 7; x <= s.x + 7; x++) {
        const k = y * m.w + x,
          p = b.bridgeAt(x, y),
          bed = game.fleet.railBeds.get(k),
          piece = game.track.get(x, y);
        row.push(
          [
            'gfhw'[m.terrain[k]] ?? m.terrain[k],
            levelAt(m, x, y),
            p ? `${p.id.slice(7, 8)}${p.deck ?? 'a'}/${b.deckLevel(p)}/L${p.level ?? 1}` : '-',
            piece ? piece.kind[0] + (bed ? railLevel(bed, bed.axis === 'x' ? x : y).toFixed(2) : '') : '-',
            m.props.get(k)?.length ?? 0,
          ].join(' '),
        );
      }
      rows.push(row);
    }
    out[name] = rows;
  }
  return out;
}
await settle();
window.qa = {
  g: game,
  load: LOAD,
  sites: SITES,
  problems,
  view,
  settle,
  sharp,
  facts,
  /** Leave the save where the next run finds it. */
  store: () => {
    sessionStorage.setItem(KEY, JSON.stringify(game.snapshot()));
    // The same world as an editor level.
    const level = new Editor(m, b, game.world, { ...game.spec.level }).collect();
    sessionStorage.setItem(KEY + '-level', JSON.stringify(level));
    return {
      saved: game.snapshot().buildings.filter((e) => e.length > 5).length,
      inLevel: level.buildings.filter((e) => e.length > 3).length,
    };
  },
  loadedFrom: save?.loadedFrom ?? null,
};

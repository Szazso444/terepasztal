import { Game, hashSeed } from './game';
import { STR } from './strings';
import { el } from './ui/dom';
import { readSave, clearSave, writeSave, type WorldSpec } from './sim/save';
import { expandSave, ownsBorderChunk } from './sim/expand';
import { rules } from './sim/rules';
import { takeIntent, setTestingLevel, type Intent } from './intent';
import { getLevel, levelFromMap, saveLevel, type LevelData } from './world/level';
import { generateMap, emptyMap, type MapGenParams } from './world/mapgen';
import { Terrain } from './world/tiles';

function paramsFromRules(size = rules.mapSize): MapGenParams {
  return {
    w: size,
    h: size,
    waterLevel: rules.waterLevel,
    hillLevel: rules.hillLevel,
    rockLevel: rules.rockLevel,
    forestDensity: rules.forestDensity,
  };
}

/** Old-style `#seed=123&new` links still start a new game. */
function legacyHashIntent(): Intent | null {
  const m = /seed=([^&]+)/.exec(location.hash);
  if (!m) return null;
  const seed = /^\d+$/.test(m[1]) ? Number(m[1]) : hashSeed(m[1]);
  return location.hash.includes('new') ? { action: 'new', seed } : null;
}

function levelForEdit(i: Extract<Intent, { action: 'edit' }>): LevelData | null {
  if (i.levelId) return getLevel(i.levelId);
  const size = i.size ?? 64;
  const seed = i.seed ?? Math.floor(Math.random() * 2 ** 31);
  const map = i.blank
    ? emptyMap(seed, size, size, Terrain.Grass)
    : generateMap(seed, paramsFromRules(size));
  const level = levelFromMap(map, `Level ${new Date().toLocaleDateString()}`);
  level.start = {
    money: rules.startMoney,
    tickets: rules.startTickets,
    reputation: rules.startReputation,
    tier: 0,
  };
  saveLevel(level);
  return level;
}

async function boot() {
  const loading = el('div', { id: 'loading' }, STR.title, el('small', { text: STR.loading }));
  document.getElementById('ui-root')!.append(loading);
  const intent = takeIntent() ?? legacyHashIntent();
  if (location.hash) history.replaceState(null, '', location.pathname);

  let spec: WorldSpec;
  let save = null as ReturnType<typeof readSave>;
  let level: LevelData | null = null;
  let start: 'menu' | 'play' | 'editor' = 'menu';

  if (intent?.action === 'new') {
    clearSave();
    setTestingLevel(null);
    spec = { kind: 'generated', seed: intent.seed, params: paramsFromRules() };
    start = 'play';
  } else if (intent?.action === 'play' && (level = getLevel(intent.levelId))) {
    clearSave();
    spec = { kind: 'level', seed: level.seed, level };
    start = 'play';
  } else if (intent?.action === 'edit' && (level = levelForEdit(intent))) {
    spec = { kind: 'level', seed: level.seed, level };
    start = 'editor';
  } else {
    save = readSave();
    spec = save?.world ?? {
      kind: 'generated',
      seed: Math.floor(Math.random() * 2 ** 31),
      params: paramsFromRules(),
    };
    // a generated world grows a ring of chunks whenever an owned chunk touches its edge (old
    // saves from the fixed-grid days come through here too)
    if (save && spec.kind === 'generated') {
      let grown = false;
      let guard = 0;
      let gp = spec.params;
      while (
        guard++ < 8 &&
        (gp.w < rules.mapSize || (save.regions && ownsBorderChunk(save.regions, gp.w, gp.h)))
      ) {
        expandSave(save, 1);
        if (save.world?.kind !== 'generated') break;
        gp = save.world.params;
        spec = save.world;
        grown = true;
      }
      if (grown) writeSave(save);
    }
    start = intent?.action === 'continue' && save ? 'play' : 'menu';
    if (save?.world?.kind !== 'level') setTestingLevel(null);
  }

  const game = new Game(spec);
  (window as unknown as { game: Game }).game = game;
  await game.init();
  if (start === 'editor' && level) game.enterEditor(level);
  else if (save) game.applySave(save);
  else if (level) game.applyLevelStart(level);
  else game.startFresh();
  // the game always starts paused; Space or the pause button starts the clock
  if (start !== 'editor') game.clock.setSpeed(0);
  if (start === 'menu') game.openMainMenu();
  loading.remove();
}

boot().catch((e) => {
  console.error(e);
  const box = el(
    'pre',
    { style: 'color:#d05a50;padding:20px;font-size:13px' },
    String(e?.stack ?? e),
  );
  document.body.append(box);
});

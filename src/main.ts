import { Game, hashSeed } from './game';
import { el } from './ui/dom';
import { LoadingScreen } from './ui/loadingScreen';
import { Toasts } from './ui/toast';
import {
  readSave,
  storedRefusal,
  clearSave,
  writeSave,
  freezeStoredSaves,
  type SaveRefusal,
  type WorldSpec,
} from './sim/save';
import { ownsBorderChunk } from './sim/expand';
import { generatorOf, groundOf, type GeneratedWorld } from './sim/ground';
import { growHolding } from './sim/holdGround';
import { restoreGround } from './sim/underground';
import { tileLevels } from './world/elevation';
import { rules, rulesFrom } from './sim/rules';
import { takeIntent, setTestingLevel, type Intent } from './intent';
import { getLevel, levelFromMap, saveLevel, type LevelData } from './world/level';
import { generateMap, emptyMap, type MapGenParams } from './world/mapgen';
import { Terrain } from './world/tiles';
import type { SupplyMode } from './sim/supply';
import { armDevReload, takeDevSession, reportDevTraffic } from './engine/devsession';
import { groundPassPending, startupToasts } from './engine/saveMessages';
import { audio } from './engine/audio';
import { LANGUAGE, STR } from './strings';
import {
  BOOT_STAGES,
  BootProgress,
  GROUND_WAIT_MS,
  bootPlan,
  groundFraction,
  type BootPlan,
  type BootStage,
} from './engine/boot';

declare global {
  interface Window {
    /** The running game, for the debug panel and the browser scripts in `scratchpad/`. */
    game: Game;
  }
}

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
  const level = levelFromMap(map, STR.menu.levelDefaultName(new Date().toLocaleDateString()));
  level.start = {
    money: rules.startMoney,
    tier: 0,
  };
  saveLevel(level);
  return level;
}

/** Resolves once the browser has painted: a frame's callback runs before its paint, a task after. */
function afterPaint() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
}

/**
 * Toasts that wait while the loading screen is up. What the boot says (a refused or repaired save,
 * a lost landscape) shows once the screen has gone, for its full few seconds, rather than running
 * out behind it.
 */
class BootToasts extends Toasts {
  private held: Parameters<Toasts['push']>[] | null = [];
  push(...toast: Parameters<Toasts['push']>) {
    if (this.held) this.held.push(toast);
    else super.push(...toast);
  }
  /** The screen has gone: what was held shows, in order, and what comes later shows at once. */
  release() {
    const held = this.held ?? [];
    this.held = null;
    for (const toast of held) super.push(...toast);
  }
}

/**
 * The last stage of the bar: the ground in the camera's view is painted. The bar follows the
 * chunks in view as they are painted; the wait ends once they all are, after `GROUND_WAIT_MS` at
 * most, and at once when painting fails (the per-tile ground covers everything then).
 */
async function groundInView(game: Game, report: (fraction: number) => void) {
  // a frame with the camera where the game starts, so the landscape knows which chunks are in view
  await afterPaint();
  const landscape = game.world.landscape;
  let frame = 0;
  const follow = () => {
    report(groundFraction(landscape.viewProgress()));
    frame = requestAnimationFrame(follow);
  };
  follow();
  await landscape.whenViewPainted(GROUND_WAIT_MS);
  cancelAnimationFrame(frame);
  report(1);
}

/**
 * The music starts now. The player clicked on the way here, and a browser that carries that click
 * over the reload it led to plays the music at once; one that does not plays it at the next click.
 */
function startMusicNow() {
  audio.startMusic();
  audio.tryUnlock();
}

/**
 * The end of the loading screen, its bar full: the music as it finishes where the plan says so,
 * "Click to begin" where the plan asks for it, then the reveal, which `begin` starts the game with
 * as it begins. Where no reveal plays (the title), the screen still leaves through its fade and
 * iris, its only way out, and `begin` is not called.
 */
async function endLoading(screen: LoadingScreen, plan: BootPlan, begin: () => void) {
  if (plan.music === 'loaded') screen.onLoaded = startMusicNow;
  screen.done();
  if (plan.clickToBegin) await screen.waitForClick();
  screen.onRevealStart = () => {
    // the click unlocks the sound; without one, the keys pressed over the screen never reached
    // the bus, so it unlocks here, once the page has had a gesture at all
    if (!plan.clickToBegin && navigator.userActivation?.hasBeenActive !== false) audio.unlock();
    // on a page opened afresh, the click to begin is the page's first, and the music starts with it
    if (plan.music === 'click') audio.startMusic();
    if (plan.reveal) begin();
  };
  await screen.reveal();
}

/**
 * Continue on the title the boot opened: the game under it begins as every way into play does,
 * behind the loading screen until the ground in view is painted, with the music as that finishes,
 * then "Click to begin" and the reveal. The stages before the ground were loaded with the title.
 * The clock stands still behind the screen (the title stopped it at the boot's loading screen,
 * and `Game.resumeGame` brings that back) and runs at 1x from the reveal on, as every game starts.
 */
async function continueFromTitle(game: Game) {
  const plan = bootPlan(null, { continueFromTitle: true });
  if (!plan.loading) return audio.startMusic();
  const screen = new LoadingScreen();
  const progress = new BootProgress();
  for (const stage of BOOT_STAGES)
    if (stage !== 'ground') screen.setProgress(progress.report(stage, 1));
  await groundInView(game, (f) => screen.setProgress(progress.report('ground', f)));
  await endLoading(screen, plan, () => game.clock.setSpeed(1));
}

async function boot() {
  document.documentElement.lang = LANGUAGE;
  // no music until loading finishes or the title screen's Play; its first track downloads
  // meanwhile, so it starts at once
  audio.hold();
  audio.preload();
  // an intent a menu stored before reloading; with none, the page was opened afresh
  const stored = takeIntent();
  const intent = stored ?? legacyHashIntent();
  if (location.hash) history.replaceState(null, '', location.pathname);
  // A dev-server reload carries the running game over, so an edit lands where you were.
  const resumed = takeDevSession();
  const asked = bootPlan(intent, { devReload: resumed !== null, fresh: stored === null });
  const screen = asked.loading ? new LoadingScreen() : null;
  const progress = new BootProgress();
  const report = (stage: BootStage, fraction: number) =>
    screen?.setProgress(progress.report(stage, fraction));
  // saves stored before saves kept their ground get it once: Continue's and every named one. That
  // takes a while, so the loading screen is painted first
  if (groundPassPending()) await afterPaint();
  const frozen = freezeStoredSaves();

  let spec: WorldSpec;
  let save = null as ReturnType<typeof readSave>;
  let level: LevelData | null = null;
  let start: 'menu' | 'play' | 'editor' = 'menu';
  /** production chain of the game about to run (new game choice, level start block or save) */
  let supply: SupplyMode | undefined;
  /** why the stored game Continue loads was refused, when the menu opens without it */
  let refused: SaveRefusal | null = null;

  if (resumed) {
    save = resumed;
    spec = resumed.world ?? { kind: 'generated', seed: resumed.seed, params: paramsFromRules() };
    supply = resumed.supply;
    start = 'play';
  } else if (intent?.action === 'new') {
    clearSave();
    setTestingLevel(null);
    spec = { kind: 'generated', seed: intent.seed, params: paramsFromRules() };
    supply = intent.supply;
    start = 'play';
  } else if (intent?.action === 'play' && (level = getLevel(intent.levelId))) {
    clearSave();
    spec = { kind: 'level', seed: level.seed, level };
    supply = level.start.supply;
    start = 'play';
  } else if (intent?.action === 'edit' && (level = levelForEdit(intent))) {
    spec = { kind: 'level', seed: level.seed, level };
    start = 'editor';
  } else {
    save = readSave();
    if (!save) refused = storedRefusal();
    spec = save?.world ?? {
      kind: 'generated',
      seed: Math.floor(Math.random() * 2 ** 31),
      params: paramsFromRules(),
    };
    // a generated world grows a ring of chunks whenever an owned chunk touches its edge (old
    // saves from the fixed-grid days come through here too)
    if (save && spec.kind === 'generated') {
      // the size the save's own tuning asks for, not the stored tuning a new game starts from
      const mapSize = rulesFrom(save.rules).mapSize;
      let grown = false;
      let guard = 0;
      let gp = spec.params;
      while (
        guard++ < 8 &&
        (gp.w < mapSize || (save.regions && ownsBorderChunk(save.regions, gp.w, gp.h)))
      ) {
        const grow = save;
        growHolding(grow, () => {
          const { map } = groundOf(spec as GeneratedWorld, generatorOf(grow.supply));
          restoreGround(map, grow);
          return tileLevels(map);
        });
        if (save.world?.kind !== 'generated') break;
        gp = save.world.params;
        spec = save.world;
        grown = true;
      }
      if (grown) writeSave(save);
    }
    start = intent?.action === 'continue' && save ? 'play' : 'menu';
    if (save?.world?.kind !== 'level') setTestingLevel(null);
    supply = save?.supply;
  }

  // an intent the boot could not carry out (its level or its stored game is gone) opens the title
  const plan = start === 'menu' ? bootPlan(null) : asked;

  const game = new Game(spec, supply, save ?? undefined);
  window.game = game;
  // what the boot says waits for the loading screen to go
  const toasts = new BootToasts();
  game.toasts = toasts;
  await game.init(async (stage, fraction) => {
    report(stage, fraction);
    // a stage that is over is painted before the next one holds the thread (the map's does)
    if (screen && fraction >= 1) await afterPaint();
  });
  if (start === 'editor' && level) game.enterEditor(level);
  else if (save) game.applySave(save);
  else if (level) game.applyLevelStart(level);
  else game.startFresh();
  // a game starts at 1x, whatever speed its save was at; the editor stays stopped. A dev reload
  // keeps the speed the snapshot was taken at instead, so a running game stays running, and so
  // does growing the world, from the reveal on: the clock stands still behind the loading screen.
  // Under the title it stays stopped, even with no loading screen (an intent the boot could not
  // carry out), so its Continue does not run the clock behind its own loading screen: that one
  // starts 1x at its reveal (`continueFromTitle`).
  if (start !== 'editor' && !resumed && !(intent?.action === 'continue' && intent.keepSpeed))
    game.clock.setSpeed(start === 'menu' ? 0 : 1);
  const speed = game.clock.speedIndex;
  if (screen) game.clock.setSpeed(0);
  if (start === 'menu') {
    game.openMainMenu();
    game.onTitleContinue = () => void continueFromTitle(game);
  }
  for (const t of startupToasts(frozen, refused)) game.toasts.push(t.text, t.kind);
  armDevReload(() => (game.mode === 'play' && !game.menuOpen ? game.snapshot() : null));
  if (import.meta.env.DEV)
    reportDevTraffic(() => ({
      time: game.clock.time,
      traffic: game.traffic.report(game.fleet.trains),
    }));
  if (screen) {
    await groundInView(game, (f) => report('ground', f));
    await endLoading(screen, plan, () => game.clock.setSpeed(speed));
  } else if (start !== 'menu') audio.startMusic();
  toasts.release();
}

boot().catch((e) => {
  console.error(e);
  // a boot that failed behind the loading screen shows its error, not the screen
  document.getElementById('loading-screen')?.remove();
  const box = el(
    'pre',
    { style: 'color:#d05a50;padding:20px;font-size:13px' },
    String(e?.stack ?? e),
  );
  document.body.append(box);
});

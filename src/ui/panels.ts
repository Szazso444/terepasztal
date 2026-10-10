import { el, btn, fmtMoney } from './dom';
import { STR } from '../strings';
import { sfx } from '../engine/audio';
import type { AtlasRegistry } from '../engine/atlas';
import type { Camera } from '../engine/camera';
import { testingLevel } from '../intent';
import type { GameMap } from '../world/tiles';
import type { RegionState } from '../world/regions';
import { listLevels } from '../world/level';
import { ageStatus, type AgeSnapshot } from '../sim/ages';
import type { GameClock } from '../sim/time';
import type { Economy } from '../sim/economy';
import { RESOURCE_IDS, scaleCost, type Stockpile } from '../sim/stockpile';
import type { Fleet } from '../sim/fleet';
import type { Builder, Decor } from '../sim/build';
import type { ContractBoard } from '../sim/contracts';
import type { TradeDesk } from '../sim/trade';
import type { Town, TownRegistry } from '../sim/towns';
import type { HouseRegistry } from '../sim/houses';
import type { PowerGrid } from '../sim/power';
import type { Notice, Notices } from '../sim/notices';
import type { Station } from '../sim/stations';
import type { Train } from '../sim/trains';
import type { Commands } from '../sim/commands';
import { cargoDef } from '../sim/cargo';
import { resourceStats } from '../sim/stats';
import { withoutInCab } from '../sim/compat';
import { readRules, rulesDiffer } from '../sim/rules';
import { supplyMode, type SupplyMode } from '../sim/supply';
import {
  SAVE_VERSION,
  CONTRACT_RARITIES,
  continueMeta,
  contractPolicyFor,
  hasSlot,
  listSlots,
  readSave,
  readSlot,
  uniformContractPolicy,
  type SaveRefusal,
  type Settings,
  type SlotMeta,
} from '../sim/save';
import { contentIsCustom } from '../data/content';
import type { Gacha } from '../gacha/gacha';
import type { Crafting } from '../gacha/crafting';
import type { Inventory } from '../gacha/inventory';
import type { Screen, ScreenManager } from './modal';
import type { Toasts } from './toast';
import type { Tooltip } from './tooltip';
import type { NamePrompt } from './namePrompt';
import type { BuildController } from './buildController';
import type { KeyHost, KeyScreen } from './keymap';
import {
  MainMenu,
  PauseMenu,
  type AudioActions,
  type ContinueTarget,
  type SlotActions,
} from './menu';
import { Hud } from './hud';
import { DepotScreen } from './depot';
import { TrainScreen } from './trainScreen';
import { MarketScreen } from './marketScreen';
import { ResourceBar } from './resourceBar';
import { TuningScreen } from './tuningScreen';
import { ContentScreen } from './contentScreen';
import { SettingsScreen } from './settingsScreen';
import { GachaScreen } from './gachaScreen';
import { CraftingScreen } from './craftingScreen';
import { RosterScreen } from './rosterScreen';
import { ContractsScreen } from './contractsScreen';
import { ContractsSide } from './contractsSide';
import { Minimap } from './minimap';
import { DebugPanel } from './debug';
import { Toolbar, type Tool } from './toolbar';
import { BuildingPanel } from './buildingPanel';
import { DecorPanel } from './decorPanel';
import { TrainSide } from './trainSide';
import { NoticePanel } from './noticePanel';
import { Advisor } from './advisor';
import { BuildInfo } from './buildInfo';
import { StationPanel } from './stationPanel';
import { TownPanel } from './townPanel';
import { showSignalGuide } from './signalGuide';

/**
 * The play UI: every panel, screen and menu of a game, built and wired in one place. The game
 * hands over its simulation objects once (`PlayUiDomains`) and answers the few things only it can
 * do (`UiHost`); adding a panel or a hotkey needs neither `src/game.ts` nor a new host call unless
 * the panel moves the camera, writes storage or reloads the page.
 */

/** What the panels read and call, passed once. */
export interface PlayUiDomains {
  clock: GameClock;
  economy: Economy;
  stock: Stockpile;
  inventory: Inventory;
  fleet: Fleet;
  builder: Builder;
  contracts: ContractBoard;
  gacha: Gacha;
  crafting: Crafting;
  trade: TradeDesk;
  towns: TownRegistry;
  houses: HouseRegistry;
  power: PowerGrid;
  notices: Notices;
  atlas: AtlasRegistry;
  map: GameMap;
  regions: RegionState;
  /** read by the minimap; moving it is a host call */
  camera: Camera;
  /** the player's settings, edited in place; they travel with the settings, not the save */
  settings: Settings;
  toasts: Toasts;
  screens: ScreenManager;
  namePrompt: NamePrompt;
  /** the simulation commands panels change trains, stations, signals, trade and pulls through */
  commands: Commands;
  /** the build controller the toolbar and the selection panels drive */
  build: BuildController;
  tooltip: Tooltip;
  /** the element every root is appended to (`#ui-root`) */
  uiRoot: HTMLElement;
}

/**
 * What only the game can do for the panels. Acts that write storage, reload the page or move the
 * camera are here; prompts, confirmations and toasts are the UI's and stay in this file.
 */
export interface UiHost {
  // ------------------------------------------------------------ what the panels read
  /** play = a game; editor = the level editor */
  readonly mode: 'play' | 'editor';
  /** 0 the field view, 1 the overview */
  readonly viewTarget: 0 | 1;
  /** 0 to 1 while the view slides between them */
  readonly viewBlend: number;
  readonly seed: number;
  /** when the stored game was last written, for the settings screen */
  readonly savedAt: number | null;
  /** the warning a converted save carries, for the settings screen */
  readonly deprecatedSave: string | null;
  /** the level being edited, when the editor is open */
  readonly editor: { readonly dirty: boolean } | null;
  /** a route is being recorded for the train picked in the overview */
  readonly recordingRoute: boolean;
  /** the train picked in the overview */
  readonly overviewTrainId: number | null;
  /** the live numbers the age goals are measured against */
  ageSnapshot(): AgeSnapshot;
  /** storage cap for one resource at the current warehouse and plant count */
  stockCap(id: string): number;

  // ------------------------------------------------------------ camera and view
  /** close the screens and look at the train */
  focusTrain(t: Train): void;
  /** look at a depot behind the dimmed screen and mark the gate a train would leave by */
  peekDepot(depot: Station, gate: { x: number; y: number } | null): void;
  /** take down the gate mark `peekDepot` put up */
  endDepotPeek(): void;
  /** look at what a notice points to; a train's notice also opens its screen */
  focusNotice(n: Notice): void;
  /** back to the field view, the camera over a tile */
  returnToRts(tx: number, ty: number): void;
  /** the camera over a world point */
  centerCamera(wx: number, wy: number): void;
  setView(v: 0 | 1): void;
  toggleOverview(): void;
  /** pick a train in the field view: its path lights up and its card follows it */
  selectFieldTrain(t: Train | null): void;
  /** trace a train's path while the pointer is on its card */
  setHoverTrain(t: Train | null): void;
  /** tint the block a signal guards; null clears it */
  highlightSignalBlock(d: Decor | null): void;
  /** colour every sprite by its depth key; returns whether the overlay is now on */
  toggleDepth(): boolean;

  // ------------------------------------------------------------ overview routes
  /** start recording stops for the picked train, or finish */
  toggleRecording(): void;
  /** give the train the recorded stops (two at least) */
  finishRecording(): void;
  /** drop the recording; the train keeps its schedule */
  cancelRecording(): void;
  /** forget the train picked in the overview */
  dropOverviewTrain(): void;

  // ------------------------------------------------------------ the running game
  /** stop the clock while a menu is up, remembering its speed */
  pauseGame(): void;
  /** the clock runs again at the speed it had */
  resumeGame(): void;
  /** apply the settings (audio, weather, signalling) and store them */
  applySettings(): void;
  /** store the settings without applying them */
  saveSettings(): void;
  /** re-tint the world and production for the season; `force` even when it has not changed */
  applySeason(force?: boolean): void;
  /** ask for a town's name; `fresh` marks a just-founded town (its default name is offered) */
  renameTown(t: Town, fresh?: boolean): void;
  /** money, tickets and a full stockpile, for testing */
  cheat(): void;

  // ------------------------------------------------------------ storage and reloads
  /** store the game; says so unless `silent`; false when storage refused it */
  save(silent?: boolean): boolean;
  /** store the game under a name and say so; false when storage refused it */
  saveSlot(name: string): boolean;
  /** make a named save the stored game and reload into it; false when there is none */
  loadSlot(name: string): boolean;
  deleteSlot(name: string): void;
  /** reload into the stored game; false when there is none */
  loadSave(): boolean;
  /** the game as save text */
  exportSave(): string;
  /** the save plus the traffic log, for bug reports */
  diagnostics(): string;
  /** store a save text the player brought and reload into it; a refused text changes nothing */
  importSave(json: string): { ok: true } | { ok: false; error: SaveRefusal };
  /** clear the stored game and start a new map from a seed text (empty: a random one) */
  newGame(seed: string, supply: SupplyMode): void;
  /** clear the stored game and play a level */
  playLevel(id: string): void;
  editLevel(id: string): void;
  /** open the editor on a new level, blank or generated from a seed text */
  newLevel(size: number, generated: boolean, seed: string): void;
  deleteLevel(id: string): void;
  /** store a level from its text; false when the text is not a level */
  importLevel(json: string): boolean;
  /** leave a play-test for the editor on the level being tested */
  backToEditor(): void;
  /** reload to the title screen */
  reloadToMenu(): void;
  /** reload on a new map from a seed text */
  regenerate(seed: string): void;
}

/** The panels, screens and menus of a game, under the names the game uses for them. */
export interface PlayUi {
  readonly hud: Hud;
  readonly depot: DepotScreen;
  readonly trainScreen: TrainScreen;
  readonly marketScreen: MarketScreen;
  readonly resourceBar: ResourceBar;
  readonly tuningScreen: TuningScreen;
  readonly contentScreen: ContentScreen;
  readonly settingsScreen: SettingsScreen;
  readonly gachaScreen: GachaScreen;
  readonly craftingScreen: CraftingScreen;
  readonly rosterScreen: RosterScreen;
  readonly contractsScreen: ContractsScreen;
  readonly contractsSide: ContractsSide;
  readonly minimap: Minimap;
  readonly debug: DebugPanel;
  readonly overviewBanner: HTMLElement;
  readonly toolbar: Toolbar;
  readonly buildingPanel: BuildingPanel;
  readonly decorPanel: DecorPanel;
  readonly trainSide: TrainSide;
  readonly noticePanel: NoticePanel;
  readonly advisor: Advisor;
  readonly buildInfo: BuildInfo;
  readonly stationPanel: StationPanel;
  readonly townPanel: TownPanel;
  readonly mainMenu: MainMenu;
  readonly pauseMenu: PauseMenu;
  /** the title or the pause menu is up */
  readonly menuOpen: boolean;
  /**
   * The title screen at boot, over the stored game or a world not yet played: loading a save from
   * it asks nothing. The pause menu opens it over the game being played itself.
   */
  openMainMenu(): void;
  /** the pause menu over the paused game (not over the title screen) */
  openPauseMenu(): void;
  /** both menus down; the clock runs again */
  closeMenus(): void;
  /** what `handlePlayKeys` reads and calls */
  readonly keys: KeyHost;
}

/** Starting something new replaces the stored game: ask first when there is one. */
export function confirmReplaceSave() {
  return !readSave() || confirm(STR.menu.confirmReplace);
}

/** Build every panel, screen and menu of a game, wire them and put them in the UI root. */
export function createPlayUi(host: UiHost, d: PlayUiDomains): PlayUi {
  const toast = (m: string, k?: 'info' | 'warn' | 'good') => d.toasts.push(m, k);

  const hud = new Hud(d.clock, () => ageStatus(d.economy.tier, host.ageSnapshot()));
  const depot = new DepotScreen(d.inventory, d.fleet, d.builder, toast, d.atlas);
  depot.onFocusTrain = (t) => host.focusTrain(t);
  depot.onFocusDepot = (dep, gate) => {
    // peek at the shed behind the dimmed screen and mark the gate the train would take
    host.peekDepot(dep, gate);
    d.screens.root.classList.add('peek');
  };
  d.screens.onChange = (sc) => {
    if (sc) d.build.setTool({ kind: 'none' });
    if (!sc) {
      d.screens.root.classList.remove('peek');
      host.endDepotPeek();
    }
    sfx(sc ? 'ui.open' : 'ui.close');
  };
  const trainScreen = new TrainScreen(d.fleet, d.builder, d.stock, d.commands, d.atlas, toast);
  trainScreen.onLocate = (t) => host.focusTrain(t);
  const trainDetails = (t: Train) => {
    trainScreen.open(t);
    d.screens.open(trainScreen);
  };
  depot.onDetails = trainDetails;
  const marketScreen = new MarketScreen(
    d.stock,
    d.economy,
    (id) => host.stockCap(id),
    toast,
    d.trade,
    () => d.clock.time,
    d.commands,
  );
  d.trade.onSettled = (lines) =>
    d.toasts.push(
      STR.market.settled(
        lines
          .map(
            (l) =>
              `${l.units > 0 ? '+' : ''}${l.units} ${cargoDef(l.resource).name.toLowerCase()} (${fmtMoney(l.money)})`,
          )
          .join(', '),
      ),
      'info',
    );
  const resourceBar = new ResourceBar(d.atlas, () => {
    if (host.mode === 'play' && !menuOpen()) d.screens.toggle(marketScreen);
  });
  resourceBar.right.append(hud.funds);
  resourceBar.stats = () => resourceStats(d.stock, RESOURCE_IDS);
  const tuningScreen = new TuningScreen(() => {
    host.applySeason(true);
    toolbar.refresh();
  });
  const contentScreen = new ContentScreen(() => {
    if (host.mode === 'play' && !menuOpen()) host.save(true);
    host.reloadToMenu();
  });
  const settingsScreen = new SettingsScreen(
    d.settings,
    () => host.applySettings(),
    {
      save: () => host.save(),
      load: () => {
        if (!readSave()) {
          d.toasts.push(STR.settings.noSave, 'warn');
          return;
        }
        askBeforeLoad(STR.saves.confirmLoadLast, () => {
          if (!host.loadSave()) d.toasts.push(STR.settings.noSave, 'warn');
        });
      },
      newGame: (seed) => host.newGame(seed, supplyMode()),
      exportSave: () => host.exportSave(),
      exportDiagnostics: () => host.diagnostics(),
      saveAs: (name) => host.saveSlot(name),
      ...slotActions(),
      // a refused text changes nothing; the player's settings never come from a save
      importSave: (json) => {
        const read = host.importSave(json);
        if (!read.ok) {
          d.toasts.push(STR.saves.refused[read.error], 'warn');
          return false;
        }
        return true;
      },
    },
    () => ({
      seed: host.seed,
      savedAt: host.savedAt,
      version: `v${SAVE_VERSION}`,
      warning: host.deprecatedSave,
    }),
    d.namePrompt,
  );
  const gachaScreen = new GachaScreen(
    d.gacha,
    d.economy,
    d.commands,
    () => d.clock.time,
    toast,
    d.atlas,
    () => d.clock.day,
  );
  const craftingScreen = new CraftingScreen(
    d.crafting,
    d.economy,
    d.stock,
    d.inventory,
    () => d.clock.time,
    toast,
    d.atlas,
  );
  const rosterScreen = new RosterScreen(d.inventory, d.fleet, d.commands, d.atlas, toast);
  const contractsScreen = new ContractsScreen(d.contracts, d.builder, d.clock, toast);
  contractsScreen.trainName = (id) => d.fleet.byId(id)?.name ?? null;
  contractsScreen.autoAccept = {
    get: () => CONTRACT_RARITIES.every((r) => contractPolicyFor(d.settings, r) === 'accept'),
    set: (v) => {
      d.settings.contractPolicy = uniformContractPolicy(v ? 'accept' : 'prompt');
      host.applySettings();
    },
  };
  const contractsSide = new ContractsSide(d.contracts, d.builder, d.clock);
  contractsSide.onOpenBoard = () => d.screens.toggle(contractsScreen);
  hud.actions.append(
    btn(STR.topbar.depot, () => d.screens.toggle(depot), 'small'),
    btn(STR.topbar.contracts, () => d.screens.toggle(contractsScreen), 'small'),
    btn(STR.topbar.craft, () => d.screens.toggle(craftingScreen), 'small'),
    btn(STR.topbar.roster, () => d.screens.toggle(rosterScreen), 'small'),
    btn(STR.topbar.market, () => d.screens.toggle(marketScreen), 'small'),
    btn(STR.topbar.cheat, () => host.cheat(), 'small cheat'),
    btn(STR.topbar.settings, () => d.screens.toggle(settingsScreen), 'small'),
  );

  const minimap = new Minimap(d.map, d.regions, d.camera, (wx, wy) => host.centerCamera(wx, wy));
  const debug = new DebugPanel(host.seed, {
    giveMoney: () => (d.economy.money += 10000),
    giveTickets: () => (d.economy.tickets += 10),
    nextAge: () => d.economy.setAge(d.economy.tier + 1),
    giveResources: () => {
      for (const id of RESOURCE_IDS) d.stock.add(id, 200, host.stockCap(id));
    },
    spawnContract: () => {
      const c = d.contracts.generate(d.clock.time, true);
      d.toasts.push(c ? STR.debug.offer(c.name) : STR.contracts.needStations, c ? 'info' : 'warn');
    },
    toggleDepth: () => host.toggleDepth(),
    regenerate: () => host.regenerate(debug.seedValue),
  });
  const overviewBanner = el('div', {
    id: 'overview-banner',
    class: 'panel',
    text: STR.overview.hint,
  });
  const toolbar = new Toolbar(
    (t: Tool) => d.build.setTool(t),
    () => (host.mode === 'editor' ? 99 : d.economy.tier),
    d.atlas,
  );
  toolbar.onHover = (it) => buildInfo.show(it ?? toolbar.item(toolbar.active));
  // the next one of a kind costs more: show the live price on the cards
  for (const c of toolbar.categories)
    for (const it of c.items) {
      const tool = it.tool;
      if (tool.kind === 'station' || tool.kind === 'decor' || tool.kind === 'building') {
        const id = tool.defId;
        it.costNow = () =>
          scaleCost(it.cost, tool.kind === 'station' && id === 'depot' ? 1 : d.builder.kindMul(id));
      }
    }
  toolbar.refresh();
  const buildingPanel = new BuildingPanel(
    d.builder,
    d.stock,
    () => d.build.selectedBuilding && d.build.selectBuilding(null),
  );
  const decorPanel = new DecorPanel(d.builder, d.power, d.commands, toast, () => {
    if (d.build.selectedDecor) d.build.selectDecor(null);
  });
  decorPanel.houses = d.houses;
  decorPanel.onSignalGuide = showSignalGuide;
  decorPanel.onSignalBlock = (dec) => host.highlightSignalBlock(dec);
  const trainSide = new TrainSide(d.builder, d.atlas, d.commands, toast);
  const noticePanel = new NoticePanel();
  noticePanel.onFocus = (n) => host.focusNotice(n);
  const advisor = new Advisor(d.settings.advisor === false);
  advisor.onSilence = (v) => {
    d.settings.advisor = !v;
    host.saveSettings();
  };
  hud.rightActions.append(advisor.button, btn(STR.hud.signalGuide, showSignalGuide, 'small'));
  hud.onToggleWeather = () => {
    d.settings.weather = !d.settings.weather;
    host.applySettings();
  };
  hud.onToggleDay = () => {
    d.settings.dayNight = !d.settings.dayNight;
    host.applySettings();
  };
  trainSide.onRefuel = (trains) => {
    const ok = d.fleet.refuelAll(trains);
    d.toasts.push(ok ? STR.trainSide.refuelled : STR.trainSide.refuelShort, ok ? 'good' : 'warn');
    trainSide.update(trains, host.viewTarget === 1, true);
  };
  trainSide.onDetails = trainDetails;
  trainSide.onLocate = (t) => host.focusTrain(t);
  trainSide.onHover = (t) => host.setHoverTrain(t);
  const buildInfo = new BuildInfo(d.atlas, d.stock, d.builder);
  buildInfo.onTrainDetails = trainDetails;
  buildInfo.onTrainLocate = (t) => host.focusTrain(t);
  buildInfo.onTrainClose = () => host.selectFieldTrain(null);
  const stationPanel = new StationPanel(
    d.builder,
    () => d.build.selected && d.build.select(null),
    d.contracts,
    d.clock,
    d.towns,
    (t) => host.renameTown(t),
    d.commands,
    toast,
  );
  const townPanel = new TownPanel(d.towns, d.houses);
  townPanel.onGo = (t) => {
    const st = d.towns.station(t);
    if (st) host.returnToRts(st.x, st.y);
  };
  townPanel.onRename = (t) => host.renameTown(t);
  d.towns.onChanged = () => {
    if (stationPanel.station) stationPanel.render();
    depot.refresh();
  };

  // the build controller opens the panel of what it selects and reports to the toolbar
  d.build.onTownPlaced = (st) => {
    const t = d.towns.found(st);
    host.renameTown(t, true);
  };
  d.build.onSelect = (s) => {
    if (s) host.selectFieldTrain(null);
    if (s) stationPanel.open(s);
    else if (stationPanel.station) stationPanel.close();
  };
  d.build.onSelectBuilding = (b) =>
    b ? buildingPanel.open(b) : buildingPanel.building && buildingPanel.close();
  d.build.onSelectDecor = (dec) =>
    dec ? decorPanel.open(dec) : decorPanel.decor && decorPanel.close();
  d.build.onStatus = (t) => toolbar.setStatus(t);
  d.build.barredTrains = () => withoutInCab(d.fleet.trains);
  d.build.onToolChanged = (t) => {
    toolbar.setActive(t);
    buildInfo.show(toolbar.item(t));
  };

  // ---------------------------------------------------------------- menus
  const menuOpen = () => mainMenu.visible || pauseMenu.visible;
  /**
   * The title screen was opened from the pause menu, over the game being played: Continue goes
   * back to that game and loading over it asks first. False at boot, where the game under it is the
   * stored one or a world not yet played.
   */
  let titleOverGame = false;
  /**
   * What Continue goes back to: over a game being played that game, described like a save; at boot
   * the stored save, which is the game under the title screen; null when there is none.
   */
  function continueTarget(overGame: boolean): ContinueTarget | null {
    if (overGame) {
      const live: SlotMeta = {
        name: '',
        savedAt: host.savedAt ?? 0,
        version: SAVE_VERSION,
        seed: host.seed,
        day: d.clock.day,
        age: d.economy.tier,
        money: d.economy.money,
      };
      return { meta: live, live: true };
    }
    const stored = continueMeta();
    return stored && { meta: stored, live: false };
  }
  /** The title screen over the paused game; `overGame` when the pause menu opened it. */
  function showMainMenu(overGame: boolean) {
    titleOverGame = overGame;
    host.pauseGame();
    d.screens.close();
    pauseMenu.hide();
    d.build.setTool({ kind: 'none' });
    mainMenu.show(continueTarget(overGame), listLevels(), {
      // the tuning a new game starts from, not the loaded game's own
      rules: rulesDiffer(readRules()).length > 0,
      content: contentIsCustom(),
    });
  }
  function openMainMenu() {
    showMainMenu(false);
  }
  function openPauseMenu() {
    if (mainMenu.visible) return;
    host.pauseGame();
    d.screens.close();
    pauseMenu.show({ testing: !!testingLevel(), editor: host.mode === 'editor' });
  }
  function closeMenus() {
    pauseMenu.hide();
    mainMenu.hide();
    titleOverGame = false;
    host.resumeGame();
  }
  /**
   * Run `load`; over a game in progress (playing, under the pause menu or a title screen opened
   * from it, not the title screen at boot) only once the player says yes to `question` in the
   * game's own dialog, since its unsaved progress is lost.
   */
  function askBeforeLoad(question: string, load: () => void) {
    if (host.mode === 'play' && (!mainMenu.visible || titleOverGame))
      void d.namePrompt.confirm(STR.saves.loadTitle, question).then((ok) => ok && load());
    else load();
  }
  /** Named-save actions shared by the menus and the settings screen. */
  function slotActions(): SlotActions {
    return {
      slots: () => listSlots(),
      loadSlot: (name) => {
        if (!readSlot(name)) {
          d.toasts.push(STR.settings.noSave, 'warn');
          return;
        }
        askBeforeLoad(STR.menu.confirmLoad(name), () => {
          if (!host.loadSlot(name)) d.toasts.push(STR.settings.noSave, 'warn');
        });
      },
      deleteSlot: (name) => {
        host.deleteSlot(name);
        d.toasts.push(STR.settings.slotDeleted(name), 'info');
      },
    };
  }
  /** Music and effects volume for the menus: same settings the Settings screen edits. */
  function audioActions(): AudioActions {
    return {
      volume: (key) => d.settings[key],
      setVolume: (key, v) => {
        d.settings[key] = v;
        host.applySettings();
      },
    };
  }
  /**
   * "Save as..." from the pause menu: asks for a name in the in-game dialog, and before replacing
   * a save of that name asks again; a no writes nothing.
   */
  async function promptSaveAs() {
    const fallback = `${STR.menu.day(d.clock.day)} · ${host.seed}`;
    const name = await d.namePrompt.ask(
      STR.settings.saveAsTitle,
      STR.settings.saveAsHint,
      fallback,
    );
    if (!name) return;
    const n = name.slice(0, 32).trim();
    if (
      hasSlot(n) &&
      !(await d.namePrompt.confirm(STR.saves.overwriteTitle, STR.saves.confirmOverwrite(n)))
    )
      return;
    if (host.saveSlot(n)) closeMenus();
  }
  const mainMenu = new MainMenu(
    {
      ...slotActions(),
      ...audioActions(),
      continue: () => closeMenus(),
      newGame: (seed, supply) => {
        if (confirmReplaceSave()) host.newGame(seed, supply);
      },
      playLevel: (id) => {
        if (confirmReplaceSave()) host.playLevel(id);
      },
      editLevel: (id) => host.editLevel(id),
      newLevel: (size, generated, seedText) => host.newLevel(size, generated, seedText),
      // the title screen is drawn again over the same game it was opened over
      deleteLevel: (id) => {
        host.deleteLevel(id);
        showMainMenu(titleOverGame);
      },
      importLevel: (json) => {
        if (!host.importLevel(json)) return false;
        showMainMenu(titleOverGame);
        return true;
      },
      exportLevel: (id) => JSON.stringify(listLevels().find((l) => l.id === id) ?? null),
      tuning: () => d.screens.open(tuningScreen),
      content: () => d.screens.open(contentScreen),
      settings: () => d.screens.open(settingsScreen),
    },
    d.namePrompt,
  );
  const pauseMenu = new PauseMenu(
    {
      ...slotActions(),
      ...audioActions(),
      resume: () => closeMenus(),
      save: () => {
        host.save();
        closeMenus();
      },
      saveAs: () => void promptSaveAs(),
      settings: () => d.screens.open(settingsScreen),
      tuning: () => d.screens.open(tuningScreen),
      content: () => d.screens.open(contentScreen),
      backToEditor: () => host.backToEditor(),
      mainMenu: () => {
        if (host.mode === 'editor') {
          if (!host.editor?.dirty || confirm(STR.editor.unsaved)) host.reloadToMenu();
        } else showMainMenu(true);
      },
    },
    d.namePrompt,
  );
  hud.onMenu = () => (menuOpen() ? closeMenus() : openPauseMenu());

  d.uiRoot.append(
    mainMenu.root,
    pauseMenu.root,
    d.screens.root,
    advisor.root,
    el(
      'div',
      { id: 'right-col' },
      noticePanel.root,
      contractsSide.root,
      trainSide.root,
      buildInfo.root,
    ),
    el('div', { class: 'vignette' }),
    hud.root,
    resourceBar.root,
    minimap.root,
    debug.root,
    overviewBanner,
    townPanel.root,
    d.namePrompt.root,
    el('div', { id: 'hint', text: STR.hints.camera }),
    toolbar.root,
    stationPanel.root,
    buildingPanel.root,
    decorPanel.root,
    d.toasts.root,
    d.tooltip.root,
  );

  // ---------------------------------------------------------------- keys
  const keyScreens: Record<KeyScreen, Screen> = {
    depot,
    contracts: contractsScreen,
    crafting: craftingScreen,
    roster: rosterScreen,
    market: marketScreen,
  };
  const keys: KeyHost = {
    get menuOpen() {
      return menuOpen();
    },
    get pauseMenuOpen() {
      return pauseMenu.visible;
    },
    get mode() {
      return host.mode;
    },
    get viewTarget() {
      return host.viewTarget;
    },
    get overviewSettled() {
      return host.viewBlend > 0.99;
    },
    get screenOpen() {
      return !!d.screens.current;
    },
    get building() {
      return d.build.tool.kind !== 'none' || !!d.build.selected;
    },
    get categoryOpen() {
      return toolbar.open !== null;
    },
    get recording() {
      return host.recordingRoute;
    },
    get overviewTrain() {
      return host.overviewTrainId !== null;
    },
    toggleDebug: () => debug.toggle(),
    closeScreen: () => d.screens.close(),
    closeMenus,
    openPauseMenu,
    toggleScreen: (s) => d.screens.toggle(keyScreens[s]),
    toggleOverview: () => host.toggleOverview(),
    cycleTool: (dir) => toolbar.cycle(dir),
    toggleReclass: (target) => toolbar.toggleReclass(target),
    cycleType: (dir) => toolbar.cycleGroup(dir),
    selectPiece: (i) => toolbar.selectIndex(i),
    setSpeed: (s) => d.clock.setSpeed(s),
    togglePause: () => d.clock.togglePause(),
    toggleRecording: () => host.toggleRecording(),
    finishRecording: () => host.finishRecording(),
    cancelRecording: () => host.cancelRecording(),
    dropOverviewTrain: () => host.dropOverviewTrain(),
    leaveOverview: () => host.setView(0),
  };

  return {
    hud,
    depot,
    trainScreen,
    marketScreen,
    resourceBar,
    tuningScreen,
    contentScreen,
    settingsScreen,
    gachaScreen,
    craftingScreen,
    rosterScreen,
    contractsScreen,
    contractsSide,
    minimap,
    debug,
    overviewBanner,
    toolbar,
    buildingPanel,
    decorPanel,
    trainSide,
    noticePanel,
    advisor,
    buildInfo,
    stationPanel,
    townPanel,
    mainMenu,
    pauseMenu,
    get menuOpen() {
      return menuOpen();
    },
    openMainMenu,
    openPauseMenu,
    closeMenus,
    keys,
  };
}

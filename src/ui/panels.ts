import { el, fmtMoney } from './dom';
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
import { RESOURCE_IDS, scaleCost } from '../sim/stores';
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
import { listRulePresets, rules, stageNewGameTuning } from '../sim/rules';
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
import { renderTip } from './tooltipRender';
import { tileToWorld } from '../engine/iso';
import { YieldLabel } from './yieldLabel';
import { seasonOf, type Season } from '../sim/weather';
import type { NamePrompt } from './namePrompt';
import type { BuildController } from './buildController';
import type { KeyHost, KeyScreen } from './keymap';
import {
  MainMenu,
  PauseMenu,
  type AudioActions,
  type Confirm,
  type ContinueTarget,
  type SlotActions,
} from './menu';
import { Hud } from './hud';
import { stepHistory, type HistoryWay } from './historyControls';
import { DepotScreen } from './depot';
import { TrainScreen } from './trainScreen';
import { MarketScreen } from './marketScreen';
import { ResourceBar } from './resourceBar';
import { TuningScreen } from './tuningScreen';
import { ContentScreen } from './contentScreen';
import { SettingsScreen } from './settingsScreen';
import { CreditsScreen } from './creditsScreen';
import { GachaScreen } from './gachaScreen';
import { CraftingScreen } from './craftingScreen';
import { RosterScreen } from './rosterScreen';
import { ContractsScreen } from './contractsScreen';
import { Minimap } from './minimap';
import { DebugPanel } from './debug';
import { Toolbar, type Tool } from './toolbar';
import { toastBottom } from './buildBar';
import { BuildingPanel } from './buildingPanel';
import { DecorPanel } from './decorPanel';
import { AlertBar } from './alertBar';
import { AlertDesk } from './alertDesk';
import { AlertPopup } from './alertPopup';
import { NotificationsScreen } from './notificationsScreen';
import { Advisor } from './advisor';
import { BuildInfo } from './buildInfo';
import { Outliner } from './outliner';
import type { ViewRect } from './outlinerRows';
import { TrainPanel } from './trainPanel';
import type { FollowCamera } from './followCamera';
import { StationPanel } from './stationPanel';
import { TownPanel } from './townPanel';
import { showSignalGuide } from './signalGuide';
import {
  asksBeforeReplacing,
  continueTargetFor,
  loadQuestion,
  replaceQuestion,
  type ReplaceSituation,
  type Replacement,
} from './saveSlots';
import { startNewGame } from './newGameTuning';

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

  // ------------------------------------------------------------ camera and view
  /** close the screens and look at the train */
  focusTrain(t: Train): void;
  /** look at a depot behind the dimmed screen and mark the gate a train would leave by */
  peekDepot(depot: Station, gate: { x: number; y: number } | null): void;
  /** take down the gate mark `peekDepot` put up */
  endDepotPeek(): void;
  /** look at what a notice points to */
  focusNotice(n: Notice): void;
  /** back to the field view, the camera over a tile */
  returnToRts(tx: number, ty: number): void;
  /** the camera over a world point */
  centerCamera(wx: number, wy: number): void;
  setView(v: 0 | 1): void;
  toggleOverview(): void;
  /** pick a train in the field view: its path lights up, its panel opens, the camera follows it */
  selectFieldTrain(t: Train | null): void;
  /** the train picked in the field view */
  readonly selectedTrain: Train | null;
  /** pick a train from anywhere, the overview too, and go to it */
  pickTrain(t: Train): void;
  /** which train the camera follows */
  readonly follow: FollowCamera;
  /** what the camera shows, in world pixels; null in the overview, which shows everything */
  viewRect(): ViewRect | null;
  /** where a tile point is drawn, in world pixels */
  tilePoint(x: number, y: number): { x: number; y: number };
  /** the seconds a train has stood stuck; null if it has not */
  stuckFor(id: number): number | null;
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
  /** money, tickets and the selected store filled, for testing */
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
  readonly marketScreen: MarketScreen;
  readonly resourceBar: ResourceBar;
  readonly tuningScreen: TuningScreen;
  readonly contentScreen: ContentScreen;
  readonly settingsScreen: SettingsScreen;
  readonly gachaScreen: GachaScreen;
  readonly craftingScreen: CraftingScreen;
  readonly rosterScreen: RosterScreen;
  readonly contractsScreen: ContractsScreen;
  readonly minimap: Minimap;
  readonly debug: DebugPanel;
  readonly overviewBanner: HTMLElement;
  readonly toolbar: Toolbar;
  readonly buildingPanel: BuildingPanel;
  readonly decorPanel: DecorPanel;
  readonly outliner: Outliner;
  readonly trainPanel: TrainPanel;
  readonly alerts: AlertDesk;
  readonly advisor: Advisor;
  readonly buildInfo: BuildInfo;
  readonly stationPanel: StationPanel;
  readonly townPanel: TownPanel;
  readonly mainMenu: MainMenu;
  readonly pauseMenu: PauseMenu;
  /** the title or the pause menu is up */
  readonly menuOpen: boolean;
  /**
   * The title screen at boot, over the stored game or a world not yet played: no game is being
   * played, so what replaces the stored game asks only when there is one. The pause menu opens it
   * over the game being played itself, where everything that replaces or leaves it asks.
   */
  openMainMenu(): void;
  /** the pause menu over the paused game (not over the title screen) */
  openPauseMenu(): void;
  /** both menus down; the clock runs again */
  closeMenus(): void;
  /** what `handlePlayKeys` reads and calls */
  readonly keys: KeyHost;
}

/**
 * The editor's play test replaces the stored game, and no game is being played in the editor: ask
 * first when a stored game exists (`asksBeforeReplacing`).
 */
export async function confirmReplaceSave(prompt: Confirm) {
  const asks = asksBeforeReplacing('overwrite', {
    mode: 'editor',
    titleShown: false,
    titleOverGame: false,
    stored: !!readSave(),
  });
  if (!asks) return true;
  return prompt.confirm(STR.menu.playTestTitle, STR.menu.confirmReplace, {
    yes: STR.prompt.play,
    danger: true,
  });
}

/** Build every panel, screen and menu of a game, wire them and put them in the UI root. */
export function createPlayUi(host: UiHost, d: PlayUiDomains): PlayUi {
  const toast = (m: string, k?: 'info' | 'warn' | 'good') => d.toasts.push(m, k);
  /**
   * The season production runs in, as `Game.applySeason` sets it on the stations: the calendar's
   * with weather on, spring with it off. The placing tooltip and the station panel work their
   * yield out for it.
   */
  const season = (): Season => (d.settings.weather ? seasonOf(d.clock.day) : 'spring');

  /** progress towards every age: the era widget's, and what the build bar's locks wait for */
  const ages = () => ageStatus(d.economy.tier, host.ageSnapshot());
  const hud = new Hud(d.clock, ages, d.atlas, d.tooltip);
  const depot = new DepotScreen(d.inventory, d.fleet, d.builder, toast, d.atlas);
  depot.onFocusTrain = (t) => host.focusTrain(t);
  depot.onFocusDepot = (dep, gate) => {
    // peek at the shed behind the dimmed screen and mark the gate the train would take
    host.peekDepot(dep, gate);
    d.screens.root.classList.add('peek');
  };
  d.screens.menuUnder = () => menuOpen();
  d.screens.pausedUnder = () =>
    host.mode === 'play' && (pauseMenu.visible || (mainMenu.visible && titleOverGame));
  d.screens.onChange = (sc) => {
    hud.menuBar.close();
    pauseMenu.setCovered(!!sc);
    if (sc && !sc.keepsTool) d.build.setTool({ kind: 'none' });
    if (!sc) {
      d.screens.root.classList.remove('peek');
      host.endDepotPeek();
    }
    sfx(sc ? 'ui.open' : 'ui.close');
  };
  const trainScreen = new TrainScreen(d.fleet, d.builder, d.commands, d.atlas, toast);
  trainScreen.onLocate = (t) => host.focusTrain(t);
  const trainDetails = (t: Train) => {
    trainScreen.open(t);
    d.screens.open(trainScreen);
  };
  depot.onDetails = trainDetails;
  const stores = d.builder.stores;
  const marketScreen = new MarketScreen(
    stores,
    d.economy,
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
  const resourceBar = new ResourceBar(d.atlas, d.tooltip, () => {
    if (host.mode === 'play' && !menuOpen()) d.screens.toggle(marketScreen);
  });
  // the money is the bar's first cell; the tickets stay in the HUD's block at its end
  resourceBar.right.append(hud.funds);
  resourceBar.passengers = () => {
    let n = 0;
    for (const s of d.builder.stations) n += s.stored('passengers');
    return n;
  };
  resourceBar.people = () => {
    const residents = d.houses.residentsTotal();
    const crews = d.builder.crewTotal() + d.fleet.crewTotal();
    return { residents, foodPerWeek: (residents + crews) * rules.wheatPerCrew };
  };
  // the bar steps through the stores in label order, from the one it shows
  resourceBar.onNextStore = () => {
    const all = stores.choices();
    if (!all.length) return;
    const now = stores.selected;
    const at = now ? all.findIndex((c) => c.key === now.key) : -1;
    stores.selected = all[(at + 1) % all.length];
  };
  const tuningScreen = new TuningScreen(
    () => {
      host.applySeason(true);
      toolbar.refresh();
      // a town's cap and the tiles in building and fuel reach are derived from the rules
      stores.refresh();
    },
    // a tuning saved or deleted there changes the title screen's New game choice, in place
    () => mainMenu.refreshTunings(),
    d.namePrompt,
  );
  const contentScreen = new ContentScreen(() => {
    if (host.mode === 'play' && !menuOpen()) host.save(true);
    host.reloadToMenu();
  }, d.namePrompt);
  const creditsScreen = new CreditsScreen();
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
        // it loads the stored game itself and replaces none, so it asks only over a game in play
        const question = asksBeforeReplacing('leave', replaceSituation())
          ? STR.saves.confirmLoadLast
          : null;
        askBeforeLoad(question, () => {
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
      saveOff: mainMenu.visible && !titleOverGame,
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
    stores,
    d.inventory,
    () => d.clock.time,
    toast,
    d.atlas,
  );
  const rosterScreen = new RosterScreen(d.inventory, d.fleet, d.commands, d.atlas, toast);
  const contractsScreen = new ContractsScreen(d.contracts, d.builder, d.clock, toast, d.namePrompt);
  contractsScreen.trainName = (id) => d.fleet.byId(id)?.name ?? null;
  contractsScreen.autoAccept = {
    get: () => CONTRACT_RARITIES.every((r) => contractPolicyFor(d.settings, r) === 'accept'),
    set: (v) => {
      d.settings.contractPolicy = uniformContractPolicy(v ? 'accept' : 'prompt');
      host.applySettings();
    },
  };
  hud.menuBar.actions = {
    pause: () => (menuOpen() ? closeMenus() : openPauseMenu()),
    save: () => void host.save(),
    savedGames: () => openPauseMenu(true),
    settings: () => d.screens.toggle(settingsScreen),
    quit: quitToTitle,
    depot: () => d.screens.toggle(depot),
    roster: () => d.screens.toggle(rosterScreen),
    signals: showSignalGuide,
    contracts: () => d.screens.toggle(contractsScreen),
    market: () => d.screens.toggle(marketScreen),
    crafting: () => d.screens.toggle(craftingScreen),
    cheat: () => host.cheat(),
    overview: () => host.toggleOverview(),
    weather: () => {
      d.settings.weather = !d.settings.weather;
      host.applySettings();
    },
    dayNight: () => {
      d.settings.dayNight = !d.settings.dayNight;
      host.applySettings();
    },
    advisor: () => advisor.toggle(),
    notifications: () => notificationsScreen.openFrom(null),
  };
  // the game applied its settings before this UI existed
  hud.setToggles(d.settings.weather, d.settings.dayNight);

  const minimap = new Minimap(d.map, d.regions, d.camera, (wx, wy) => host.centerCamera(wx, wy));
  const debug = new DebugPanel(host.seed, {
    giveMoney: () => (d.economy.money += 10000),
    giveTickets: () => (d.economy.tickets += 10),
    nextAge: () => d.economy.setAge(d.economy.tier + 1),
    giveResources: () => {
      const store = stores.selected;
      if (store) for (const id of RESOURCE_IDS) stores.withGrid(store).add(id, 200);
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
    d.tooltip,
    ages,
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
    () => d.build.selectedBuilding && d.build.selectBuilding(null),
    d.commands,
  );
  const decorPanel = new DecorPanel(d.builder, d.power, d.commands, toast, () => {
    if (d.build.selectedDecor) d.build.selectDecor(null);
  });
  decorPanel.houses = d.houses;
  decorPanel.onSignalGuide = showSignalGuide;
  decorPanel.onSignalBlock = (dec) => host.highlightSignalBlock(dec);
  const alertBar = new AlertBar(d.atlas, d.tooltip, d.toasts);
  alertBar.onLook = (n) => host.focusNotice(n);
  const notificationsScreen = new NotificationsScreen(d.settings, d.screens, () =>
    host.saveSettings(),
  );
  alertBar.onSettings = () => notificationsScreen.openFrom(null);
  settingsScreen.onNotifications = () => notificationsScreen.openFrom(settingsScreen);
  const alerts = new AlertDesk({
    settings: d.settings,
    clock: d.clock,
    toasts: d.toasts,
    bar: alertBar,
    popup: new AlertPopup(
      d.screens,
      () => !d.namePrompt.open,
      (n) => host.focusNotice(n),
    ),
    // a toast fired under the loading screen would never be read
    live: () => host.mode === 'play' && !menuOpen() && !document.getElementById('loading-screen'),
  });
  const advisor = new Advisor(d.settings.advisor === false);
  advisor.onSilence = (v) => {
    d.settings.advisor = !v;
    host.saveSettings();
  };
  advisor.onCount = (count, urgent) => hud.menuBar.setBadge('advisor', count, urgent);
  /** The camera over a tile, keeping its zoom; from the overview, back in the field. */
  const lookAt = (x: number, y: number) => {
    if (host.viewTarget === 1) return host.returnToRts(x, y);
    const w = tileToWorld(x, y);
    host.centerCamera(w.x, w.y);
  };
  const outliner = new Outliner({
    fleet: d.fleet,
    builder: d.builder,
    contracts: d.contracts,
    clock: d.clock,
    commands: d.commands,
    atlas: d.atlas,
    toast,
    view: () => host.viewRect(),
    tilePoint: (x, y) => host.tilePoint(x, y),
    selectedTrain: () => host.selectedTrain,
    followedTrain: () => host.follow.trainId,
    stuckFor: (id) => host.stuckFor(id),
    onTrain: (t) => {
      d.build.setTool({ kind: 'none' });
      host.pickTrain(t);
    },
    // off a row, the path of the train picked stays lit
    onHover: (t) => host.setHoverTrain(t ?? host.selectedTrain),
    // a station, a works or a decor piece: one is picked at a time, as a click on the map has it
    onStation: (s) => {
      d.build.setTool({ kind: 'none' });
      lookAt(s.cx + 0.5, s.cy + 0.5);
      d.build.selectDecor(null);
      d.build.select(s);
    },
    onWorks: (b) => {
      d.build.setTool({ kind: 'none' });
      lookAt(b.x + 0.5, b.y + 0.5);
      d.build.select(null);
      d.build.selectDecor(null);
      d.build.selectBuilding(b);
    },
    onContract: () => d.screens.open(contractsScreen),
  });
  const trainPanel = new TrainPanel({
    fleet: d.fleet,
    builder: d.builder,
    commands: d.commands,
    atlas: d.atlas,
    toast,
    followedTrain: () => host.follow.trainId,
    toggleFollow: (t) => host.follow.toggle(t.id),
    stuckFor: (id) => host.stuckFor(id),
    onClose: () => host.selectFieldTrain(null),
    onDetails: trainDetails,
    onDepot: () => d.screens.open(depot),
  });
  const buildInfo = new BuildInfo(
    d.atlas,
    d.builder,
    () => d.build.placement,
    () => d.build.run,
  );
  buildInfo.onClose = () => toolbar.select({ kind: 'none' });
  toolbar.root.prepend(buildInfo.root);
  const stationPanel = new StationPanel(
    d.builder,
    () => d.build.selected && d.build.select(null),
    d.contracts,
    d.clock,
    d.towns,
    (t) => host.renameTown(t),
    d.commands,
    toast,
    {
      season,
      render: (doc) => renderTip(doc, d.atlas),
      bindTerms: (scope) => d.tooltip.bindTerms(scope),
    },
    d.namePrompt,
  );
  const townPanel = new TownPanel(d.towns, d.houses, stores);
  townPanel.onGo = (t) => {
    const st = d.towns.station(t);
    const store = stores.byKey(`town:${t.id}`);
    if (store) stores.selected = stores.poolOf(store);
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
    // a town's Townhouse, a depot or a warehouse: the top bar shows its store
    const store = s && (s.def.id === 'town' ? stores.townStore(s.x, s.y) : stores.dockOf(s));
    if (store) stores.selected = store;
    if (s) stationPanel.open(s);
    else if (stationPanel.station) stationPanel.close();
  };
  // the panels stand where the train panel does: picking one lets the train go
  d.build.onSelectBuilding = (b) => {
    if (b) host.selectFieldTrain(null);
    if (b) buildingPanel.open(b);
    else if (buildingPanel.building) buildingPanel.close();
  };
  d.build.onSelectDecor = (dec) => {
    if (dec) host.selectFieldTrain(null);
    if (dec) decorPanel.open(dec);
    else if (decorPanel.decor) decorPanel.close();
  };
  /** the run the build card showed at the last status */
  let runShown = false;
  d.build.onStatus = (t) => {
    toolbar.setStatus(t);
    // the card follows a drag from frame to frame, not at the panels' half-second refresh, and
    // drops the run the frame it ends
    const run = !!d.build.run;
    if (run || runShown) buildInfo.refresh();
    runShown = run;
  };
  // a harvest station's tool: the placing tooltip is the stack's root, the label floats over the tile
  const yieldLabel = new YieldLabel();
  d.build.placing = {
    stack: d.tooltip.stack,
    content: (doc) => renderTip(doc, d.atlas),
    label: (text, corner) => yieldLabel.show(text, corner),
    season,
  };
  d.build.onToolChanged = (t) => {
    toolbar.setActive(t);
    buildInfo.show(toolbar.item(t));
    // what is built stands still under the pointer
    if (t.kind !== 'none') host.follow.note('tool');
  };

  // ---------------------------------------------------------------- undo
  /** One step back or forward: then what was picked may have gone, and the panels may be stale. */
  const historyStep = (way: HistoryWay) => {
    if (menuOpen() || host.recordingRoute) return;
    if (!stepHistory(way, d.commands.history, toast)) return;
    // a tooltip open now tells of the world before the step
    d.tooltip.stack.closeAll();
    d.build.dropGone();
    stationPanel.render();
    buildingPanel.render();
    decorPanel.render();
    outliner.update(0, true);
    trainPanel.update(0, true);
  };
  hud.onHistory = historyStep;
  d.commands.history.onChange = () => hud.setHistory(d.commands.history);
  hud.setHistory(d.commands.history);

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
    return continueTargetFor(
      overGame,
      (): SlotMeta => ({
        name: '',
        savedAt: host.savedAt ?? 0,
        version: SAVE_VERSION,
        seed: host.seed,
        day: d.clock.day,
        age: d.economy.tier,
        money: d.economy.money,
      }),
      continueMeta,
    );
  }
  /** The title screen over the paused game; `overGame` when the pause menu opened it. */
  function showMainMenu(overGame: boolean) {
    // what was done in the game being left is no longer the player's to take back
    d.commands.history.clear();
    titleOverGame = overGame;
    host.pauseGame();
    d.screens.close();
    pauseMenu.hide();
    d.build.setTool({ kind: 'none' });
    mainMenu.show(continueTarget(overGame), listLevels(), { content: contentIsCustom() });
  }
  function openMainMenu() {
    showMainMenu(false);
  }
  /** `slotsOpen` shows the named saves unfolded, for the menu bar's Saved games. */
  function openPauseMenu(slotsOpen = false) {
    if (mainMenu.visible) return;
    host.pauseGame();
    d.screens.close();
    pauseMenu.show({ testing: !!testingLevel(), editor: host.mode === 'editor' }, slotsOpen);
  }
  /** Leave for the title screen: from the editor by a reload, asking over unsaved changes. */
  function quitToTitle() {
    if (host.mode !== 'editor') showMainMenu(true);
    else if (!host.editor?.dirty) host.reloadToMenu();
    else
      void d.namePrompt
        .confirm(STR.editor.unsavedTitle, STR.editor.unsaved, {
          yes: STR.prompt.leave,
          danger: true,
        })
        .then((ok) => ok && host.reloadToMenu());
  }
  function closeMenus() {
    pauseMenu.hide();
    mainMenu.hide();
    titleOverGame = false;
    host.resumeGame();
  }
  /** What decides whether a replacement asks first, read when the player picks the action. */
  function replaceSituation(): ReplaceSituation {
    return {
      mode: host.mode,
      titleShown: mainMenu.visible,
      titleOverGame,
      stored: !!readSave(),
    };
  }
  /**
   * The dialog's question before starting something over the game in progress or the stored game
   * (`replaceQuestion`), under `title` and answered `yes`; false when the player says no, so the
   * caller changes nothing. What overwrites a game is the red answer.
   */
  async function confirmReplacement(kind: Replacement, title: string, yes: string) {
    const question = replaceQuestion(kind, replaceSituation());
    if (question === null) return true;
    return d.namePrompt.confirm(title, question, { yes, danger: kind === 'overwrite' });
  }
  /**
   * Run `load`; with a `question` only once the player says yes to it in the game's own dialog.
   * No question (null) loads at once.
   */
  function askBeforeLoad(question: string | null, load: () => void) {
    if (question === null) load();
    else
      void d.namePrompt
        .confirm(STR.saves.loadTitle, question, { yes: STR.prompt.load })
        .then((ok) => ok && load());
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
        askBeforeLoad(loadQuestion(name, replaceSituation()), () => {
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
      !(await d.namePrompt.confirm(STR.saves.overwriteTitle, STR.saves.confirmOverwrite(n), {
        yes: STR.prompt.replace,
        danger: true,
      }))
    )
      return;
    if (host.saveSlot(n)) closeMenus();
  }
  const mainMenu = new MainMenu(
    {
      ...slotActions(),
      ...audioActions(),
      continue: () => closeMenus(),
      tunings: () => listRulePresets(),
      // the pick is staged only once every question is answered yes, and a refused staging starts nothing
      newGame: async (seed, supply, tuning) => {
        if (!(await confirmReplacement('overwrite', STR.menu.newGame, STR.prompt.start))) return;
        const unusable = startNewGame(tuning, stageNewGameTuning, () => host.newGame(seed, supply));
        if (unusable) d.toasts.push(unusable, 'warn');
      },
      playLevel: async (id) => {
        if (await confirmReplacement('overwrite', STR.menu.playLevelTitle, STR.prompt.play))
          host.playLevel(id);
      },
      editLevel: async (id) => {
        if (await confirmReplacement('leave', STR.menu.editLevelTitle, STR.prompt.edit))
          host.editLevel(id);
      },
      newLevel: async (size, generated, seedText) => {
        if (await confirmReplacement('leave', STR.menu.newLevel, STR.menu.newLevel))
          host.newLevel(size, generated, seedText);
      },
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
      credits: () => d.screens.open(creditsScreen),
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
      mainMenu: quitToTitle,
    },
    d.namePrompt,
  );

  d.uiRoot.append(
    mainMenu.root,
    pauseMenu.root,
    d.screens.root,
    advisor.root,
    outliner.root,
    trainPanel.root,
    el('div', { class: 'vignette' }),
    yieldLabel.root,
    hud.root,
    hud.menuBar.pane,
    resourceBar.root,
    alertBar.root,
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
    d.tooltip.stackRoot,
  );

  // the toasts stand over the dock, which changes height with what it shows; hidden, it measures 0
  if (typeof ResizeObserver !== 'undefined')
    new ResizeObserver(() => {
      d.toasts.root.style.bottom = `${toastBottom(toolbar.root.offsetHeight)}px`;
      // and the train panel ends over it, whatever it shows (style.css)
      d.uiRoot.style.setProperty('--dock-height', `${toolbar.root.offsetHeight}px`);
    }).observe(toolbar.root);

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
    get trainOpen() {
      return host.selectedTrain !== null;
    },
    get recording() {
      return host.recordingRoute;
    },
    get overviewTrain() {
      return host.overviewTrainId !== null;
    },
    get tooltipsOpen() {
      return d.tooltip.stack.open;
    },
    get barMenuOpen() {
      return hud.menuBar.isOpen;
    },
    toggleDebug: () => debug.toggle(),
    closeTooltips: () => {
      // the build controller reads Escape later in the same frame: this one is spent
      if (d.tooltip.stack.escape()) d.build.takeEscape();
    },
    closeBarMenu: () => {
      // an Escape that closed it is spent as well: the tool in hand stays
      hud.menuBar.close();
      d.build.takeEscape();
    },
    closeScreen: () => d.screens.back(),
    closeTrain: () => host.selectFieldTrain(null),
    closeMenus,
    openPauseMenu,
    toggleScreen: (s) => d.screens.toggle(keyScreens[s]),
    toggleOverview: () => host.toggleOverview(),
    cycleTool: (dir) => toolbar.bar.cycle(dir),
    toggleReclass: (target) => toolbar.bar.toggleReclass(target),
    cycleType: (dir) => toolbar.bar.cycleGroup(dir),
    selectPiece: (i) => toolbar.bar.selectIndex(i),
    openCategory: (i) => toolbar.bar.openAt(i),
    closeCategory: () => toolbar.bar.closeCategory(),
    cycleCategory: (dir) => toolbar.bar.cycleCategory(dir),
    toggleDemolish: () => toolbar.bar.toggleDemolish(),
    stepSpeed: (dir) => d.clock.stepSpeed(dir),
    togglePause: () => d.clock.togglePause(),
    toggleRecording: () => host.toggleRecording(),
    finishRecording: () => host.finishRecording(),
    cancelRecording: () => host.cancelRecording(),
    dropOverviewTrain: () => host.dropOverviewTrain(),
    leaveOverview: () => host.setView(0),
    undo: () => historyStep('undo'),
    redo: () => historyStep('redo'),
  };

  return {
    hud,
    depot,
    marketScreen,
    resourceBar,
    tuningScreen,
    contentScreen,
    settingsScreen,
    gachaScreen,
    craftingScreen,
    rosterScreen,
    contractsScreen,
    minimap,
    debug,
    overviewBanner,
    toolbar,
    buildingPanel,
    decorPanel,
    outliner,
    trainPanel,
    alerts,
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

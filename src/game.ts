import { Application, Sprite, extensions, CullerPlugin } from 'pixi.js';
import { AtlasRegistry } from './engine/atlas';
import { Camera, ZOOM_STEPS } from './engine/camera';
import { Input } from './engine/input';
import { GameLoop } from './engine/loop';
import { worldToTileInt, tileToWorld, HALF_H as HALF_H_PX } from './engine/iso';
import { ATLAS_GROUPS } from './art/index';
import { generateMap } from './world/mapgen';
import { mapFromLevel, type LevelData } from './world/level';
import { rules, setRules, daySeconds } from './sim/rules';
import { setIntentAndReload, testingLevel, setTestingLevel } from './intent';
import { rulesDiffer } from './sim/rules';
import { contentIsCustom } from './data/content';
import { MainMenu, PauseMenu } from './ui/menu';
import { Editor } from './editor/editor';
import { EditorPanel } from './ui/editorPanel';
import {
  listLevels,
  deleteLevel,
  saveLevel,
  isLevel,
  type LevelData as LevelRecord,
} from './world/level';
import { generateMap as generateMapForEditor } from './world/mapgen';
import { decorateProps } from './world/mapgen';
import { Terrain as TerrainEnum } from './world/tiles';
import type { WorldSpec } from './sim/save';
import { type GameMap, inBounds, TERRAIN_NAMES, Terrain, terrainAt } from './world/tiles';
import { RegionState } from './world/regions';
import { WorldRenderer } from './render/worldRenderer';
import { OverviewRenderer, OV_UNIT, type OverviewSource } from './render/overviewRenderer';
import { GameClock } from './sim/time';
import { Hud } from './ui/hud';
import { Minimap } from './ui/minimap';
import { DebugPanel } from './ui/debug';
import { Tooltip } from './ui/tooltip';
import { el } from './ui/dom';
import { STR } from './strings';
import { TrackGraph } from './world/track';
import { Builder } from './sim/build';
import { Economy } from './sim/economy';
import { Toolbar, type Tool } from './ui/toolbar';
import { StationPanel } from './ui/stationPanel';
import { BuildController } from './ui/buildController';
import { Toasts } from './ui/toast';
import { Inventory } from './gacha/inventory';
import { Fleet } from './sim/fleet';
import { TrainRenderer } from './render/trainRenderer';
import { ScreenManager } from './ui/modal';
import { DepotScreen } from './ui/depot';
import { btn } from './ui/dom';
import type { Train } from './sim/trains';
import { defaultStop as defaultStopFor } from './sim/trains';
import { ContractBoard } from './sim/contracts';
import { ContractsScreen } from './ui/contractsScreen';
import { ContractsSide } from './ui/contractsSide';
import { Rng } from './engine/rng';
import { DayNight, Glows, Smoke, GroundLights, Rain, Fog, nightness } from './render/fx';
import {
  Weather,
  SEASON_FX,
  seasonOf,
  productionMul,
  setSeasonOffset,
  getSeasonOffset,
  seasonFromDate,
  type Season,
} from './sim/weather';
import { decorOffset, type Decor } from './sim/build';
import { SEMAPHORE_STEPS, semaphoreFrame } from './art/structures';
import { validateBanners } from './gacha/gacha';
import { Dir, DIR_DX, DIR_DY, depthKey as depthKeyFor } from './engine/iso';
import { audio, sfx } from './engine/audio';
import { SettingsScreen } from './ui/settingsScreen';
import { TuningScreen } from './ui/tuningScreen';
import { ContentScreen } from './ui/contentScreen';
import {
  SAVE_VERSION,
  readSave,
  parseSave,
  writeSave,
  clearSave,
  listSlots,
  writeSlot,
  readSlot,
  deleteSlot,
  KNOWN_SAVE_KEYS,
  DEFAULT_SETTINGS,
  readSettings,
  writeSettings,
  type SaveGame,
  type Settings,
} from './sim/save';
import { Station, resetStationIds, stationDef as stationDefOf } from './sim/stations';
import { scaleCost as scaleCostOf } from './sim/stockpile';
import { TradeDesk } from './sim/trade';
import { TownRegistry, TOWN_RADIUS, TOWN_COLORS, type Town } from './sim/towns';
import { NamePrompt } from './ui/namePrompt';
import { TownPanel } from './ui/townPanel';
import { Train as TrainClass, resetTrainIds } from './sim/trains';
import { footprintOf, pieceFrame, pieceCost, type TrackKind } from './world/track';
import { cargoDef } from './sim/cargo';
import { fmtMoney } from './ui/dom';
import { Gacha } from './gacha/gacha';
import { GachaScreen } from './ui/gachaScreen';
import { RosterScreen } from './ui/rosterScreen';
import { Stockpile, RESOURCE_IDS } from './sim/stockpile';
import { tickBuildings, buildingDef, type Building } from './sim/buildings';
import { PowerGrid } from './sim/power';
import { TrainScreen } from './ui/trainScreen';
import { MarketScreen } from './ui/marketScreen';
import { ResourceBar } from './ui/resourceBar';
import { BuildingPanel } from './ui/buildingPanel';
import { TrainSide } from './ui/trainSide';
import { BuildInfo } from './ui/buildInfo';
import { Floaters } from './render/floaters';
import { PowerLines } from './render/powerLines';
import { buildingDef as buildingDefOf } from './sim/buildings';
import { Notices, type Notice } from './sim/notices';
import { NoticePanel } from './ui/noticePanel';
import { Advisor, type Tip } from './ui/advisor';
import { resourceStats } from './sim/stats';
import { locoFrame } from './art/frames';
import { DRAWN_FACINGS, mirrorFacing, vehicleSpec } from './sim/body';
import { buildCompatTable } from './sim/compat';
import { Catenary, type SupplyKind } from './sim/catenary';
import { biomeDef, biomeAt, biomeSummary } from './sim/biomes';
import { decorDef as decorDefOf } from './sim/build';
import { PeopleSim } from './sim/people';
import { expandSave, ownsBorderChunk } from './sim/expand';
import { DecorPanel } from './ui/decorPanel';
import { PeopleRenderer } from './render/peopleRenderer';

/**
 * Starting stockpile for a brand-new game, before `rules.startStock` scaling. Wood, stone and
 * iron are derived from the track cost matrix (spec §16): about fifty straights, a handful of
 * curves and a switch, plus the crafting of one locomotive and four wagons, and are multiplied
 * by `rules.startingResourceScale`.
 */
function startStock(): Record<string, number> {
  const piece = (kind: TrackKind, n: number) => {
    const c = pieceCost(kind, 'regular');
    return { wood: (c.wood ?? 0) * n, stone: (c.stone ?? 0) * n, iron: (c.iron ?? 0) * n };
  };
  const parts = [piece('straight', 50), piece('curve', 6), piece('switch', 1)];
  // crafting one locomotive and four wagons (see src/data/crafting.json when present)
  const craft = { wood: 40, stone: 10, iron: 30 };
  const sum = (k: 'wood' | 'stone' | 'iron') => parts.reduce((a, p) => a + p[k], 0) + craft[k];
  const s = rules.startingResourceScale;
  return {
    wood: Math.round(sum('wood') * s),
    stone: Math.round(sum('stone') * s),
    iron: Math.round(sum('iron') * s),
    water: 120,
    wheat: 120,
    coal: 40,
  };
}

const SIM_HZ = 20;
const EDGE_MARGIN = 14;
const PAN_SPEED = 900; // screen px / s at zoom 1
const TRANSITION_MS = 300;

/** Top-level orchestrator: owns renderer, camera, sim clock, UI and the RTS/overview state machine. */
export class Game {
  app!: Application;
  atlas = new AtlasRegistry();
  input!: Input;
  camera = new Camera();
  clock = new GameClock();
  map!: GameMap;
  regions!: RegionState;
  world!: WorldRenderer;
  overview!: OverviewRenderer;
  hud!: Hud;
  minimap!: Minimap;
  debug!: DebugPanel;
  tooltip = new Tooltip();
  loop!: GameLoop;
  seed: number;
  economy = new Economy();
  track!: TrackGraph;
  builder!: Builder;
  toolbar!: Toolbar;
  stationPanel!: StationPanel;
  build!: BuildController;
  toasts = new Toasts();
  inventory = new Inventory();
  fleet!: Fleet;
  trainRenderer!: TrainRenderer;
  screens = new ScreenManager();
  depot!: DepotScreen;
  contracts!: ContractBoard;
  contractsScreen!: ContractsScreen;
  contractsSide!: ContractsSide;
  gacha!: Gacha;
  gachaScreen!: GachaScreen;
  rosterScreen!: RosterScreen;
  stock = new Stockpile();
  power!: PowerGrid;
  trainScreen!: TrainScreen;
  marketScreen!: MarketScreen;
  resourceBar!: ResourceBar;
  buildingPanel!: BuildingPanel;
  decorPanel!: DecorPanel;
  /** overview: train picked with a click, and a route being recorded for it */
  private ovSelected: number | null = null;
  private recording: { trainId: number; stops: number[] } | null = null;
  trainSide!: TrainSide;
  buildInfo!: BuildInfo;
  floaters!: Floaters;
  powerLines!: PowerLines;
  notices = new Notices();
  people!: PeopleSim;
  peopleRenderer!: PeopleRenderer;
  noticePanel!: NoticePanel;
  advisor!: Advisor;
  private noticeTimer = 0;
  private noticeMarkers = new Set<string>();
  private lastFailedContract = '';
  private hoverTrain: Train | null = null;
  /** train under the cursor in the field view, and the one picked with a click */
  private fieldHover: Train | null = null;
  private fieldSelected: Train | null = null;
  private spawnMarkTimer = 0;
  private pathHighlight: { x: number; y: number }[][] = [];
  private pathTimer = 0;
  private lastDay = 1;
  settings: Settings = readSettings();
  settingsScreen!: SettingsScreen;
  tuningScreen!: TuningScreen;
  contentScreen!: ContentScreen;
  dayNight = new DayNight();
  glows!: Glows;
  smoke!: Smoke;
  private autosaveTimer = 0;
  private savedAt: number | null = null;
  weather!: Weather;
  groundLights!: GroundLights;
  rain!: Rain;
  fog!: Fog;
  private season: Season | null = null;
  private orphaned = new Set<number>();
  private signalAspect = new Map<number, string>();
  private aspectTimer = 0;
  private bobTime = 0;
  private panelRefresh = 0;
  /** 0 = RTS view, 1 = overview. Animated. */
  viewBlend = 0;
  viewTarget: 0 | 1 = 0;
  private cursor!: Sprite;
  private hoverTile = { x: -1, y: -1 };
  private uiRoot: HTMLElement;
  private overviewBanner!: HTMLElement;
  private depthOverlay = false;
  private overviewSource: OverviewSource = {
    trackTiles: () => this.trackTilesForOverview(),
    stations: () =>
      this.builder.stations.map((s) => ({
        id: s.id,
        x: s.cx,
        y: s.cy,
        name: s.name,
        level: s.level,
        kind: s.def.depot
          ? ('depot' as const)
          : s.def.stockpile
            ? ('warehouse' as const)
            : s.def.id === 'town'
              ? ('town' as const)
              : ('other' as const),
        fill: s.def.stockpile ? s.totalStored() / Math.max(1, s.capacity) : undefined,
        color:
          s.def.id === 'town'
            ? TOWN_COLORS[(this.towns.byStation(s.id)?.color ?? 0) % TOWN_COLORS.length]
            : undefined,
      })),
    towns: () =>
      this.towns.towns
        .map((t) => {
          const st = this.towns.station(t);
          if (!st) return null;
          const m = this.towns.members(t);
          return {
            id: t.id,
            x: st.x,
            y: st.y,
            radius: TOWN_RADIUS,
            name: t.name,
            color: TOWN_COLORS[t.color % TOWN_COLORS.length],
            founded: m.houses > 0 && m.warehouses > 0,
            population: this.towns.population(t, m),
          };
        })
        .filter((t): t is NonNullable<typeof t> => !!t),
    trains: () =>
      this.fleet.trains
        .filter((t) => t.poses.length)
        .map((t) => ({
          id: t.id,
          x: t.poses[0].x,
          y: t.poses[0].y,
          name: t.name,
          heading: t.poses[0].heading + (t.reversed ? Math.PI : 0),
          frame: locoFrame(
            this.atlas,
            t.locoDef,
            DRAWN_FACINGS.has(t.facingOf(0, t.poses[0]))
              ? t.facingOf(0, t.poses[0])
              : mirrorFacing(t.facingOf(0, t.poses[0])),
            vehicleSpec(t.locoDef).segments[0].part,
          ),
          flip: !DRAWN_FACINGS.has(t.facingOf(0, t.poses[0])),
        })),
    markers: () =>
      this.notices.list
        .map((n) => {
          const p = this.noticePos(n);
          return p ? { x: p.x, y: p.y, kind: n.kind } : null;
        })
        .filter((m): m is { x: number; y: number; kind: Notice['kind'] } => !!m),
    contracts: () =>
      this.contracts.active.map((c) => {
        const a = this.builder.stationById(c.originId);
        const b = this.builder.stationById(c.destId);
        return {
          id: c.id,
          from: { x: a?.x ?? 0, y: a?.y ?? 0 },
          to: { x: b?.x ?? 0, y: b?.y ?? 0 },
          remaining: this.contracts.remaining(c, this.clock.time),
          label: `${Math.round(c.amount)} ${cargoDef(c.cargo).name}`,
        };
      }),
  };

  readonly spec: WorldSpec;
  /** play = normal game; editor = level editor (free building, paused clock) */
  mode: 'play' | 'editor' = 'play';
  mainMenu!: MainMenu;
  pauseMenu!: PauseMenu;
  editor: Editor | null = null;
  editorPanel: EditorPanel | null = null;
  towns!: TownRegistry;
  readonly trade = new TradeDesk();
  private townPanel!: TownPanel;
  private namePrompt = new NamePrompt();
  private paused = false;
  private menuPausedSpeed = 0;
  get menuOpen() {
    return this.mainMenu.visible || this.pauseMenu.visible;
  }

  constructor(spec: WorldSpec) {
    this.spec = spec;
    this.seed = spec.seed;
    this.uiRoot = document.getElementById('ui-root')!;
  }

  /** Starting economy for a brand-new game, from the rules (or a level's start block). */
  startFresh(start?: LevelData['start']) {
    // a new game begins at noon in the player's current season
    setSeasonOffset(seasonFromDate());
    this.clock.time = daySeconds() * 0.5;
    this.applySeason(true);
    this.economy.money = start ? start.money : rules.startMoney;
    this.economy.tickets = start ? start.tickets : rules.startTickets;
    const rep = start ? start.reputation : rules.startReputation;
    if (rep > 0) this.economy.addReputation(rep);
    const stockMul = start?.stockMul ?? 1;
    for (const [id, n] of Object.entries(startStock()))
      this.stock.add(id, Math.round(n * rules.startStock * stockMul));
    if (!start) {
      const d = this.ensureDepot();
      if (d) {
        const p = tileToWorld(d.cx + 0.5, d.cy + 0.5);
        this.camera.centerOn(p.x, p.y);
      }
    }
    if (start && start.tier > this.economy.tier) {
      this.economy.tier = Math.min(start.tier, this.regions.tiers.length ? 4 : 0);
      const newly = this.regions.applyTier(start.tier);
      if (newly.length) {
        this.world.rebuildFog();
        this.overview.rebuildRegions();
        this.minimap.rebuildBase();
      }
      this.toolbar.refresh();
    }
  }

  /** Place a level's pre-built content into a fresh world (no economy). */
  placeLevelContent(level: LevelData) {
    for (const [x, y, kind, rot, cls, cls2] of level.track) {
      if (!inBounds(this.map, x, y)) continue;
      for (const t of this.track.place(x, y, kind, rot, cls ?? 'regular', cls2))
        this.onTrackChanged(t.x, t.y);
    }
    resetStationIds(1);
    for (const sj of level.stations) {
      if (!inBounds(this.map, sj.x, sj.y)) continue;
      const st = new Station(sj.defId, sj.x, sj.y, sj.name || undefined);
      st.level = Math.max(1, Math.min(5, sj.level));
      this.builder.stations.push(st);
      this.onStationChanged(st, false);
    }
    for (const [x, y, id, rot] of level.decor) {
      if (!inBounds(this.map, x, y)) continue;
      const d: Decor = { id, x, y, rot };
      this.builder.decor.set(y * this.map.w + x, d);
      this.onDecorChanged(d, false);
    }
    for (const [x, y, id] of level.buildings ?? []) {
      if (!inBounds(this.map, x, y)) continue;
      const b: Building = { id, x, y, acc: 0, active: false, rate: 0 };
      this.builder.buildings.set(y * this.map.w + x, b);
      this.onBuildingChanged(b, false);
    }
    this.builder.refreshStationBoosts();
    this.builder.refreshHarvest();
    for (const s of this.builder.stations) this.onStationOrphaned(s, this.builder.isOrphaned(s));
  }
  applyLevelStart(level: LevelData) {
    this.placeLevelContent(level);
    this.startFresh(level.start);
  }

  // ---------------------------------------------------------------- menus
  private pauseGame() {
    if (this.paused) return;
    this.paused = true;
    this.menuPausedSpeed = this.clock.speedIndex;
    this.clock.setSpeed(0);
  }
  private resumeGame() {
    if (!this.paused) return;
    this.paused = false;
    if (this.mode === 'play') this.clock.setSpeed(this.menuPausedSpeed);
  }
  openMainMenu() {
    this.pauseGame();
    this.screens.close();
    this.pauseMenu.hide();
    this.build.setTool({ kind: 'none' });
    this.mainMenu.show(!!readSave(), listLevels(), {
      rules: rulesDiffer().length > 0,
      content: contentIsCustom(),
    });
  }
  openPauseMenu() {
    if (this.mainMenu.visible) return;
    this.pauseGame();
    this.screens.close();
    this.pauseMenu.show({ testing: !!testingLevel(), editor: this.mode === 'editor' });
  }
  closeMenus() {
    this.pauseMenu.hide();
    this.mainMenu.hide();
    this.resumeGame();
  }
  private confirmReplaceSave() {
    return !readSave() || confirm(STR.menu.confirmReplace);
  }
  private parseSeed(text: string) {
    const t = text.trim();
    return t ? (/^\d+$/.test(t) ? Number(t) : hashSeed(t)) : Math.floor(Math.random() * 2 ** 31);
  }
  private buildMenus() {
    this.mainMenu = new MainMenu({
      continue: () => this.closeMenus(),
      newGame: (seed) => {
        if (this.confirmReplaceSave()) this.newGame(seed);
      },
      playLevel: (id) => {
        if (!this.confirmReplaceSave()) return;
        clearSave();
        setTestingLevel(null);
        setIntentAndReload({ action: 'play', levelId: id });
      },
      editLevel: (id) => setIntentAndReload({ action: 'edit', levelId: id }),
      newLevel: (size, generated, seedText) =>
        setIntentAndReload({
          action: 'edit',
          levelId: null,
          blank: !generated,
          size,
          seed: this.parseSeed(seedText),
        }),
      deleteLevel: (id) => {
        deleteLevel(id);
        this.openMainMenu();
      },
      importLevel: (json) => {
        try {
          const l = JSON.parse(json) as LevelRecord;
          if (!isLevel(l)) return false;
          saveLevel(l);
          this.openMainMenu();
          return true;
        } catch {
          return false;
        }
      },
      exportLevel: (id) => JSON.stringify(listLevels().find((l) => l.id === id) ?? null),
      tuning: () => this.screens.open(this.tuningScreen),
      content: () => this.screens.open(this.contentScreen),
      settings: () => this.screens.open(this.settingsScreen),
    });
    this.pauseMenu = new PauseMenu({
      resume: () => this.closeMenus(),
      save: () => {
        this.save();
        this.closeMenus();
      },
      settings: () => this.screens.open(this.settingsScreen),
      tuning: () => this.screens.open(this.tuningScreen),
      content: () => this.screens.open(this.contentScreen),
      backToEditor: () => {
        const id = testingLevel();
        setTestingLevel(null);
        if (id) setIntentAndReload({ action: 'edit', levelId: id });
      },
      mainMenu: () => {
        if (this.mode === 'editor') {
          if (!this.editor?.dirty || confirm(STR.editor.unsaved))
            setIntentAndReload({ action: 'menu' });
        } else this.openMainMenu();
      },
    });
    this.hud.onMenu = () => (this.menuOpen ? this.closeMenus() : this.openPauseMenu());
  }

  // ---------------------------------------------------------------- editor
  enterEditor(level: LevelData) {
    this.mode = 'editor';
    document.body.classList.add('editor');
    this.builder.free = true;
    this.regions.applyTier(99);
    this.world.rebuildFog();
    this.overview.rebuildRegions();
    this.minimap.rebuildBase();
    this.clock.setSpeed(0);
    this.clock.time = daySeconds() * 0.5; // edit in daylight
    this.hud.setEditor(true);
    this.toolbar.setEditor(true);
    this.toolbar.refresh();
    this.placeLevelContent(level);
    const editor = new Editor(this.map, this.builder, this.world, level);
    this.editor = editor;
    this.build.editor = editor;
    this.editorPanel = new EditorPanel(editor, {
      save: () => {
        if (editor.save()) this.toasts.push(STR.editor.saved(editor.level.name), 'good');
        else this.toasts.push(STR.editor.saveFailed, 'warn');
      },
      saveAs: () => {
        const name = prompt(STR.editor.newName, editor.level.name);
        if (name && name.trim() && editor.saveAs(name.trim().slice(0, 40))) {
          this.toasts.push(STR.editor.saved(editor.level.name), 'good');
          this.editorPanel?.render();
        }
      },
      playTest: () => {
        if (!this.confirmReplaceSave()) return;
        if (!editor.save()) {
          this.toasts.push(STR.editor.saveFailed, 'warn');
          return;
        }
        clearSave();
        setTestingLevel(editor.level.id);
        setIntentAndReload({ action: 'play', levelId: editor.level.id, testing: true });
      },
      exit: () => {
        if (!editor.dirty || confirm(STR.editor.unsaved)) setIntentAndReload({ action: 'menu' });
      },
      exportJson: () => JSON.stringify(editor.collect()),
      importJson: (json) => {
        try {
          const l = JSON.parse(json) as LevelRecord;
          if (!isLevel(l)) return false;
          saveLevel(l);
          setIntentAndReload({ action: 'edit', levelId: l.id });
          return true;
        } catch {
          return false;
        }
      },
      fill: (t) => editor.fillAll(t),
      regenerate: () => {
        const v = prompt(STR.settings.seedPlaceholder, String(this.map.seed));
        if (v === null) return;
        const seed = this.parseSeed(v);
        const fresh = generateMapForEditor(seed, {
          w: this.map.w,
          h: this.map.h,
          waterLevel: rules.waterLevel,
          hillLevel: rules.hillLevel,
          rockLevel: rules.rockLevel,
          forestDensity: rules.forestDensity,
        });
        editor.fillAll(TerrainEnum.Grass);
        this.map.terrain.set(fresh.terrain);
        this.map.variant.set(fresh.variant);
        this.map.biome.set(fresh.biome);
        this.map.seed = seed;
        decorateProps(this.map, seed);
        for (let y = 0; y < this.map.h; y++)
          for (let x = 0; x < this.map.w; x++) this.world.retile(x, y);
        editor.dirty = true;
      },
    });
    this.uiRoot.append(this.editorPanel.root);
    this.toasts.push(STR.editor.hint, 'info');
  }

  async init() {
    extensions.add(CullerPlugin);
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.app = new Application();
    await this.app.init({
      canvas,
      resizeTo: window,
      background: '#0a0a0c',
      antialias: false,
      roundPixels: true,
      resolution: 1,
      preference: 'webgl',
    });
    canvas.tabIndex = 0;
    this.input = new Input(canvas);
    await this.atlas.load(ATLAS_GROUPS);
    buildCompatTable();

    this.map =
      this.spec.kind === 'level'
        ? mapFromLevel(this.spec.level)
        : generateMap(this.spec.seed, this.spec.params);
    this.regions = new RegionState(this.map, 0);
    this.camera.setMapSize(this.map.w, this.map.h);
    this.camera.viewW = this.app.screen.width;
    this.camera.viewH = this.app.screen.height;
    const c = tileToWorld(this.map.w / 2, this.map.h / 2);
    this.camera.centerOn(c.x, c.y);

    this.track = new TrackGraph(this.map.w, this.map.h);
    this.builder = new Builder(this.map, this.regions, this.track, this.economy, this.stock);
    this.towns = new TownRegistry(this.builder);
    this.power = new PowerGrid(this.map);
    this.catenary = new Catenary(this.map);
    this.builder.catenary = this.catenary;
    this.builder.onSupplyChanged = (x, y) => this.onSupplyChanged(x, y);
    this.stock.onMessage = (m, k) => this.toasts.push(m, k);
    this.builder.onBuildingChanged = (b, removed) => this.onBuildingChanged(b, removed);
    this.builder.onTrackChanged = (x, y) => this.onTrackChanged(x, y);
    this.builder.onStationChanged = (s, removed) => this.onStationChanged(s, removed);
    this.builder.onDecorChanged = (d, removed) => this.onDecorChanged(d, removed);
    this.builder.onStationOrphaned = (s, orphaned) => this.onStationOrphaned(s, orphaned);
    this.weather = new Weather(new Rng(this.seed ^ 0x77ea));
    validateBanners();
    this.economy.onMessage = (m, k) => this.toasts.push(m, k);
    this.economy.onTierUp = (t) => this.onTierUp(t);
    this.inventory.seedStarter(0);
    this.fleet = new Fleet(
      this.track,
      this.builder,
      this.map,
      this.inventory,
      this.economy,
      this.stock,
    );
    this.fleet.powered = (x, y) => this.catenary.isLive(x, y);
    this.fleet.stockCap = (id) => this.stockCap(id);
    this.fleet.onFlow = (x, y, r, d) => this.floaters.spawn(x, y, r, d);
    this.fleet.onPassengers = (st, n, b) =>
      b ? this.people.board(st, n) : this.people.alight(st, n);
    this.people = new PeopleSim(this.map, this.builder);
    this.contracts = new ContractBoard(new Rng(this.seed ^ 0x5eed), this.builder, this.economy);
    this.gacha = new Gacha(new Rng(this.seed ^ 0x9ac4a), this.inventory);
    this.fleet.onDelivery = (e) => this.contracts.onDelivery(e);
    this.contracts.onEvent = (e) => {
      if (e.kind === 'offered' && this.settings.autoContracts !== false)
        this.contracts.accept(e.contract, this.clock.time);
      if (e.kind === 'completed') {
        this.toasts.push(
          STR.contracts.completed(e.contract.name, fmtMoney(e.contract.payout)),
          'good',
        );
        sfx('contract.done');
      } else if (e.kind === 'failed') {
        this.toasts.push(
          STR.contracts.failedMsg(e.contract.name, Math.round(e.contract.reputation * 0.6)),
          'warn',
        );
        const dest = this.builder.stationById(e.contract.destId);
        this.notices.push(
          {
            key: `contract:${e.contract.id}`,
            kind: 'bad',
            text: STR.notice.contractFailed(e.contract.name),
            target: dest ? { kind: 'tile', x: dest.x, y: dest.y } : null,
          },
          60,
        );
        this.lastFailedContract = e.contract.name;
        sfx('contract.fail');
      } else if (e.kind === 'accepted') sfx('contract.accept');
    };

    this.world = new WorldRenderer(this.atlas, this.map, this.regions);
    this.overview = new OverviewRenderer(this.map, this.regions, this.overviewSource);
    this.overview.atlas = this.atlas;
    this.overview.root.visible = false;
    const cur = this.atlas.get('terrain/cursor');
    this.cursor = new Sprite(cur.texture);
    this.cursor.anchor.set(cur.anchorX, cur.anchorY);
    this.world.overlay.addChild(this.cursor);
    this.rain = new Rain(this.atlas);
    this.fog = new Fog(this.atlas);
    this.world.root.addChild(this.dayNight.overlay);
    this.dayNight.setWorld(this.map.w, this.map.h, WorldRenderer.BORDER);
    this.fog.setWorld(this.map.w, this.map.h, WorldRenderer.BORDER);
    this.world.overlay.addChild(this.fog.patches);
    this.app.stage.addChild(this.world.root, this.fog.haze, this.rain.root, this.overview.root);
    this.glows = new Glows(this.atlas, this.world.overlay, (x, y) => this.world.surfacePoint(x, y));
    this.groundLights = new GroundLights(
      this.atlas,
      this.world.lights,
      (x, y) => this.world.surfacePoint(x, y),
      (x, y) => inBounds(this.map, x, y),
    );
    this.smoke = new Smoke(this.atlas, this.world.overlay);
    this.floaters = new Floaters(this.atlas, this.world.overlay, (x, y) =>
      this.world.surfacePoint(x, y),
    );
    this.powerLines = new PowerLines((n) => {
      const p = this.world.surfacePoint(n.x, n.y);
      if (n.plant) return { x: p.x - 12, y: p.y - 42 };
      const off = decorOffset({ id: 'power_line', rot: 0 });
      return { x: p.x + off.dx, y: p.y + off.dy - 33 };
    });
    this.world.overlay.addChild(this.powerLines.root);
    this.applySeason(true);
    this.applySettings();
    this.trainRenderer = new TrainRenderer(this.atlas, this.world.objects);
    // vehicles still inside an engine shed are hidden until they roll out
    this.trainRenderer.hideAt = (x, y) => this.builder.stationAt(x, y)?.def.depot === true;
    this.peopleRenderer = new PeopleRenderer(this.atlas, this.world.objects, (x, y) =>
      this.world.elevationOf(x, y),
    );

    this.build = new BuildController(this.input, this.builder, this.world, () =>
      this.tileUnderMouse(),
    );
    this.buildUi();
    this.build.onSelect = (s) => {
      if (s) this.selectFieldTrain(null);
      if (s) this.stationPanel.open(s);
      else if (this.stationPanel.station) this.stationPanel.close();
    };
    this.build.onSelectBuilding = (b) =>
      b ? this.buildingPanel.open(b) : this.buildingPanel.building && this.buildingPanel.close();
    this.build.onSelectDecor = (d) =>
      d ? this.decorPanel.open(d) : this.decorPanel.decor && this.decorPanel.close();
    this.fleet.waitingAt = (id) => this.people.waitingAt(id).length;
    this.fleet.contractDest = (cargo, origin) => {
      const c = this.contracts.active.find((k) => k.cargo === cargo && k.originId === origin);
      return c ? c.destId : null;
    };
    this.build.onStatus = (t) => this.toolbar.setStatus(t);
    this.build.onToolChanged = (t) => {
      this.toolbar.setActive(t);
      this.buildInfo.show(this.toolbar.item(t));
    };
    this.loop = new GameLoop(
      SIM_HZ,
      (dt) => this.update(dt),
      (a, dt) => this.render(a, dt),
    );
    this.loop.start();
    window.addEventListener('beforeunload', () => {
      if (this.settings.autosave && this.mode === 'play') this.save(true);
    });
  }

  // ---------------------------------------------------------------- settings / save
  applySettings() {
    audio.master = this.settings.master;
    audio.sfx = this.settings.sfx;
    audio.music = this.settings.music;
    writeSettings(this.settings);
    audio.applyMusic();
    if (!this.settings.weather && this.weather) this.weather.visible = 0;
    if (this.world) this.applySeason();
    if (this.hud) this.hud.setToggles(this.settings.weather, this.settings.dayNight);
  }

  /** fields of the loaded save this build does not understand: written back untouched */
  private saveExtra: Record<string, unknown> = {};
  snapshot(): SaveGame {
    const track: SaveGame['track'] = [];
    for (const t of this.track.anchors())
      track.push([t.x, t.y, t.piece.kind, t.piece.rot, t.piece.cls, t.piece.cls2]);
    return {
      ...this.saveExtra,
      version: SAVE_VERSION,
      savedAt: Date.now(),
      seed: this.seed,
      clock: { time: this.clock.time, speedIndex: this.clock.speedIndex },
      economy: this.economy.toJSON(),
      track,
      stations: this.builder.stations.map((st) => st.toJSON()),
      trains: this.fleet.trains.map((t) => t.toJSON()),
      contracts: this.contracts.toJSON(),
      trade: this.trade.toJSON(),
      inventory: this.inventory.toJSON(),
      gacha: this.gacha.toJSON(),
      camera: { x: this.camera.x, y: this.camera.y, zoomIndex: this.camera.zoomIndex },
      lastDay: this.lastDay,
      decor: [...this.builder.decor.values()].map((d) => [d.x, d.y, d.id, d.rot]),
      weather: this.weather.toJSON(),

      world: this.spec,
      rules: { ...rules },
      stockpile: this.stock.toJSON(),
      regions: this.regions.toJSON(),
      seasonOffset: getSeasonOffset(),
      towns: this.towns.toJSON(),
      settings: { ...this.settings },
      buildings: [...this.builder.buildings.values()].map((b) => [b.x, b.y, b.id, b.acc]),
      supply: this.catenary.toJSON(),
    };
  }

  save(silent = false) {
    const snap = this.snapshot();
    const ok = writeSave(snap);
    if (ok) this.savedAt = snap.savedAt;
    if (!silent)
      this.toasts.push(ok ? STR.settings.saved : STR.settings.saveFailed, ok ? 'good' : 'warn');
    return ok;
  }

  /**
   * Terrain is regenerated on load; anything the player built must still stand on buildable
   * ground (a regenerated stone field or lake under a station would strand it).
   */
  private fixBuiltTiles(j: SaveGame) {
    const fix = (x: number, y: number, bridge = false) => {
      if (!inBounds(this.map, x, y)) return;
      const t = terrainAt(this.map, x, y);
      if (
        bridge
          ? t !== Terrain.Water
          : t === Terrain.Water || t === Terrain.Rock || t === Terrain.Mountain
      ) {
        this.map.terrain[y * this.map.w + x] = bridge ? Terrain.Water : Terrain.Grass;
        this.map.props.delete(y * this.map.w + x);
        this.world.retile(x, y);
      }
    };
    for (const [x, y, kind, rot, cls] of j.track)
      for (const f of footprintOf(x, y, kind, rot, cls ?? 'regular'))
        fix(f.x, f.y, kind === 'bridge');
    for (const s of j.stations) {
      const size = stationDefOf(s.defId).size ?? 1;
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) fix(s.x + dx, s.y + dy);
    }
    for (const [x, y] of j.decor ?? []) fix(x, y);
    for (const [x, y] of j.buildings ?? []) fix(x, y);
  }
  /** Populate a freshly initialised game from a save with the same seed. */
  applySave(j: SaveGame) {
    this.saveExtra = {};
    for (const [k, v] of Object.entries(j)) if (!KNOWN_SAVE_KEYS.has(k)) this.saveExtra[k] = v;
    if (j.loadedFrom !== undefined) this.warnDeprecated(j);
    if (j.rules) setRules(j.rules);
    setSeasonOffset(j.seasonOffset ?? 0);
    this.clock.time = j.clock.time;
    this.clock.setSpeed(j.clock.speedIndex);
    this.economy.load(j.economy);
    this.lastDay = j.lastDay;
    this.savedAt = j.savedAt;
    if (j.regions) this.regions.load(j.regions);
    else this.regions.applyTier(this.economy.tier);
    this.world.rebuildFog();
    this.fixBuiltTiles(j);
    this.overview.rebuildRegions();
    this.minimap.rebuildBase();
    this.toolbar.refresh();
    for (const [x, y, kind, rot, cls, cls2] of j.track) {
      for (const t of this.track.place(x, y, kind, rot, cls ?? 'regular', cls2))
        this.onTrackChanged(t.x, t.y);
    }
    if (j.supply) {
      for (const [x, y, kind] of j.supply) {
        if (!this.track.has(x, y)) continue;
        this.catenary.set(x, y, kind as SupplyKind);
        this.onSupplyChanged(x, y);
      }
    } else this.legacySupplyPending = true;
    resetStationIds(1);
    for (const sj of j.stations) {
      const st = Station.fromJSON(sj);
      this.builder.stations.push(st);
      this.onStationChanged(st, false);
    }
    this.inventory.load(j.inventory as ReturnType<typeof this.inventory.toJSON>);
    this.gacha.load(j.gacha as ReturnType<typeof this.gacha.toJSON>);
    this.contracts.load(j.contracts as ReturnType<typeof this.contracts.toJSON>);
    this.trade.load(j.trade as ReturnType<typeof this.trade.toJSON> | undefined);
    resetTrainIds(1);
    for (const tj of j.trains as ReturnType<TrainClass['toJSON']>[]) {
      const t = TrainClass.fromJSON(tj, this.track);
      this.fleet.trains.push(t);
    }
    for (const [x, y, id, rot] of j.decor ?? []) {
      const d: Decor = { id, x, y, rot };
      this.builder.decor.set(y * this.map.w + x, d);
      this.onDecorChanged(d, false);
    }
    for (const [x, y, id, acc] of j.buildings ?? []) {
      const b: Building = { id, x, y, acc: acc ?? 0, active: false, rate: 0 };
      this.builder.buildings.set(y * this.map.w + x, b);
      this.onBuildingChanged(b, false);
    }
    if (j.stockpile) this.stock.load(j.stockpile as ReturnType<Stockpile['toJSON']>);
    this.towns.load(j.towns);
    this.ensureDepot();
    this.builder.refreshStationBoosts();
    this.builder.refreshHarvest();
    if (j.weather) this.weather.load(j.weather as ReturnType<Weather['toJSON']>);

    for (const s of this.builder.stations) this.onStationOrphaned(s, this.builder.isOrphaned(s));
    this.applySeason(true);
    // items assigned to trains that no longer exist are freed
    for (const it of this.inventory.items)
      if (it.assigned !== null && !this.fleet.byId(it.assigned)) it.assigned = null;
    this.camera.zoomIndex = j.camera.zoomIndex;
    this.camera.zoom = ZOOM_STEPS[j.camera.zoomIndex];
    this.camera.centerOn(j.camera.x, j.camera.y);
  }

  newGame(seedText: string) {
    clearSave();
    const seed = seedText
      ? /^\d+$/.test(seedText)
        ? Number(seedText)
        : hashSeed(seedText)
      : Math.floor(Math.random() * 2 ** 31);
    setIntentAndReload({ action: 'new', seed });
  }

  // ---------------------------------------------------------------- world edits
  private onTrackChanged(x: number, y: number) {
    this.depot?.onTrackChanged();
    const p = this.track.get(x, y);
    const t = terrainAt(this.map, x, y);
    if (p) {
      if (t === Terrain.Hill) this.world.setFlattened(x, y, true);
      if (t === Terrain.Forest || t === Terrain.Grass)
        this.world.displaceProps(x, y, p.unit ? [] : (p.links as [number, number][]));
      this.world.setTrack(x, y, pieceFrame(p));
    } else {
      this.world.setTrack(x, y, null);
      if (t === Terrain.Hill && !this.builder.stationAt(x, y)) this.world.setFlattened(x, y, false);
    }
  }
  private onDecorChanged(d: Decor, removed: boolean) {
    const id = `decor:${d.x},${d.y}`;
    this.towns?.refresh();
    if (removed) {
      this.world.removeStructure(id);
      this.signalAspect.delete(d.y * this.map.w + d.x);
      if (
        d.id !== 'signal' &&
        terrainAt(this.map, d.x, d.y) === Terrain.Hill &&
        !this.track.has(d.x, d.y) &&
        !this.builder.stationAt(d.x, d.y)
      )
        this.world.setFlattened(d.x, d.y, false);
      if (d.id === 'power_line') this.rebuildPower();
      return;
    }
    const off = decorOffset(d);
    if (d.id === 'power_line') {
      this.world.setStructure(id, d.x, d.y, 'structures/power_line', 14, off.dy, off.dx);
      this.rebuildPower();
      return;
    }
    if (d.id === 'signal') {
      this.world.setStructure(id, d.x, d.y, semaphoreFrame(3, 3), 12, off.dy, off.dx);
      this.signalAspect.set(d.y * this.map.w + d.x, 'green');
    } else {
      const t = terrainAt(this.map, d.x, d.y);
      if (t === Terrain.Hill) this.world.setFlattened(d.x, d.y, true);
      this.world.removeProps(d.x, d.y);
      this.world.setStructure(id, d.x, d.y, `structures/${d.id}`, 20);
    }
  }
  private onStationOrphaned(s: Station, orphaned: boolean) {
    const id = `warn:${s.id}`;
    if (orphaned && !this.orphaned.has(s.id)) {
      this.orphaned.add(s.id);
      this.world.setStructure(id, s.x, s.y, 'structures/warn', 45, -54);
      this.toasts.push(STR.station.orphaned(s.name), 'warn');
    } else if (!orphaned && this.orphaned.has(s.id)) {
      this.orphaned.delete(s.id);
      this.world.removeStructure(id);
    }
  }
  private onBuildingChanged(b: Building, removed: boolean) {
    const id = `building:${b.x},${b.y}`;
    this.towns?.refresh();
    const t = terrainAt(this.map, b.x, b.y);
    if (removed) {
      this.world.removeStructure(id);
      if (t === Terrain.Hill && !this.track.has(b.x, b.y)) this.world.setFlattened(b.x, b.y, false);
    } else {
      if (t === Terrain.Hill) this.world.setFlattened(b.x, b.y, true);
      this.world.removeProps(b.x, b.y);
      this.world.setStructure(id, b.x, b.y, `structures/${b.id}`);
    }
    if (buildingDef(b.id).power || buildingDef(b.id).substation) this.rebuildPower();
  }
  /** electrified track, substations and what is live */
  catenary!: Catenary;
  /** a save from before electrification: string wire over the rails the poles powered */
  private legacySupplyPending = false;
  private onSupplyChanged(x: number, y: number) {
    const id = `supply:${x},${y}`;
    const kind = this.catenary.supplyAt(x, y);
    if (!kind) {
      this.world.removeStructure(id);
    } else {
      const p = this.track.get(x, y);
      const links = p?.links ?? [];
      const ns = links.some((l) => l.includes(Dir.N) && l.includes(Dir.S));
      const ew = links.some((l) => l.includes(Dir.E) && l.includes(Dir.W));
      const axis = ns && !ew ? 'ns' : ew && !ns ? 'ew' : 'x';
      this.world.setStructure(id, x, y, `structures/supply_${kind}_${axis}`, 13);
    }
    this.catenary.rebuild(this.builder.buildings.values(), this.power);
  }
  private fillLegacySupply() {
    this.legacySupplyPending = false;
    this.rebuildPower();
    for (const t of this.track.tiles())
      if (this.power.isPowered(t.x, t.y) && !this.catenary.supplyAt(t.x, t.y)) {
        this.catenary.set(t.x, t.y, 'catenary');
        this.onSupplyChanged(t.x, t.y);
      }
  }
  private rebuildPower() {
    this.power.rebuild(this.builder.decor.values(), this.builder.buildings.values());
    this.catenary.rebuild(this.builder.buildings.values(), this.power);
    this.overview.rebuildPower(this.power);
    this.powerLines.rebuild(this.power);
  }
  /** Storage cap for one resource at the current warehouse and plant count. */
  stockCap(id: string) {
    return this.stock.cap(id, this.builder.depotCount(), this.builder.plantCount());
  }
  /** Arm positions of every semaphore, stepped towards the aspect they should show. */
  private semaphoreArms = new Map<number, { m: number; d: number; frame: string }>();
  private semaphoreClock = 0;
  /**
   * Aspect a signal should show: red while a train sits on the tile it guards or on its own
   * tile, yellow when the tile beyond that is taken, else green. (Block signalling refines this.)
   */
  protected signalAspectAt(d: { x: number; y: number; rot: number }): 'red' | 'yellow' | 'green' {
    const ax = d.x + DIR_DX[d.rot];
    const ay = d.y + DIR_DY[d.rot];
    if (this.fleet.occupied(ax, ay, -1) || this.fleet.occupied(d.x, d.y, -1)) return 'red';
    const bx = ax + DIR_DX[d.rot];
    const by = ay + DIR_DY[d.rot];
    if (this.fleet.occupied(bx, by, -1)) return 'yellow';
    return 'green';
  }
  /** Semaphore arms sweep one step per 70 ms towards the aspect: home arm up for clear, distant arm down when the next block is clear too. */
  private updateSignals(dt = 0) {
    this.semaphoreClock += dt;
    const step = this.semaphoreClock >= 0.07;
    if (step) this.semaphoreClock = 0;
    const top = SEMAPHORE_STEPS - 1;
    for (const d of this.builder.decor.values()) {
      if (d.id !== 'signal') continue;
      const key = d.y * this.map.w + d.x;
      const aspect = this.signalAspectAt(d);
      this.signalAspect.set(key, aspect);
      const want =
        aspect === 'red'
          ? { m: 0, d: 0 }
          : aspect === 'yellow'
            ? { m: top, d: 0 }
            : { m: top, d: top };
      let arms = this.semaphoreArms.get(key);
      if (!arms) {
        arms = { m: want.m, d: want.d, frame: '' };
        this.semaphoreArms.set(key, arms);
      } else if (step) {
        arms.m += Math.sign(want.m - arms.m);
        arms.d += Math.sign(want.d - arms.d);
      }
      const frame = semaphoreFrame(arms.m, arms.d);
      if (arms.frame === frame) continue;
      arms.frame = frame;
      const off = decorOffset(d);
      this.world.setStructure(`decor:${d.x},${d.y}`, d.x, d.y, frame, 12, off.dy, off.dx);
    }
  }
  /** Re-tint the world and adjust production when the season changes. */
  private applySeason(force = false) {
    const s = this.settings.weather ? seasonOf(this.clock.day) : 'spring';
    if (s === this.season && !force) return;
    this.season = s;
    const fx = SEASON_FX[s];
    this.world.setSeasonTint(fx.ground, fx.props);
    for (const st of this.builder.stations)
      st.productionMul = productionMul(st.def.id, s) * this.biomeProduction(st);
  }
  private onStationChanged(s: Station, removed: boolean) {
    const id = `station:${s.id}`;
    if (removed) {
      this.onStationOrphaned(s, false);
      this.world.removeStructure(id);
      for (const f of s.footprint())
        if (terrainAt(this.map, f.x, f.y) === Terrain.Hill && !this.track.has(f.x, f.y))
          this.world.setFlattened(f.x, f.y, false);
    } else {
      s.productionMul = productionMul(s.def.id, this.season ?? 'spring') * this.biomeProduction(s);
      for (const f of s.footprint()) {
        if (terrainAt(this.map, f.x, f.y) === Terrain.Hill) this.world.setFlattened(f.x, f.y, true);
        this.world.removeProps(f.x, f.y);
      }
      if (s.size === 2) {
        // the sprite is anchored at the footprint centre; sort it with its front tile
        this.world.setStructure(
          id,
          s.x + 1,
          s.y + 1,
          `structures/${s.def.art}_r${s.rot % 2}`,
          20,
          -HALF_H_PX,
        );
      } else {
        const fam = `structures/${s.def.art}_${s.spriteLevel}`;
        this.world.setStructure(
          id,
          s.x,
          s.y,
          this.atlas.has(fam) ? fam : `structures/station_${s.spriteLevel}`,
        );
      }
      if (this.stationPanel.station === s) this.stationPanel.render();
    }
    this.towns?.refresh();
  }
  /** A save from another format version was loaded: say which and what was defaulted. */
  private warnDeprecated(j: SaveGame) {
    const from = j.loadedFrom ?? SAVE_VERSION;
    const newer = from > SAVE_VERSION;
    const text = newer
      ? STR.settings.newerSave(from, SAVE_VERSION)
      : STR.settings.olderSave(from, SAVE_VERSION, j.migrationNotes ?? []);
    this.deprecatedSave = text;
    this.toasts.push(newer ? STR.settings.newerToast(from) : STR.settings.olderToast(from), 'warn');
    this.notices.push({ key: 'save:deprecated', kind: 'warn', text, target: null }, 180);
  }
  /** warning text for the settings screen while a converted save is in play */
  deprecatedSave: string | null = null;
  /** Ask for a town's name; `fresh` marks a just-placed station (the default name is offered). */
  private async renameTown(t: Town, fresh = false) {
    const n = await this.namePrompt.ask(STR.town.namePrompt, STR.town.nameHint, t.name);
    if (n && n !== t.name) {
      this.towns.rename(t, n);
      this.townPanel.render(true);
      if (!fresh) this.toasts.push(STR.town.renamed(n), 'info');
    }
  }
  /**
   * Every game has a depot: the start grants one at the middle of the start chunk, an older save
   * gets one on load. Gate track is laid where nothing stands yet. Returns the depot, or null when
   * no room could be found nearby.
   */
  ensureDepot(): Station | null {
    const have = this.builder.depots()[0];
    if (have) return have;
    const rs = this.map.regionSize;
    const cx = Math.floor((Math.floor((this.map.regionsX - 1) / 2) + 0.5) * rs);
    const cy = Math.floor((Math.floor((this.map.regionsY - 1) / 2) + 0.5) * rs);
    const clear = (x: number, y: number, allowTrack: boolean) => {
      if (!inBounds(this.map, x, y) || !this.regions.isTileUnlocked(x, y)) return false;
      const t = terrainAt(this.map, x, y);
      if (t === Terrain.Water || t === Terrain.Rock || t === Terrain.Mountain) return false;
      if (this.builder.stationAt(x, y) || this.builder.decorAt(x, y)) return false;
      if (this.builder.buildingAt(x, y)) return false;
      if (!allowTrack && this.track.has(x, y)) return false;
      return true;
    };
    const fits = (x: number, y: number, rot: number) => {
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) if (!clear(x + dx, y + dy, false)) return false;
      const gates =
        rot === 0
          ? [
              [x - 1, y],
              [x - 1, y + 1],
              [x + 2, y],
              [x + 2, y + 1],
            ]
          : [
              [x, y - 1],
              [x + 1, y - 1],
              [x, y + 2],
              [x + 1, y + 2],
            ];
      return gates.every(([gx, gy]) => clear(gx, gy, true));
    };
    for (let r = 0; r <= 24; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          for (const rot of [0, 1]) {
            const x = cx + dx - 1;
            const y = cy + dy - 1;
            if (!fits(x, y, rot)) continue;
            const wasFree = this.builder.free;
            this.builder.free = true;
            const d = this.builder.placeStation(x, y, 'depot', rot);
            if (d) {
              for (const g of d.gateTiles())
                if (!this.track.has(g.x, g.y))
                  this.builder.placeTrackKind(g.x, g.y, 'straight', rot === 0 ? 1 : 0);
              d.name = STR.station.depotName;
              this.onStationChanged(d, false);
            }
            this.builder.free = wasFree;
            return d;
          }
        }
    return null;
  }
  private onTierUp(tier: number) {
    this.toolbar.refresh();
    this.toasts.push(STR.hud.tierUp(tier), 'good');
    sfx('tier.up');
  }
  /** Biome multiplier on a station's output. */
  private biomeProduction(s: Station) {
    return biomeDef(biomeAt(this.map, s.x, s.y)).production[s.def.id] ?? 1;
  }
  /** Buy a revealed, unowned chunk. Returns true when the purchase went through. */
  buyChunk(i: number, confirmed = false) {
    if (this.regions.unlocked[i] || !this.regions.isRevealed(i)) return false;
    const price = this.regions.price(i);
    if (!this.economy.canAfford(price)) {
      this.toasts.push(STR.overview.cannotAfford(fmtMoney(price)), 'warn');
      return false;
    }
    if (!confirmed) {
      // an in-game dialog: a browser confirm() stalls the loop and then lurches to catch up
      void this.namePrompt
        .confirm(STR.overview.buyTitle, STR.overview.buyConfirm(fmtMoney(price)))
        .then((ok) => {
          if (ok) this.buyChunk(i, true);
        });
      return false;
    }
    this.economy.money -= price;
    this.regions.own(i);
    sfx('tier.up');
    if (
      this.spec.kind === 'generated' &&
      ownsBorderChunk(this.regions.unlocked, this.map.w, this.map.h)
    ) {
      // the grid needs another ring: persist, grow the world and come back into it
      const snap = expandSave(this.snapshot(), 1);
      if (writeSave(snap)) {
        this.toasts.push(STR.overview.growing, 'info');
        setIntentAndReload({ action: 'continue' });
        return true;
      }
    }
    this.world.rebuildFog();
    this.overview.rebuildRegions();
    this.minimap.rebuildBase();
    this.toasts.push(STR.overview.bought, 'good');
    return true;
  }
  private trackTilesForOverview() {
    const out: { x: number; y: number; links: [number, number][] }[] = [];
    for (const t of this.track.tiles())
      out.push({ x: t.x, y: t.y, links: t.piece.links as [number, number][] });
    return out;
  }

  private buildUi() {
    this.hud = new Hud(this.clock);
    this.depot = new DepotScreen(
      this.inventory,
      this.fleet,
      this.builder,
      (m, k) => this.toasts.push(m, k),
      this.atlas,
    );
    this.depot.onFocusTrain = (t) => this.focusTrain(t);
    this.depot.onFocusDepot = (d, gate) => {
      // peek at the shed behind the dimmed screen and mark the gate the train would take
      const p = tileToWorld(d.cx + 0.5, d.cy + 0.5);
      this.camera.zoomIndex = 2;
      this.camera.zoom = ZOOM_STEPS[2];
      this.camera.centerOn(p.x, p.y);
      this.setView(0);
      this.spawnMarkTimer = gate ? 6 : 0;
      if (gate) {
        const sp = this.world.setStructure('spawn-preview', gate.x, gate.y, 'terrain/ghost_ok', 30);
        sp.alpha = 0.9;
      } else this.world.removeStructure('spawn-preview');
      this.screens.root.classList.add('peek');
    };
    this.screens.onChange = (sc) => {
      if (sc) this.build.setTool({ kind: 'none' });
      if (!sc) {
        this.screens.root.classList.remove('peek');
        this.world.removeStructure('spawn-preview');
      }
      sfx(sc ? 'ui.open' : 'ui.close');
    };
    this.trainScreen = new TrainScreen(this.fleet, this.builder, this.stock, this.atlas, (m, k) =>
      this.toasts.push(m, k),
    );
    this.trainScreen.onLocate = (t) => this.focusTrain(t);
    this.depot.onDetails = (t) => {
      this.trainScreen.open(t);
      this.screens.open(this.trainScreen);
    };
    this.marketScreen = new MarketScreen(
      this.stock,
      this.economy,
      (id) => this.stockCap(id),
      (m, k) => this.toasts.push(m, k),
      this.trade,
      () => this.clock.time,
    );
    this.trade.onSettled = (lines) =>
      this.toasts.push(
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
    this.resourceBar = new ResourceBar(this.atlas, () => {
      if (this.mode === 'play' && !this.menuOpen) this.screens.toggle(this.marketScreen);
    });
    this.resourceBar.right.append(this.hud.funds);
    this.resourceBar.stats = () =>
      resourceStats(this.builder, this.fleet.trains, this.stock, RESOURCE_IDS);
    this.tuningScreen = new TuningScreen(() => {
      this.applySeason(true);
      this.toolbar.refresh();
    });
    this.contentScreen = new ContentScreen(() => {
      if (this.mode === 'play' && !this.menuOpen) this.save(true);
      setIntentAndReload({ action: 'menu' });
    });
    this.settingsScreen = new SettingsScreen(
      this.settings,
      () => this.applySettings(),
      {
        save: () => this.save(),
        load: () => {
          const j = readSave();
          if (!j) {
            this.toasts.push(STR.settings.noSave, 'warn');
            return;
          }
          location.hash = `seed=${j.seed}`;
          location.reload();
        },
        newGame: (seed) => this.newGame(seed),
        exportSave: () => JSON.stringify(this.snapshot()),
        saveAs: (name) => {
          const ok = writeSlot(name, this.snapshot());
          this.toasts.push(
            ok ? STR.settings.slotSaved(name) : STR.settings.saveFailed,
            ok ? 'good' : 'warn',
          );
          return ok;
        },
        loadSlot: (name) => {
          const j = readSlot(name);
          if (!j) {
            this.toasts.push(STR.settings.noSave, 'warn');
            return;
          }
          writeSave(j);
          location.hash = `seed=${j.seed}`;
          location.reload();
        },
        deleteSlot: (name) => {
          deleteSlot(name);
          this.toasts.push(STR.settings.slotDeleted(name), 'info');
        },
        slots: () => listSlots(),
        importSave: (json) => {
          try {
            const j = parseSave(json);
            if (!j) throw new Error('bad');
            if (j.settings) writeSettings({ ...DEFAULT_SETTINGS, ...j.settings });
            writeSave(j);
            location.hash = `seed=${j.seed}`;
            location.reload();
            return true;
          } catch {
            this.toasts.push(STR.settings.badSave, 'warn');
            return false;
          }
        },
      },
      () => ({
        seed: this.seed,
        savedAt: this.savedAt,
        version: `v${SAVE_VERSION}`,
        warning: this.deprecatedSave,
      }),
    );
    this.gachaScreen = new GachaScreen(
      this.gacha,
      this.economy,
      () => this.clock.time,
      (m, k) => this.toasts.push(m, k),
      this.atlas,
      () => this.clock.day,
    );
    this.rosterScreen = new RosterScreen(this.inventory, this.fleet, this.atlas);
    this.contractsScreen = new ContractsScreen(this.contracts, this.builder, this.clock, (m, k) =>
      this.toasts.push(m, k),
    );
    this.contractsSide = new ContractsSide(this.contracts, this.builder, this.clock);
    this.contractsSide.onOpenBoard = () => this.screens.toggle(this.contractsScreen);
    this.hud.actions.append(
      btn(STR.topbar.depot, () => this.screens.toggle(this.depot), 'small'),
      btn(STR.topbar.contracts, () => this.screens.toggle(this.contractsScreen), 'small'),
      btn(STR.topbar.gacha, () => this.screens.toggle(this.gachaScreen), 'small'),
      btn(STR.topbar.roster, () => this.screens.toggle(this.rosterScreen), 'small'),
      btn(STR.topbar.market, () => this.screens.toggle(this.marketScreen), 'small'),
      btn(STR.topbar.cheat, () => this.cheat(), 'small cheat'),
      btn(STR.topbar.settings, () => this.screens.toggle(this.settingsScreen), 'small'),
    );

    this.minimap = new Minimap(this.map, this.regions, this.camera, (wx, wy) =>
      this.camera.centerOn(wx, wy),
    );
    this.debug = new DebugPanel(this.seed, {
      giveMoney: () => (this.economy.money += 10000),
      giveTickets: () => (this.economy.tickets += 10),
      giveReputation: () => this.economy.addReputation(100),
      giveResources: () => {
        for (const id of RESOURCE_IDS) this.stock.add(id, 200, this.stockCap(id));
      },
      spawnContract: () => {
        const c = this.contracts.generate(this.clock.time, true);
        this.toasts.push(c ? `Offer: ${c.name}` : STR.contracts.needStations, c ? 'info' : 'warn');
      },
      toggleDepth: () => {
        this.depthOverlay = !this.depthOverlay;
        this.applyDepthOverlay();
        return this.depthOverlay;
      },
      regenerate: () => {
        const v = this.debug.seedValue.trim();
        const seed = /^\d+$/.test(v) ? Number(v) : hashSeed(v);
        location.hash = `seed=${seed}`;
        location.reload();
      },
    });
    this.overviewBanner = el('div', {
      id: 'overview-banner',
      class: 'panel',
      text: STR.overview.hint,
    });
    this.toolbar = new Toolbar(
      (t: Tool) => this.build.setTool(t),
      () => (this.mode === 'editor' ? 99 : this.economy.tier),
      this.atlas,
    );
    this.toolbar.onHover = (it) =>
      this.buildInfo.show(it ?? this.toolbar.item(this.toolbar.active));
    // the next one of a kind costs more: show the live price on the cards
    for (const c of this.toolbar.categories)
      for (const it of c.items) {
        const tool = it.tool;
        if (tool.kind === 'station' || tool.kind === 'decor' || tool.kind === 'building') {
          const id = tool.defId;
          it.costNow = () =>
            scaleCostOf(
              it.cost,
              tool.kind === 'station' && id === 'depot' ? 1 : this.builder.kindMul(id),
            );
        }
      }
    this.toolbar.refresh();
    this.buildingPanel = new BuildingPanel(
      this.builder,
      this.stock,
      () => this.build.selectedBuilding && this.build.selectBuilding(null),
    );
    this.decorPanel = new DecorPanel(this.builder, this.power, () => {
      if (this.build.selectedDecor) this.build.selectDecor(null);
    });
    this.trainSide = new TrainSide(this.builder, this.atlas);
    this.noticePanel = new NoticePanel();
    this.noticePanel.onFocus = (n) => this.focusNotice(n);
    this.advisor = new Advisor(this.settings.advisor === false);
    this.advisor.onSilence = (v) => {
      this.settings.advisor = !v;
      writeSettings(this.settings);
    };
    this.hud.rightActions.append(this.advisor.button);
    this.hud.onToggleWeather = () => {
      this.settings.weather = !this.settings.weather;
      this.applySettings();
    };
    this.hud.onToggleDay = () => {
      this.settings.dayNight = !this.settings.dayNight;
      this.applySettings();
    };
    this.trainSide.onDetails = (t) => {
      this.trainScreen.open(t);
      this.screens.open(this.trainScreen);
    };
    this.trainSide.onLocate = (t) => this.focusTrain(t);
    this.trainSide.onHover = (t) => this.setHoverTrain(t);
    this.buildInfo = new BuildInfo(this.atlas, this.stock, this.builder);
    this.buildInfo.onTrainDetails = (t) => {
      this.trainScreen.open(t);
      this.screens.open(this.trainScreen);
    };
    this.buildInfo.onTrainLocate = (t) => this.focusTrain(t);
    this.buildInfo.onTrainClose = () => this.selectFieldTrain(null);
    this.stationPanel = new StationPanel(
      this.builder,
      () => this.build.selected && this.build.select(null),
      this.contracts,
      this.clock,
      this.towns,
      (t) => this.renameTown(t),
    );
    this.townPanel = new TownPanel(this.towns);
    this.townPanel.onGo = (t) => {
      const st = this.towns.station(t);
      if (st) this.returnToRts(st.x, st.y);
    };
    this.townPanel.onRename = (t) => this.renameTown(t);
    this.towns.onChanged = () => {
      if (this.stationPanel.station) this.stationPanel.render();
      this.depot.refresh();
    };
    this.build.onTownPlaced = (st) => {
      const t = this.towns.found(st);
      this.renameTown(t, true);
    };
    this.buildMenus();
    this.uiRoot.append(
      this.mainMenu.root,
      this.pauseMenu.root,
      this.screens.root,
      this.advisor.root,
      el(
        'div',
        { id: 'right-col' },
        this.noticePanel.root,
        this.contractsSide.root,
        this.trainSide.root,
        this.buildInfo.root,
      ),
      el('div', { class: 'vignette' }),
      this.hud.root,
      this.resourceBar.root,
      this.minimap.root,
      this.debug.root,
      this.overviewBanner,
      this.townPanel.root,
      this.namePrompt.root,
      el('div', { id: 'hint', text: STR.hints.camera }),
      this.toolbar.root,
      this.stationPanel.root,
      this.buildingPanel.root,
      this.decorPanel.root,
      this.toasts.root,
      this.tooltip.root,
    );
  }

  setOverviewSource(src: OverviewSource) {
    this.overviewSource = src;
    (this.overview as unknown as { source: OverviewSource }).source = src;
  }

  // ---------------------------------------------------------------- sim
  private update(dt: number) {
    if (this.settings.autosave && this.mode === 'play' && !this.menuOpen) {
      this.autosaveTimer += dt;
      if (this.autosaveTimer >= 60) {
        this.autosaveTimer = 0;
        this.save(true);
      }
    }
    const gdt = this.clock.advance(dt);
    if (gdt > 0) {
      this.stock.population =
        this.builder.crewTotal() + this.builder.residentsTotal() + this.fleet.crewTotal();
      this.stock.tick(gdt);
      if (this.mode === 'play')
        this.people.tick(
          gdt,
          this.builder.crewTotal() + this.builder.residentsTotal(),
          this.clock.dayFraction,
        );
      const famineMul = this.stock.famine ? 0.5 : 1;
      for (const s of this.builder.stations) s.tick(gdt * famineMul);
      tickBuildings(
        this.builder.buildings.values(),
        this.stock,
        gdt,
        this.stock.famine,
        this.builder.plantCount(),
        this.builder.depotCount(),
      );
      if (this.settings.weather) this.weather.tick(this.clock.time, this.clock.day, dt);
      this.applySeason();
      const wf =
        (this.settings.weather ? this.weather.speedFactor() : 1) * (this.stock.famine ? 0.7 : 1);
      this.fleet.tick(gdt, this.clock.time, wf);
      this.contracts.tick(this.clock.time);
      this.trade.tick(this.clock.time, this.stock, this.economy, (id) => this.stockCap(id));
      if (this.clock.day !== this.lastDay) {
        this.lastDay = this.clock.day;
        if (this.contracts.completedToday > 0) {
          this.economy.tickets += 1;
          this.toasts.push(STR.contracts.dailyTicket, 'good');
        }
        this.contracts.completedToday = 0;
      }
    }
  }

  /** Debug aid requested for testing: money plus a full stockpile. */
  cheat() {
    this.economy.money += 10000;
    this.economy.tickets += 10;
    for (const id of RESOURCE_IDS) this.stock.add(id, 1e9, this.stockCap(id));
    this.toasts.push(STR.topbar.cheated, 'info');
  }

  /** Traffic control and statistics (`game.traffic.report()` in the console; `verbose` logs episodes). */
  get traffic() {
    return this.fleet.traffic;
  }
  /** What a bare tile is and what sits on it, for the hover tooltip. */
  private tileInfo(x: number, y: number): { title: string; lines: string[] } {
    const t = terrainAt(this.map, x, y);
    const T = STR.tile;
    const title = T.terrain[TERRAIN_NAMES[t]] ?? TERRAIN_NAMES[t];
    const lines: string[] = [biomeSummary(biomeAt(this.map, x, y))];
    if (!this.regions.isTileUnlocked(x, y)) lines.push(T.uncharted);
    const piece = this.track.get(x, y);
    if (piece) lines.push(T.track(piece.kind));
    const dec = this.builder.decorAt(x, y);
    if (dec) {
      lines.push(decorDefOf(dec.id).name);
      lines.push(...DecorPanel.lines(dec, this.builder, this.power));
    }
    const props = this.map.props.get(y * this.map.w + x);
    if (props?.length) {
      const kinds = new Map<string, number>();
      for (const p of props) kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1);
      lines.push([...kinds].map(([k, n]) => (n > 1 ? `${n}× ${k}` : k)).join(', '));
    }
    if (this.power.isPowered(x, y)) lines.push(T.powered);
    const tm = this.builder.terrainMul(x, y);
    if (tm === 0) lines.push(T.noTrack);
    else if (tm !== 1) lines.push(T.trackCost(tm));
    if (t === Terrain.Water) lines.push(T.water);
    return { title, lines };
  }
  /** Tile position of a notice's object, or null. */
  private noticePos(n: Notice): { x: number; y: number } | null {
    if (!n.target) return null;
    if (n.target.kind === 'tile') return { x: n.target.x, y: n.target.y };
    const t = this.fleet.byId(n.target.id);
    const p = t?.poses[0];
    return p ? { x: p.x, y: p.y } : null;
  }
  private focusNotice(n: Notice) {
    const p = this.noticePos(n);
    if (!p) return;
    if (n.target?.kind === 'train') {
      const t = this.fleet.byId(n.target.id);
      if (t) {
        this.trainScreen.open(t);
        this.screens.open(this.trainScreen);
      }
    }
    this.returnToRts(p.x, p.y);
  }
  private static markerFrame(kind: Notice['kind']) {
    return kind === 'bad'
      ? 'structures/alert'
      : kind === 'warn'
        ? 'structures/warn'
        : 'structures/note';
  }
  /** Keep one world marker per notice with a target. */
  private syncNoticeMarkers() {
    const live = new Set<string>();
    for (const n of this.notices.list) {
      const p = this.noticePos(n);
      if (!p) continue;
      const id = `notice:${n.key}`;
      live.add(id);
      const lift = n.target?.kind === 'train' ? -40 : -58;
      this.world.setStructure(id, p.x, p.y, Game.markerFrame(n.kind), 46, lift);
    }
    for (const id of this.noticeMarkers) if (!live.has(id)) this.world.removeStructure(id);
    this.noticeMarkers = live;
  }
  /** Train markers follow the locomotive every frame; tile markers bob. */
  private positionTrainMarkers() {
    for (const n of this.notices.list) {
      const m = this.world.getStructure(`notice:${n.key}`);
      if (!m) continue;
      const p = this.noticePos(n);
      if (!p) continue;
      const s = this.world.surfacePoint(p.x, p.y);
      const lift = n.target?.kind === 'train' ? 40 : 58;
      m.position.set(s.x, s.y - lift + Math.sin(this.bobTime * 4) * 3);
      m.zIndex = depthKeyFor(p.x, p.y, 46);
    }
  }
  /** Plain-language tips for the advisor, worst first. */
  private computeTips(): Tip[] {
    const tips: Tip[] = [];
    const T = STR.advisor.tips;
    const b = this.builder;
    if (this.mode !== 'play') return tips;
    for (const n of this.notices.list) {
      if (n.kind !== 'bad' && n.kind !== 'warn') continue;
      const t = n.target?.kind === 'train' ? this.fleet.byId(n.target.id) : null;
      if (t?.state === 'noFuel') tips.push({ key: n.key, kind: 'bad', text: T.outOfFuel(t.name) });
      else if (t?.state === 'noPower')
        tips.push({ key: n.key, kind: 'bad', text: T.noPower(t.name) });
      else if (n.key.endsWith(':wire'))
        tips.push({ key: n.key, kind: 'warn', text: T.unwired(n.text.split(':')[0]) });
      else if (n.key.endsWith(':orphan'))
        tips.push({ key: n.key, kind: 'bad', text: T.noPlatform(n.text.split(':')[0]) });
      else if (n.key.endsWith(':held') || (t && t.blocked && t.blockedTime > 20))
        tips.push({ key: n.key, kind: 'warn', text: T.blocked(t?.name ?? '?') });
    }
    if (this.lastFailedContract)
      tips.push({ key: 'failed', kind: 'warn', text: T.failed(this.lastFailedContract) });
    if (this.stock.famine) tips.push({ key: 'famine', kind: 'bad', text: T.famine });
    else if (this.stock.wheatPerDay() > 0 && this.stock.get('wheat') < this.stock.wheatPerDay() * 2)
      tips.push({ key: 'wheat', kind: 'warn', text: T.lowWheat });
    if (b.stations.length === 0) tips.push({ key: 'nostations', kind: 'info', text: T.noStations });
    else if (b.stations.length === 1)
      tips.push({ key: 'onestation', kind: 'info', text: T.oneStation });
    else if (!this.fleet.trains.length)
      tips.push({ key: 'notrain', kind: 'info', text: T.noTrain });
    const idle = this.inventory.free('loco').length;
    if (idle > 0 && this.fleet.trains.length > 0 && b.stations.length >= 2)
      tips.push({ key: 'idle', kind: 'info', text: T.idleStock(idle) });
    const steam = this.fleet.trains.some((t) => t.hasSteam);
    if (
      steam &&
      !b.stations.some((s) => s.producedCargo().includes('water')) &&
      !b.decorHas('water_tower')
    )
      tips.push({ key: 'water', kind: 'warn', text: T.noWater });
    if (steam && this.stock.get('coal') < 10 && !b.buildingHas('kiln'))
      tips.push({ key: 'coal', kind: 'warn', text: T.lowCoal });
    for (const id of RESOURCE_IDS)
      if (this.stock.get(id) >= this.stockCap(id) - 1e-6 && id !== 'power') {
        tips.push({ key: `cap:${id}`, kind: 'info', text: T.capFull(id) });
        break;
      }
    const offers = this.contracts.offers.length;
    if (offers > 0 && !this.contracts.active.length)
      tips.push({ key: 'offers', kind: 'info', text: T.offers(offers) });
    const buyable = this.regions.unlocked.findIndex((u, i) => !u && this.regions.isRevealed(i));
    if (buyable >= 0 && this.economy.money >= this.regions.price(buyable) * 1.5)
      tips.push({
        key: 'chunk',
        kind: 'info',
        text: T.chunk(fmtMoney(this.regions.price(buyable))),
      });
    return tips.slice(0, 8);
  }

  /** Trains whose head is inside the camera view (field) or all of them (overview). */
  private updateTrainSide(dt: number) {
    const all = this.viewTarget === 1;
    let list: Train[];
    if (all) list = this.fleet.trains;
    else {
      const r = this.camera.viewRect();
      list = this.fleet.trains.filter((t) => {
        const p = t.poses[0];
        if (!p) return false;
        const w = tileToWorld(p.x, p.y);
        return w.x >= r.x - 40 && w.x <= r.x + r.w + 40 && w.y >= r.y - 40 && w.y <= r.y + r.h + 40;
      });
    }
    this.trainSide.update(list, all);
    if (all) this.townPanel.render();
    if (this.spawnMarkTimer > 0) {
      this.spawnMarkTimer -= dt;
      const sp = this.world.getStructure('spawn-preview');
      if (sp) sp.alpha = 0.5 + 0.5 * Math.abs(Math.sin(this.spawnMarkTimer * 6));
      if (this.spawnMarkTimer <= 0) this.world.removeStructure('spawn-preview');
    }
    if (this.hoverTrain && !this.fleet.byId(this.hoverTrain.id)) this.setHoverTrain(null);
    if (!this.hoverTrain && this.pathHighlight.length) this.applyPathHighlight([]);
    if (this.hoverTrain) {
      this.pathTimer += dt;
      if (this.pathTimer > 0.5) {
        this.pathTimer = 0;
        this.applyPathHighlight(this.hoverTrain.predictPath(this.track, this.builder, 2));
      }
    }
  }
  private setHoverTrain(t: Train | null) {
    this.hoverTrain = t;
    this.pathTimer = 1;
    if (!t) this.applyPathHighlight([]);
  }
  /** The train whose cars lie under the cursor in the field view (nearest car within reach). */
  private trainUnderMouse(): Train | null {
    const m = this.camera.screenToWorld(this.input.mouseX, this.input.mouseY);
    let best: Train | null = null;
    let bd = Infinity;
    for (const t of this.fleet.trains)
      for (const p of t.poses) {
        const w = tileToWorld(p.x, p.y);
        const wy = w.y + this.world.elevationOf(Math.floor(p.x + 0.5), Math.floor(p.y + 0.5));
        const dx = Math.abs(w.x - m.x);
        const dy = Math.abs(wy - 10 - m.y);
        const d = Math.hypot(dx, dy * 1.6);
        if (dx <= 22 && dy <= 16 && d < bd) {
          bd = d;
          best = t;
        }
      }
    return best;
  }
  /** Pick a train in the field view: its path lights up and the card above the survey map follows it. */
  selectFieldTrain(t: Train | null) {
    if (this.fieldSelected === t) return;
    this.fieldSelected = t;
    this.trainRenderer.selectedId = t ? t.id : null;
    this.buildInfo.showTrain(t);
    if (t) {
      this.build.select(null);
      this.build.selectBuilding(null);
      this.build.selectDecor(null);
    }
    this.setHoverTrain(t);
  }
  private updateFieldTrains(active: boolean) {
    if (this.fieldSelected && !this.fleet.byId(this.fieldSelected.id)) this.selectFieldTrain(null);
    const canPick = active && this.build.tool.kind === 'none';
    const hover = canPick ? this.trainUnderMouse() : null;
    if (hover !== this.fieldHover) {
      this.fieldHover = hover;
      this.trainRenderer.setHover(hover ? hover.id : null);
      if (!this.fieldSelected || hover) this.setHoverTrain(hover ?? this.fieldSelected);
    }
    if (canPick) {
      const clicks = this.input.clicks;
      for (let i = clicks.length - 1; i >= 0; i--) {
        if (clicks[i].button !== 0) continue;
        if (hover) {
          this.selectFieldTrain(hover);
          clicks.splice(i, 1);
        } else if (this.fieldSelected) this.selectFieldTrain(null);
      }
    }
    if (this.fieldSelected) this.buildInfo.refreshTrain();
  }
  private applyPathHighlight(legs: { x: number; y: number }[][]) {
    for (const leg of this.pathHighlight)
      for (const p of leg) this.world.setTrackTint(p.x, p.y, 0xffffff);
    this.pathHighlight = legs;
    this.overview.highlight = legs;
    legs.forEach((leg, i) => {
      const col = i === 0 ? 0x8ae0f0 : i === 1 ? 0xe0b060 : 0xd8d0c0;
      for (const p of leg) this.world.setTrackTint(p.x, p.y, col);
    });
  }

  focusTrain(t: Train) {
    const p = t.poses[0];
    if (!p) return;
    this.screens.close();
    this.returnToRts(p.x, p.y);
  }

  // ---------------------------------------------------------------- frame
  private render(alpha: number, dt: number) {
    this.camera.viewW = this.app.screen.width;
    this.camera.viewH = this.app.screen.height;
    this.handleInput(dt);
    this.camera.update(dt);
    this.updateViewBlend(dt);
    this.world.animate(dt);
    this.world.applyCamera(this.camera);
    this.layoutViews();
    this.updateCursor();
    this.trainRenderer.update(this.fleet.trains, this.clock.speed === 0 ? 1 : alpha, dt);
    const night = this.settings.dayNight ? nightness(this.clock.dayFraction) : 0;
    const rainI = this.settings.weather && this.weather.kind === 'rain' ? this.weather.visible : 0;
    const fogI = this.settings.weather && this.weather.kind === 'fog' ? this.weather.visible : 0;
    this.dayNight.update(this.clock.dayFraction, this.settings.dayNight, rainI);
    this.rain.update(dt, this.viewTarget === 0 ? rainI : 0, this.camera.viewW, this.camera.viewH);
    this.fog.update(
      dt,
      this.viewTarget === 0 ? fogI : 0,
      this.camera.viewRect(),
      this.camera.viewW,
      this.camera.viewH,
    );
    this.groundLights.update(this.builder.stations, this.fleet.trains, night);
    this.world.setTrackNight(night);
    this.aspectTimer += dt;
    if (this.aspectTimer > 0.1) {
      this.aspectTimer = 0;
      this.updateSignals(dt);
      if (this.legacySupplyPending) this.fillLegacySupply();
    }
    this.bobTime += dt;
    for (const id of this.orphaned) {
      const s = this.builder.stationById(id);
      const m = this.world.getStructure(`warn:${id}`);
      if (s && m) m.y = this.world.surfacePoint(s.x, s.y).y - 54 + Math.sin(this.bobTime * 4) * 3;
    }
    this.hud.setWeather(
      this.settings.weather
        ? STR.hud.weather(SEASON_FX[this.season ?? 'spring'].label, this.weather.label())
        : '',
    );
    this.glows.update(this.builder.stations, this.fleet.trains, night);
    this.smoke.update(this.fleet.trains, dt * this.clock.speed, this.settings.smoke);
    this.peopleRenderer.update(this.people, dt * this.clock.speed);
    const fieldActive =
      this.viewTarget === 0 &&
      this.viewBlend === 0 &&
      !this.input.overUi &&
      !this.screens.current &&
      !this.menuOpen;
    this.updateFieldTrains(fieldActive);
    this.build.update(fieldActive);
    this.updateRtsTooltip();
    this.hud.update(this.economy);
    this.resourceBar.update(this.stock, (id) => this.stockCap(id));
    this.hud.setFps(this.settings.showFps ? this.loop.fps : null);
    this.panelRefresh += dt;
    if (this.panelRefresh > 0.5) {
      this.panelRefresh = 0;
      if (this.stationPanel.station) this.stationPanel.render();
      if (this.buildingPanel.building) this.buildingPanel.render();
      if (this.decorPanel.decor) this.decorPanel.render();
      this.contractsSide.update();
      this.screens.refresh();
      this.buildInfo.refresh();
    }
    this.noticeTimer += dt;
    if (this.noticeTimer > 0.5) {
      this.noticeTimer = 0;
      this.notices.refresh({
        trains: this.fleet.trains,
        builder: this.builder,
        stock: this.stock,
        power: this.power,
        stuck: this.traffic.stuckTrains(this.clock.time),
      });
      this.noticePanel.render(this.notices.list);
      this.advisor.update(this.computeTips(), this.notices.list);
      this.syncNoticeMarkers();
    }
    this.positionTrainMarkers();
    this.floaters.update(dt);
    this.powerLines.update(dt);
    this.updateTrainSide(dt);
    this.minimap.draw(this.minimapMarks());
    if (this.debug.open) this.updateDebug();
    this.input.endFrame();
  }

  private minimapMarks() {
    const track: { x: number; y: number }[] = [];
    for (const t of this.track.tiles()) track.push({ x: t.x, y: t.y });
    return {
      track,
      stations: this.builder.stations.map((s) => ({ x: s.x, y: s.y })),
      trains: this.fleet.trains
        .filter((t) => t.poses.length)
        .map((t) => ({ x: t.poses[0].x, y: t.poses[0].y })),
    };
  }

  private updateRtsTooltip() {
    if (this.viewTarget !== 0 || this.input.overUi) return;
    const st = this.build.hoverStation;
    const bld = this.build.hoverBuilding;
    const ht = this.fieldHover;
    if (ht && this.build.tool.kind === 'none') {
      const d = this.describePick({ kind: 'train', id: ht.id });
      this.tooltip.show(this.input.mouseX, this.input.mouseY, d.title, [
        ...d.lines,
        STR.train.clickHint,
      ]);
    } else if (st && this.build.tool.kind === 'none') {
      this.tooltip.show(this.input.mouseX, this.input.mouseY, st.name, [
        STR.station.level(st.level),
        `${STR.station.storage}: ${Math.floor(st.totalStored())} / ${st.capacity}`,
        biomeSummary(biomeAt(this.map, st.x, st.y)),
      ]);
    } else if (
      this.build.tool.kind === 'none' &&
      !st &&
      !bld &&
      inBounds(this.map, this.hoverTile.x, this.hoverTile.y)
    ) {
      const info = this.tileInfo(this.hoverTile.x, this.hoverTile.y);
      this.tooltip.show(this.input.mouseX, this.input.mouseY, info.title, info.lines);
    } else if (bld && this.build.tool.kind === 'none') {
      const def = buildingDefOf(bld.id);
      const status = BuildingPanel.status(bld, this.stock);
      this.tooltip.show(this.input.mouseX, this.input.mouseY, def.name, [
        BuildingPanel.recipeText(bld.id),
        status.text,
        `${STR.building.rate}: ${STR.station.perDay(Math.round(bld.rate * 10) / 10)}`,
      ]);
    } else this.tooltip.hide();
  }

  private handleInput(dt: number) {
    const inp = this.input;
    if (inp.wasPressed('Backquote')) this.debug.toggle();
    if (this.menuOpen) {
      if (inp.wasPressed('Escape') && this.screens.current) this.screens.close();
      else if (inp.wasPressed('Escape') && this.pauseMenu.visible) this.closeMenus();
      return;
    }
    if (
      inp.wasPressed('Escape') &&
      !this.screens.current &&
      this.build.tool.kind === 'none' &&
      !this.build.selected &&
      this.viewTarget === 0
    ) {
      this.openPauseMenu();
      return;
    }
    if (this.mode === 'play' && inp.wasPressed('KeyF')) this.screens.toggle(this.depot);
    if (this.mode === 'play' && inp.wasPressed('KeyC')) this.screens.toggle(this.contractsScreen);
    if (this.mode === 'play' && inp.wasPressed('KeyG')) this.screens.toggle(this.gachaScreen);
    if (this.mode === 'play' && inp.wasPressed('KeyV')) this.screens.toggle(this.rosterScreen);
    if (this.mode === 'play' && inp.wasPressed('KeyK')) this.screens.toggle(this.marketScreen);
    if (inp.wasPressed('Escape') && this.screens.current) {
      this.screens.close();
      return;
    }
    if (inp.wasPressed('KeyM')) this.toggleOverview();
    if (inp.wasPressed('Tab') && this.toolbar.open && this.viewTarget === 0)
      this.toolbar.cycle(inp.isDown('ShiftLeft') || inp.isDown('ShiftRight') ? -1 : 1);
    if (inp.wasPressed('Escape') && this.viewTarget === 1) {
      if (this.recording) this.cancelRecording();
      else if (this.ovSelected !== null) {
        this.ovSelected = null;
        this.setHoverTrain(null);
        this.updateOverviewBanner();
      } else this.setView(0);
    }
    if (inp.wasPressed('Space')) this.clock.togglePause();
    const catOpen = this.toolbar.open !== null && this.viewTarget === 0;
    for (let d = 1; d <= 9; d++)
      if (inp.wasPressed(`Digit${d}`)) {
        if (catOpen) this.toolbar.selectIndex(d - 1);
        else if (d <= 3) this.clock.setSpeed(d);
      }
    void catOpen;

    // wheel zoom (also crosses the RTS/overview threshold)
    if (inp.wheelDelta !== 0) {
      const dir = inp.wheelDelta > 0 ? -1 : 1; // wheel down = zoom out
      if (this.viewTarget === 0) {
        if (dir < 0 && this.camera.zoomIndex === 0) this.setView(1);
        else this.camera.zoomBy(dir, inp.mouseX, inp.mouseY);
      } else if (dir > 0) {
        const t = this.overviewTileAt(inp.mouseX, inp.mouseY);
        if (t) this.returnToRts(t.x, t.y);
      }
    }

    if (this.viewTarget === 0) {
      // pan: keys
      let dx = 0;
      let dy = 0;
      if (inp.isDown('KeyW') || inp.isDown('ArrowUp')) dy -= 1;
      if (inp.isDown('KeyS') || inp.isDown('ArrowDown')) dy += 1;
      if (inp.isDown('KeyA') || inp.isDown('ArrowLeft')) dx -= 1;
      if (inp.isDown('KeyD') || inp.isDown('ArrowRight')) dx += 1;
      // edge scroll
      if (
        this.settings.edgeScroll &&
        inp.mouseInside &&
        document.hasFocus() &&
        !inp.buttons.size &&
        !this.screens.current
      ) {
        if (inp.mouseX < EDGE_MARGIN) dx -= 1;
        if (inp.mouseX > this.camera.viewW - EDGE_MARGIN) dx += 1;
        if (inp.mouseY < EDGE_MARGIN) dy -= 1;
        if (inp.mouseY > this.camera.viewH - EDGE_MARGIN) dy += 1;
      }
      if (dx || dy) {
        const l = Math.hypot(dx, dy);
        this.camera.pan((dx / l) * PAN_SPEED * dt, (dy / l) * PAN_SPEED * dt);
      }
      // middle-drag
      if (inp.buttons.has(1) && (inp.dragDX || inp.dragDY))
        this.camera.pan(-inp.dragDX, -inp.dragDY);
    } else if (this.viewBlend > 0.99) {
      this.handleOverviewPointer();
    }
  }

  private handleOverviewPointer() {
    const inp = this.input;
    const lp = this.overviewLocal(inp.mouseX, inp.mouseY);
    const pick = this.overview.pick(lp.x, lp.y);
    this.overview.hover = pick;
    const hoverTile = this.overviewTileAt(inp.mouseX, inp.mouseY);
    const hoverChunk = hoverTile ? this.regions.regionIndex(hoverTile.x, hoverTile.y) : -1;
    const buyable =
      hoverChunk >= 0 && !this.regions.unlocked[hoverChunk] && this.regions.isRevealed(hoverChunk);
    if (pick) {
      const info = this.describePick(pick);
      this.tooltip.show(inp.mouseX, inp.mouseY, info.title, info.lines);
    } else if (buyable)
      this.tooltip.show(
        inp.mouseX,
        inp.mouseY,
        STR.overview.chunkTitle,
        STR.overview.chunkLines(fmtMoney(this.regions.price(hoverChunk))),
      );
    else this.tooltip.hide();
    if (inp.wasPressed('KeyR')) this.toggleRecording();
    if (this.recording && inp.wasPressed('Enter')) this.finishRecording();
    for (const c of inp.clicks) {
      if (c.button !== 0) continue;
      const p = this.overview.pick(...this.overviewLocalTuple(c.x, c.y));
      if (this.recording) {
        if (p?.kind === 'station') {
          this.recording.stops.push(p.id);
          this.updateOverviewBanner();
        }
        continue;
      }
      if (p?.kind === 'train') {
        // first click selects (and traces the path), a second click on it goes there
        if (this.ovSelected === p.id) {
          const target = this.pickPosition(p);
          if (target) this.returnToRts(target.x, target.y);
        } else {
          this.ovSelected = p.id;
          const t = this.fleet.byId(p.id);
          this.setHoverTrain(t ?? null);
          this.updateOverviewBanner();
        }
      } else if (p) {
        const target = this.pickPosition(p);
        if (target) this.returnToRts(target.x, target.y);
      } else if (buyable) {
        this.buyChunk(hoverChunk);
      } else {
        const t = this.overviewTileAt(c.x, c.y);
        if (t) this.returnToRts(t.x, t.y);
      }
    }
  }
  /** R in the overview: start recording stops for the selected train, or finish. */
  private toggleRecording() {
    if (this.recording) {
      this.finishRecording();
      return;
    }
    const t = this.ovSelected !== null ? this.fleet.byId(this.ovSelected) : null;
    if (!t) return;
    this.recording = { trainId: t.id, stops: [] };
    this.updateOverviewBanner();
  }
  private finishRecording() {
    const rec = this.recording;
    this.recording = null;
    const t = rec ? this.fleet.byId(rec.trainId) : null;
    if (rec && t && rec.stops.length >= 2) {
      const stops = rec.stops.map(
        (id) => t.schedule.find((s) => s.stationId === id) ?? defaultStopFor(id),
      );
      t.mode = 'schedule';
      this.fleet.setSchedule(t, stops);
      this.toasts.push(STR.overview.recorded(t.name, stops.length), 'good');
    } else if (rec) this.toasts.push(STR.depot.needTwoStops, 'warn');
    this.updateOverviewBanner();
  }
  private cancelRecording() {
    this.recording = null;
    this.updateOverviewBanner();
  }
  private updateOverviewBanner() {
    const t = this.ovSelected !== null ? this.fleet.byId(this.ovSelected) : null;
    if (this.recording && t) {
      const names = this.recording.stops
        .map((id) => this.builder.stationById(id)?.name ?? '?')
        .join(' > ');
      this.overviewBanner.textContent = STR.overview.recording(t.name, names);
    } else if (t) this.overviewBanner.textContent = STR.overview.selectHint(t.name);
    else this.overviewBanner.textContent = STR.overview.hint;
  }

  /** Overridable hooks for later milestones. */
  describePick(p: { kind: 'station' | 'train'; id: number }): { title: string; lines: string[] } {
    if (p.kind === 'station') {
      const s = this.builder.stationById(p.id);
      if (s)
        return {
          title: s.name,
          lines: [
            STR.station.level(s.level),
            `${STR.station.storage}: ${Math.floor(s.totalStored())} / ${s.capacity}`,
          ],
        };
    }
    if (p.kind === 'train') {
      const t = this.fleet.byId(p.id);
      if (t) {
        const next = this.builder.stationById(t.route[t.routeIndex % Math.max(1, t.route.length)]);
        return {
          title: t.name,
          lines: [
            `${t.blocked && t.state === 'moving' ? STR.depot.state.held : STR.depot.state[t.state]}${next ? ` → ${next.name}` : ''}`,
            STR.depot.cargo(Math.round(t.totalCargo())),
            `${Math.round(t.weight)} / ${Math.round(t.power)} t`,
          ],
        };
      }
    }
    return { title: `${p.kind} #${p.id}`, lines: [] };
  }
  pickPosition(p: { kind: 'station' | 'train'; id: number }): { x: number; y: number } | null {
    const list =
      p.kind === 'station' ? this.overviewSource.stations() : this.overviewSource.trains();
    const e = list.find((s) => s.id === p.id);
    return e ? { x: e.x, y: e.y } : null;
  }

  // ---------------------------------------------------------------- view modes
  toggleOverview() {
    this.setView(this.viewTarget === 0 ? 1 : 0);
  }
  setView(v: 0 | 1) {
    if (this.viewTarget === v) return;
    this.viewTarget = v;
    this.overviewBanner.classList.toggle('show', v === 1);
    this.toolbar.root.style.display = v === 1 ? 'none' : '';
    this.townPanel.show(v === 1);
    if (v === 1) this.build.setTool({ kind: 'none' });
    if (v === 0) {
      this.tooltip.hide();
      this.overview.hover = null;
      this.ovSelected = null;
      this.recording = null;
      this.setHoverTrain(null);
      this.updateOverviewBanner();
    }
  }
  returnToRts(tx: number, ty: number) {
    const p = tileToWorld(tx, ty);
    this.camera.zoomIndex = 1;
    this.camera.zoom = ZOOM_STEPS[1];
    this.camera.centerOn(p.x, p.y);
    this.setView(0);
  }
  private updateViewBlend(dt: number) {
    const step = dt * (1000 / TRANSITION_MS);
    if (this.viewBlend < this.viewTarget) this.viewBlend = Math.min(1, this.viewBlend + step);
    else if (this.viewBlend > this.viewTarget) this.viewBlend = Math.max(0, this.viewBlend - step);
  }
  private layoutViews() {
    const e = easeInOut(this.viewBlend);
    // world: fade + shrink towards the camera centre
    const w = this.world.root;
    const shrink = 1 - 0.45 * e;
    w.scale.set(this.camera.zoom * shrink);
    w.position.set(
      Math.round(this.camera.viewW / 2 - this.camera.x * this.camera.zoom * shrink),
      Math.round(this.camera.viewH / 2 - this.camera.y * this.camera.zoom * shrink),
    );
    w.alpha = 1 - e;
    w.visible = this.viewBlend < 1;
    // overview: fit map, scale in from 1.6x centred on the camera tile
    const o = this.overview.root;
    o.visible = this.viewBlend > 0;
    o.alpha = e;
    const vw = this.camera.viewW;
    const vh = this.camera.viewH;
    const ob = this.overview.bounds();
    const fit = Math.min((vw - 300) / ob.w, (vh - 90) / ob.h);
    const camTile = worldToTileInt(this.camera.x, this.camera.y);
    const s = fit * (1.6 - 0.6 * e);
    const centerX = lerp((camTile.x + 0.5) * OV_UNIT, ob.x + ob.w / 2, e);
    const centerY = lerp((camTile.y + 0.5) * OV_UNIT, ob.y + ob.h / 2, e);
    o.scale.set(s);
    o.position.set(vw / 2 - centerX * s, vh / 2 + 18 - centerY * s);
    if (o.visible) this.overview.refresh();
  }
  private overviewLocal(sx: number, sy: number) {
    const o = this.overview.root;
    return { x: (sx - o.x) / o.scale.x, y: (sy - o.y) / o.scale.y };
  }
  private overviewLocalTuple(sx: number, sy: number): [number, number] {
    const p = this.overviewLocal(sx, sy);
    return [p.x, p.y];
  }
  overviewTileAt(sx: number, sy: number) {
    const p = this.overviewLocal(sx, sy);
    const t = this.overview.localToTile(p.x, p.y);
    const tx = Math.floor(t.x);
    const ty = Math.floor(t.y);
    return inBounds(this.map, tx, ty) ? { x: tx, y: ty } : null;
  }

  // ---------------------------------------------------------------- cursor / debug
  tileUnderMouse() {
    const w = this.camera.screenToWorld(this.input.mouseX, this.input.mouseY);
    return worldToTileInt(w.x, w.y);
  }
  private updateCursor() {
    const t = this.tileUnderMouse();
    this.hoverTile = t;
    const ok = inBounds(this.map, t.x, t.y) && this.viewTarget === 0 && !this.input.overUi;
    this.cursor.visible = ok;
    if (ok) {
      const p = this.world.surfacePoint(t.x, t.y);
      this.cursor.position.set(p.x, p.y);
    }
  }
  private applyDepthOverlay() {
    for (const ch of this.world.objects.children) {
      if (!this.depthOverlay) {
        ch.tint = 0xffffff;
        continue;
      }
      const z = ch.zIndex / 100;
      const h = (z * 7) % 360;
      ch.tint = hsl(h, 0.8, 0.6);
    }
  }
  private updateDebug() {
    const d = this.debug;
    d.set(STR.debug.fps, String(this.loop.fps));
    d.set(STR.debug.seed, String(this.seed));
    d.set(
      STR.debug.entities,
      `${this.world.objects.children.length} obj / ${this.map.w * this.map.h} tiles`,
    );
    d.set(STR.debug.zoom, `${this.camera.targetZoom}x (${this.viewTarget ? 'overview' : 'rts'})`);
    d.set(STR.debug.camera, `${Math.round(this.camera.x)}, ${Math.round(this.camera.y)}`);
    const tc = this.traffic.counters;
    d.set(
      STR.debug.traffic,
      `stuck ${tc.stuck} · deadlock ${tc.deadlocks} · overlap ${tc.overlaps} · yields ${tc.yields} · holds ${tc.waits}`,
    );
    const t = this.hoverTile;
    const name = inBounds(this.map, t.x, t.y)
      ? TERRAIN_NAMES[this.map.terrain[t.y * this.map.w + t.x] as Terrain]
      : '-';
    d.set(
      STR.debug.tile,
      `${t.x}, ${t.y} ${name} · ${inBounds(this.map, t.x, t.y) ? biomeDef(biomeAt(this.map, t.x, t.y)).name : '-'}`,
    );
  }
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function hsl(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return (
    (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255)
  );
}
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

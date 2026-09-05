import { Application, Sprite, extensions, CullerPlugin } from 'pixi.js';
import { AtlasRegistry } from './engine/atlas';
import { Camera, ZOOM_STEPS } from './engine/camera';
import { Input } from './engine/input';
import { GameLoop } from './engine/loop';
import { worldToTileInt, tileToWorld } from './engine/iso';
import { ATLAS_GROUPS } from './art/index';
import { generateMap } from './world/mapgen';
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
import { ContractBoard } from './sim/contracts';
import { ContractsScreen } from './ui/contractsScreen';
import { ContractsSide } from './ui/contractsSide';
import { Rng } from './engine/rng';
import { DayNight, Glows, Smoke, GroundLights, Rain, Fog, nightness } from './render/fx';
import { Weather, SEASON_FX, seasonOf, productionMul, type Season } from './sim/weather';
import { decorOffset, type Decor } from './sim/build';
import { validateBanners } from './gacha/gacha';
import { DIR_DX, DIR_DY } from './engine/iso';
import { audio, sfx } from './engine/audio';
import { SettingsScreen } from './ui/settingsScreen';
import {
  SAVE_VERSION,
  readSave,
  writeSave,
  clearSave,
  readSettings,
  writeSettings,
  type SaveGame,
  type Settings,
} from './sim/save';
import { Station, resetStationIds } from './sim/stations';
import { Train as TrainClass, resetTrainIds } from './sim/trains';
import { makePiece } from './world/track';
import { cargoDef } from './sim/cargo';
import { fmtMoney } from './ui/dom';
import { Gacha } from './gacha/gacha';
import { GachaScreen } from './ui/gachaScreen';
import { RosterScreen } from './ui/rosterScreen';

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
  private lastDay = 1;
  settings: Settings = readSettings();
  settingsScreen!: SettingsScreen;
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
        x: s.x,
        y: s.y,
        name: s.name,
        level: s.level,
      })),
    trains: () =>
      this.fleet.trains
        .filter((t) => t.poses.length)
        .map((t) => ({
          id: t.id,
          x: t.poses[0].x,
          y: t.poses[0].y,
          name: t.name,
          heading: t.poses[0].heading + (t.reversed ? Math.PI : 0),
        })),
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

  constructor(seed: number) {
    this.seed = seed;
    this.uiRoot = document.getElementById('ui-root')!;
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

    this.map = generateMap(this.seed);
    this.regions = new RegionState(this.map, 0);
    this.camera.setMapSize(this.map.w, this.map.h);
    this.camera.viewW = this.app.screen.width;
    this.camera.viewH = this.app.screen.height;
    const c = tileToWorld(this.map.w / 2, this.map.h / 2);
    this.camera.centerOn(c.x, c.y);

    this.track = new TrackGraph(this.map.w, this.map.h);
    this.builder = new Builder(this.map, this.regions, this.track, this.economy);
    this.builder.onTrackChanged = (x, y) => this.onTrackChanged(x, y);
    this.builder.onStationChanged = (s, removed) => this.onStationChanged(s, removed);
    this.builder.onDecorChanged = (d, removed) => this.onDecorChanged(d, removed);
    this.builder.onStationOrphaned = (s, orphaned) => this.onStationOrphaned(s, orphaned);
    this.weather = new Weather(new Rng(this.seed ^ 0x77ea));
    validateBanners();
    this.economy.onMessage = (m, k) => this.toasts.push(m, k);
    this.economy.onTierUp = (t) => this.onTierUp(t);
    this.inventory.seedStarter(0);
    this.fleet = new Fleet(this.track, this.builder, this.map, this.inventory, this.economy);
    this.contracts = new ContractBoard(new Rng(this.seed ^ 0x5eed), this.builder, this.economy);
    this.gacha = new Gacha(new Rng(this.seed ^ 0x9ac4a), this.inventory);
    this.fleet.onDelivery = (e) => this.contracts.onDelivery(e);
    this.contracts.onEvent = (e) => {
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
        sfx('contract.fail');
      } else if (e.kind === 'accepted') sfx('contract.accept');
    };

    this.world = new WorldRenderer(this.atlas, this.map, this.regions);
    this.overview = new OverviewRenderer(this.map, this.regions, this.overviewSource);
    this.overview.root.visible = false;
    const cur = this.atlas.get('terrain/cursor');
    this.cursor = new Sprite(cur.texture);
    this.cursor.anchor.set(cur.anchorX, cur.anchorY);
    this.world.overlay.addChild(this.cursor);
    this.rain = new Rain(this.atlas);
    this.fog = new Fog(this.atlas);
    this.world.root.addChild(this.dayNight.overlay);
    this.dayNight.setWorld(this.map.w, this.map.h, WorldRenderer.BORDER);
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
    this.applySeason(true);
    this.applySettings();
    this.trainRenderer = new TrainRenderer(this.atlas, this.world.objects);

    this.build = new BuildController(this.input, this.builder, this.world, () =>
      this.tileUnderMouse(),
    );
    this.buildUi();
    this.build.onSelect = (s) =>
      s ? this.stationPanel.open(s) : this.stationPanel.station && this.stationPanel.close();
    this.build.onStatus = (t) => this.toolbar.setStatus(t);
    this.build.onToolChanged = (t) => this.toolbar.setActive(t);
    this.loop = new GameLoop(
      SIM_HZ,
      (dt) => this.update(dt),
      (a, dt) => this.render(a, dt),
    );
    this.loop.start();
    window.addEventListener('beforeunload', () => {
      if (this.settings.autosave) this.save(true);
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
  }

  snapshot(): SaveGame {
    const track: SaveGame['track'] = [];
    for (const t of this.track.tiles()) track.push([t.x, t.y, t.piece.kind, t.piece.rot]);
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      seed: this.seed,
      clock: { time: this.clock.time, speedIndex: this.clock.speedIndex },
      economy: this.economy.toJSON(),
      track,
      stations: this.builder.stations.map((st) => st.toJSON()),
      trains: this.fleet.trains.map((t) => t.toJSON()),
      contracts: this.contracts.toJSON(),
      inventory: this.inventory.toJSON(),
      gacha: this.gacha.toJSON(),
      camera: { x: this.camera.x, y: this.camera.y, zoomIndex: this.camera.zoomIndex },
      lastDay: this.lastDay,
      decor: [...this.builder.decor.values()].map((d) => [d.x, d.y, d.id, d.rot]),
      weather: this.weather.toJSON(),
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

  /** Populate a freshly initialised game from a save with the same seed. */
  applySave(j: SaveGame) {
    this.clock.time = j.clock.time;
    this.clock.setSpeed(j.clock.speedIndex);
    this.economy.load(j.economy);
    this.lastDay = j.lastDay;
    this.savedAt = j.savedAt;
    this.regions.applyTier(this.economy.tier);
    this.world.rebuildFog();
    this.overview.rebuildRegions();
    this.minimap.rebuildBase();
    this.toolbar.refresh();
    for (const [x, y, kind, rot] of j.track) {
      this.track.set(x, y, makePiece(kind, rot));
      this.onTrackChanged(x, y);
    }
    resetStationIds(1);
    for (const sj of j.stations) {
      const st = Station.fromJSON(sj);
      this.builder.stations.push(st);
      this.onStationChanged(st, false);
    }
    this.inventory.load(j.inventory as ReturnType<typeof this.inventory.toJSON>);
    this.gacha.load(j.gacha as ReturnType<typeof this.gacha.toJSON>);
    this.contracts.load(j.contracts as ReturnType<typeof this.contracts.toJSON>);
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
    this.builder.refreshStationBoosts();
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
    location.hash = `seed=${seed}&new`;
    location.reload();
  }

  // ---------------------------------------------------------------- world edits
  private onTrackChanged(x: number, y: number) {
    const p = this.track.get(x, y);
    const t = terrainAt(this.map, x, y);
    if (p) {
      if (t === Terrain.Hill) this.world.setFlattened(x, y, true);
      if (t === Terrain.Forest || t === Terrain.Grass) this.world.removeProps(x, y);
      this.world.setTrack(x, y, `track/${p.kind}_${p.rot}`);
    } else {
      this.world.setTrack(x, y, null);
      if (t === Terrain.Hill && !this.builder.stationAt(x, y)) this.world.setFlattened(x, y, false);
    }
  }
  private onDecorChanged(d: Decor, removed: boolean) {
    const id = `decor:${d.x},${d.y}`;
    if (removed) {
      this.world.removeStructure(id);
      this.signalAspect.delete(d.y * this.map.w + d.x);
      return;
    }
    const off = decorOffset(d);
    if (d.id === 'signal') {
      this.world.setStructure(id, d.x, d.y, 'structures/signal_green', 12, off.dy, off.dx);
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
  /** Signals show red when a train sits on the tile they guard or on their own tile. */
  private updateSignals() {
    for (const d of this.builder.decor.values()) {
      if (d.id !== 'signal') continue;
      const key = d.y * this.map.w + d.x;
      const ax = d.x + DIR_DX[d.rot];
      const ay = d.y + DIR_DY[d.rot];
      const red = this.fleet.occupied(ax, ay, -1) || this.fleet.occupied(d.x, d.y, -1);
      const aspect = red ? 'red' : 'green';
      if (this.signalAspect.get(key) === aspect) continue;
      this.signalAspect.set(key, aspect);
      const off = decorOffset(d);
      this.world.setStructure(
        `decor:${d.x},${d.y}`,
        d.x,
        d.y,
        `structures/signal_${aspect}`,
        12,
        off.dy,
        off.dx,
      );
    }
  }
  /** Re-tint the world and adjust production when the season changes. */
  private applySeason(force = false) {
    const s = this.settings.weather ? seasonOf(this.clock.day) : 'spring';
    if (s === this.season && !force) return;
    this.season = s;
    const fx = SEASON_FX[s];
    this.world.setSeasonTint(fx.ground, fx.props);
    for (const st of this.builder.stations) st.productionMul = productionMul(st.def.id, s);
  }
  private onStationChanged(s: Station, removed: boolean) {
    const id = `station:${s.id}`;
    const t = terrainAt(this.map, s.x, s.y);
    if (removed) {
      this.world.removeStructure(id);
      if (t === Terrain.Hill && !this.track.has(s.x, s.y)) this.world.setFlattened(s.x, s.y, false);
    } else {
      if (t === Terrain.Hill) this.world.setFlattened(s.x, s.y, true);
      this.world.removeProps(s.x, s.y);
      this.world.setStructure(id, s.x, s.y, `structures/station_${s.spriteLevel}`);
      if (this.stationPanel.station === s) this.stationPanel.render();
    }
  }
  private onTierUp(tier: number) {
    const newly = this.regions.applyTier(tier);
    if (newly.length) {
      this.world.rebuildFog();
      this.overview.rebuildRegions();
      this.minimap.rebuildBase();
    }
    this.toolbar.refresh();
    this.toasts.push(STR.hud.tierUp(tier), 'good');
    sfx('tier.up');
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
        importSave: (json) => {
          try {
            const j = JSON.parse(json) as SaveGame;
            if (j.version !== SAVE_VERSION || typeof j.seed !== 'number') throw new Error('bad');
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
      () => ({ seed: this.seed, savedAt: this.savedAt, version: `v${SAVE_VERSION}` }),
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
      btn(STR.topbar.settings, () => this.screens.toggle(this.settingsScreen), 'small'),
    );
    this.screens.onChange = (sc) => {
      if (sc) this.build.setTool({ kind: 'none' });
      sfx(sc ? 'ui.open' : 'ui.close');
    };
    this.minimap = new Minimap(this.map, this.regions, this.camera, (wx, wy) =>
      this.camera.centerOn(wx, wy),
    );
    this.debug = new DebugPanel(this.seed, {
      giveMoney: () => (this.economy.money += 10000),
      giveTickets: () => (this.economy.tickets += 10),
      giveReputation: () => this.economy.addReputation(100),
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
      () => this.economy.tier,
    );
    this.toolbar.refresh();
    this.stationPanel = new StationPanel(
      this.builder,
      () => this.build.selected && this.build.select(null),
      this.contracts,
      this.clock,
    );
    this.uiRoot.append(
      this.screens.root,
      this.contractsSide.root,
      el('div', { class: 'vignette' }),
      this.hud.root,
      this.minimap.root,
      this.debug.root,
      this.overviewBanner,
      el('div', { id: 'hint', text: STR.hints.camera }),
      this.toolbar.root,
      this.stationPanel.root,
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
    if (this.settings.autosave) {
      this.autosaveTimer += dt;
      if (this.autosaveTimer >= 60) {
        this.autosaveTimer = 0;
        this.save(true);
      }
    }
    const gdt = this.clock.advance(dt);
    if (gdt > 0) {
      for (const s of this.builder.stations) s.tick(gdt);
      if (this.settings.weather) this.weather.tick(this.clock.time, this.clock.day, dt);
      this.applySeason();
      const wf = this.settings.weather ? this.weather.speedFactor() : 1;
      this.fleet.tick(gdt, this.clock.time, wf);
      this.contracts.tick(this.clock.time);
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
    this.trainRenderer.update(this.fleet.trains, this.clock.speed === 0 ? 1 : alpha);
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
    this.aspectTimer += dt;
    if (this.aspectTimer > 0.1) {
      this.aspectTimer = 0;
      this.updateSignals();
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
    this.build.update(
      this.viewTarget === 0 && this.viewBlend === 0 && !this.input.overUi && !this.screens.current,
    );
    this.updateRtsTooltip();
    this.hud.update(this.economy);
    this.hud.setFps(this.settings.showFps ? this.loop.fps : null);
    this.panelRefresh += dt;
    if (this.panelRefresh > 0.5) {
      this.panelRefresh = 0;
      if (this.stationPanel.station) this.stationPanel.render();
      this.contractsSide.update();
      this.screens.refresh();
    }
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
    if (st && this.build.tool.kind === 'none') {
      this.tooltip.show(this.input.mouseX, this.input.mouseY, st.name, [
        STR.station.level(st.level),
        `${STR.station.storage}: ${Math.floor(st.totalStored())} / ${st.capacity}`,
      ]);
    } else this.tooltip.hide();
  }

  private handleInput(dt: number) {
    const inp = this.input;
    if (inp.wasPressed('Backquote')) this.debug.toggle();
    if (inp.wasPressed('KeyF')) this.screens.toggle(this.depot);
    if (inp.wasPressed('KeyC')) this.screens.toggle(this.contractsScreen);
    if (inp.wasPressed('KeyG')) this.screens.toggle(this.gachaScreen);
    if (inp.wasPressed('KeyV')) this.screens.toggle(this.rosterScreen);
    if (inp.wasPressed('Escape') && this.screens.current) {
      this.screens.close();
      return;
    }
    if (inp.wasPressed('Tab')) this.toggleOverview();
    if (inp.wasPressed('Escape') && this.viewTarget === 1) this.setView(0);
    if (inp.wasPressed('Space')) this.clock.togglePause();
    if (inp.wasPressed('Digit1')) this.clock.setSpeed(1);
    if (inp.wasPressed('Digit2')) this.clock.setSpeed(2);
    if (inp.wasPressed('Digit3')) this.clock.setSpeed(3);

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
    if (pick) {
      const info = this.describePick(pick);
      this.tooltip.show(inp.mouseX, inp.mouseY, info.title, info.lines);
    } else this.tooltip.hide();
    for (const c of inp.clicks) {
      if (c.button !== 0) continue;
      const p = this.overview.pick(...this.overviewLocalTuple(c.x, c.y));
      if (p) {
        const target = this.pickPosition(p);
        if (target) this.returnToRts(target.x, target.y);
      } else {
        const t = this.overviewTileAt(c.x, c.y);
        if (t) this.returnToRts(t.x, t.y);
      }
    }
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
    if (v === 1) this.build.setTool({ kind: 'none' });
    if (v === 0) {
      this.tooltip.hide();
      this.overview.hover = null;
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
    const fit = Math.min((vw - 40) / (this.map.w * OV_UNIT), (vh - 90) / (this.map.h * OV_UNIT));
    const camTile = worldToTileInt(this.camera.x, this.camera.y);
    const s = fit * (1.6 - 0.6 * e);
    const centerX = lerp((camTile.x + 0.5) * OV_UNIT, (this.map.w * OV_UNIT) / 2, e);
    const centerY = lerp((camTile.y + 0.5) * OV_UNIT, (this.map.h * OV_UNIT) / 2, e);
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
    const t = this.hoverTile;
    const name = inBounds(this.map, t.x, t.y)
      ? TERRAIN_NAMES[this.map.terrain[t.y * this.map.w + t.x] as Terrain]
      : '-';
    d.set(STR.debug.tile, `${t.x}, ${t.y} ${name}`);
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

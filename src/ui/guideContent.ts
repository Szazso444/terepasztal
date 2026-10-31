/**
 * The in-game Guide, as plain data. Every page is built by a pure function from the data and the
 * rules: costs, ages, line speeds, `rules`, `KEYMAP` and the game's own hints are read here, and the
 * words around them come from `STR.guide`, so a page says what the game does today. `guideScreen.ts`
 * draws the pages; a test walks them for both production chains and both languages. DOM-free.
 */
import { content, type Cost } from '../data/content';
import { CRAFT_CONFIG, CRAFT_TIERS } from '../gacha/crafting';
import { LEVEL_CAP, STAT_PER_LEVEL } from '../gacha/items';
import { AGE_DEFS, type GoalKind } from '../sim/ages';
import { BRIDGE_SLOW_FACTOR, BRIDGE_SLOW_SHARE } from '../sim/bridges';
import { Builder, DECOR_DEFS, decorDef } from '../sim/build';
import { BUILDING_DEFS, buildingDef } from '../sim/buildings';
import { CARGO } from '../sim/cargo';
import { SUPPLY_DEFS, SUPPLY_KINDS } from '../sim/catenary';
import { CLASS_LINE, TRAIN_CLASSES, classOf, classRunsOn, gaugeLine } from '../sim/compat';
import { MAX_LOCOS, MAX_WAGONS } from '../sim/fleet';
import { lineSpeedCap } from '../sim/lineSpeed';
import { rules, weekSeconds, daySeconds } from '../sim/rules';
import { HEADWAY, SIGNAL_LEVELS } from '../sim/signals';
import { startDepotKind } from '../sim/startDepot';
import {
  HARVEST_CEIL,
  HARVEST_FLOOR,
  HARVEST_RADIUS,
  LEVELS,
  STATION_DEFS,
  stationDef,
  weeklyOutput,
} from '../sim/stations';
import { FAMINE_PRODUCTION_MUL, PASSENGER_CATCHMENT, startStock } from '../sim/step';
import { dieselFuelId, inSupplyMode, sandPerTile, supplyMode } from '../sim/supply';
import { TOWN_RADIUS } from '../sim/towns';
import { BUY_MUL, SELL_MUL, TradeDesk } from '../sim/trade';
import { FAMINE_SPEED_MUL } from '../sim/trains';
import { STR } from '../strings';
import { Terrain } from '../world/tiles';
import {
  BUILDABLE_CLASSES,
  TRACK_ITEMS,
  classCostMul,
  classRadius,
  pieceCost,
  type TrackClass,
} from '../world/track';
import { curveFactor } from '../world/trackGeom';
import { ageNews, lineOpens } from './ageNews';
import { ageName, fmtGoal, newsLines } from './ageTooltip';
import { buildCatalog, keyLabel, visibleCategories, type CategoryId } from './buildBar';
import type { IconName } from './kit';
import { KEYMAP, screenKey, type KeyAction, type KeyContext } from './keymap';
import { fmtDecimal, fmtInt, fmtMoney } from './numberFormat';
import { makersOf, usersOf, type BuildRef } from './resourceOrder';
import { tileGoods } from './tileTooltip';
import { amounts } from './tooltipContent';
import { fill, num, plain, res, richText, type Inline, type Parts } from './tooltipDoc';

/** A picture of something the game has, named by its id. */
export interface GuidePicture {
  of: 'vehicle' | 'station' | 'works' | 'age';
  id: string;
  caption: string;
}

/** A row of a key table. */
export interface GuideKey {
  keys: readonly string[];
  text: string;
}

export type GuideBlock =
  | { readonly kind: 'head'; readonly text: string }
  | { readonly kind: 'text'; readonly parts: Parts }
  /** `steps` are numbered, `list` is not */
  | { readonly kind: 'steps' | 'list'; readonly items: readonly Parts[] }
  | { readonly kind: 'table'; readonly head: readonly string[]; readonly rows: readonly Parts[][] }
  | { readonly kind: 'keys'; readonly rows: readonly GuideKey[] }
  /** fixed-width text, as it stands */
  | { readonly kind: 'diagram'; readonly text: string }
  | { readonly kind: 'pictures'; readonly items: readonly GuidePicture[] };

export interface GuidePage {
  id: string;
  title: string;
  icon: IconName;
  blocks: GuideBlock[];
}

const G = STR.guide;

// ---------------------------------------------------------------- small pieces

const head = (text: string): GuideBlock => ({ kind: 'head', text });
const para = (template: string, slots: Record<string, Inline | Parts> = {}): GuideBlock => ({
  kind: 'text',
  parts: fill(template, slots),
});
const list = (...items: Parts[]): GuideBlock => ({ kind: 'list', items });
const steps = (...items: Parts[]): GuideBlock => ({ kind: 'steps', items });
const table = (head_: readonly string[], rows: Parts[][]): GuideBlock => ({
  kind: 'table',
  head: head_,
  rows,
});
/** A sentence of the game's own, its numbers in bold. */
const said = (s: string): Inline[] => richText(s);
const cell = (v: string | number): Parts => [String(v)];

/** A share as a whole percent, or with its decimals when it has them. */
function percent(share: number): string {
  const p = Math.round(share * 10000) / 100;
  return `${fmtDecimal(p)}%`;
}
const times = (v: number) => `×${fmtDecimal(v)}`;
const lineName = (c: TrackClass) => STR.toolbar.trackClass[c];
/** Names in a sentence: "a, b and c". */
function names(list_: readonly string[]): string {
  if (list_.length < 2) return list_.join('');
  return `${list_.slice(0, -1).join(', ')} ${G.and} ${list_[list_.length - 1]}`;
}
/** Pieces of a line, with commas between them. */
function joined(items: readonly Inline[][]): Inline[] {
  return items.flatMap((p, i) => (i ? [', ', ...p] : p));
}
/** What a list of things that make or use a good reads as: their names, or a dash for none. */
function refNames(refs: readonly BuildRef[]): string {
  return refs.map((r) => r.name).join(', ') || G.none;
}
const costCell = (c: Cost): Parts => amounts(c);

/** A build category's name and the key that opens it in a game. */
function category(id: CategoryId): { label: string; key: string } {
  const cats = visibleCategories(
    buildCatalog(() => true),
    false,
  );
  const at = cats.findIndex((c) => c.id === id);
  return { label: cats[at].label, key: keyLabel(at) };
}

/** A key of the keymap as the Guide prints it. */
function keyName(code: string, shift?: boolean): string {
  const name = G.keyNames[code];
  if (name) return shift ? `Shift+${name}` : name;
  if (code.startsWith('Ctrl+')) return code;
  if (code === 'Char+') return '+';
  if (code === 'Char-') return '−';
  if (code.startsWith('Digit')) return code.slice('Digit'.length);
  const letter = code.slice('Key'.length);
  return shift ? `Shift+${letter}` : letter;
}

/** The first keys bound to an action in a context, as the Guide prints them. */
function keysOf(action: KeyAction, context: KeyContext): string[] {
  const bound = KEYMAP.filter((b) => b.action === action && b.context === context);
  const shown = bound.map((b) => keyName(b.code, b.shift));
  // the digits read as one range
  return action === 'pieceOrCategory' ? [`${shown[0]}–${shown[shown.length - 1]}`] : shown;
}
/** The key of an action, for a sentence. */
const keyOf = (action: KeyAction, context: KeyContext = 'play') => keysOf(action, context)[0] ?? '';

// ---------------------------------------------------------------- the pages

/** A new game to a first train earning. */
function firstPage(): GuidePage {
  const S = G.first;
  const depot = stationDef(startDepotKind());
  const line = gaugeLine(depot.gauge ?? 'regular');
  const engines = content.locomotives.filter((l) => l.starter && !l.retired);
  const wagons = content.wagons.filter((w) => w.starter && !w.retired);
  const stock = Object.entries(startStock()).map(([id, n]): Inline[] => [
    num(fmtInt(Math.round(n * rules.startStock))),
    ' ',
    res(id),
  ]);
  const goodOn = (t: Terrain) => res(tileGoods(t)[0].cargo);
  const track = category('track');
  const works = category('works');
  return {
    id: 'first',
    title: G.pages.first,
    icon: 'play',
    blocks: [
      para(S.intro, {
        money: num(fmtMoney(rules.startMoney)),
        depot: depot.name,
        line: lineName(line),
      }),
      head(S.haveHead),
      para(S.goods, { list: joined(stock) }),
      {
        kind: 'pictures',
        items: [...engines, ...wagons].map((v) => ({ of: 'vehicle', id: v.id, caption: v.name })),
      },
      para(S.copies, {
        engines: num(CRAFT_CONFIG.starterCopies.loco),
        wagons: num(CRAFT_CONFIG.starterCopies.wagon),
      }),
      head(S.stepsHead),
      steps(
        fill(S.look, {
          forest: goodOn(Terrain.Forest),
          rock: goodOn(Terrain.Rock),
          grass: goodOn(Terrain.Grass),
        }),
        fill(S.lay, {
          category: track.label,
          key: num(track.key),
          line: lineName(line),
          depot: depot.name,
        }),
        fill(S.place, {
          category: works.label,
          key: num(works.key),
          type: STR.toolbar.rawMaterials,
          a: stationDef('farm').name,
          b: stationDef('lumber').name,
          c: stationDef('quarry').name,
        }),
        [
          ...fill(S.train, {
            key: num(screenKey('depot') ?? ''),
            depot: STR.depot.title,
            dispatch: STR.depot.dispatch,
          }),
          ' ',
          ...said(STR.depot.routeAutoHint),
        ],
        fill(S.sell, { key: num(screenKey('market') ?? ''), market: STR.market.title }),
      ),
      head(S.nextHead),
      list(
        fill(S.money, { market: STR.market.title, contracts: STR.contracts.title }),
        fill(S.reach, { reach: num(rules.buildReach) }),
        fill(S.food, {
          food: res('food'),
          windmill: buildingDef('windmill').name,
          wheat: res('wheat'),
        }),
        fill(S.land, { key: num(keyOf('overview')), price: num(fmtMoney(rules.chunkCost)) }),
        said(S.age),
        fill(S.advisor, { advisor: STR.advisor.button }),
      ),
    ],
  };
}

/** The line a class of trains starts at, for the table of lines. */
function classesOf(c: TrackClass): string {
  const stock = [...content.locomotives, ...content.wagons].filter((v) => !v.retired);
  const shown = TRAIN_CLASSES.filter(
    (t) => CLASS_LINE[t] === c && stock.some((v) => classOf(v) === t),
  );
  return shown.map((t) => STR.trainClass[t]).join(', ') || G.none;
}

/** Track classes, gauges, curves, slopes and upgrades. */
function trackPage(): GuidePage {
  const S = G.track;
  const lines = BUILDABLE_CLASSES.filter((c) => c !== 'narrow' || !!rules.narrowUnlocked);
  const cap = (c: TrackClass) => {
    const v = lineSpeedCap(c);
    return v === Infinity ? S.noLimit : fmtDecimal(v);
  };
  const standard = lines.filter((c) => c !== 'narrow');
  const crossedByNarrow = TRACK_ITEMS.filter(
    (i) => i.kind === 'crossing' && i.cls === 'narrow' && i.cls2 && i.cls2 !== 'narrow',
  ).map((i) => lineName(i.cls2 as TrackClass));
  const terrains = Object.entries(content.track.terrainCost);
  const bridges = BUILDING_DEFS.filter((b) => b.bridge);
  return {
    id: 'track',
    title: G.pages.track,
    icon: 'mountain',
    blocks: [
      para(S.intro),
      table(
        [S.colLine, S.colClass, S.colCurve, S.colCurveSpeed, S.colCost, S.colSpeed, S.colAge],
        lines.map((c) => [
          cell(lineName(c)),
          cell(classesOf(c)),
          cell(`${classRadius(c) + 0.5}×${classRadius(c) + 0.5}`),
          cell(`${Math.round(curveFactor(classRadius(c), content.track.curveSpeed) * 100)}%`),
          cell(times(classCostMul(c))),
          cell(cap(c)),
          cell(ageName(AGE_DEFS[lineOpens(c)].id)),
        ]),
      ),
      head(S.gaugeHead),
      list(
        fill(S.narrow, {
          narrow: lineName('narrow'),
          crossed: names(crossedByNarrow),
        }),
        fill(S.standard, { lines: names(standard.map(lineName)) }),
        said(S.classes),
      ),
      head(S.curvesHead),
      list(
        said(S.curves),
        fill(S.pieces, {
          straight: costCell(pieceCost('straight', 'branch')),
          curve: costCell(pieceCost('curve', 'branch')),
          switch: costCell(pieceCost('switch', 'branch')),
          line: lineName('branch'),
        }),
      ),
      head(S.slopesHead),
      list(
        said(STR.build.tooSteep),
        said(STR.build.notLevel),
        said(STR.build.notSmooth),
        said(S.climb),
      ),
      head(S.groundHead),
      para(S.ground),
      table(
        [S.colGround, S.colCost],
        terrains.map(([t, m]) => [cell(STR.tile.terrain[t] ?? t), cell(times(m))]),
      ),
      head(S.bridgesHead),
      para(S.bridges, {
        share: num(percent(BRIDGE_SLOW_SHARE)),
        speed: num(percent(BRIDGE_SLOW_FACTOR)),
      }),
      table(
        [S.colBridge, S.colCapacity, S.colPrice],
        bridges.map((b) => [
          cell(b.name),
          cell(`${fmtInt(b.bridge?.capacity ?? 0)} t`),
          costCell(b.cost),
        ]),
      ),
      head(S.upgradeHead),
      list(
        [
          ...fill(S.upgrade, { name: STR.toolbar.upgrade, key: num(keyOf('upgradeTrack')) }),
          ' ',
          ...said(STR.toolbar.upgradeHint),
        ],
        [
          ...fill(S.upgrade, { name: STR.toolbar.downgrade, key: num(keyOf('downgradeTrack')) }),
          ' ',
          ...said(STR.toolbar.downgradeHint),
        ],
        said(STR.build.reclass.size),
      ),
    ],
  };
}

/** What a station is for, as a table cell: the good it makes, or a dash. */
function stationMakes(cargo: readonly { cargo: string }[]): Parts {
  return cargo.length ? joined(cargo.map((p) => [res(p.cargo)])) : [G.none];
}

/** Stations, depots, stores and towns. */
function stationsPage(): GuidePage {
  const S = G.stations;
  const defs = STATION_DEFS.filter(inSupplyMode);
  const depot = stationDef('depot');
  const narrow = stationDef('narrow_depot');
  const house = decorDef('townhouse');
  const services = DECOR_DEFS.filter((d) => d.radius);
  const cfg = content.houses;
  return {
    id: 'stations',
    title: G.pages.stations,
    icon: 'home',
    blocks: [
      para(S.intro),
      {
        kind: 'pictures',
        items: ['farm', 'lumber', 'quarry', 'town', 'station', 'warehouse'].map((id) => ({
          of: 'station',
          id,
          caption: stationDef(id).name,
        })),
      },
      table(
        [S.colStation, S.colCost, S.colMakes, S.colGround, S.colAge],
        defs.map((d) => [
          cell(d.name),
          costCell(d.cost),
          stationMakes(d.produces),
          cell(d.terrain ? STR.tile.phrase[d.terrain].many : G.none),
          cell(ageName(AGE_DEFS[d.tier].id)),
        ]),
      ),
      para(S.repeat, { pct: num(percent(rules.repeatCostStep)) }),
      head(S.depotsHead),
      list(
        fill(S.depots, { depot: depot.name, narrow: narrow.name }),
        said(S.depotCount),
        fill(S.depotStore, { cap: num(fmtInt(rules.depotCap)) }),
      ),
      head(S.producersHead),
      list(
        fill(S.harvest, {
          radius: num(HARVEST_RADIUS),
          base: num(fmtInt(weeklyOutput(1, 1))),
          floor: num(percent(HARVEST_FLOOR)),
          ceil: num(percent(HARVEST_CEIL)),
        }),
        said(S.placing),
      ),
      head(S.levelsHead),
      para(S.levels),
      table(
        [S.colLevel, S.colStorage, S.colLoad, S.colPlatforms, S.colWeek],
        LEVELS.production.map((_, i) => [
          cell(i + 1),
          cell(fmtInt(LEVELS.capacity[i] * rules.capacityMul)),
          cell(fmtDecimal(LEVELS.loadRate[i] * rules.loadRateMul)),
          cell(LEVELS.platforms[i]),
          cell(fmtInt(weeklyOutput(i + 1, 1))),
        ]),
      ),
      head(S.storesHead),
      list(
        said(S.stores),
        said(supplyMode() === 'full' ? S.storesFull : S.storesSimple),
        fill(S.townStore, {
          town: num(fmtInt(rules.townStoreCap)),
          warehouse: num(fmtInt(rules.warehouseCap)),
        }),
        fill(S.reach, { reach: num(rules.buildReach) }),
        said(S.outlet),
      ),
      head(S.townsHead),
      list(
        fill(S.found, {
          townhouse: stationDef('town').name,
          house: house.name,
          warehouse: stationDef('warehouse').name,
          radius: num(TOWN_RADIUS),
          spacing: num(Builder.TOWN_SPACING),
        }),
        fill(S.growth, {
          food: res('food'),
          days: num(fmtDecimal(cfg.growthDays)),
          first: num(cfg.startResidents),
          built: num(cfg.constructionDays),
        }),
        fill(S.houses, { list: cfg.capacity.map((c) => fmtInt(c)).join(', ') }),
        fill(S.spawn, { pct: num(percent(cfg.spawnAt)) }),
        fill(S.passengers, {
          station: stationDef('station').name,
          reach: num(PASSENGER_CATCHMENT),
        }),
        said(STR.toolbar.roadDesc),
      ),
      head(S.servicesHead),
      para(S.services, { reach: num(rules.fuelReach) }),
      table(
        [S.colService, S.colReach, S.colCost, S.colGives],
        services.map((d) => [
          cell(d.name),
          cell(d.radius ?? 0),
          costCell(d.cost),
          d.water ? [res('water')] : [res('coal')],
        ]),
      ),
    ],
  };
}

/** Consists, fuel and water, electric running, routes and schedules. */
function trainsPage(): GuidePage {
  const S = G.trains;
  const classes = TRAIN_CLASSES.filter((t) =>
    [...content.locomotives, ...content.wagons].some((v) => !v.retired && classOf(v) === t),
  );
  const wagonClasses = ['bulk', 'mineral', 'liquid', 'people'] as const;
  const physics = content.track.physics;
  const battery = buildingDef('substation');
  const modes = ['auto', 'custom', 'transport', 'contract', 'freight'];
  const cargoOf = (c: string) =>
    CARGO.filter((x) => x.class === c && inSupplyMode(x)).map((x): Inline[] => [res(x.id)]);
  const fuel = dieselFuelId();
  return {
    id: 'trains',
    title: G.pages.trains,
    icon: 'train',
    blocks: [
      head(S.consistHead),
      list(
        fill(S.build, { depot: STR.depot.title, dispatch: STR.depot.dispatch }),
        fill(S.limits, { locos: num(MAX_LOCOS), wagons: num(MAX_WAGONS) }),
        said(STR.fleet.mixedGauge),
        said(S.haul),
        said(S.speed),
        said(STR.modes.hint),
      ),
      table(
        [S.colClass, S.colRuns],
        classes.map((t) => [
          cell(STR.trainClass[t]),
          cell(
            BUILDABLE_CLASSES.filter((c) => classRunsOn(t, c))
              .map(lineName)
              .join(', '),
          ),
        ]),
      ),
      table(
        [S.colWagons, S.colGoods],
        wagonClasses.map((c) => [cell(STR.craft.filter[c]), joined(cargoOf(c))]),
      ),
      head(S.fuelHead),
      table(
        [S.colEngine, S.colUses],
        [
          [
            cell(STR.roster.type.steam),
            fill(S.steamUses, { coal: res('coal'), wood: res('wood'), water: res('water') }),
          ],
          [cell(STR.roster.type.diesel), [res(fuel)]],
          [cell(STR.roster.type.electric), [res('power')]],
        ],
      ),
      list(
        fill(S.fillUp, {
          depot: stationDef('depot').name,
          warehouse: stationDef('warehouse').name,
          townhouse: stationDef('town').name,
        }),
        said(S.seek),
        fill(S.carts, {
          saving: num(percent(physics.cartSaving)),
          cap: num(percent(physics.cartSavingCap)),
        }),
        [
          ...fill(S.emergency, { name: STR.train.emergency }),
          ' ',
          ...said(STR.train.emergencyHint),
        ],
        fill(S.crew, {
          food: res('food'),
          n: num(fmtDecimal(rules.wheatPerCrew)),
          pct: num(percent(FAMINE_SPEED_MUL)),
        }),
        ...(sandPerTile() > 0 ? [fill(S.sand, { sand: res('sand') })] : []),
      ),
      head(S.electricHead),
      para(S.electric, {
        plant: names(BUILDING_DEFS.filter((b) => b.power && inSupplyMode(b)).map((b) => b.name)),
        pole: decorDef('power_line').name,
        battery: battery.name,
        radius: num(battery.substation?.radius ?? 0),
      }),
      table(
        [S.colSupply, G.track.colPrice, S.colCeiling, S.colAbout],
        SUPPLY_KINDS.map((k) => {
          const c = SUPPLY_DEFS[k].ceiling;
          return [
            cell(STR.toolbar.supply[k]),
            costCell(SUPPLY_DEFS[k].cost),
            cell(c === Infinity ? G.track.noLimit : fmtDecimal(c)),
            said(STR.toolbar.supplyDesc[k]),
          ];
        }),
      ),
      head(S.routesHead),
      para(S.routes),
      table(
        [S.colRoute, S.colWhat],
        modes.map((m) => [cell(STR.depot.routeMode[m]), said(STR.depot.routeHint[m])]),
      ),
      list(
        fill(S.record, {
          overview: num(keyOf('overview')),
          record: num(keyOf('record', 'overview')),
          finish: num(keyOf('finishRoute', 'overview')),
        }),
        [...fill(S.emergency, { name: STR.depot.recall }), ' ', ...said(STR.depot.recallHint)],
      ),
      head(S.levelsHead),
      para(S.levels, { pct: num(percent(STAT_PER_LEVEL)), cap: num(LEVEL_CAP) }),
      para(S.weather),
    ],
  };
}

/** Semaphores and the signalling levels. */
function signalsPage(): GuidePage {
  const S = G.signals;
  const T = STR.signals;
  const L = STR.settings;
  return {
    id: 'signals',
    title: G.pages.signals,
    icon: 'eye',
    blocks: [
      para(S.intro, { fleet: STR.topbar.fleet, signals: STR.topbar.signals }),
      table(
        [S.colLevel, S.colHeadway, S.colWhat],
        SIGNAL_LEVELS.map((lv) => [
          cell(L.signalLevel[lv]),
          cell(HEADWAY[lv] ? HEADWAY[lv] : G.none),
          said(L.signalHint[lv]),
        ]),
      ),
      list(said(L.signallingNote), [
        ...said(STR.roster.fitInCabHint),
        ' ',
        ...fill(S.inCab, { cost: num(fmtMoney(rules.inCabCost)), roster: STR.roster.title }),
      ]),
      head(T.guideTitle),
      list(said(T.guidePlace), fill(S.postCost, { cost: costCell(decorDef('signal').cost) })),
      { kind: 'diagram', text: T.guideDiagram },
      list(
        said(T.guideAspects),
        said(T.guideFence),
        said(T.guideJunction),
        said(T.guideSingleLine),
      ),
    ],
  };
}

/** A works' recipe as a table cell. */
function recipeCell(b: (typeof BUILDING_DEFS)[number]): Parts {
  if (!Object.keys(b.recipe.in).length) return amounts(b.recipe.out);
  const slots = {
    input: amounts(b.recipe.in),
    alt: amounts(b.altIn ?? {}),
    output: amounts(b.recipe.out),
  };
  return fill(b.altIn ? STR.building.recipeAlt : STR.building.recipeLine, slots);
}

/** Goods and works of the running production chain. */
function goodsPage(): GuidePage {
  const S = G.goods;
  const mode = supplyMode();
  const raw = STATION_DEFS.filter((d) => d.terrain && d.produces.length && inSupplyMode(d));
  const tied = BUILDING_DEFS.filter((b) => (b.terrain || b.deposit) && inSupplyMode(b));
  const works = BUILDING_DEFS.filter(
    (b) => inSupplyMode(b) && !b.bridge && Object.keys(b.recipe.out).length,
  );
  const goods = [
    ...CARGO.filter((c) => inSupplyMode(c) && c.class !== 'people').map((c) => c.id),
    'power',
  ];
  const ground = (b: (typeof BUILDING_DEFS)[number]) =>
    b.deposit
      ? (STR.tile.prop[b.deposit] ?? b.deposit)
      : (STR.tile.terrain[b.terrain ?? ''] ?? '').toLowerCase();
  return {
    id: 'goods',
    title: G.pages.goods,
    icon: 'factory',
    blocks: [
      para(S.intro, { chain: STR.menu.supplyModes[mode] }),
      { kind: 'text', parts: said(STR.menu.supplyHint[mode]) },
      head(S.rawHead),
      table(
        [S.colGood, S.colMaker, S.colGround],
        [
          ...raw.map((d) => [
            [res(d.produces[0].cargo)],
            cell(d.name),
            cell(STR.tile.phrase[d.terrain ?? 'grass'].many),
          ]),
          ...tied.flatMap((b) =>
            Object.keys(b.recipe.out).map((c) => [[res(c)], cell(b.name), cell(ground(b))]),
          ),
        ],
      ),
      head(S.worksHead),
      {
        kind: 'pictures',
        items: works.map((b) => ({ of: 'works', id: b.id, caption: b.name })),
      },
      list(fill(S.works, { reach: num(rules.buildReach) }), said(S.worksLevels)),
      table(
        [S.colWorks, S.colRecipe, S.colBatches, S.colAge],
        works.map((b) => [
          cell(b.name),
          recipeCell(b),
          cell(b.perWeek),
          cell(ageName(AGE_DEFS[b.tier].id)),
        ]),
      ),
      head(S.allHead),
      table(
        [S.colGood, S.colMadeBy, S.colUsedBy],
        goods.map((id) => [[res(id)], cell(refNames(makersOf(id))), cell(refNames(usersOf(id)))]),
      ),
      head(S.foodHead),
      list(
        fill(S.food, { food: res('food'), n: num(fmtDecimal(rules.wheatPerCrew)) }),
        fill(S.famine, { pct: num(percent(FAMINE_PRODUCTION_MUL)) }),
      ),
    ],
  };
}

/** Offers, deadlines, pay and fines. */
function contractsPage(): GuidePage {
  const S = G.contracts;
  const C = content.contracts;
  const ends = STATION_DEFS.filter(
    (d) => d.contracts !== false && d.accepts.length > 0 && inSupplyMode(d),
  );
  const shut = STATION_DEFS.filter((d) => d.contracts === false).map((d) => d.name);
  const weight = C.rarities.reduce((n, r) => n + r.weight, 0);
  return {
    id: 'contracts',
    title: G.pages.contracts,
    icon: 'scroll',
    blocks: [
      para(S.intro),
      list(
        fill(S.ends, { ends: names(ends.map((d) => d.name)), shut: names(shut) }),
        fill(S.limit, {
          base: num(rules.contractOfferCount),
          per: num(fmtDecimal(rules.contractOffersPerChunk)),
          max: num(rules.contractOfferMax),
        }),
        fill(S.timing, {
          days: num(rules.contractRefreshDays),
          life: num(C.offerLifetimeDays),
        }),
        said(S.trains),
        [...said(S.policy), ' ', ...said(STR.settings.contractPolicyHint)],
      ),
      head(S.payHead),
      list(
        said(S.pay),
        fill(S.fines, {
          fail: num(percent(C.failFine * rules.failPenaltyMul)),
          cancel: num(percent(C.cancelFine)),
        }),
        said(S.lapse),
      ),
      table(
        [S.colRarity, S.colChance, S.colReward, S.colAmount, S.colDeadline],
        C.rarities.map((r) => [
          cell(STR.contracts.rarity[r.id] ?? r.name),
          cell(percent(r.weight / weight)),
          cell(times(r.rewardMul)),
          cell(times(r.amountMul)),
          cell(times(r.deadlineMul)),
        ]),
      ),
      table(
        [S.colKind, S.colAge, S.colSize, S.colPay],
        C.templates.map((t) => [
          cell(t.name),
          cell(ageName(AGE_DEFS[t.minTier].id)),
          cell(`${t.amount[0]}–${t.amount[1]}`),
          cell(times(t.payoutMul)),
        ]),
      ),
    ],
  };
}

/** The spot market, standing deals, recipes and building vehicles. */
function marketPage(): GuidePage {
  const S = G.market;
  const desk = new TradeDesk();
  const goods = CARGO.filter((c) => inSupplyMode(c) && c.class !== 'people');
  const price = (v: number) => STR.format.money(fmtDecimal(v, 2));
  const K = CRAFT_CONFIG;
  const qualities = ['N', 'R', 'SR', 'SSR'] as const;
  const sizes = ['small', 'medium', 'large'] as const;
  return {
    id: 'market',
    title: G.pages.market,
    icon: 'coin',
    blocks: [
      head(S.marketHead),
      list(
        fill(S.where, { market: STR.market.title }),
        fill(S.prices, {
          buy: num(percent(BUY_MUL * rules.spotPriceMul)),
          sell: num(percent(SELL_MUL * rules.spotPriceMul)),
        }),
        said(STR.market.driftHint),
        said(STR.market.dealsHint(Math.round(weekSeconds() / daySeconds()))),
        said(STR.market.hint),
      ),
      table(
        [S.colGood, S.colBuy, S.colSell],
        goods.map((c) => {
          const q = desk.spotQuote(c.id);
          return [[res(c.id)], cell(price(q.buy)), cell(price(q.sell))];
        }),
      ),
      head(S.craftHead),
      para(S.craft, { crafting: STR.craft.title, roster: STR.roster.title }),
      steps(
        fill(S.unlock, { cards: num(K.cardsPerDraw), refund: costCell(K.ownedRefund) }),
        fill(S.build, { pct: num(percent(K.failRefund)) }),
      ),
      list(
        said(S.anyAge),
        fill(S.starters, { key: num(screenKey('roster') ?? ''), roster: STR.roster.title }),
      ),
      table(
        [S.colAge, S.colEngine, S.colWagon],
        CRAFT_TIERS.map((t) => [
          cell(ageName(AGE_DEFS[t].id)),
          cell(fmtMoney(K.unlockPrice.loco[t])),
          cell(fmtMoney(K.unlockPrice.wagon[t])),
        ]),
      ),
      table(
        [S.colQuality, S.colCostMul, S.colFail],
        qualities.map((q) => [
          cell(STR.craft.quality[q]),
          cell(times(K.rarityCostMul[q])),
          cell(percent(K.failChance[q])),
        ]),
      ),
      table(
        [S.colSize, S.colEngine, S.colWagon],
        sizes.map((z) => [
          cell(STR.roster.sizes[z]),
          costCell(K.instanceCost.loco[z]),
          costCell(K.instanceCost.wagon[z]),
        ]),
      ),
    ],
  };
}

/** What an age asks for, as a sentence's list: "Residents 100 or Owned chunks 9". */
function goalParts(index: number): Parts {
  const goal = (g: { kind: GoalKind; target: number }): Inline[] => [
    `${STR.ages.goal[g.kind]} `,
    num(fmtGoal(g.kind, g.target)),
  ];
  return joined(
    AGE_DEFS[index].goals.map((e) =>
      'anyOf' in e ? e.anyOf.flatMap((g, i) => (i ? [` ${G.or} `, ...goal(g)] : goal(g))) : goal(e),
    ),
  );
}

/** Each age on its own: its picture, what it asks for, what it brings. */
function agesPage(): GuidePage {
  const S = G.ages;
  const blocks: GuideBlock[] = [{ kind: 'text', parts: said(STR.ages.hint) }, para(S.intro)];
  AGE_DEFS.forEach((a, i) => {
    const n = ageNews(i);
    blocks.push(
      head(ageName(a.id)),
      { kind: 'pictures', items: [{ of: 'age', id: a.id, caption: ageName(a.id) }] },
      a.goals.length
        ? para(S.goals, { goals: goalParts(i) })
        : { kind: 'text', parts: said(STR.ages.start) },
    );
    const lines = newsLines(n).map((l) =>
      fill(l.label, { list: l.things.map((t) => t.name).join(', ') }),
    );
    if (n.level > 1) lines.push(said(STR.ages.news.level(n.level)));
    blocks.push(list(...lines));
  });
  return { id: 'ages', title: G.pages.ages, icon: 'up', blocks };
}

/** The actions of a context, in the order of `KEYMAP`, one row each. */
function keyRows(context: KeyContext): GuideKey[] {
  const seen = new Set<KeyAction>();
  const out: GuideKey[] = [];
  for (const b of KEYMAP) {
    if (b.context !== context || seen.has(b.action)) continue;
    seen.add(b.action);
    out.push({ keys: keysOf(b.action, context), text: G.keyAction[b.action] });
  }
  return out;
}

/** Every key the keymap has, by where it works, then the keys that live with the camera. */
function keysPage(): GuidePage {
  const S = G.keys;
  const [camera, , , building] = STR.settings.keyGroups;
  const bound = (contexts: readonly KeyContext[]) =>
    new Set(
      KEYMAP.filter((b) => contexts.includes(b.context)).map((b) => keyName(b.code, b.shift)),
    );
  const all = bound(['play', 'overview', 'menu']);
  const play = bound(['play']);
  // the number keys have their row above
  const shown = (r: { keys: readonly string[] }) => !/^\d/.test(r.keys[0]);
  const rest = [
    ...camera.rows.filter((r) => !r.keys.every((k) => all.has(k))),
    ...building.rows.filter((r) => shown(r) && !r.keys.every((k) => play.has(k))),
  ];
  return {
    id: 'keys',
    title: G.pages.keys,
    icon: 'keys',
    blocks: [
      head(S.fieldHead),
      { kind: 'keys', rows: keyRows('play') },
      head(S.overviewHead),
      { kind: 'keys', rows: keyRows('overview') },
      head(S.menuHead),
      { kind: 'keys', rows: keyRows('menu') },
      head(S.pointerHead),
      { kind: 'keys', rows: rest },
    ],
  };
}

/** Every page of the Guide, in the order a new player needs them, for the running game. */
export function guidePages(): GuidePage[] {
  return [
    firstPage(),
    trackPage(),
    stationsPage(),
    trainsPage(),
    signalsPage(),
    goodsPage(),
    contractsPage(),
    marketPage(),
    agesPage(),
    keysPage(),
  ];
}

/** A block as plain text, for the search. */
function blockWords(b: GuideBlock): string {
  switch (b.kind) {
    case 'head':
    case 'diagram':
      return b.text;
    case 'text':
      return plain(b.parts);
    case 'steps':
    case 'list':
      return b.items.map(plain).join(' ');
    case 'table':
      return [...b.head, ...b.rows.flatMap((r) => r.map(plain))].join(' ');
    case 'keys':
      return b.rows.map((r) => `${r.keys.join(' ')} ${r.text}`).join(' ');
    case 'pictures':
      return b.items.map((p) => p.caption).join(' ');
  }
}

/** The words of a page, lower case: its title and every block. */
export function pageWords(p: GuidePage): string {
  return [p.title, ...p.blocks.map(blockWords)].join(' ').toLowerCase();
}

/** The pages a search keeps: every word typed appears somewhere on the page. */
export function matchingPages(pages: readonly GuidePage[], query: string): GuidePage[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return pages.filter((p) => {
    const text = pageWords(p);
    return words.every((w) => text.includes(w));
  });
}

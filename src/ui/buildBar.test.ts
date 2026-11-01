import { afterEach, describe, expect, it } from 'vitest';
import stationsFull from '../data/stations_full.json';
import buildingsFull from '../data/buildings_full.json';
import type { BuildingDef, DecorDef, StationDef } from '../data/content';
import { DECOR_DEFS } from '../sim/build';
import { BUILDING_DEFS } from '../sim/buildings';
import { SUPPLY_KINDS } from '../sim/catenary';
import { rules, DEFAULT_RULES } from '../sim/rules';
import { STATION_DEFS } from '../sim/stations';
import { SUPPLY_MODES, inSupplyMode, setSupplyMode } from '../sim/supply';
import type { AgeStatus } from '../sim/ages';
import { STR } from '../strings';
import { TRACK_ITEMS, itemKey } from '../world/track';
import { blockText, type TipDoc } from './tooltipDoc';
import {
  BuildBar,
  DOCK_BOTTOM,
  TOAST_FLOOR,
  arrowTip,
  buildCatalog,
  categoryTip,
  controlsHint,
  currentGroup,
  decorPlace,
  demolishTip,
  enabledItems,
  itemTip,
  keyLabel,
  locate,
  modeItems,
  pickAt,
  reclassable,
  refundPercent,
  shownItems,
  statusLine,
  toastBottom,
  stationPlace,
  stepCategory,
  toolKey,
  typeLockAge,
  typeTip,
  visibleCategories,
  workPlace,
  type Category,
  type CategoryId,
  type Tool,
  type ToolItem,
} from './buildBar';

afterEach(() => {
  setSupplyMode('simple');
  Object.assign(rules, DEFAULT_RULES);
});

const catalog = () => buildCatalog(() => true);
const cat = (id: CategoryId) => catalog().find((c) => c.id === id)!;
const names = (c: Category, group: string | null) => shownItems(c, group).map((i) => i.name);

/** An item of a made-up category. */
const item = (name: string, tier = 0, over: Partial<ToolItem> = {}): ToolItem => ({
  key: `decor:${name}`,
  tool: { kind: 'decor', defId: name },
  name,
  cost: {},
  frame: '',
  desc: '',
  tier,
  place: '',
  ...over,
});
const made = (items: ToolItem[], groups?: string[]): Category => ({
  id: 'buildings',
  label: 'Made up',
  icon: 'station',
  items,
  groups: groups?.map((id) => ({ id, label: id })),
});

/** A bar as the game wires it: the build controller reports the tool straight back. */
function barOn(categories: Category[], tier = 0) {
  const held: Tool[] = [];
  const bar: BuildBar = new BuildBar(
    categories,
    () => tier,
    (t) => {
      held.push(t);
      bar.setActive(t);
    },
    () => {},
  );
  return { bar, held };
}

describe('the terrain category', () => {
  it('names each brush as its tile is named, not by its id', () => {
    const items = catalog().find((c) => c.id === 'terrain')!.items;
    expect(items.map((i) => i.name)).toContain(STR.tile.terrain.grass);
    expect(items.every((i) => i.name && i.name[0] === i.name[0].toUpperCase())).toBe(true);
  });
});

describe('the categories', () => {
  it('come in the order of their keys, with Terrain last', () => {
    expect(catalog().map((c) => c.id)).toEqual([
      'track',
      'buildings',
      'tools',
      'works',
      'roads',
      'terrain',
    ]);
  });

  it('have the types the bar lists, in order', () => {
    const types = (id: CategoryId) => cat(id).groups?.map((g) => g.label);
    expect(types('buildings')).toEqual([
      STR.toolbar.stations,
      STR.toolbar.town,
      STR.toolbar.services,
    ]);
    expect(types('tools')).toEqual([
      STR.toolbar.trackTools,
      STR.toolbar.electrification,
      STR.toolbar.ground,
    ]);
    expect(types('works')).toEqual([
      STR.toolbar.rawMaterials,
      STR.toolbar.processing,
      STR.toolbar.power,
    ]);
    expect(types('track')?.at(-1)).toBe(STR.toolbar.bridges);
    expect(types('roads')).toBeUndefined();
    expect(types('terrain')).toBeUndefined();
  });

  it('take no types from the mock: Battery is the name, not Substation', () => {
    expect(names(cat('works'), 'power')).toEqual(['Power Plant', 'Hydro Plant', 'Battery']);
  });
});

describe('where a def is listed', () => {
  it('lists the stations in the order of the design', () => {
    expect(names(cat('buildings'), 'stations')).toEqual([
      'Station',
      'Depot',
      'Narrow Depot',
      'Warehouse',
    ]);
  });
  it('keeps the passenger Station out of the raw materials, though it produces passengers', () => {
    expect(names(cat('works'), 'raw')).toEqual([
      'Farm Halt',
      'Lumber Yard',
      'Quarry',
      'Water Pump',
    ]);
  });
  it('puts the Townhouse with what has residents, and services with the rest of the decor', () => {
    expect(names(cat('buildings'), 'town')).toEqual(['Townhouse', 'House']);
    expect(names(cat('buildings'), 'services')).toEqual(['Water Tower', 'Coaling Stage']);
  });
  it('splits the tools: on-track decor and the two arrows, the power line and the supply, then the ground', () => {
    expect(shownItems(cat('tools'), 'track').map((i) => i.key)).toEqual([
      'decor:signal',
      'reclass:up',
      'reclass:down',
    ]);
    expect(shownItems(cat('tools'), 'electrification').map((i) => i.key)).toEqual([
      'decor:power_line',
      ...SUPPLY_KINDS.map((k) => `supply:${k}`),
    ]);
    expect(shownItems(cat('tools'), 'ground').map((i) => i.key)).toEqual([
      'ground:up',
      'ground:down',
    ]);
  });
  it('holds Raise and Lower in Tools, open from the first age, each with its own arrow', () => {
    const [up, down] = shownItems(cat('tools'), 'ground');
    expect(up.tool).toEqual({ kind: 'ground', delta: 1 });
    expect(down.tool).toEqual({ kind: 'ground', delta: -1 });
    expect([up.name, down.name]).toEqual([STR.toolbar.raise, STR.toolbar.lower]);
    expect([up.icon, down.icon]).toEqual(['up', 'down']);
    expect([up.desc, down.desc]).toEqual([STR.toolbar.raiseHint, STR.toolbar.lowerHint]);
    for (const i of [up, down]) {
      expect(i.tier, i.key).toBe(0);
      expect(i.hidden, i.key).toBeUndefined();
      // money, per tile that moves: no table price, and the ghost has the sum
      expect(i.cost, i.key).toEqual({});
      expect(i.costText, i.key).toBe(STR.toolbar.groundCost);
      expect(i.typeLabel, i.key).toBe(STR.toolbar.ground);
    }
    expect(toolKey(up.tool)).toBe('ground:up');
    expect(toolKey(down.tool)).toBe('ground:down');
  });
  it('keeps the bridges in Track and out of the works', () => {
    const works = cat('works').items.map((i) => i.key);
    const bridges = shownItems(cat('track'), 'bridges').map((i) => i.key);
    expect(bridges).toEqual(['building:bridge_wood', 'building:bridge_stone']);
    for (const b of bridges) expect(works).not.toContain(b);
  });

  it('reads the fields, so a new def lands where its data says', () => {
    const station = STATION_DEFS.find((d) => d.id === 'warehouse') as StationDef;
    expect(stationPlace({ ...station, id: 'new', terrain: 'sand' })).toEqual({
      category: 'works',
      group: 'raw',
    });
    expect(stationPlace({ ...station, id: 'new' })).toEqual({
      category: 'buildings',
      group: 'stations',
    });
    const decor = DECOR_DEFS.find((d) => d.id === 'water_tower') as DecorDef;
    const place = (over: Partial<DecorDef>) => decorPlace({ ...decor, id: 'new', ...over });
    expect(place({})).toEqual({ category: 'buildings', group: 'services' });
    expect(place({ residents: 4 })).toEqual({ category: 'buildings', group: 'town' });
    expect(place({ onTrack: true })).toEqual({ category: 'tools', group: 'track' });
    expect(place({ onTrack: true, power: true })).toEqual({
      category: 'tools',
      group: 'electrification',
    });
    const work = BUILDING_DEFS.find((d) => d.id === 'windmill') as BuildingDef;
    const of = (over: Partial<BuildingDef>) => workPlace({ ...work, id: 'new', ...over });
    expect(of({})).toEqual({ category: 'works', group: 'processing' });
    expect(of({ power: true })).toEqual({ category: 'works', group: 'power' });
    expect(of({ substation: { radius: 1, throughput: 1 } })).toEqual({
      category: 'works',
      group: 'power',
    });
    expect(of({ bridge: { material: 'wood', capacity: 1 } })).toEqual({
      category: 'track',
      group: 'bridges',
    });
    // tied to what lies in the ground: raw, whatever else it takes in
    expect(of({ deposit: 'oil' })).toEqual({ category: 'works', group: 'raw' });
    expect(of({ terrain: 'hill' })).toEqual({ category: 'works', group: 'raw' });
    // what makes power is listed with power, wherever it stands
    expect(of({ power: true, terrain: 'hill' })).toEqual({ category: 'works', group: 'power' });
  });
});

describe.each(SUPPLY_MODES)('every def of the %s chain', (mode) => {
  /** What the old toolbar offered in this mode, by item key. */
  const offered = () => [
    ...TRACK_ITEMS.map((i) => `track:${itemKey(i)}`),
    ...STATION_DEFS.filter(inSupplyMode).map((d) => `station:${d.id}`),
    ...DECOR_DEFS.map((d) => `decor:${d.id}`),
    ...BUILDING_DEFS.filter(inSupplyMode).map((d) => `building:${d.id}`),
    ...SUPPLY_KINDS.map((k) => `supply:${k}`),
    'road',
    ...cat('terrain').items.map((i) => i.key),
  ];
  const listed = () => catalog().flatMap((c) => modeItems(c).map((i) => i.key));

  it('is listed once and nothing is lost: only the arrows join the old toolbar', () => {
    setSupplyMode(mode);
    const want = [...offered(), 'reclass:up', 'reclass:down', 'ground:up', 'ground:down'].sort();
    expect(listed().sort()).toEqual(want);
    expect(new Set(want).size).toBe(want.length);
  });

  it('sits in one type of its category, and every type has something in it', () => {
    setSupplyMode(mode);
    for (const c of catalog()) {
      if (!c.groups) {
        expect(
          c.items.every((i) => i.group === undefined),
          c.id,
        ).toBe(true);
        continue;
      }
      const ids = c.groups.map((g) => g.id);
      for (const i of modeItems(c)) expect(ids, `${c.id} ${i.key}`).toContain(i.group);
      for (const g of ids) expect(shownItems(c, g).length, `${c.id} ${g}`).toBeGreaterThan(0);
      const seen = ids.flatMap((g) => shownItems(c, g).map((i) => i.key));
      expect(seen.sort()).toEqual(
        modeItems(c)
          .map((i) => i.key)
          .sort(),
      );
    }
  });

  it('has its type on its item, and its key found by the tool in hand', () => {
    setSupplyMode(mode);
    const all = catalog();
    for (const c of all)
      for (const i of modeItems(c)) {
        const at = locate(all, i.tool);
        expect(at?.category.id, i.key).toBe(c.id);
        expect(at?.item, i.key).toBe(i);
        if (c.groups)
          expect(i.typeLabel, i.key).toBe(c.groups.find((g) => g.id === i.group)?.label);
      }
  });
});

describe('the full production chain', () => {
  it('lists what its files add, where its fields say', () => {
    setSupplyMode('full');
    const raw = names(cat('works'), 'raw');
    for (const d of stationsFull) expect(raw, d.id).toContain(d.name);
    const all = [...raw, ...names(cat('works'), 'processing'), ...names(cat('works'), 'power')];
    for (const d of buildingsFull) expect(all, d.id).toContain(d.name);
  });
  it('lists what digs a resource out of the ground with the raw materials', () => {
    setSupplyMode('full');
    expect(names(cat('works'), 'raw')).toEqual([
      'Farm Halt',
      'Lumber Yard',
      'Quarry',
      'Water Pump',
      'Iron Mine',
      'Sand Pit',
      'Colliery',
      'Oil Derrick',
      'Copper Mine',
    ]);
    expect(names(cat('works'), 'processing')).toEqual([
      'Windmill',
      'Charcoal Kiln',
      'Stone Grinder',
      'Ironworks',
      'Refinery',
      'Wire Mill',
    ]);
  });
  it('keeps the raw materials in the order of their ages, so what is open comes first', () => {
    setSupplyMode('full');
    const ages = shownItems(cat('works'), 'raw').map((i) => i.tier);
    expect(ages).toEqual([...ages].sort((a, b) => a - b));
  });
  it('drops what only the simple chain has, and the simple chain drops the full one', () => {
    setSupplyMode('full');
    expect(names(cat('works'), 'processing')).not.toContain('Oil Refinery');
    setSupplyMode('simple');
    expect(names(cat('works'), 'processing')).toContain('Oil Refinery');
    expect(names(cat('works'), 'processing')).not.toContain('Ironworks');
    expect(names(cat('works'), 'raw')).not.toContain('Iron Mine');
  });
});

describe('the shown list and its keys', () => {
  const list = () => shownItems(made([item('a'), item('b', 2), item('c')]), null);

  it('numbers every shown item by its place, a locked one too', () => {
    expect(list().map((_, i) => keyLabel(i))).toEqual(['1', '2', '3']);
    expect(keyLabel(8)).toBe('9');
    expect(keyLabel(9)).toBe('');
  });
  it('lets a key pick its item, and a locked item keep its number and do nothing', () => {
    const shown = list();
    expect(pickAt(shown, 0, 0)?.name).toBe('a');
    expect(pickAt(shown, 1, 0)).toBeNull();
    expect(pickAt(shown, 2, 0)?.name).toBe('c');
    expect(pickAt(shown, 3, 0)).toBeNull();
  });
  it('gives the same key the same item once an age opens the locked one', () => {
    expect(pickAt(list(), 2, 2)?.name).toBe('c');
    expect(pickAt(list(), 1, 2)?.name).toBe('b');
  });
  it('shows no hidden item, and that one takes no number', () => {
    const c = made([item('a', 0, { hidden: () => true }), item('b')]);
    expect(shownItems(c, null).map((i) => i.name)).toEqual(['b']);
    expect(pickAt(shownItems(c, null), 0, 0)?.name).toBe('b');
  });
  it('shows the arrows only while there are two lines to move between', () => {
    const arrows = shownItems(cat('tools'), 'track').filter((i) => i.tool.kind === 'reclass');
    expect(reclassable()).toBe(true);
    expect(arrows.map((a) => a.icon)).toEqual(['up', 'down']);
    expect(
      cat('tools')
        .items.find((i) => i.key === 'reclass:up')
        ?.hidden?.(),
    ).toBe(false);
  });
  it('prices the arrows in words: the difference is no table cost', () => {
    const up = cat('tools').items.find((i) => i.key === 'reclass:up')!;
    const down = cat('tools').items.find((i) => i.key === 'reclass:down')!;
    expect(up.costText).toBe(STR.toolbar.upgradeCost);
    expect(down.costText).toBe(STR.build.free);
  });
  it('gives a works its recipe and a building with none no Makes', () => {
    const mill = cat('works').items.find((i) => i.key === 'building:windmill')!;
    expect(mill.recipe).toEqual({ in: { wheat: 1 }, out: { food: 5 }, perWeek: 60 });
    expect(cat('works').items.find((i) => i.key === 'building:substation')?.recipe).toBeUndefined();
    expect(cat('works').items.find((i) => i.key === 'building:hydro_plant')?.recipe?.out).toEqual({
      power: 1,
    });
    const plant = cat('works').items.find((i) => i.key === 'building:power_plant')!;
    expect(plant.recipe?.altIn).toEqual({ oil: 1, wood: 1, water: 1 });
  });
});

describe('a type', () => {
  const c = made(
    [
      item('a', 0, { group: 'x' }),
      item('b', 2, { group: 'y' }),
      item('c', 1, { group: 'y' }),
      item('d', 0, { group: 'z' }),
    ],
    ['x', 'y', 'z'],
  );

  it('is locked until one of its items opens, and waits for the first age that opens one', () => {
    expect(typeLockAge(c, 'x', 0)).toBeNull();
    expect(typeLockAge(c, 'y', 0)).toBe(1);
    expect(typeLockAge(c, 'y', 1)).toBeNull();
  });
  it('opens as the one used last while it has something to offer, else the first that does', () => {
    expect(currentGroup(c, 0, 'z')).toBe('z');
    expect(currentGroup(c, 0, 'y')).toBe('x');
    expect(currentGroup(c, 0, undefined)).toBe('x');
    expect(currentGroup(c, 0, 'gone')).toBe('x');
    expect(currentGroup(made([item('a')]), 0, undefined)).toBeNull();
  });
  it('falls back on the first when nothing at all is open yet', () => {
    expect(currentGroup(c, -1, 'z')).toBe('x');
  });
  it('offers only what is not locked', () => {
    expect(enabledItems(c, 1).map((i) => i.name)).toEqual(['a', 'c', 'd']);
  });
});

describe('the categories on show', () => {
  it('has Roads as key 5 in a game, and no Terrain', () => {
    const ids = visibleCategories(catalog(), false).map((c) => c.id);
    expect(ids).toEqual(['track', 'buildings', 'tools', 'works', 'roads']);
  });
  it('has Terrain as key 5 in the editor, with Roads gone and no gap', () => {
    const { bar } = barOn(catalog());
    bar.setEditor(true);
    expect(bar.visible().map((c) => c.id)).toEqual([
      'track',
      'buildings',
      'tools',
      'works',
      'terrain',
    ]);
    expect(bar.keyOf('terrain')).toBe('5');
    expect(bar.keyOf('roads')).toBe('');
    bar.openAt(4);
    expect(bar.open).toBe('terrain');
  });
  it('steps round the visible categories both ways', () => {
    const ids: CategoryId[] = ['track', 'buildings', 'roads'];
    expect(stepCategory(ids, 'track', 1)).toBe('buildings');
    expect(stepCategory(ids, 'track', -1)).toBe('roads');
    expect(stepCategory(ids, 'roads', 1)).toBe('track');
  });
});

describe('the bar', () => {
  const noTool = { kind: 'none' } as const;

  it('digits open the visible categories in order, and take up what the first offers', () => {
    const { bar } = barOn(catalog());
    bar.openAt(1);
    expect(bar.open).toBe('buildings');
    expect(bar.active).toEqual({ kind: 'station', defId: 'station' });
    bar.closeCategory();
    bar.openAt(5);
    expect(bar.open).toBeNull();
  });

  it('holds no tool in a category where everything is locked, and that closes without one', () => {
    const { bar } = barOn([made([item('a', 3), item('b', 4)])]);
    bar.openCategory('buildings');
    expect(bar.open).toBe('buildings');
    expect(bar.active).toEqual(noTool);
    expect(bar.openList().map((i) => i.name)).toEqual(['a', 'b']);
    bar.selectIndex(0);
    expect(bar.active).toEqual(noTool);
    bar.closeCategory();
    expect(bar.open).toBeNull();
  });

  it('puts down the tool in hand on opening a category that has nothing to take up', () => {
    const locked: Category = { ...made([item('l', 3)]), id: 'works' };
    const { bar, held } = barOn([made([item('a')]), locked]);
    bar.openCategory('buildings');
    expect(bar.active.kind).toBe('decor');
    bar.openCategory('works');
    expect(bar.open).toBe('works');
    expect(bar.active).toEqual(noTool);
    expect(held.at(-1)).toEqual(noTool);
  });

  it('takes up the first open item, not a locked one before it', () => {
    const { bar } = barOn([made([item('l', 3), item('a')])]);
    bar.openCategory('buildings');
    expect(bar.active).toEqual({ kind: 'decor', defId: 'a' });
  });

  it('U with no category open brings Tools up with its item in hand, and dropping it closes', () => {
    const { bar } = barOn(catalog());
    bar.toggleReclass('up');
    expect(bar.open).toBe('tools');
    expect(bar.openGroup()).toBe('track');
    expect(bar.active).toEqual({ kind: 'reclass', dir: 'up' });
    expect(bar.openList().map((i) => i.key)).toContain('reclass:up');
    // Esc: the build controller drops the tool and tells the bar
    bar.setActive(noTool);
    expect(bar.open).toBeNull();
    expect(bar.active).toEqual(noTool);
  });

  it('Shift+U while the Electrification type shows brings its own type back', () => {
    const { bar } = barOn(catalog());
    bar.openCategory('tools');
    bar.setGroup('electrification');
    bar.toggleReclass('down');
    expect(bar.openGroup()).toBe('track');
    expect(bar.active).toEqual({ kind: 'reclass', dir: 'down' });
  });

  it('U again puts the arrow down', () => {
    const { bar } = barOn(catalog());
    bar.toggleReclass('up');
    bar.toggleReclass('up');
    expect(bar.active).toEqual(noTool);
    expect(bar.open).toBeNull();
  });

  it('a tool picked anywhere brings its category and its type with it', () => {
    // a tool in hand is never locked: the age that opens everything
    for (const c of catalog())
      for (const i of modeItems(c)) {
        const { bar } = barOn(catalog(), 99);
        bar.setActive(i.tool);
        expect(bar.open, i.key).toBe(c.id);
        if (c.groups) expect(bar.openGroup(), i.key).toBe(i.group);
      }
  });

  it('Tab walks the whole category, and the next type comes up with its item', () => {
    const { bar } = barOn(catalog());
    bar.openCategory('buildings');
    const last = shownItems(bar.category('buildings'), 'stations').at(-1)!;
    bar.select(last.tool);
    bar.cycle(1);
    expect(bar.openGroup()).toBe('town');
    expect(bar.active).toEqual({ kind: 'station', defId: 'town' });
    bar.cycle(-1);
    expect(bar.openGroup()).toBe('stations');
    expect(bar.active).toEqual(last.tool);
  });

  it('Tab skips what is locked', () => {
    const { bar } = barOn([made([item('a'), item('l', 3), item('b')])]);
    bar.openCategory('buildings');
    bar.cycle(1);
    expect(bar.active).toEqual({ kind: 'decor', defId: 'b' });
  });

  it('Q and E skip locked types, and step round', () => {
    const c = made(
      [item('a', 0, { group: 'x' }), item('l', 3, { group: 'y' }), item('b', 0, { group: 'z' })],
      ['x', 'y', 'z'],
    );
    const { bar } = barOn([c]);
    bar.openCategory('buildings');
    bar.cycleGroup(1);
    expect(bar.openGroup()).toBe('z');
    bar.cycleGroup(1);
    expect(bar.openGroup()).toBe('x');
    bar.cycleGroup(-1);
    expect(bar.openGroup()).toBe('z');
  });

  it('a digit picks the shown item, and a locked one leaves the tool in hand as it was', () => {
    const { bar } = barOn(catalog());
    bar.openCategory('track');
    bar.selectIndex(1);
    expect(bar.active.kind === 'track' && bar.active.item.kind).toBe('curve');
    const { bar: low } = barOn([made([item('a'), item('l', 3)])]);
    low.openCategory('buildings');
    low.selectIndex(1);
    expect(low.active).toEqual({ kind: 'decor', defId: 'a' });
  });

  it('a type keeps the slot of the piece in hand', () => {
    const { bar } = barOn(catalog());
    bar.openCategory('track');
    bar.selectIndex(1);
    bar.setGroup('narrow');
    expect(bar.active.kind === 'track' && bar.active.item).toEqual({
      kind: 'curve',
      cls: 'narrow',
    });
  });

  it('steps the category with Shift+Q and E, and the tool follows', () => {
    const { bar } = barOn(catalog());
    bar.openCategory('track');
    bar.cycleCategory(1);
    expect(bar.open).toBe('buildings');
    expect(bar.active).toEqual({ kind: 'station', defId: 'station' });
    bar.cycleCategory(-1);
    bar.cycleCategory(-1);
    expect(bar.open).toBe('roads');
    expect(bar.active).toEqual({ kind: 'road' });
  });

  it('remembers the type last open in a category', () => {
    const { bar } = barOn(catalog());
    bar.openCategory('buildings');
    bar.setGroup('services');
    bar.closeCategory();
    bar.openCategory('buildings');
    expect(bar.openGroup()).toBe('services');
  });

  it('closing a category drops its tool, Demolish stays in hand', () => {
    const { bar } = barOn(catalog());
    bar.openCategory('roads');
    bar.closeCategory();
    expect(bar.active).toEqual(noTool);
    bar.toggleDemolish();
    bar.closeCategory();
    expect(bar.active).toEqual({ kind: 'remove' });
  });

  it('toggles Demolish, which closes the open category', () => {
    const { bar } = barOn(catalog());
    bar.openCategory('roads');
    bar.toggleDemolish();
    expect(bar.active).toEqual({ kind: 'remove' });
    expect(bar.open).toBeNull();
    bar.toggleDemolish();
    expect(bar.active).toEqual(noTool);
  });

  it('opening a category ends Demolish, even one with nothing to take up', () => {
    const { bar } = barOn(catalog());
    bar.toggleDemolish();
    bar.openCategory('track');
    expect(bar.active.kind).toBe('track');
    const { bar: locked } = barOn([made([item('l', 3)])]);
    locked.toggleDemolish();
    locked.openCategory('buildings');
    expect(locked.open).toBe('buildings');
    expect(locked.active).toEqual(noTool);
  });

  it('clears the status when the tool changes, and keeps it when it does not', () => {
    const { bar } = barOn(catalog());
    bar.openCategory('roads');
    bar.status = 'Not enough wood';
    bar.setActive(bar.active);
    expect(bar.status).toBe('Not enough wood');
    bar.setActive({ kind: 'none' });
    expect(bar.status).toBe('');
  });
});

describe('the line at the top of the bar', () => {
  const quiet = { demolishing: false, categoryOpen: false, refund: 50 };

  it('stays away with nothing to say', () => {
    expect(statusLine('', quiet)).toEqual({ text: '', warn: false });
  });
  it('carries the status', () => {
    expect(statusLine('Tile occupied', quiet)).toEqual({ text: 'Tile occupied', warn: false });
  });
  it('carries the demolish hint while Demolish is on and no category is open', () => {
    const on = { ...quiet, demolishing: true };
    expect(statusLine('', on)).toEqual({ text: STR.toolbar.demolishOn(50), warn: true });
    expect(statusLine('Refund 4 wood', on)).toEqual({ text: 'Refund 4 wood', warn: false });
    expect(statusLine('', { ...on, categoryOpen: true }).text).toBe('');
  });
  it('reads the refund from the tuning, and says nothing of one in the editor', () => {
    expect(refundPercent(false)).toBe(50);
    rules.refundRate = 0.25;
    expect(refundPercent(false)).toBe(25);
    expect(refundPercent(true)).toBeNull();
    expect(STR.toolbar.demolishOn(25)).toContain('25%');
    expect(STR.toolbar.demolishOn(null)).not.toContain('%');
  });
});

describe('where the toasts stand', () => {
  it('stays above the dock, whatever it holds', () => {
    // a closed bar, one row of tiles, two rows, two rows with the card, the tallest the dock can be
    for (const height of [60, 187, 242, 262, 560, 650])
      expect(toastBottom(height), `${height}`).toBeGreaterThan(DOCK_BOTTOM + height);
  });
  it('rises with the dock, not in steps', () => {
    expect(toastBottom(500) - toastBottom(400)).toBe(100);
  });
  it('keeps its place over a hidden dock (the overview) or a low one', () => {
    expect(toastBottom(0)).toBe(TOAST_FLOOR);
    expect(toastBottom(40)).toBe(TOAST_FLOOR);
  });
});

describe('the tooltips', () => {
  const text = (doc: TipDoc) => doc.map(blockText);
  const ages: AgeStatus[] = [
    { index: 0, id: 'steam', unlocked: true, current: true, goals: [] },
    {
      index: 1,
      id: 'diesel',
      unlocked: false,
      current: false,
      goals: [{ kind: 'depots', target: 2, current: 1, done: false }],
    },
  ];

  it('a category: its name and key, and what it lists', () => {
    const lines = text(categoryTip(cat('buildings'), '2'));
    expect(lines[0]).toBe(STR.toolbar.buildings);
    expect(lines).toContain(STR.toolbar.keyHint('2'));
    expect(lines.join()).toContain(STR.toolbar.services);
    expect(text(categoryTip(cat('roads'), '5')).join()).toContain(STR.toolbar.road);
  });
  it('a type: its name and key, and what unlocks it while locked', () => {
    expect(text(typeTip('Main Line', null, ages))).toEqual([
      'Main Line',
      STR.toolbar.keyHint(STR.toolbar.typeKeys),
    ]);
    const locked = text(typeTip('Main Line', 1, ages));
    expect(locked).toContain(STR.ages.unlocksIn(STR.ages.name.diesel));
    expect(locked).toContain(`${STR.ages.goal.depots}: 1 / 2`);
  });
  it('an arrow: which way it steps, and its key', () => {
    expect(text(arrowTip(-1))[0]).toBe(STR.toolbar.prevType);
    expect(text(arrowTip(1))[0]).toBe(STR.toolbar.nextType);
    expect(text(arrowTip(-1))).toContain(STR.toolbar.keyHint('Q'));
    expect(text(arrowTip(1))).toContain(STR.toolbar.keyHint('E'));
  });
  it('an item: its name, description, cost and key, at the price it costs now', () => {
    const it0 = item('Mill', 0, {
      desc: 'Grinds.',
      cost: { wood: 2 },
      costNow: () => ({ wood: 3, stone: 1 }),
    });
    const lines = text(itemTip(it0, '4', 0, ages));
    expect(lines[0]).toBe('Mill');
    expect(lines).toContain('Grinds.');
    expect(lines).toContain(`${STR.toolbar.secCost}: 3 1`);
    expect(lines).toContain(STR.toolbar.keyHint('4'));
    expect(lines.some((l) => l.includes(STR.ages.unlocksIn('')))).toBe(false);
  });
  it('an item that costs nothing says free, and the arrows say theirs and name their key', () => {
    expect(text(itemTip(item('Free'), '1', 0, ages))).toContain(
      `${STR.toolbar.secCost}: ${STR.build.free}`,
    );
    const up = cat('tools').items.find((i) => i.key === 'reclass:up')!;
    const lines = text(itemTip(up, '2', 0, ages));
    expect(lines).toContain(`${STR.toolbar.secCost}: ${STR.toolbar.upgradeCost}`);
    expect(lines).toContain(STR.toolbar.keyHint('2 · U'));
  });
  it('a locked item says what unlocks it', () => {
    const lines = text(itemTip(item('Far', 1), '1', 0, ages));
    expect(lines).toContain(STR.ages.unlocksIn(STR.ages.name.diesel));
    expect(lines).toContain(`${STR.ages.goal.depots}: 1 / 2`);
  });
  it('an item past the ninth place has no key to name', () => {
    const lines = text(itemTip(item('Tenth'), '', 0, ages));
    expect(lines.some((l) => l.startsWith(STR.toolbar.keyHint('').trim()))).toBe(false);
  });
  it('Demolish: what comes back, and its key', () => {
    const lines = text(demolishTip(50));
    expect(lines[0]).toBe(STR.toolbar.demolish);
    expect(lines.join()).toContain('50%');
    expect(lines.join()).toContain('X');
    expect(text(demolishTip(null)).join()).not.toContain('%');
  });
});

describe('the controls line of the build card', () => {
  const key = (t: Tool) => controlsHint(item('x', 0, { tool: t }));
  it('tells a dragged tool from a placed one', () => {
    expect(key({ kind: 'track', item: { kind: 'straight', cls: 'branch' } })).toContain(
      STR.toolbar.foot.run,
    );
    expect(key({ kind: 'track', item: { kind: 'curve', cls: 'branch' } })).toContain(
      STR.toolbar.foot.click,
    );
    expect(key({ kind: 'road' })).toContain(STR.toolbar.foot.drag);
    expect(key({ kind: 'supply', supply: 'catenary' })).toContain(STR.toolbar.foot.drag);
    expect(key({ kind: 'terrain', terrain: 0 })).not.toContain(STR.toolbar.foot.drag);
    expect(key({ kind: 'terrain', terrain: 0 })).toContain(STR.toolbar.foot.paint);
  });
  it('says Raise and Lower act by a click or along a line, and lay nothing', () => {
    for (const delta of [1, -1] as const) {
      const line = key({ kind: 'ground', delta });
      expect(line, String(delta)).toContain(STR.toolbar.foot.ground);
      expect(line, String(delta)).not.toMatch(/lay|place/i);
      expect(line, String(delta)).toContain(STR.toolbar.foot.cancel);
      expect(line, String(delta)).not.toContain(STR.toolbar.foot.turn);
    }
  });
  it('does not say Upgrade and Downgrade lay anything: they move track that stands', () => {
    for (const dir of ['up', 'down'] as const) {
      const line = key({ kind: 'reclass', dir });
      expect(line, dir).toContain(STR.toolbar.foot.reclass);
      expect(line, dir).not.toMatch(/lay|place/i);
    }
  });
  it('names R only for a tool that turns, and never undo', () => {
    expect(key({ kind: 'track', item: { kind: 'curve', cls: 'branch' } })).toContain(
      STR.toolbar.foot.turn,
    );
    expect(key({ kind: 'road' })).not.toContain(STR.toolbar.foot.turn);
    expect(key({ kind: 'road' })).toContain(STR.toolbar.foot.cancel);
    expect(key({ kind: 'road' })).not.toMatch(/ctrl|undo/i);
  });
});

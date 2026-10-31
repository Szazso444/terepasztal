import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Notices, type Notice } from './notices';
import { rules, DEFAULT_RULES, daySeconds } from './rules';
import { ALERT_TYPES, type AlertType } from './alerts';
import { STR } from '../strings';
import { depotWith } from '../testing/storeFixtures';
import { simWorld } from '../testing/simWorld';
import type { Builder } from './build';
import type { Contract } from './contracts';
import type { PowerGrid } from './power';
import type { Train } from './trains';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

beforeEach(() => Object.assign(rules, DEFAULT_RULES));

/** The wear of a world with no track, for a case that builds its builder by hand. */
const NO_WEAR = { unusable: new Set<number>(), track: { pieces: new Map(), w: 1 } } as never;

/** The train fields `Notices.refresh` reads; each case below sets what makes it report. */
function train(state: string, more: Partial<Train> = {}): Train {
  return {
    id: 7,
    name: 'Rocket',
    state,
    eco: false,
    blocked: false,
    blockedTime: 0,
    ...more,
  } as Train;
}
/** A building `Notices.refresh` reports on: no wire, no store. */
function works(id: string, reason: string) {
  return { id, x: 3, y: 4, reason };
}

/** A world of nothing but the pieces given, with a board if a test passes one. */
function refreshed(pieces: {
  trains?: Train[];
  buildings?: ReturnType<typeof works>[];
  orphaned?: boolean;
  stuck?: { id: number; since: number }[];
}) {
  const station = { id: 1, name: 'Halt', x: 5, y: 6 };
  const builder = {
    stations: pieces.orphaned ? [station] : [],
    isOrphaned: () => true,
    buildings: new Map((pieces.buildings ?? []).map((b, i) => [i, b])),
    stores: {
      choices: () => [],
      worksStore: () => ({ key: 'st:1', get: () => 0, cap: () => 0 }),
      networkPool: (r: unknown) => r,
      label: () => '',
    },
    stationById: () => station,
  } as unknown as Builder;
  const n = new Notices();
  n.refresh({
    trains: pieces.trains ?? [],
    builder,
    power: { edges: () => [] } as unknown as PowerGrid,
    wear: NO_WEAR,
    stuck: pieces.stuck,
  });
  return n.list;
}
const typeOf = (list: Notice[], suffix: string) => list.find((n) => n.key.endsWith(suffix))?.type;

describe('every notice has an alert type', () => {
  const cases: [string, Notice[], string, AlertType][] = [
    ['no fuel', refreshed({ trains: [train('noFuel')] }), ':fuel', 'nofuel'],
    ['no power', refreshed({ trains: [train('noPower')] }), ':power', 'nofuel'],
    [
      'stuck',
      refreshed({ trains: [train('run')], stuck: [{ id: 7, since: 90 }] }),
      ':stuck',
      'stuck',
    ],
    ['no route', refreshed({ trains: [train('noRoute')] }), ':route', 'noroute'],
    ['stranded', refreshed({ trains: [train('stranded')] }), ':route', 'noroute'],
    ['overweight', refreshed({ trains: [train('overweight')] }), ':heavy', 'noroute'],
    ['a station cut off', refreshed({ orphaned: true }), ':orphan', 'noroute'],
    ['works full', refreshed({ buildings: [works('kiln', 'full')] }), ':full', 'full'],
    ['works short of input', refreshed({ buildings: [works('kiln', 'inputs')] }), ':in', 'starved'],
    [
      'unwired plant',
      refreshed({ buildings: [works('power_plant', 'inputs')] }),
      ':wire',
      'starved',
    ],
    ['eco mode', refreshed({ trains: [train('run', { eco: true })] }), ':eco', 'slow'],
    [
      'held',
      refreshed({ trains: [train('run', { blocked: true, blockedTime: 9 })] }),
      ':held',
      'slow',
    ],
  ];
  for (const [name, list, suffix, want] of cases)
    it(`${name} is ${want}`, () => expect(typeOf(list, suffix)).toBe(want));

  it('a pushed notice keeps the type it was given', () => {
    const n = new Notices();
    n.push({ key: 'x', kind: 'info', type: 'note', text: 'x', target: null }, 30);
    n.refresh({
      trains: [],
      builder: { stations: [], buildings: new Map(), stores: { choices: () => [] } } as never,
      power: { edges: () => [] } as never,
      wear: NO_WEAR,
    });
    expect(n.list.map((m) => m.type)).toEqual(['note']);
  });

  it('every type is a row of the Notifications screen', () => {
    for (const [, , , want] of cases) expect(ALERT_TYPES).toContain(want);
  });
});

describe('the derived notices that are new', () => {
  /** An empty world with one depot, its store as given. */
  function depotWorld(goods: Record<string, number>) {
    const w = simWorld({ terrain: 'grass', size: 96 });
    const store = depotWith(w, goods, { x: 40, y: 24 });
    return { w, store };
  }
  function placed(w: ReturnType<typeof simWorld>, id: string, x: number, y: number) {
    w.builder.free = true;
    const b = w.builder.placeBuilding(x, y, id);
    w.builder.free = false;
    if (!b) throw new Error(`no ${id} at ${x},${y}`);
    return b;
  }
  const refresh = (w: ReturnType<typeof simWorld>, contracts?: Partial<Contract>[], now = 0) => {
    w.notices.refresh({
      trains: [],
      builder: w.builder,
      power: w.power,
      wear: w.builder.wear,
      contracts: {
        board: {
          get active() {
            return (contracts ?? []).filter((c) => c.status === 'active') as Contract[];
          },
          get offers() {
            return (contracts ?? []).filter((c) => c.status === 'offer') as Contract[];
          },
          remaining: (c, t) => Math.max(0, (c.expires - t) / c.duration),
        },
        now,
      },
    });
    return w.notices.list;
  };

  it('a store at its cap is a notice on it, and one that never reached it is none', () => {
    const { w, store } = depotWorld({ coal: rules.depotCap });
    const [n] = refresh(w).filter((m) => m.type === 'full');
    expect(n.key).toBe(`store:${store.key}:full`);
    expect(n.text).toBe(STR.notice.storeFull(w.stores.label(store), 'Coal'));
    expect(n.target).toEqual({ kind: 'tile', x: store.anchor.x, y: store.anchor.y });
    const below = depotWorld({ coal: rules.depotCap - 1 });
    expect(refresh(below.w).filter((m) => m.type === 'full')).toEqual([]);
  });

  it('is one notice for a store however many goods fill it', () => {
    const { w } = depotWorld({ coal: rules.depotCap, wood: rules.depotCap });
    const full = refresh(w).filter((m) => m.type === 'full');
    expect(full).toHaveLength(1);
    expect(full[0].text).toContain('Wood, Coal');
  });

  it('stays until the store falls below 95 percent, so it does not flap at the cap', () => {
    const { w, store } = depotWorld({ coal: rules.depotCap });
    const full = () => refresh(w).filter((m) => m.type === 'full');
    expect(full()).toHaveLength(1);
    store.amounts.set('coal', rules.depotCap - 1);
    expect(full()).toHaveLength(1);
    store.amounts.set('coal', rules.depotCap * 0.95);
    expect(full()).toHaveLength(1);
    store.amounts.set('coal', rules.depotCap * 0.95 - 1);
    expect(full()).toEqual([]);
    // cleared, it takes the cap to come back
    store.amounts.set('coal', rules.depotCap * 0.98);
    expect(full()).toEqual([]);
    store.amounts.set('coal', rules.depotCap);
    expect(full()).toHaveLength(1);
  });

  it('keeps one good in the text while another falls away', () => {
    const { w, store } = depotWorld({ coal: rules.depotCap, wood: rules.depotCap });
    refresh(w);
    store.amounts.set('wood', 1);
    const [n] = refresh(w).filter((m) => m.type === 'full');
    expect(n.text).toContain('Coal');
    expect(n.text).not.toContain('Wood');
  });

  it('does not say again what a works there already says', () => {
    const { w, store } = depotWorld({ wood: rules.depotCap });
    const kiln = placed(w, 'kiln', 44, 20);
    expect(w.stores.worksStore(kiln)?.key).toBe(store.key);
    kiln.reason = 'full';
    expect(
      refresh(w)
        .filter((m) => m.type === 'full')
        .map((n) => n.key),
    ).toEqual([`b${kiln.x},${kiln.y}:full`]);
  });

  it('takes over when that works stops saying so, the store being as full as it was', () => {
    const { w, store } = depotWorld({ wood: rules.depotCap });
    const kiln = placed(w, 'kiln', 44, 20);
    kiln.reason = 'full';
    refresh(w);
    kiln.reason = '';
    store.amounts.set('wood', rules.depotCap - 1);
    expect(
      refresh(w)
        .filter((m) => m.type === 'full')
        .map((n) => n.key),
    ).toEqual([`store:${store.key}:full`]);
  });

  it('a works at another place does not hide it', () => {
    const { w, store } = depotWorld({ wood: rules.depotCap });
    const far = placed(w, 'kiln', 80, 80);
    expect(w.stores.worksStore(far)).toBeNull();
    far.reason = 'full';
    const keys = refresh(w)
      .filter((m) => m.type === 'full')
      .map((n) => n.key);
    expect(keys).toContain(`store:${store.key}:full`);
  });

  it('a contract with under a quarter of its term left is at risk, on its destination', () => {
    const { w } = depotWorld({});
    const d = daySeconds();
    const c = {
      id: 3,
      name: 'Coal run',
      status: 'active',
      delivered: 0,
      amount: 10,
      destId: w.builder.stations[0].id,
      duration: 4 * d,
      expires: 4 * d,
    } as Partial<Contract>;
    expect(refresh(w, [c], 3 * d).some((n) => n.type === 'contract')).toBe(false);
    const [n] = refresh(w, [c], 3 * d + 1).filter((m) => m.type === 'contract');
    expect(n.key).toBe('contract:3:risk');
    expect(n.text).toBe(STR.notice.contractAtRisk('Coal run'));
    const dest = w.builder.stations[0];
    expect(n.target).toEqual({ kind: 'tile', x: dest.x, y: dest.y });
  });

  it('a contract that has no station left is at risk with no target', () => {
    const { w } = depotWorld({});
    const c: Partial<Contract> = {
      id: 3,
      status: 'active',
      delivered: 0,
      amount: 1,
      duration: 1,
      expires: 0,
    };
    const [n] = refresh(w, [{ ...c, name: 'x', destId: -1 }]).filter((m) => m.type === 'contract');
    expect(n.target).toBeNull();
  });

  it('an open offer is a notice as long as it stays open', () => {
    const { w } = depotWorld({});
    const offer = { id: 4, name: 'Wood run', status: 'offer', destId: w.builder.stations[0].id };
    const [n] = refresh(w, [offer as Partial<Contract>]).filter((m) => m.type === 'offer');
    expect(n.key).toBe('offer:4');
    expect(n.text).toBe(STR.notice.contractOffered('Wood run'));
    expect(refresh(w, []).filter((m) => m.type === 'offer')).toEqual([]);
  });
});

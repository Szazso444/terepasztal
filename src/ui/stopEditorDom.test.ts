import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STR } from '../strings';
import type { Builder } from '../sim/build';
import type { Commands } from '../sim/commands';
import { defaultStop, type StopPlan, type Train } from '../sim/trains';
import { DWELL_RANGE } from './depotView';
import { ScheduleEditor, TrainStops } from './scheduleEditor';

// the buttons play a sound when pressed; the context that plays it is a browser's
vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

/** What a click carries through the fake page. */
class FakeEvent {
  stopped = false;
  constructor(
    readonly type: string,
    readonly target: FakeEl,
    readonly shiftKey = false,
  ) {}
  stopPropagation() {
    this.stopped = true;
  }
  preventDefault() {}
}

/** The little of an element the stop editor and the kit's controls use. */
class FakeEl {
  className = '';
  textContent = '';
  title = '';
  value = '';
  disabled = false;
  hidden = false;
  innerHTML = '';
  attrs = new Map<string, string>();
  style = { setProperty() {} };
  parent: FakeEl | null = null;
  children: (FakeEl | string)[] = [];
  private listeners = new Map<string, ((e: FakeEvent) => void)[]>();
  classList = {
    add: (c: string) => {
      if (!this.has(c)) this.className = `${this.className} ${c}`.trim();
    },
    toggle: (c: string, on = !this.className.split(' ').includes(c)) => {
      const rest = this.className.split(' ').filter((x) => x && x !== c);
      this.className = (on ? [...rest, c] : rest).join(' ');
      return on;
    },
  };
  constructor(readonly tagName: string) {}

  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
    if (k === 'value') this.value = v;
    if (k === 'title') this.title = v;
  }
  private adopt(c: FakeEl | string) {
    if (c instanceof FakeEl) c.parent = this;
    return c;
  }
  append(...c: (FakeEl | string)[]) {
    this.children.push(...c.map((x) => this.adopt(x)));
  }
  prepend(...c: (FakeEl | string)[]) {
    this.children.unshift(...c.map((x) => this.adopt(x)));
  }
  replaceChildren(...c: (FakeEl | string)[]) {
    for (const old of this.children) if (old instanceof FakeEl) old.parent = null;
    this.children = c.map((x) => this.adopt(x));
  }
  addEventListener(type: string, f: (e: FakeEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), f]);
  }
  /** Fire `type` here and bubble it up as far as nothing stops it. */
  fire(type: string, shift = false) {
    const e = new FakeEvent(type, this, shift);
    for (const f of this.listeners.get(type) ?? []) f(e);
    if (!e.stopped) this.parent?.bubble(e);
  }
  private bubble(e: FakeEvent) {
    for (const f of this.listeners.get(e.type) ?? []) f(e);
    if (!e.stopped) this.parent?.bubble(e);
  }
  click() {
    this.fire('click');
  }
  contains(other: FakeEl | null): boolean {
    return other === this || this.all.includes(other as FakeEl);
  }
  get all(): FakeEl[] {
    return this.children
      .filter((c): c is FakeEl => c instanceof FakeEl)
      .flatMap((c) => [c, ...c.all]);
  }
  text(): string {
    return (
      this.textContent + this.children.map((c) => (c instanceof FakeEl ? c.text() : c)).join('')
    );
  }
  has(cls: string) {
    return this.className.split(' ').includes(cls);
  }
  byClass(cls: string): FakeEl[] {
    return this.all.filter((e) => e.has(cls));
  }
}

const page = {
  activeElement: null as FakeEl | null,
  createElement: (tag: string) => new FakeEl(tag.toUpperCase()),
  createTextNode: (t: string) => t,
};

beforeEach(() => {
  page.activeElement = null;
  vi.stubGlobal('document', page);
  vi.stubGlobal('HTMLInputElement', class {});
});
afterEach(() => vi.unstubAllGlobals());

const STATIONS = [
  { id: 1, name: 'Quarry' },
  { id: 2, name: 'Farm' },
  { id: 3, name: 'Mill' },
].map((s) => ({
  ...s,
  producedCargo: () => [] as string[],
  refuelsFuel: false,
  refuelsWater: false,
}));
const builder = {
  stations: STATIONS,
  platformTiles: () => [1],
  stationById: (id: number) => STATIONS.find((s) => s.id === id),
} as unknown as Builder;

const stopsOf = (...ids: number[]): StopPlan[] => ids.map((id) => defaultStop(id));
const fake = (e: unknown) => e as FakeEl;

/** The switch of a stop that is called `label`. */
const switchOf = (block: FakeEl, label: string) =>
  block.all.find((e) => e.has('k-sw') && e.attrs.get('title') === label)!;
const dwellInput = (block: FakeEl, hint: string) =>
  block.all.find((e) => e.tagName === 'INPUT' && e.attrs.get('aria-label') === hint)!;

describe('a stop editor that a train refuses', () => {
  /** A train with these stops, and a `setSchedule` that takes a list of two stops or more. */
  function trained(ids: number[]) {
    const train = { program: stopsOf(...ids), routeIndex: 0 } as unknown as Train;
    (train as unknown as { schedule: StopPlan[] }).schedule = train.program as StopPlan[];
    const toasts: string[] = [];
    const commands = {
      setSchedule(t: Train, stops: readonly StopPlan[]) {
        if (stops.length < 2) return { ok: false as const, message: STR.fleet.needTwoStops };
        (t as unknown as { program: StopPlan[]; schedule: StopPlan[] }).program = [...stops];
        (t as unknown as { schedule: StopPlan[] }).schedule = [...stops];
        return { ok: true as const };
      },
    } as unknown as Commands;
    const stops = new TrainStops(builder, commands, (m) => toasts.push(m));
    stops.show(train);
    return { train, stops, toasts };
  }
  const blocks = (stops: TrainStops) => fake(stops.root).byClass('dp-stop');

  it('draws the switch again from the train, with the reason said', () => {
    // a roaming train's program is the one stop it roams with
    const { train, stops, toasts } = trained([1]);
    const before = blocks(stops)[0];
    expect(switchOf(before, STR.depot.opt.refuel).has('on')).toBe(true);
    switchOf(before, STR.depot.opt.refuel).fire('click');
    expect(toasts).toEqual([STR.fleet.needTwoStops]);
    const now = blocks(stops)[0];
    // a fresh block, and its switch shows what the train still holds
    expect(now).not.toBe(before);
    expect(train.program[0].refuel).toBe(true);
    expect(switchOf(now, STR.depot.opt.refuel).has('on')).toBe(true);
  });

  it('draws a segment again too, on the value the train holds', () => {
    const { train, stops } = trained([1]);
    const nothing = (block: FakeEl) =>
      block.all.find((e) => e.tagName === 'BUTTON' && e.text() === STR.depot.nothing)!;
    nothing(blocks(stops)[0]).fire('click');
    expect(train.program[0].load).toBe('auto');
    // the segment of the new block holds Auto, not the refused Nothing
    expect(nothing(blocks(stops)[0]).has('on')).toBe(false);
  });

  it('draws a dwell field again with the time the train holds', () => {
    const { train, stops } = trained([1]);
    const hint = STR.depot.dwellMinHint;
    const field = dwellInput(blocks(stops)[0], hint);
    field.value = '40';
    field.fire('change');
    expect(train.program[0].minDwell).toBe(0);
    expect(dwellInput(blocks(stops)[0], hint).value).toBe('0');
  });

  it('keeps the controls as they are when the train takes the edit', () => {
    const { train, stops, toasts } = trained([1, 2]);
    const before = blocks(stops);
    switchOf(before[0], STR.depot.opt.refuel).fire('click');
    expect(toasts).toEqual([]);
    expect(train.program[0].refuel).toBe(false);
    // nothing was drawn again: the same blocks, the switch already off
    expect(blocks(stops)).toEqual(before);
    expect(switchOf(blocks(stops)[0], STR.depot.opt.refuel).has('on')).toBe(false);
  });
});

describe('the stop the train heads for', () => {
  it('is marked in place: the blocks are not drawn again as the train goes on', () => {
    const train = { program: stopsOf(1, 2, 3), routeIndex: 0 } as unknown as Train;
    (train as unknown as { schedule: StopPlan[] }).schedule = train.program as StopPlan[];
    const stops = new TrainStops(builder, {} as Commands, () => {});
    stops.show(train);
    const blocks = fake(stops.root).byClass('dp-stop');
    expect(blocks.map((b) => b.has('on'))).toEqual([true, false, false]);
    train.routeIndex = 2;
    stops.sync(train);
    const after = fake(stops.root).byClass('dp-stop');
    expect(after).toEqual(blocks);
    expect(after.map((b) => b.has('on'))).toEqual([false, false, true]);
  });

  it('shows a program the train was given elsewhere', () => {
    const train = { program: stopsOf(1, 2), routeIndex: 0 } as unknown as Train;
    (train as unknown as { schedule: StopPlan[] }).schedule = train.program as StopPlan[];
    const stops = new TrainStops(builder, {} as Commands, () => {});
    stops.show(train);
    const t = train as unknown as { program: StopPlan[]; schedule: StopPlan[] };
    t.program = t.schedule = stopsOf(1, 2, 3);
    stops.sync(train);
    expect(fake(stops.root).byClass('dp-stop')).toHaveLength(3);
  });
});

describe("a stop's time", () => {
  function edited(stored: number) {
    const stop = { ...defaultStop(1), minDwell: stored };
    const stops = [stop, defaultStop(2)];
    const editor = new ScheduleEditor(builder, () => {});
    editor.render(stops);
    const block = fake(editor.root).byClass('dp-stop')[0];
    return { stop, field: dwellInput(block, STR.depot.dwellMinHint), block };
  }

  it('shows a stored 7 as 7, not as a step', () => {
    expect(edited(7).field.value).toBe('7');
    expect(edited(12).field.value).toBe('12');
    expect(edited(600).field.value).toBe('600');
  });

  it('keeps a typed time to the second', () => {
    const { stop, field } = edited(0);
    field.value = '7';
    field.fire('change');
    expect(stop.minDwell).toBe(7);
    expect(field.value).toBe('7');
    field.value = '12';
    field.fire('change');
    expect(stop.minDwell).toBe(12);
  });

  it('moves by 15 s a press and by 5 s with Shift', () => {
    const { stop, block } = edited(7);
    const plus = block.all.filter((e) => e.tagName === 'BUTTON' && e.text() === '+')[0];
    plus.fire('click');
    expect(stop.minDwell).toBe(7 + DWELL_RANGE.step);
    plus.fire('click', true);
    expect(stop.minDwell).toBe(7 + DWELL_RANGE.step + DWELL_RANGE.bigStep);
  });
});

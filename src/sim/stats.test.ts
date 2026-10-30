import { describe, it, expect } from 'vitest';
import { ShownFlows } from './stats';
import { looseStore } from '../testing/storeFixtures';
import type { Flow, ResourceStore } from './stores';

/** A store that counts how often its weekly flows are read. */
function counted(): { store: ResourceStore; reads: () => number } {
  const store = looseStore({ wood: 5 });
  let n = 0;
  const weeklyFlow = store.weeklyFlow.bind(store);
  store.weeklyFlow = (id: string): Flow => {
    n++;
    return weeklyFlow(id);
  };
  return { store, reads: () => n };
}

describe('the flows a reader shows (ShownFlows)', () => {
  it('works them out once, and again only on a refresh or for another store', () => {
    const shown = new ShownFlows(['wood', 'stone']);
    const a = counted();
    const b = counted();
    const first = shown.of(a.store);
    expect(Object.keys(first)).toEqual(['wood', 'stone']);
    expect(a.reads()).toBe(2);
    // drawn frame after frame: nothing is worked out again
    for (let i = 0; i < 10; i++) expect(shown.of(a.store)).toBe(first);
    expect(a.reads()).toBe(2);
    // the panels' refresh: once more
    shown.refresh();
    shown.of(a.store);
    shown.of(a.store);
    expect(a.reads()).toBe(4);
    // another store shown: its own flows at once
    shown.of(b.store);
    expect(b.reads()).toBe(2);
    expect(a.reads()).toBe(4);
  });
});

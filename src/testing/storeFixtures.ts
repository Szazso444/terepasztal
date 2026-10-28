// Store fixtures for tests that build without a whole world (`simWorld`): a registry holding one
// depot store, standing where the test builds, in the place of the old global stockpile; and a
// stocked depot for a whole world.

import type { Builder } from '../sim/build';
import { Station } from '../sim/stations';
import { StoreRegistry, type Store } from '../sim/stores';
import type { TownRegistry } from '../sim/towns';
import { TrackGraph } from '../world/track';
import { station, type SimWorld } from './simWorld';

/** The fixture depot's station id: no station a test places has it, as ids start at 1. */
const FIXTURE_DEPOT_ID = 0;

/**
 * A store registry with one depot store, anchored at `at`, holding `amounts`. The registry is
 * attached to a world of its own that holds only that depot (no towns, no plants), so it can be
 * handed to any `Builder`: the builder pays from the depot whatever it builds within
 * `rules.buildReach` of `at`, and refunds go to it, and the registry's `refresh` keeps it. The
 * amounts are put in as given, past the depot's cap; what is added later is capped as in a game.
 */
export function storeWith(
  amounts: Record<string, number>,
  at = { x: 0, y: 0 },
): { stores: StoreRegistry; depot: Store } {
  const st = new Station('depot', at.x, at.y, undefined, FIXTURE_DEPOT_ID);
  const builder = {
    stations: [st],
    plantCount: () => 0,
    stationById: (id: number) => (id === st.id ? st : undefined),
  };
  const towns = { towns: [], townAt: () => null, station: () => undefined, byId: () => undefined };
  const stores = new StoreRegistry();
  stores.attach({
    builder: builder as unknown as Builder,
    towns: towns as unknown as TownRegistry,
    track: new TrackGraph(1, 1),
  });
  stores.refresh();
  const depot = stores.byKey(`st:${st.id}`)!;
  for (const [id, n] of Object.entries(amounts)) depot.amounts.set(id, n);
  return { stores, depot };
}

/**
 * A depot placed in a whole world (`simWorld`) at (x, y), through the builder in the editor's
 * way, its store holding `amounts`, put in as given past its cap: the store the world's building
 * pays from within `rules.buildReach` of it.
 */
export function depotWith(
  w: SimWorld,
  amounts: Record<string, number>,
  at: { x: number; y: number },
): Store {
  const depot = w.stores.byKey(`st:${station(w, 'depot', at.x, at.y).id}`)!;
  for (const [id, n] of Object.entries(amounts)) depot.amounts.set(id, n);
  return depot;
}

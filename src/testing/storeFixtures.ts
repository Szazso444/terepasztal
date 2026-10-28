// Store fixtures for tests that build without a whole world (`simWorld`): a registry holding one
// depot store, standing where the test builds, in the place of the old global stockpile; and a
// stocked depot for a whole world.

import type { Builder } from '../sim/build';
import { Station } from '../sim/stations';
import { StoreRegistry, type Store } from '../sim/stores';
import type { TownRegistry } from '../sim/towns';
import { TrackGraph } from '../world/track';
import { station, type SimWorld } from './simWorld';

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
  const { stores, depots } = storesWith([{ amounts, at }]);
  return { stores, depot: depots[0] };
}

/**
 * `storeWith` for several depots: a registry of one depot store for each, in the order given,
 * anchored where it says and holding what it says. Their station ids are 0, -1, -2 and on: no
 * station a test places has one, as ids start at 1.
 */
export function storesWith(
  list: readonly { amounts: Record<string, number>; at: { x: number; y: number } }[],
): { stores: StoreRegistry; depots: Store[] } {
  const sts = list.map(({ at }, i) => new Station('depot', at.x, at.y, undefined, -i || 0));
  const builder = {
    stations: sts,
    plantCount: () => 0,
    stationById: (id: number) => sts.find((s) => s.id === id),
  };
  const towns = { towns: [], townAt: () => null, station: () => undefined, byId: () => undefined };
  const stores = new StoreRegistry();
  stores.attach({
    builder: builder as unknown as Builder,
    towns: towns as unknown as TownRegistry,
    track: new TrackGraph(1, 1),
  });
  stores.refresh();
  const depots = sts.map((st, i) => {
    const depot = stores.byKey(`st:${st.id}`)!;
    for (const [id, n] of Object.entries(list[i].amounts)) depot.amounts.set(id, n);
    return depot;
  });
  return { stores, depots };
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

/**
 * A Townhouse placed in a whole world (`simWorld`) at (x, y), through the builder in the editor's
 * way, its town's store holding `amounts`, put in as given past its cap: the store the houses,
 * works, crews and harvesters within the town's reach use.
 */
export function townWith(
  w: SimWorld,
  amounts: Record<string, number>,
  at: { x: number; y: number },
): Store {
  const hall = station(w, 'town', at.x, at.y);
  const town = w.stores.byKey(`town:${w.towns.byStation(hall.id)!.id}`)!;
  for (const [id, n] of Object.entries(amounts)) town.amounts.set(id, n);
  return town;
}

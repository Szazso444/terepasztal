import { rules } from '../sim/rules';
import type { TripStats } from '../sim/trains';
import type { TrainFacts } from '../ui/trainView';

/** A train that runs and carries nothing, as literals: a test sets what it is about. */
export function trainFacts(more: Partial<TrainFacts> = {}): TrainFacts {
  return {
    state: 'moving',
    blocked: false,
    route: [],
    routeIndex: 0,
    detour: null,
    maintaining: false,
    maint: null,
    parkAt: null,
    wagons: [],
    hasSteam: false,
    hasDiesel: false,
    hasElectric: false,
    fuelKind: 'coal',
    coal: 0,
    coalCap: 0,
    coalRate: 0,
    water: 0,
    waterCap: 0,
    waterRate: 0,
    oilKind: 'oil',
    oil: 0,
    oilCap: 0,
    oilRate: 0,
    battery: 0,
    batteryCap: 0,
    powerRate: 0,
    rangeTiles: Infinity,
    lastTrip: null,
    freeSpeed: 0,
    maxSpeed: 1,
    loadFactor: 1,
    holding: false,
    pathTotal: 0,
    pathProgress: 0,
    lastMessage: '',
    hungry: false,
    job: null,
    jobs: [],
    ...more,
  };
}

/** A closed loop that took `days` days. */
export function tripWith(more: Partial<TripStats>, days: number): TripStats {
  return {
    startedAt: 100,
    endedAt: 100 + days * rules.daySeconds,
    distance: 0,
    fuel: {},
    loaded: {},
    delivered: {},
    income: 0,
    ...more,
  };
}

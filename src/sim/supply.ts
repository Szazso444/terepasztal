/**
 * Production-chain mode of the running game, chosen when a game starts and stored in the save.
 *
 * - `simple`: works run from the global stockpile, warehouses top up from the stockpile when
 *   their own store runs dry, diesel engines burn oil.
 * - `full`: a second data set of cargo, stations and works (`*_full.json`) joins the game:
 *   collieries on coal deposits, mines and ironworks, derricks and refineries making diesel,
 *   sand for traction and copper wire. Warehouses refuel only from what trains bring them.
 *
 * Read at use time like `rules`, so every consumer sees the mode of the loaded game.
 */
export type SupplyMode = 'simple' | 'full';
export const SUPPLY_MODES: SupplyMode[] = ['simple', 'full'];
export const DEFAULT_SUPPLY: SupplyMode = 'simple';

let mode: SupplyMode = DEFAULT_SUPPLY;

export function supplyMode(): SupplyMode {
  return mode;
}
export function setSupplyMode(m: SupplyMode | undefined | null) {
  mode = m === 'full' ? 'full' : 'simple';
}
/** True when a data entry (cargo, station, works) belongs to the running mode. */
export function inSupplyMode(def: { supply?: SupplyMode }): boolean {
  return !def.supply || def.supply === mode;
}
/** What diesel engines burn in the running mode. */
export function dieselFuelId(): 'oil' | 'diesel' {
  return mode === 'full' ? 'diesel' : 'oil';
}
/** Sand spread on the rails per tile run by any train (full mode only). */
export function sandPerTile(): number {
  return mode === 'full' ? 1 / 200 : 0;
}

import { content, type CargoDef, type CargoClass } from '../data/content';

export type { CargoDef, CargoClass };
export const CARGO: CargoDef[] = content.cargo;
const byId = new Map(CARGO.map((c) => [c.id, c]));
/** Display name for a cargo or 'power'. */
export function cargoName(id: string): string {
  if (id === 'power') return 'power';
  const d = CARGO.find((c) => c.id === id);
  return d ? d.name : id;
}
export function cargoDef(id: string): CargoDef {
  const c = byId.get(id);
  if (!c) throw new Error(`unknown cargo ${id}`);
  return c;
}
export function cargoClass(id: string): CargoClass {
  return byId.get(id)?.class ?? 'bulk';
}
export const BASIC_RESOURCES = CARGO.filter((c) => c.basic).map((c) => c.id);
export const ADVANCED_RESOURCES = CARGO.filter((c) => !c.basic).map((c) => c.id);

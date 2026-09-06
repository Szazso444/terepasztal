import { content, type CargoDef } from '../data/content';

export type { CargoDef };
export const CARGO: CargoDef[] = content.cargo;
const byId = new Map(CARGO.map((c) => [c.id, c]));
export function cargoDef(id: string): CargoDef {
  const c = byId.get(id);
  if (!c) throw new Error(`unknown cargo ${id}`);
  return c;
}

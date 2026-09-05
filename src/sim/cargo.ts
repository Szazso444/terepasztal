import cargoData from '../data/cargo.json';

export interface CargoDef {
  id: string;
  name: string;
  tier: number;
  price: number;
  color: string;
  weight: number;
}
export const CARGO: CargoDef[] = cargoData as CargoDef[];
const byId = new Map(CARGO.map((c) => [c.id, c]));
export function cargoDef(id: string): CargoDef {
  const c = byId.get(id);
  if (!c) throw new Error(`unknown cargo ${id}`);
  return c;
}

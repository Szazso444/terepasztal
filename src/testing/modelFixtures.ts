import { afterAll, beforeAll } from 'vitest';
import type { RenderedModelFields } from '../data/content';
import { locoDef, wagonDef } from '../gacha/items';

const MODEL_FIELDS: (keyof RenderedModelFields)[] = [
  'gear',
  'lengthTiles',
  'spriteGear',
  'truckSprites',
  'truckOffsets',
  'wheels',
  'spriteFacings',
  'boxes',
  'smoke',
  'lamps',
];

/**
 * A copy of a vehicle as its row in the table draws it, without the rendered model the load lays
 * on it: the size's length and the plan's segments, as for a vehicle with no measured model. For
 * a test about those rules, which every shipped model has left behind.
 */
export function withoutModel<T extends RenderedModelFields>(def: T): T {
  const bare = { ...def };
  for (const field of MODEL_FIELDS) delete bare[field];
  return bare;
}

/**
 * Runs `fn` with these shipped entries as their rows draw them, then gives them their models back:
 * for a test of what a vehicle without a model does that reaches the entries by id, as a fleet does.
 */
export function withModelsOff<T>(defs: RenderedModelFields[], fn: () => T): T {
  const kept = defs.map((d) => ({ ...d }));
  try {
    for (const d of defs) for (const field of MODEL_FIELDS) delete d[field];
    return fn();
  } finally {
    defs.forEach((d, i) => Object.assign(d, kept[i]));
  }
}

/** `withModelsOff` for the whole of the file or `describe` it is called in. */
export function rowLengths(...defs: RenderedModelFields[]) {
  const kept = defs.map((d) => ({ ...d }));
  beforeAll(() => {
    for (const d of defs) for (const field of MODEL_FIELDS) delete d[field];
  });
  afterAll(() => {
    defs.forEach((d, i) => Object.assign(d, kept[i]));
  });
}

/**
 * For the file or `describe` it is called in, the F7, the wood hopper and the wooden coach at
 * lengths that fit a scene laid out tile by tile for them as they were: 2 + 1 tiles and a coupling
 * then, 1.93 + 1.07 here. As their models measure (2.48 + 1.37) such a scene's sidings and spacings
 * no longer hold them, which says nothing of what it asks about trains making way. They keep their
 * models' running gear, and their lengths stay off the tile grid.
 */
export function sceneLengths() {
  const scene: [RenderedModelFields, number][] = [
    [locoDef('f7'), 1.93],
    [wagonDef('wood_hopper'), 1.07],
    [wagonDef('wooden_coach'), 1.07],
  ];
  const kept = scene.map(([def]) => def.lengthTiles);
  beforeAll(() => {
    for (const [def, tiles] of scene) def.lengthTiles = tiles;
  });
  afterAll(() => {
    scene.forEach(([def], i) => (def.lengthTiles = kept[i]));
  });
}

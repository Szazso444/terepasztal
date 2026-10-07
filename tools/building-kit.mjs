/** Conventions of the building pictures (ages, rotations, footprints, projection) and the list of
 * buildings, read from the game's own data files so the art work cannot drift from the game.
 * See docs/superpowers/specs/2026-10-02-building-eras-art-package-design.md.
 */
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where the pictures and their work list live. */
export const ROOT = 'assets/source/buildings-v2';

/**
 * Write a file whole or not at all: under a name beside it first, then into its place. A write
 * that a full disk cuts short then leaves the file as it was, where writing in place would leave
 * half a list behind. Where the file cannot be replaced in one step (something has it open), it
 * is written in place after all. `io` stands in for the disk in the tests.
 */
export function writeWhole(file, data, io = {}) {
  const write = io.writeFileSync ?? writeFileSync;
  const rename = io.renameSync ?? renameSync;
  const part = `${file}.part`;
  try {
    write(part, data);
  } catch (e) {
    rmSync(part, { force: true });
    throw e;
  }
  try {
    rename(part, file);
  } catch {
    rmSync(part, { force: true });
    write(file, data);
  }
}

export const AGES = ['steam', 'diesel', 'electric', 'nuclear', 'magnetic', 'hyper'].map(
  (id, index) => ({ index, id, tag: `a${index}`, name: id[0].toUpperCase() + id.slice(1) }),
);

/** Walls in the order a building's front passes them when it turns clockwise seen from above. */
export const WALLS = ['S', 'W', 'N', 'E'];
/** Rotation r turns the front to WALLS[r]. The camera sees the S wall (lower left) and the E wall. */
export const ROTATIONS = WALLS.map((front, index) => ({ index, tag: `r${index}`, front }));
const ROLES = ['front', 'sideB', 'back', 'sideA'];
/** What a wall of the footprint is for a building turned to `rot`. Side A is on the front's right
 * for someone standing outside and facing it. */
export function wallRole(wall, rot) {
  return ROLES[(WALLS.indexOf(wall) - rot + 4) % 4];
}

/**
 * One entry per footprint: the canvas (a size image generators return), canvas px per game px,
 * and the fixed pixel of the footprint's centre at ground level. A tile is 64 x 32 game px.
 */
export const FOOTPRINTS = {
  t1: { id: 't1', canvas: [1024, 1024], scale: 8, centre: [512, 832], tiles: [1, 1] },
  // one tile on a tall canvas, for buildings that grow upwards with the ages (houses)
  t1tall: { id: 't1tall', canvas: [1024, 1536], scale: 8, centre: [512, 1344], tiles: [1, 1] },
  // two tiles along the front: 2 x 1 when the front faces S or N, 1 x 2 when it faces W or E
  t1x2: { id: 't1x2', canvas: [1024, 1024], scale: 8, centre: [512, 800], tiles: [2, 1] },
  t2x2: { id: 't2x2', canvas: [1536, 1024], scale: 6, centre: [768, 760], tiles: [2, 2] },
};

/** Width (along x) and depth (along y) of the footprint in tiles when turned to `rot`. */
export function footprintTiles(fp, rot) {
  const [a, b] = fp.tiles;
  return rot % 2 === 0 ? { w: a, h: b } : { w: b, h: a };
}

/** Tile offset from the footprint centre (x, y) at height z game px, to canvas px. */
export function project(fp, x, y, z = 0) {
  return [fp.centre[0] + fp.scale * (x - y) * 32, fp.centre[1] + fp.scale * ((x + y) * 16 - z)];
}

/** The footprint's four ground corners on the canvas: n is the far one, s the near one. */
export function diamond(fp, rot) {
  const { w, h } = footprintTiles(fp, rot);
  return {
    n: project(fp, -w / 2, -h / 2),
    e: project(fp, w / 2, -h / 2),
    s: project(fp, w / 2, h / 2),
    w: project(fp, -w / 2, h / 2),
  };
}

/** A building's walls stand this far inside its footprint's edge, in tiles. */
export const WALL_INSET = 0.06;

/** The ground corners of a building's walls on the canvas: the footprint, set in by WALL_INSET. */
export function wallBase(fp, rot) {
  const { w, h } = footprintTiles(fp, rot);
  const x = w / 2 - WALL_INSET,
    y = h / 2 - WALL_INSET;
  return {
    n: project(fp, -x, -y),
    e: project(fp, x, -y),
    s: project(fp, x, y),
    w: project(fp, -x, y),
  };
}

export function pictureFile(family, age, rot) {
  return `${ROOT}/${family}/${family}-a${age}-r${rot}.png`;
}
export function frameKey(family, age, rot) {
  return `structures/${family}_a${age}_r${rot}`;
}

/** The order the families are worked in: the pilot first, then stations, works, houses, services. */
const ORDER = { depot: 0, station: 1 };
const KIND_ORDER = { station: 2, depot: 3, works: 4, house: 5, service: 6 };

/**
 * Every building family of the game, in working order.
 * Stations and works are upgradeable: one model per age from the age they unlock in (`tier`) to
 * the last age, or to their own last one (`lastTier`): a building of one period, the charcoal
 * kiln, is not modernised after it.
 */
export function loadInventory(root = '.') {
  const data = (file) => JSON.parse(readFileSync(join(root, 'src/data', file), 'utf8'));
  const out = [];
  const add = ({ lastTier, ...f }) => {
    const last = f.upgradeable ? (lastTier ?? AGES.length - 1) : f.firstAge;
    if (!AGES[last]) throw new Error(`${f.id}: there is no age ${last} (lastTier)`);
    if (last < f.firstAge)
      throw new Error(
        `${f.id}: its last age (lastTier ${last}) is before its first (tier ${f.firstAge})`,
      );
    out.push({ ...f, lastAge: last, ages: last - f.firstAge + 1, order: out.length });
  };
  const footprint = (d) => (d.long ? 't1x2' : (d.size ?? 1) > 1 ? 't2x2' : 't1');
  for (const d of data('stations.json').defs)
    add({
      family: d.art,
      id: d.id,
      name: d.name,
      kind: d.depot ? 'depot' : 'station',
      footprint: footprint(d),
      firstAge: d.tier ?? 0,
      lastTier: d.lastTier,
      upgradeable: true,
    });
  // the full-chain mines share the quarry's picture in the game today; each gets its own
  for (const d of data('stations_full.json'))
    add({
      family: d.id,
      id: d.id,
      name: d.name,
      kind: 'station',
      footprint: footprint(d),
      firstAge: d.tier ?? 0,
      lastTier: d.lastTier,
      upgradeable: true,
    });
  for (const file of ['buildings.json', 'buildings_full.json'])
    for (const d of data(file))
      if (!d.bridge)
        add({
          family: d.id,
          id: d.id,
          name: d.name,
          kind: 'works',
          footprint: 't1',
          firstAge: d.tier ?? 0,
          lastTier: d.lastTier,
          upgradeable: true,
        });
  for (const d of data('decor.json')) {
    if (d.onTrack || d.power) continue;
    add({
      family: d.id,
      id: d.id,
      name: d.name,
      kind: d.residents ? 'house' : 'service',
      footprint: d.residents ? 't1tall' : 't1',
      firstAge: 0,
      upgradeable: !!d.residents,
    });
  }
  const rank = (f) => ORDER[f.family] ?? KIND_ORDER[f.kind];
  return out
    .sort((a, b) => rank(a) - rank(b) || a.order - b.order)
    .map(({ order: _order, ...f }) => f);
}

/** Every picture to make, in working order: a family age by age, the front view (r0) first. */
export function pictures(inventory) {
  const out = [];
  for (const f of inventory)
    for (let n = 0; n < f.ages; n++)
      for (const r of ROTATIONS) {
        const age = f.firstAge + n;
        out.push({
          family: f.family,
          age,
          rot: r.index,
          file: pictureFile(f.family, age, r.index),
        });
      }
  return out;
}

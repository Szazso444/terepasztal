import { Graphics, Text } from 'pixi.js';
import { content, landmarkDef, type LandmarkDef } from '../data/content';
import { locoDef, wagonDef } from '../gacha/items';
import type { Game } from '../game';
import { LANDMARK_REACH, type LandmarkItem, type LandmarkRegistry } from '../sim/landmarks';
import { daySeconds } from '../sim/rules';
import { grantDepot } from '../sim/startDepot';
import type { Station } from '../sim/stations';
import { Train, defaultStop, type StopPlan } from '../sim/trains';
import type { Builder, LinePiece } from '../sim/build';
import { CHUNK_TILES } from '../world/chunks';
import { pieceLinks, type TrackItem } from '../world/track';
import { sitesInChunk, startChunk, type LandmarkSite } from '../world/landmarks';
import type { GameMap } from '../world/tiles';
import { Dir, tileToWorld } from './iso';

/**
 * The review scene of the rare landmarks (#549): a fixed generated world with all twelve landmarks
 * on legal ground, each with a ring of narrow track round it and a train going round, the
 * footprints and anchors drawn over them, and one landmark being restored by a scheduled train.
 * Dev only: `main.ts` reaches this file through a dynamic import behind `import.meta.env.DEV`, so a
 * production build holds none of it.
 *
 * Everything goes through the game's own parts: the landmarks through the registry, the track and
 * stations through the Builder, the delivery train through `Fleet.create`. The ring trains are put
 * on their rings directly, as the headless tests put a train on a line, as no depot serves a ring.
 */

/** The seed of the scene's world: one where all twelve landmarks have a legal site off the start chunk. */
export const LANDMARK_SCENE_SEED = 54;
/** The tuning rule `landmarkChance` the scene runs at, so most regions roll a landmark of their own. */
export const LANDMARK_SCENE_CHANCE = 3;
/** The landmark that is being restored in front of the reviewer (20 wood and 20 iron, no condition). */
export const RESTORE_ID = 'bellkeepers_refuge';

const NARROW = 'narrow' as const;
const STRAIGHT: TrackItem = { kind: 'straight', cls: NARROW, cls2: NARROW };
const CURVE: TrackItem = { kind: 'curve', cls: NARROW };

/** The way a landmark came to stand where it does. */
export type Origin = 'rolled' | 'site';

/** What the scene made round one landmark. */
export interface SceneEntry {
  id: number;
  def: string;
  x: number;
  y: number;
  w: number;
  d: number;
  /** `rolled`: the game's own placement drew it; `site`: placed on a legal site `sitesInChunk` found */
  origin: Origin;
  /** the ring of track round it, as its rectangle's corners, or null where none fit */
  ring: { x0: number; y0: number; x1: number; y1: number } | null;
  stations: number[];
  train: number | null;
}

/** The rotation of a straight or curve whose single link joins exactly these two edges. */
function rotJoining(kind: 'straight' | 'curve', a: Dir, b: Dir): number {
  for (let rot = 0; rot < 4; rot++) {
    const link = pieceLinks(kind, rot)[0];
    if (link && link.includes(a) && link.includes(b)) return rot;
  }
  throw new Error(`no ${kind} joins ${a} and ${b}`);
}

/**
 * The pieces of a closed ring of narrow track on the rectangle's border, clockwise from its corner
 * of least x and y: a curve at each corner and straights between.
 */
export function ringPieces(x0: number, y0: number, x1: number, y1: number): LinePiece[] {
  const out: LinePiece[] = [];
  const at = (x: number, y: number, item: TrackItem, rot: number) =>
    out.push({ kind: 'track', x, y, item, rot });
  const along = rotJoining('straight', Dir.E, Dir.W);
  const up = rotJoining('straight', Dir.N, Dir.S);
  at(x0, y0, CURVE, rotJoining('curve', Dir.E, Dir.S));
  for (let x = x0 + 1; x < x1; x++) at(x, y0, STRAIGHT, along);
  at(x1, y0, CURVE, rotJoining('curve', Dir.W, Dir.S));
  for (let y = y0 + 1; y < y1; y++) at(x1, y, STRAIGHT, up);
  at(x1, y1, CURVE, rotJoining('curve', Dir.W, Dir.N));
  for (let x = x1 - 1; x > x0; x--) at(x, y1, STRAIGHT, along);
  at(x0, y1, CURVE, rotJoining('curve', Dir.E, Dir.N));
  for (let y = y1 - 1; y > y0; y--) at(x0, y, STRAIGHT, up);
  return out;
}

/** Lay a line with the Builder granting: no price, age or chunk lock. False, nothing laid, when it is refused. */
function lay(builder: Builder, pieces: readonly LinePiece[]): boolean {
  const was = builder.free;
  builder.free = true;
  try {
    return builder.placeLine(pieces);
  } finally {
    builder.free = was;
  }
}
function judge(builder: Builder, pieces: readonly LinePiece[]): boolean {
  const was = builder.free;
  builder.free = true;
  try {
    return builder.checkLine(pieces).ok;
  } finally {
    builder.free = was;
  }
}

/**
 * Lay the smallest ring of narrow track the ground takes round a footprint, with 1 to 3 tiles of
 * clearance on each side (the footprint's own tiles refuse track, so the ring goes round them).
 * Null when no ring fits.
 */
export function layRing(builder: Builder, f: Foot): SceneEntry['ring'] {
  const c = findRing(builder, f);
  return c && lay(builder, ringPieces(c.x0, c.y0, c.x1, c.y1)) ? c : null;
}

/** A footprint: its corner of least x and y, and its width along x and depth along y. */
export interface Foot {
  x: number;
  y: number;
  w: number;
  d: number;
}

/** The smallest ring the ground takes round the footprint, judged and not laid; null when none fits. */
export function findRing(builder: Builder, f: Foot): SceneEntry['ring'] {
  const cands: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (let l = 1; l <= 3; l++)
    for (let r = 1; r <= 3; r++)
      for (let u = 1; u <= 3; u++)
        for (let b = 1; b <= 3; b++)
          cands.push({ x0: f.x - l, y0: f.y - u, x1: f.x + f.w - 1 + r, y1: f.y + f.d - 1 + b });
  const size = (c: (typeof cands)[number]) => c.x1 - c.x0 + c.y1 - c.y0;
  // the smallest first, and among equals the one that leaves the same room on every side
  const spread = (c: (typeof cands)[number]) =>
    Math.abs(f.x - c.x0 - (c.x1 - (f.x + f.w - 1))) +
    Math.abs(f.y - c.y0 - (c.y1 - (f.y + f.d - 1)));
  cands.sort((a, b) => size(a) - size(b) || spread(a) - spread(b));
  for (const c of cands) {
    if (c.x0 < 1 || c.y0 < 1 || c.x1 >= builder.map.w - 1 || c.y1 >= builder.map.h - 1) continue;
    if (judge(builder, ringPieces(c.x0, c.y0, c.x1, c.y1))) return c;
  }
  return null;
}

/**
 * Put two plain stations beside a ring, on different sides, so a train going round halts twice a
 * lap. Each goes next to a straight of the ring, outside it where the ground takes that and
 * inside it where not. Returns the stations that stood: two, unless the ground took fewer.
 */
export function ringStations(builder: Builder, ring: NonNullable<SceneEntry['ring']>): Station[] {
  const out: Station[] = [];
  const tryAt = (x: number, y: number): Station | null => {
    const was = builder.free;
    builder.free = true;
    try {
      const s = builder.placeStation(x, y, 'station', 0);
      if (!s) return null;
      if (builder.platformTiles(s).length) return s;
      builder.removeStation(s);
      return null;
    } finally {
      builder.free = was;
    }
  };
  const { x0, y0, x1, y1 } = ring;
  const mid = (a: number, b: number) => Math.floor((a + b) / 2);
  // the straights of each side, middle first, with the step that goes out of the ring and in again
  const along = (a: number, b: number) =>
    Array.from({ length: b - a - 1 }, (_, i) => a + 1 + i).sort(
      (p, q) => Math.abs(p - mid(a, b)) - Math.abs(q - mid(a, b)),
    );
  const sides = [
    { at: (k: number) => ({ x: k, y: y0 }), ks: along(x0, x1), dx: 0, dy: -1 },
    { at: (k: number) => ({ x: k, y: y1 }), ks: along(x0, x1), dx: 0, dy: 1 },
    { at: (k: number) => ({ x: x0, y: k }), ks: along(y0, y1), dx: -1, dy: 0 },
    { at: (k: number) => ({ x: x1, y: k }), ks: along(y0, y1), dx: 1, dy: 0 },
  ];
  const taken: object[] = [];
  for (const inward of [false, true])
    for (const side of sides) {
      if (out.length >= 2 || taken.includes(side)) continue;
      for (const k of side.ks) {
        const t = side.at(k);
        const sgn = inward ? -1 : 1;
        const s = tryAt(t.x + sgn * side.dx, t.y + sgn * side.dy);
        if (s) {
          out.push(s);
          taken.push(side);
          break;
        }
      }
    }
  return out;
}

/** Whether a landmark's footprint is within a station's reach (the survey and the delivery rule). */
function within(item: LandmarkItem, def: LandmarkDef, s: Station): boolean {
  const dx = Math.max(0, item.x - (s.x + s.w - 1), s.x - (item.x + def.w - 1));
  const dy = Math.max(0, item.y - (s.y + s.h - 1), s.y - (item.y + def.d - 1));
  return Math.max(dx, dy) <= LANDMARK_REACH;
}

/**
 * Bring the registry up to all twelve landmarks. The game's own roll at `landmarkChance` 3 has
 * placed what it could in the first map; each landmark still missing goes on the first legal
 * corner `sitesInChunk` finds in a chunk that holds no landmark yet (the start chunk left out),
 * the same search placement samples, so the site rules are the game's. A corner is taken only when
 * `fits` accepts its footprint (the scene asks for room to lay a ring of track round it). Returns
 * the ids of the landmarks that were added so.
 */
export function completeLandmarks(
  map: GameMap,
  registry: LandmarkRegistry,
  sites: readonly LandmarkSite[],
  fits: (f: Foot) => boolean = () => true,
): Set<string> {
  const filled = new Set<string>();
  const start = startChunk(map);
  const used = new Set<string>();
  const chunkOfTile = (x: number, y: number) =>
    `${Math.floor((map.originX + x) / CHUNK_TILES)},${Math.floor((map.originY + y) / CHUNK_TILES)}`;
  for (const i of registry.items) used.add(chunkOfTile(i.x, i.y));
  const cx0 = Math.floor(map.originX / CHUNK_TILES);
  const cy0 = Math.floor(map.originY / CHUNK_TILES);
  const cx1 = Math.floor((map.originX + map.w - 1) / CHUNK_TILES);
  const cy1 = Math.floor((map.originY + map.h - 1) / CHUNK_TILES);
  for (const site of sites) {
    if (registry.items.some((i) => i.def === site.id)) continue;
    let placed = false;
    for (let cy = cy0; cy <= cy1 && !placed; cy++)
      for (let cx = cx0; cx <= cx1 && !placed; cx++) {
        if ((cx === start.cx && cy === start.cy) || used.has(`${cx},${cy}`)) continue;
        const [corners] = sitesInChunk(map, cx, cy, [site]);
        const at = corners.find((c) => fits({ x: c.x, y: c.y, w: site.w, d: site.d }));
        if (!at) continue;
        registry.addPlacements([{ id: site.id, x: at.x, y: at.y, cx, cy }]);
        used.add(`${cx},${cy}`);
        filled.add(site.id);
        placed = true;
      }
  }
  return filled;
}

/** Where the delivery line of the restoring landmark runs: a row or column, and where its depot stands. */
interface Line {
  /** the axis the line runs along: 0 along x (rows), 1 along y (columns) */
  axis: 0 | 1;
  /** the row's y (or the column's x) */
  at: number;
  from: number;
  to: number;
}

/** The gap in tiles between the landmark and a delivery line: past any ring and its stations. */
const GAPS = [6, 7, 8];

function lineTiles(l: Line): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let p = l.from; p <= l.to; p++)
    out.push(l.axis === 0 ? { x: p, y: l.at } : { x: l.at, y: p });
  return out;
}

/**
 * A narrow depot with a line to a plain station within reach of the landmark. The depot is granted
 * (`grantDepot`, which lays its gate track), the rest of the line laid, the station put beside it
 * on the landmark's side. Null when no row or column near the landmark takes all three.
 */
export function layDelivery(
  builder: Builder,
  item: LandmarkItem,
  def: LandmarkDef,
): { depot: Station; plain: Station } | null {
  const was = builder.free;
  builder.free = true;
  try {
    for (const gap of GAPS)
      for (const axis of [0, 1] as const)
        for (const side of [1, -1]) {
          const centre = axis === 0 ? item.x : item.y;
          const span = axis === 0 ? def.w : def.d;
          const cross = axis === 0 ? item.y : item.x;
          const crossSpan = axis === 0 ? def.d : def.w;
          const at = side > 0 ? cross + crossSpan - 1 + gap : cross - gap;
          // gate, the two shed tiles, gate, then the run past the landmark
          const from = centre - 4;
          const to = centre + span + 4;
          const line: Line = { axis, at, from, to };
          const tiles = lineTiles(line);
          const first = tiles[0];
          if (!first || at < 2 || at > (axis === 0 ? builder.map.h : builder.map.w) - 3) continue;
          // the shed stands on from+1 and from+2, turned along the line
          const shed = tiles[1];
          const depot = grantDepot(builder, 'narrow_depot', shed.x, shed.y, axis === 0 ? 0 : 1);
          if (!depot) continue;
          const run = tiles.slice(4).map((t) => ({
            kind: 'track' as const,
            x: t.x,
            y: t.y,
            item: STRAIGHT,
            rot: rotJoining('straight', axis === 0 ? Dir.E : Dir.N, axis === 0 ? Dir.W : Dir.S),
          }));
          if (!judge(builder, run) || !lay(builder, run)) {
            builder.removeStation(depot);
            continue;
          }
          // the station beside the run, on the landmark's side, nearest the landmark first
          const inward = -side;
          let plain: Station | null = null;
          const order = tiles
            .slice(4)
            .sort(
              (a, b) =>
                Math.abs((axis === 0 ? a.x : a.y) - centre) -
                Math.abs((axis === 0 ? b.x : b.y) - centre),
            );
          for (const t of order) {
            const sx = axis === 0 ? t.x : t.x + inward;
            const sy = axis === 0 ? t.y + inward : t.y;
            const s = builder.placeStation(sx, sy, 'station', 0);
            if (!s) continue;
            if (builder.platformTiles(s).length && within(item, def, s)) {
              plain = s;
              break;
            }
            builder.removeStation(s);
          }
          if (plain) return { depot, plain };
          builder.removeStation(depot);
        }
    return null;
  } finally {
    builder.free = was;
  }
}

/** The stop a ring train makes: a short halt, nothing loaded or unloaded. */
function haltAt(stationId: number): StopPlan {
  return {
    ...defaultStop(stationId),
    load: 'none',
    unload: 'none',
    waitFull: false,
    refuel: false,
    minDwell: 4,
    maxDwell: 8,
  };
}

/** The footprint outline, the anchor and the front tile of a landmark, drawn over the world. */
function drawOutline(game: Game, e: SceneEntry, label: string) {
  const g = new Graphics();
  const lift = game.world.elevationOf(e.x, e.y);
  const corner = (x: number, y: number) => {
    const p = tileToWorld(x - 0.5, y - 0.5);
    return [p.x, p.y + lift];
  };
  g.poly([
    ...corner(e.x, e.y),
    ...corner(e.x + e.w, e.y),
    ...corner(e.x + e.w, e.y + e.d),
    ...corner(e.x, e.y + e.d),
  ])
    .fill({ color: 0xff3c3c, alpha: 0.12 })
    .stroke({ color: 0xff3c3c, width: 1.5, alpha: 0.95 });
  // the anchor: the picture is drawn about the footprint's centre
  const c = tileToWorld(e.x + (e.w - 1) / 2, e.y + (e.d - 1) / 2);
  g.circle(c.x, c.y + lift, 2.5).fill({ color: 0xffd23c });
  g.moveTo(c.x - 5, c.y + lift)
    .lineTo(c.x + 5, c.y + lift)
    .stroke({ color: 0xffd23c, width: 1 });
  g.moveTo(c.x, c.y + lift - 5)
    .lineTo(c.x, c.y + lift + 5)
    .stroke({ color: 0xffd23c, width: 1 });
  // the front tile, whose depth key the picture sorts by
  const f = tileToWorld(e.x + e.w - 1, e.y + e.d - 1);
  g.circle(f.x, f.y + lift, 2).fill({ color: 0x3cc8ff });
  const t = new Text({
    text: label,
    style: { fontSize: 9, fill: 0xffffff, stroke: { color: 0x000000, width: 2 } },
  });
  const top = tileToWorld(e.x - 0.5, e.y - 0.5);
  t.position.set(top.x - t.width / 2, top.y + lift - 22);
  game.world.overlay.addChild(g, t);
  return [g, t] as const;
}

/** What `window.landmarkScene` offers the reviewer in the console. */
export interface SceneHandle {
  entries: SceneEntry[];
  filled: string[];
  restoring: number | null;
  /** centre the camera on landmark `n` (0-11, data order) at a zoom step (default 4: 2x) */
  focus(n: number, zoom?: number): void;
  /** the footprint outlines and anchors on or off */
  outlines(on: boolean): void;
  /** the clock to the middle of the night (or noon) */
  night(on: boolean): void;
  speed(i: number): void;
}

declare global {
  interface Window {
    landmarkScene?: SceneHandle;
  }
}

/**
 * Build the scene on a game that has just started fresh in the scene's world. Returns what it
 * made; also put on `window.landmarkScene`. The clock is left stopped so the `?` markers show
 * until the reviewer starts it.
 */
export function buildLandmarkScene(game: Game): SceneHandle {
  const { builder, landmarks, fleet, inventory, world, stores } = game;
  game.settings.autosave = false;
  // nothing may stop the clock under the reviewer: no popup or pause for a goal or a train's trouble
  const alerts = game.settings.alerts;
  alerts.criticalPause = false;
  for (const row of Object.values(alerts.channels)) {
    row.popup = false;
    row.pause = false;
  }
  const sites: readonly LandmarkSite[] = content.landmarks;
  const filled = completeLandmarks(
    game.map,
    landmarks,
    sites,
    (f) => findRing(builder, f) !== null,
  );
  // the whole map is the reviewer's: nothing under fog, every chunk buildable
  game.regions.applyTier(Number.POSITIVE_INFINITY);
  world.rebuildFog();
  game.overview.rebuildRegions();
  game.minimap.rebuildBase();
  landmarks.refreshVisibility(() => true);
  world.setLandmarks(landmarks.items);

  const entries: SceneEntry[] = [];
  const was = builder.free;
  builder.free = true;
  const order = sites.map((s) => s.id);
  const items = [...landmarks.items].sort((a, b) => order.indexOf(a.def) - order.indexOf(b.def));
  const rings: SceneEntry[] = [];
  items.forEach((item) => {
    const def = landmarkDef(item.def)!;
    const e: SceneEntry = {
      id: item.id,
      def: item.def,
      x: item.x,
      y: item.y,
      w: def.w,
      d: def.d,
      origin: filled.has(item.def) ? 'site' : 'rolled',
      ring: null,
      stations: [],
      train: null,
    };
    e.ring = layRing(builder, e);
    if (e.ring) {
      const st = ringStations(builder, e.ring);
      e.stations = st.map((s) => s.id);
    }
    entries.push(e);
    rings.push(e);
  });
  // the restore: a depot with the cargo, a line to a plain station in reach, a scheduled train
  const restoreItem = landmarks.items.find((i) => i.def === RESTORE_ID);
  let restoring: number | null = null;
  if (restoreItem) {
    const def = landmarkDef(RESTORE_ID)!;
    const made = layDelivery(builder, restoreItem, def);
    if (made) {
      const dock = stores.dockOf(made.depot);
      const store = dock ? stores.byKey(dock.key) : null;
      if (store)
        for (const [k, n] of Object.entries({ wood: 120, iron: 120, coal: 200, water: 300 }))
          store.amounts.set(k, store.get(k) + n);
      landmarks.onArrive(made.plain);
      landmarks.start(restoreItem.id);
      const loco = inventory.add('mav490', 0);
      const wagons = ['narrow_box', 'narrow_box', 'narrow_box', 'mine_tub', 'mine_tub'].map((w) =>
        inventory.add(w, 0),
      );
      const t = fleet.create(
        [loco.uid],
        wagons.map((w) => w.uid),
        [defaultStop(made.depot.id), { ...defaultStop(made.plain.id), load: 'none' }],
        'Bellkeeper delivery',
        'schedule',
        made.depot.id,
      );
      if (typeof t !== 'string') restoring = restoreItem.id;
      else console.warn(`[landmark scene] the delivery train did not roll out: ${t}`);
    } else console.warn('[landmark scene] no depot line fits near the restoring landmark');
  }
  // a ring train for each ring, going round with a halt at each station
  const trains: Train[] = [];
  for (const e of rings) {
    if (!e.ring || e.stations.length < 2) continue;
    const loco = inventory.add('rocket', 0);
    const coach = [inventory.add('narrow_coach', 0), inventory.add('narrow_coach', 0)];
    const t = new Train([{ uid: loco.uid, level: 1, def: locoDef('rocket') }], `Ring ${e.def}`);
    t.wagons = coach.map((c) => ({
      uid: c.uid,
      def: wagonDef(c.defId),
      level: 1,
      cargo: null,
      amount: 0,
      origin: null,
    }));
    const top = e.ring.y0;
    const mid = Math.floor((e.ring.x0 + e.ring.x1) / 2);
    // on the top row's first straight, heading east, with the lap in front of it
    const x = e.ring.x0 + 1;
    void mid;
    if (!t.spawnAt(game.track, x, top, Dir.W)) continue;
    t.schedule = e.stations.map((id) => haltAt(id));
    t.routeIndex = 0;
    if (!t.dispatch(game.track, builder, game.map)) continue;
    t.onPathReady({ builder });
    t.coal = t.coalCap;
    t.water = t.waterCap;
    loco.assigned = t.id;
    for (const c of coach) c.assigned = t.id;
    fleet.trains.push(t);
    e.train = t.id;
    trains.push(t);
  }
  builder.free = was;

  // surveyed or spotted: every second landmark is surveyed by a stop of its first station (the
  // game's own rule), the others stay spotted, a `?`, until their train first stops
  entries.forEach((e, n) => {
    if (n % 2 === 1 || e.id === restoring) {
      const s = builder.stationById(e.stations[0] ?? -1);
      if (s) landmarks.onArrive(s);
    }
  });
  world.setLandmarks(landmarks.items);

  const drawn: ReturnType<typeof drawOutline>[] = [];
  entries.forEach((e, n) => drawn.push(drawOutline(game, e, `${n + 1} ${e.def}`)));
  const fuel = window.setInterval(() => {
    for (const t of trains) {
      t.coal = t.coalCap;
      t.water = t.waterCap;
    }
  }, 10_000);
  void fuel;

  const handle: SceneHandle = {
    entries,
    filled: [...filled],
    restoring,
    focus(n, zoom = 4) {
      const e = entries[n];
      if (!e) return;
      const c = tileToWorld(e.x + (e.w - 1) / 2, e.y + (e.d - 1) / 2);
      game.camera.zoomIndex = zoom;
      game.camera.zoom = game.camera.targetZoom;
      game.camera.centerOn(c.x, c.y + world.elevationOf(e.x, e.y) - 24);
    },
    outlines(on) {
      for (const parts of drawn) for (const p of parts) p.visible = on;
    },
    night(on) {
      game.clock.time = daySeconds() * (on ? 0.9 : 0.5);
    },
    speed(i) {
      game.clock.setSpeed(i);
    },
  };
  window.landmarkScene = handle;
  game.clock.setSpeed(0);
  handle.focus(0, 1);
  return handle;
}

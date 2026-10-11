// Scratch for the bridge deck height survey: boots the real game on an empty map and exposes
// window.qa. Nothing here changes src: stored deck levels are emulated by replacing the game's
// rail-profile refresh with a copy that substitutes a stored level for a bridge tile's level.
import { Game } from '/src/game.ts';
import { emptyMap } from '/src/world/mapgen.ts';
import { levelFromMap } from '/src/world/level.ts';
import { tileToWorld } from '/src/engine/iso.ts';
import { levelAt } from '/src/world/elevation.ts';
import { lineSpans, climbAxes, railLevel } from '/src/world/railProfile.ts';

const level = levelFromMap(emptyMap(7412, 112, 112), 'Bridge heights');
const g = new Game({ kind: 'level', seed: 7412, level });
window.game = g;
await g.init();
g.loop.stop();
g.app.ticker.stop();
g.closeMenus();
g.settings.autosave = false;
g.settings.weather = false;
g.settings.dayNight = false;
g.settings.smoke = false;
g.clock.setSpeed(0);
g.builder.free = true;
for (let i = 0; i < g.regions.unlocked.length; i++) g.regions.own(i);
g.world.rebuildFog();
const m = g.map,
  W = m.w;
for (let y = 4; y < 108; y++)
  for (let x = 4; x < 108; x++) {
    const i = y * W + x;
    m.terrain[i] = 0;
    if (m.props.has(i)) {
      m.props.delete(i);
      g.world.removeProps(x, y);
    }
  }
for (let y = 3; y < 109; y++) for (let x = 3; x < 109; x++) g.world.retile(x, y);

/** Stored deck levels by tile key: the field the feature would add to a bridge platform. */
const decks = new Map();

/** railProfile + lineProfile of src/world/railProfile.ts, reading stored decks. */
function profile() {
  const track = g.track,
    beds = new Map(),
    bridgeAt = (x, y) => !!g.builder.bridgeAt(x, y),
    axesAt = (x, y) => {
      const p = track.get(x, y);
      return p && !p.unit ? climbAxes(p.links) : [];
    };
  for (const [k, p] of track.pieces) {
    const x = k % W,
      y = Math.floor(k / W);
    for (const axis of p.unit ? [] : climbAxes(p.links)) {
      const dx = axis === 'x' ? 1 : 0,
        dy = 1 - dx;
      if (axesAt(x - dx, y - dy).includes(axis)) continue;
      const tiles = [];
      for (let tx = x, ty = y; axesAt(tx, ty).includes(axis); tx += dx, ty += dy) tiles.push([tx, ty]);
      const start = axis === 'x' ? tiles[0][0] : tiles[0][1],
        bridge = tiles.map(([tx, ty]) => bridgeAt(tx, ty)),
        stored = tiles.map(([tx, ty]) => (bridgeAt(tx, ty) ? decks.get(ty * W + tx) : undefined)),
        pinned = tiles.map(([tx, ty]) => (track.get(tx, ty)?.links.length ?? 0) > 1),
        { spans, levels } = lineSpans(
          tiles.map(([tx, ty], i) => stored[i] ?? levelAt(m, tx, ty)),
          bridge.map((b, i) => b && stored[i] === undefined),
          start,
          pinned,
        );
      tiles.forEach(([tx, ty], i) => {
        const c = start + i,
          kk = ty * W + tx,
          near = spans.filter((s) => s.to > c - 1.5 && s.from < c + 1.5),
          close = near.filter((s) => s.to > c - 0.9 && s.from < c + 0.9),
          bed = {
            axis,
            spans: near,
            bridge: bridge[i] || undefined,
            flat: close.every((s) => s.a === s.b && s.a === levels[i]),
          },
          other = beds.get(kk);
        if (!other) beds.set(kk, bed);
        else if (other.flat && !bed.flat) beds.set(kk, { ...bed, cross: other });
        else beds.set(kk, { ...other, cross: bed, flat: other.flat && bed.flat });
      });
    }
  }
  return beds;
}
/** Replace the game's refresh (game.ts refreshRails) by the copy that reads stored decks. */
function emulateStoredDecks() {
  g.refreshRails = function () {
    this.railsDirty = false;
    const beds = profile();
    this.fleet.railBeds = beds;
    this.world.setRailBeds(beds);
    this.refreshBridges();
  };
}

const stampRect = (x0, y0, x1, y1, terrain) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m.terrain[y * W + x] = terrain;
};
const retile = (x0, y0, x1, y1) => {
  for (let y = y0 - 5; y <= y1 + 5; y++) for (let x = x0 - 5; x <= x1 + 5; x++) g.world.retile(x, y);
};
/** Straight track along x from x0 to x1 on row y. */
const lay = (x0, x1, y) => {
  const failed = [];
  for (let x = x0; x <= x1; x++) if (!g.builder.placeTrackKind(x, y, 'straight', 1)) failed.push(x);
  return failed;
};
const platforms = (x0, x1, y, id) => {
  for (let x = x0; x <= x1; x++) if (!g.builder.placeBuilding(x, y, id)) throw new Error(`bridge ${x},${y}`);
};
async function settle() {
  for (let i = 0; i < 400; i++) {
    g.render(1, 0);
    if (g.world.landscape.ready) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  g.render(1, 0);
  g.app.renderer.render(g.app.stage);
  return g.world.landscape.ready;
}
async function view(x, y, zoom = 3) {
  const at = tileToWorld(x, y);
  g.camera.centerOn(at.x, at.y);
  g.camera.zoom = zoom;
  return settle();
}
const levelsAlong = (x0, x1, y) => Array.from({ length: x1 - x0 + 1 }, (_, i) => levelAt(m, x0 + i, y));
/** Rail level at each tile centre of row y. */
const railAlong = (x0, x1, y) =>
  Array.from({ length: x1 - x0 + 1 }, (_, i) => {
    const bed = g.fleet.railBeds.get(y * W + x0 + i);
    return bed ? +railLevel(bed.axis === 'x' ? bed : (bed.cross ?? bed), x0 + i).toFixed(2) : null;
  });

const scenes = {
  /** TODAY: a river two tiles wide through a level-2 hill; its banks are level 1. */
  async riverInHills() {
    stampRect(28, 16, 52, 30, 2);
    stampRect(40, 14, 41, 32, 3);
    retile(28, 14, 52, 32);
    platforms(40, 41, 23, 'bridge_stone');
    const failed = lay(33, 48, 23);
    await view(40.5, 23, 3);
    return {
      failed,
      terrain: levelsAlong(33, 48, 23),
      rail: railAlong(33, 48, 23),
      step: g.world.landscape.step,
    };
  },
  /** TODAY: a land bridge across a one-tile dip, then what loading its own save does to it. */
  async landBridgeReload() {
    stampRect(28, 40, 52, 50, 2);
    stampRect(40, 38, 40, 52, 0);
    retile(28, 38, 52, 52);
    platforms(39, 41, 45, 'bridge_stone');
    const failed = lay(33, 48, 45);
    await view(40, 45, 3);
    return { failed, terrain: levelsAlong(33, 48, 45), rail: railAlong(33, 48, 45) };
  },
  async landBridgeReloadApply() {
    const terrainBefore = [39, 40, 41].map((x) => m.terrain[45 * W + x]),
      levelsBefore = levelsAlong(33, 48, 45),
      snap = g.snapshot();
    // The step applySave runs on every load (game.ts fixBuiltTiles), on the save of this world.
    g.fixBuiltTiles(snap);
    g.railsDirty = true;
    await view(40, 45, 3);
    return {
      saved: snap.buildings,
      terrainBefore,
      terrainAfter: [39, 40, 41].map((x) => m.terrain[45 * W + x]),
      levelsBefore,
      levelsAfter: levelsAlong(33, 48, 45),
      rail: railAlong(33, 48, 45),
    };
  },
  /** EMULATED stored decks: ramps of platforms one level apart on flat land, stone and wood. */
  async rampOnLand() {
    emulateStoredDecks();
    const ramp = [1, 2, 3, 4, 4, 4, 4, 3, 2, 1];
    for (const [y, id] of [
      [60, 'bridge_stone'],
      [64, 'bridge_wood'],
    ]) {
      platforms(32, 41, y, id);
      ramp.forEach((d, i) => decks.set(y * W + 32 + i, d));
      lay(28, 45, y);
    }
    g.railsDirty = true;
    await view(36.5, 62, 3);
    return { rail: railAlong(28, 45, 60), terrain: levelsAlong(28, 45, 60) };
  },
  /** EMULATED stored decks: a deck two levels up over a lake, one level up on each bank tile. */
  async raisedOverWater() {
    emulateStoredDecks();
    stampRect(33, 74, 38, 82, 3);
    retile(33, 74, 38, 82);
    platforms(32, 39, 78, 'bridge_stone');
    [1, 2, 2, 2, 2, 2, 2, 1].forEach((d, i) => decks.set(78 * W + 32 + i, d));
    lay(28, 43, 78);
    g.railsDirty = true;
    await view(35.5, 78, 3);
    return { rail: railAlong(28, 43, 78), terrain: levelsAlong(28, 43, 78) };
  },
  /** EMULATED: one raised tile in the middle of a level land bridge (a hump), and a step of two. */
  async humpAndJump() {
    emulateStoredDecks();
    platforms(32, 36, 92, 'bridge_stone');
    [0, 0, 1, 0, 0].forEach((d, i) => decks.set(92 * W + 32 + i, d));
    lay(29, 39, 92);
    platforms(44, 48, 92, 'bridge_stone');
    [2, 2, 2, 2, 2].forEach((d, i) => decks.set(92 * W + 44 + i, d));
    lay(41, 51, 92);
    g.railsDirty = true;
    await view(40, 92, 3);
    return { hump: railAlong(29, 39, 92), jump: railAlong(41, 51, 92) };
  },
};
window.qa = { g, scenes, view, settle, decks, stampRect, retile };

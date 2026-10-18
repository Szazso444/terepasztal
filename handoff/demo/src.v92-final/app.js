// ==== app: assets, the ground painter, sprites, camera, tooltips, legend

// ---------- the wind (v9): one weather and one wind for every effect that moves in it. A contract between the effects:
// they read WIND and windGust and never change them; only the Weather and Wind from switches (setWind) do.
//   WIND.level     'calm' | 'breeze' | 'windy' | 'storm' (the Weather switch; Breeze by default)
//   WIND.strength  0 | 0.35 | 0.7 | 1, by level: how hard it pushes. Calm is 0, and then nothing moves in the wind (the
//                  water keeps v8's own animation)
//   WIND.from      'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' (the Wind from switch; W by default), with north at
//                  the top of the screen and east to its right
//   WIND.to        { sx, sy }: the unit vector on screen the wind blows toward (screen y grows downward, so a wind from
//                  the north has sy = 1)
//   WIND.toTile    { x, y }: the same direction in tile coordinates, the unit ground vector whose picture on screen
//                  ((x - y) * 32, (x + y) * 16) points along WIND.to; a wind from the west blows toward +x, -y
// The object and its to and toTile are changed in place, so a reference kept to any of them stays current.
const WIND_STRENGTH = { calm: 0, breeze: 0.35, windy: 0.7, storm: 1 };
const WIND_FROM = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] }; // on screen
const WIND_NAMES = { N: 'the north', NE: 'the north-east', E: 'the east', SE: 'the south-east', S: 'the south', SW: 'the south-west', W: 'the west', NW: 'the north-west' };
const WIND = { level: 'breeze', strength: WIND_STRENGTH.breeze, from: 'W', to: { sx: 1, sy: 0 }, toTile: { x: Math.SQRT1_2, y: -Math.SQRT1_2 } };
// set the level, the direction or both (null keeps one); an unknown name throws and changes nothing
function setWind(level, from) {
  if (level != null && !(level in WIND_STRENGTH)) throw new Error(`no weather ${level}`);
  if (from != null && !(from in WIND_FROM)) throw new Error(`no wind from ${from}`);
  if (level != null) { WIND.level = level; WIND.strength = WIND_STRENGTH[level]; }
  if (from != null) {
    const [fx, fy] = WIND_FROM[from], l = Math.hypot(fx, fy);
    WIND.from = from; WIND.to.sx = -fx / l || 0; WIND.to.sy = -fy / l || 0;
    // the ground vector whose picture on screen points along to: x - y along sx / 32, x + y along sy / 16
    const tx = WIND.to.sx / 64 + WIND.to.sy / 32, ty = WIND.to.sy / 32 - WIND.to.sx / 64, lt = Math.hypot(tx, ty);
    WIND.toTile.x = tx / lt || 0; WIND.toTile.y = ty / lt || 0;
  }
  return WIND;
}
// windGust(px, py, t): how gusty the wind is at a world point at a time, 0..1. px, py are world pixels as the map is
// drawn (twc: x = (tx - ty) * 32, y = (tx + ty) * 16 less the level's lift), t the animation clock in seconds (draw's t,
// which __demo.freeze pins). Smooth bands of gusts and lulls travel downwind, at 40 world px a second in a breeze up to
// 240 in a storm; their fronts are bent across the wind, so no front is a straight line, and a slow swell across the
// wind makes each gust a patch rather than an endless band. The same field for every effect: a tree, a wave and a
// tumbleweed at one point feel the same gust at the same moment. It is the gust's shape, not its force: an effect
// multiplies by WIND.strength for how hard it pushes. 0 everywhere when calm.
function windGust(px, py, t) {
  const s = WIND.strength;
  if (!s) return 0;
  const sx = WIND.to.sx, sy = WIND.to.sy;
  const u = px * sx + py * sy - (40 + 200 * s) * t, v = py * sx - px * sy; // downwind (moving with the bands), across
  const a = Math.sin(u / 61 + 1.3 * Math.sin(v / 173 + t * 0.21)); // bands about 6 tiles apart
  const b = Math.sin(u / 37 + 1.7 + 0.9 * Math.sin(v / 97 - t * 0.17)); // and about 3.6 tiles apart
  const c = Math.sin(v / 251 + u / 409 + t * 0.05); // the swell across the wind
  const g = 0.5 + 0.27 * a + 0.13 * b + 0.1 * c; // 0..1
  return g * g * (3 - 2 * g); // soft lulls, soft crests
}

(async function main() {
  // the painter's hottest helpers (heightAt, vnoise) leave their result in UB and return nothing; a two-line wrapper
  // with the old name reads it. Called from the painter's large functions, which the engine does not inline them into,
  // a returned number cost a fresh heap allocation each time (the garbage collector alone took about a tenth of the
  // load); the wrappers are small enough to be inlined everywhere (fix round 1: load time)
  const UB = new Float64Array(16);
  const $ = (id) => document.getElementById(id);
  const SCALE = 2; // ground raster px per world px: the Codex pictures' own zoom
  const HOLD_MS = 2000, GRACE_MS = 350, SHOW_MS = 120;
  // the pointer must rest this long on a tile before its tooltip is worked out at all
  const ROOT_DELAY_MS = 400; let rootTimer = 0;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // roads: 'organic' (the Carcassonne-like set, the default) or 'measured' (the five variants, picked by width, edge and crossing)
  // anim: Water: Animated (v8's default) or Still (v7); a system that asks for reduced motion starts with Still
  const state = { redo: false, extras: false, biome: false, anim: !still, roads: 'organic', width: '0.32', edge: 'B', crossing: 'stone', raw: false, deck: 'wood', rbridges: 'on' };
  const VARIANTS = ['w0.32-B-timber', 'w0.25-B-timber', 'w0.4-B-timber', 'w0.32-A-timber', 'w0.32-B-stone'];
  // Codex varied one road choice at a time from the timber default; the author's default is the stone crossing
  const MEASURED_BASE = { width: '0.32', edge: 'B', crossing: 'timber' };
  const ORGANIC_LOOK = { width: '0.32', edge: 'B', crossing: 'stone' }; // what the organic set is drawn with
  const measured = () => `w${state.width}-${state.edge}-${state.crossing}`;
  const variant = () => (state.roads === 'organic' ? 'organic' : measured());

  const WORLD = buildWorld();
  const map = WORLD.map;
  const tileAt = (x, y) => (inb(x, y) ? map[idx(x, y)] : null);
  const T = (x, y) => map[idx(x, y)];

  // ---------- loading
  const tipEl = $('tip'), barEl = $('bar'), goBtn = $('go');
  const setBar = (f) => { barEl.style.width = `${Math.round(f * 100)}%`; barEl.parentElement.setAttribute('aria-valuenow', String(Math.round(f * 100))); };
  $('start-img').src = 'assets/screen-1.jpg';
  const fail = (msg) => { tipEl.textContent = msg; tipEl.classList.add('err'); };
  const loadImg = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error(`Could not load ${src}`)); im.src = src; });
  let DATA;
  const IMG = {};
  try {
    DATA = await (await fetch('assets/data.json')).json();
    const names = ['surfaces', 'swatches', 'pieces', 'roads', 'people', 'props', 'structures', 'decor', 'track'];
    let n = 0;
    await Promise.all(names.map((k) => loadImg(`assets/${k}.png`).then((im) => { IMG[k] = im; setBar((++n / names.length) * 0.15); })));
  } catch (e) {
    fail(`${e.message}. The page needs its assets folder beside it.`);
    return;
  }
  tipEl.textContent = 'Painting the ground from the game’s swatches and Codex’s…';
  const CX = {};
  for (const e of DATA.codex) CX[e.key] = e;
  const GAME = DATA.game;
  function pixels(im) {
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0);
    return { d: x.getImageData(0, 0, im.width, im.height).data, w: im.width, h: im.height };
  }
  const PX = { surfaces: pixels(IMG.surfaces), swatches: pixels(IMG.swatches), pieces: pixels(IMG.pieces), roads: pixels(IMG.roads) };

  // ---------- materials
  const M = { GRASS: 0, FOREST: 1, DESERT: 2, TAIGA: 3, WATER: 4, SAND: 5, ROCK: 6, CITY: 7, LAKE: 8, RIVERW: 9, BEACH: 10, WET: 11, BANK: 12, SNOW: 13, HIGHROCK: 14, ALPINE: 15, ICE: 16, MORAINE: 17, ROCKMIX: 20 };
  const SWATCH = { 8: 'swatch/lake-water', 9: 'swatch/river-water', 10: 'swatch/beach-sand', 11: 'swatch/wet-sand', 12: 'swatch/river-bank', 13: 'swatch/snow', 14: 'swatch/mountain-rock-high', 15: 'swatch/alpine-ground', 16: 'swatch/glacier-ice', 17: 'swatch/moraine' };
  const SWY = new Int32Array(32);
  for (const [m, k] of Object.entries(SWATCH)) SWY[m] = CX[k].y;
  const GAME_MAT = ['Grass', 'Forest', 'Desert', 'Taiga', 'Water', 'Sand', 'Rock', 'City paving'];
  const isWaterMat = (m) => m === M.WATER || m === M.LAKE || m === M.RIVERW;

  // noise
  const NT = new Float32Array(65536);
  { const r = makeRng(9001); for (let i = 0; i < NT.length; i++) NT[i] = r(); }
  function vnoise_(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = xi & 255, y0 = yi & 255, x1 = (x0 + 1) & 255, y1 = (y0 + 1) & 255;
    const a = NT[(y0 << 8) | x0], b = NT[(y0 << 8) | x1], c = NT[(y1 << 8) | x0], d = NT[(y1 << 8) | x1];
    { UB[1] = a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy; return; }
  }
  function vnoise(x, y) { vnoise_(x, y); return UB[1]; }
  // several noise samples in one call, for the painter's per-pixel ones: the points in VN_IN (x, y pairs), the values
  // into VN_OUT (each exactly vnoise's), with no number passed or returned per sample
  const VN_IN = new Float64Array(16), VN_OUT = new Float64Array(8);
  function vnoiseN(n) {
    for (let q = 0; q < n; q++) {
      const x = VN_IN[2 * q], y = VN_IN[2 * q + 1], xi = Math.floor(x), yi = Math.floor(y);
      let fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      const x0 = xi & 255, y0 = yi & 255, x1 = (x0 + 1) & 255, y1 = (y0 + 1) & 255;
      const a = NT[(y0 << 8) | x0], b = NT[(y0 << 8) | x1], c = NT[(y1 << 8) | x0], d = NT[(y1 << 8) | x1];
      VN_OUT[q] = a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy;
    }
  }
  const hash2 = (x, y, s) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const sstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

  // ---------- per-tile planes (rebuilt when a toggle changes the scene)
  const N = W * H;
  const Lv = new Float32Array(N);
  for (const c of map) Lv[c.i] = c.level;
  const MAT = new Int16Array(N), SNOWT = new Float32Array(N), RELIEF = new Uint8Array(N), COAST = new Uint8Array(N), OCEANSIDE = new Uint8Array(N);
  for (const c of map) {
    let rel = 0, coast = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const o = tileAt(c.x + dx, c.y + dy); if (o && o.level !== c.level) rel = 1; }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const o = tileAt(c.x + dx, c.y + dy); if (o && o.kind !== 'land' && o.kind !== 'glacier' && !o.pond && !o.cove) coast = 1; }
    RELIEF[c.i] = rel; COAST[c.i] = coast;
    for (const d of DIRS) { const o = tileAt(c.x + d.dx, c.y + d.dy); if (o && o.kind === 'ocean' && !o.cove) OCEANSIDE[c.i] |= d.bit; }
  }
  const armDown = { 29: 28, 30: 29, 31: 30, 32: 31 };
  // the side arm (Redo pieces) is Codex's raised glacier-strip-x picture: it has no place in the flat Ice channel
  const isGlacier = (c) => c.kind === 'glacier' || (state.redo && c.arm && glacierName !== 'channel');
  const downOf = (c) => (state.redo && c.arm ? idx(armDown[c.x], c.y) : c.down);

  // ---------- hills lab: relief and glacier options, switched at run time by setRelief(name) and setGlacier(name)
  // A relief option shapes the bank between two levels (bank: its width in tiles, centred on the shared
  // edge) and says how slopes, rims and the mountain are lit. One light, from the upper left: tops are brightest, a
  // side facing SW (screen left) is lighter than one facing SE.
  // v3 (the author, 2026-10-12): Game and Smooth (v1) are the direction, but the mountain's flank read as stacked stone
  // walls. The fix round (a critic of v3): each v2 option is its v1 everywhere but on the mountain. There stacked levels
  // join into one slope (stack: its slope at a tile centre, in levels per tile) and the flank is painted as ground
  // (mountainAt): darker facing SE, lighter facing SW, a soft break of slope under the plateau with a few crags, outcrops
  // with dark lower rims, and a scree fan with a contact shadow at its foot. Game v2 keeps the game's rock on every other
  // bank and has a rocky flank; Smooth v2 keeps Smooth (v1)'s grassy banks and an alpine flank with fewer outcrops. Fix
  // round 1 of the merged v3: the flank's value steps, the snow's drift line and its crag band (snowBrink).
  // v9 (the author, 2026-10-16: "Game v2 and Smooth v2 are the direction. The rest need not be rendered from now on"):
  // only these two are left, Game v2 the default; on the mountain's faces turned to the right of the screen each level
  // step is marked (rightSteps).
  const RELIEFS = {
    game2: { label: 'Game v2 (default): Game’s banks, the dressed stone ending in rubble and grass, soft lips on banks that look away; on the mountain one rocky slope instead of stone walls, each level step marked on its right-hand faces', bank: 0.5, stack: 0.6, v2: 'game' },
    smooth2: { label: 'Smooth v2: Smooth (v1), the game today, with soft lips on banks that look away; on the mountain one alpine slope with a few outcrops, each level step marked on its right-hand faces', bank: 0.5, stack: 0.8, v2: 'smooth' },
  };
  // A glacier option: as now, or a valley that steps down (GLACIER_PLAN) with the ice raised as a tongue
  // (ice: its surface above the valley floor, in levels) or lying in a channel between moraine banks.
  const GLACIERS = {
    demo: { label: 'As now: the glacier as v2 had it' },
    tongue: { label: 'Ice tongue: the ice raised, stepping down in ice cliffs', ice: 0.35, flank: 0 },
    channel: { label: 'Ice channel (default, the author’s choice): flat ice between moraine banks', ice: 0, flank: 0.3 },
  };
  // the author's choice (feedback 2026-10-12b, point 9): the ice channel is the default
  let reliefName = 'game2', glacierName = 'channel', RM = RELIEFS.game2, GM = GLACIERS.channel;
  // the glacier at x = 28 drops from level 4 to 3 at y = 6, its melt (and the stream it feeds) runs at level 2,
  // the spring beside the melt dries up, and the flanks drop with the ice; land then keeps the one-step rule
  const GLACIER_PLAN = { x: 28, steps: [[3, 5, 4], [6, 10, 3]], melt: [[28, 11], [27, 11], [26, 11], [25, 11]], meltLevel: 2, dry: [[28, 12]] };
  const KEEP = ['kind', 'terrain', 'biome', 'snow', 'headwater', 'level', 'fall', 'down'];
  const BASE = map.map((c) => KEEP.map((k) => c[k]));
  const VALLEY = new Uint8Array(N); // glacier options: 1 the ice, 2 its flank
  const FACEN = new Uint8Array(N); // tiles where a face may hang without the relief's own faces (levelPlan)
  const ICEW = new Float32Array(N); // 1 on the glacier options' ice tiles (where the warp of their edges is strongest)
  const ICEW_BOX = new Float64Array(4); // [x0, y0, x1, y1): the points whose ICEW blend may be above zero
  const ICEN = new Uint8Array(N); // v3: 1 within two tiles of a glacier option's ice (where the channel's moraine may lie)
  const EWX = new Float32Array(N), EWY = new Float32Array(N); // bank width of each tile's edge to its +x and +y neighbour
  // waterfalls (v3, the author's feedback of 12 October, afternoon: the vertical box looked 2D): the edge a river falls
  // over is a bank of its own, as steep as the relief's banks (half a tile for one level), and longer for a bigger drop
  // (0.8 tile for two levels), so the water sheet lies along the slope in the river's line (fallAt paints it). The
  // tiles either side of the fall keep steeper banks (0.25 tile), so the channel stays level across its width.
  const FALLE = new Uint8Array(N); // per tile: bit 1 its +x edge, bit 2 its +y edge is a fall
  const FALLT = new Uint8Array(N); // the two tiles of a fall
  const FALLWE = new Float32Array(N * 2); // the bank width of the fall over each tile's +x and +y edge
  const FALLL = new Array(N).fill(null); // the falls each tile takes part in (as the upper or the lower tile)
  const FALLP = new Array(N).fill(null); // fix round 2: and the tiles either side of those, where its spray and pool reach
  const RVSTEP = new Uint8Array(N); // river tiles in a step to another river tile with no fall between them
  // round 3: a river tile's sides toward land at another level with no fall over them (bits 1 +x, 2 -x, 4 +y, 8 -y;
  // shoreCap), and the river tiles by such a side, a fall, a step or wet rock (RWILD: their waterline wanders more and
  // their margin is rock and moss; RNAR: a fall's own, where it wanders inward only)
  const RSIDE = new Uint8Array(N), RWILD = new Float32Array(N), RNAR = new Float32Array(N);
  // round 4: the lips beside a river on the mountain (lipBand), each side of a river tile toward ground at another level
  // (RSIDE) listed on the tiles round it: [axis (0: the edge runs along y, at x = c; 1: along x, at y = c), c, its
  // middle along the edge, sign (+1: the other ground lies toward +), where its break of slope lies (tiles from the edge,
  // + toward the other ground), a seed, how much further the band reaches (a drop: down the slope to its wet rock)]
  const LIPE = new Array(N).fill(null);
  const FALLB = new Uint8Array(N); // a far fall's two tiles (2) and the lower land beside them (1): their banks' wet rock
  const WETN = new Uint8Array(N); // (and the tiles where wetAt may be above zero)
  const WETT = new Float32Array(N); // fix round 2: how wet each tile's banks are (FALLB, RVSTEP), blended between tiles (wetAt)
  const FALLN = new Array(N).fill(null); // the falls within about three tiles (their ground turns mossy: sampleSpecial)
  const TREEN = new Uint8Array(N); // the trees standing on each tile (buildScene)
  const MOSSF = new Float32Array(N); // 1 on taiga ground and on forest tiles left without trees (buildScene)
  let FALLS = [];
  // fix round of v8: per ground raster column, the records of the near falls' painted points there (fallRec); set up
  // again (fallRecSetup) whenever the falls are planned again
  let FREC_COL = null;
  const fallWidth = (d) => Math.min(0.9, Math.max(0.42, RM.bank) * (d > 1 ? 1.6 : 1));
  function fallPlan() {
    FALLE.fill(0); FALLT.fill(0); FALLWE.fill(0); FALLL.fill(null); FALLP.fill(null); FALLS = []; FREC_COL = null;
    for (const c of map) {
      if (!c.fall || c.down < 0) continue;
      const n = map[c.down], dx = n.x - c.x, dy = n.y - c.y;
      const own = dx > 0 || dy > 0 ? c : n, bit = dx !== 0 ? 1 : 2;
      const edge = dx > 0 ? 'se' : dy > 0 ? 'sw' : dx < 0 ? 'nw' : 'ne', d = Math.min(4, c.fall);
      const zHi = Lv[c.i] * LEVEL, zLo = Lv[n.i] * LEVEL, w = fallWidth(d);
      // near: the slope faces the view (over a SE or SW edge); a fall over a far edge drops away from it
      const near = edge === 'se' || edge === 'sw';
      const f = { c, n, edge, d, w, near, sheet: near ? `water/face-fall-sheet-${edge === 'sw' ? 'lit' : 'shade'}` : null,
        mx: (c.x + n.x) / 2, my: (c.y + n.y) / 2, dx, dy, zHi, zLo, uo: (c.x * 37 + c.y * 19) % 64, box: null, frames: null };
      // the part of the screen the fall needs clear of trees: the slope from its brink to its foot and the foam
      // beyond it, across the channel and its banks
      const bx = [], by = [];
      for (const al of [-w / 2 - 0.1, w / 2 + 0.6]) for (const ac of [-0.5, 0.5]) { const px = f.mx + dx * al - dy * ac, py = f.my + dy * al + dx * ac; bx.push((px - py) * 32); by.push((px + py) * 16 - (al < 0 ? zHi : zLo)); }
      f.box = [Math.min(...bx) - 4, Math.min(...by) - 6, Math.max(...bx) + 4, Math.max(...by) + 6];
      FALLE[own.i] |= bit; FALLT[c.i] = 1; FALLT[n.i] = 1; FALLWE[own.i * 2 + bit - 1] = w; FALLS.push(f);
      (FALLL[c.i] ||= []).push(f); (FALLL[n.i] ||= []).push(f);
      for (const q of [c, n]) for (const sd of [0, -1, 1]) { const o = sd ? tileAt(q.x - sd * dy, q.y + sd * dx) : q; if (o && !(FALLP[o.i] ||= []).includes(f)) FALLP[o.i].push(f); }
    }
  }
  // A fall's water, at a point of the upper or the lower tile (z: the ground's height there). Fix round of v3 (the
  // critic: cut-out sides, saw-toothed streak ends, a beige plank at the foot, a hump at the brink, sheets wider than the
  // river, a white blob over a far edge). The sheet is exactly as wide as the river's own water (riverAt's waterline),
  // its sides wandering down the fall line; beside it the bank is wet, darker rock with spray drifting over it. It
  // starts at the brink as the river's own smooth, dark water and breaks into soft white streaks toward the foot, where
  // white foam fans out down the river in tongues over darker pool water, with a few rings of ripples past it. A fall
  // over a far edge, whose slope looks away, bends over a curved lip into white water, with mist rising past it and the
  // river below starting paler, with foam (fix round 1; see the branch below and fallMist). ph moves the water down the slope (sheet texels; the Animated water's frames: with moving false, a near fall's whole
  // picture with its sheet and foam moved on, nearFrame). moving: only what moves (a far fall's foam flecks, for its
  // frames). Leaves the colour in FA[0..2] and how much it covers in FA[3].
  const FA = new Float64Array(4), SHEET_LIT = CX['water/face-fall-sheet-lit'], SHEET_SHADE = CX['water/face-fall-sheet-shade'];
  // the river's waterline at a point: half its water's width (tiles), wandering as riverAt draws it
  // (fix round of v3: it wanders twice as far, so the two banks are never parallel and the channel never ruled)
  const wline = (tx, ty) => 0.35 + (vnoise(tx * 3.1 + 19, ty * 3.1 + 41) - 0.5) * 0.16 + (vnoise(tx * 9.3 + 7, ty * 9.3 + 23) - 0.5) * 0.05;
  // Round 3 (the critic: river lips above the drops ran ruler-straight along the tile grid, at 22.5,11, 29.5,13 and
  // 28,12): by a fall, a step, wet rock or a side toward land at another level (RWILD, blended between tile centres) the
  // waterline wanders twice as far; and on a side toward land at another level (RSIDE) the water keeps 0.27 to 0.39 tile
  // off the tile's edge, so a wandering bank of rock and moss (riverAt) lies between it and the drop or the rise, where a
  // lip would have cut it on a ruled line. shoreCap: how far past that limit a point is (tiles; -9 on no such side). Each
  // side's limit fades out over the half tile next to a neighbour without one, so the water never steps at a tile edge.
  const wlineX = (tx, ty) => {
    const rw = bil(RWILD, tx, ty);
    if (rw <= 0) return wline(tx, ty);
    let e = (vnoise(tx * 3.6 + 11, ty * 3.6 + 2) - 0.5) * 0.26 + (vnoise(tx * 9 + 5, ty * 9 + 17) - 0.5) * 0.1;
    if (e > 0) { const nr = bil(RNAR, tx, ty); if (nr > 0) e *= 1 - nr; } // (on a fall's tiles inward only)
    return wline(tx, ty) + rw * e;
  };
  function shoreCap(tx, ty) {
    const i = Math.round(tx) | 0, j = Math.round(ty) | 0;
    if (i < 0 || j < 0 || i >= W || j >= H) return -9;
    const t = j * W + i, la = tx - i, lb = ty - j, sx = la > 0 ? 1 : -1, sy = lb > 0 ? 1 : -1;
    // the bits of the neighbours along each edge (toward the point's side of the tile)
    const nx = i + sx >= 0 && i + sx < W ? RSIDE[t + sx] : 0, ny = j + sy >= 0 && j + sy < H ? RSIDE[t + sy * W] : 0, b = RSIDE[t];
    if (!b && !nx && !ny) return -9;
    const fx = 0.5 * sstep((Math.abs(la) - 0.2) / 0.3), fy = 0.5 * sstep((Math.abs(lb) - 0.2) / 0.3);
    SC_M = 0.27 + 0.08 * vnoise(tx * 5.1 + 3, ty * 5.1 + 7) + 0.04 * vnoise(tx * 12 + 1, ty * 12 + 5); SC_D = -9;
    // an x side runs along y: blended with the neighbour along y; a y side with the neighbour along x
    scSide(1, 0.5 - la, fy, b, ny); scSide(2, 0.5 + la, fy, b, ny); scSide(4, 0.5 - lb, fx, b, nx); scSide(8, 0.5 + lb, fx, b, nx);
    return SC_D;
  }
  let SC_M = 0, SC_D = -9;
  function scSide(bit, e, f, b, nb) {
    const w0 = b & bit ? 1 : 0, w = w0 + ((nb & bit ? 1 : 0) - w0) * f;
    if (w > 0) { const q = SC_M - e - (1 - w) * 0.5; if (q > SC_D) SC_D = q; }
  }
  let fr = 0, fg = 0, fb = 0, fA = 0, FALL_WQ = 1; // FALL_WQ: how much of the painter's point is river water
  // fix round of v8 (the critic: the falls' loop jumped from its last frame to its first, and the moving frames lost
  // the approved still's foam and spray): a near fall's frames (nearFrame) are the still's own picture with ph > 0 and
  // moving false, the sheet's white streaks and the foam's clots sliding with the water (loopNoise), periodic over the
  // loop and exactly the still at its first frame. FMOV: how much of the point moves (the sheet, the foam). FB: the
  // ground at the painter's last point on a fall's tiles before the falls were laid over it, and its river water share
  // (shadeAt); FB_SEQ counts those points, so the painter's columns know which of their points had one (fallRec)
  let FMOV = 0, FB_SEQ = 0;
  const FB = new Float64Array(4);
  // a noise value at (x, y) that slides with the sheet: y = v * fy + c, v already ph texels up the sheet. Two samples a
  // loop (80 texels) apart, blended by how far into the loop ph is (the first is the still's own value at ph 0, the
  // second is it again at ph 80), and rescaled about the noise's mean so the blend keeps its contrast
  function loopNoise(x, y, ph, fy) {
    const a = vnoise(x, y);
    if (ph <= 0) return a;
    const w2 = ph / 80, w1 = 1 - w2;
    return 0.5 + (w1 * (a - 0.5) + w2 * (vnoise(x, y + 80 * fy) - 0.5)) / Math.sqrt(w1 * w1 + w2 * w2);
  }
  // round 3: how much a fall darkens the ground under it (its wet rock), applied to the ground before its water (so the
  // rock keeps its own detail: v3 laid a flat dark colour over it at a third, which read as a murky smear)
  let FALL_DK = 0;
  function fover(cr, cg, cb, ca) {
    if (ca <= 0) return;
    const na = fA + ca * (1 - fA);
    fr = (fr * fA * (1 - ca) + cr * ca) / na; fg = (fg * fA * (1 - ca) + cg * ca) / na; fb = (fb * fA * (1 - ca) + cb * ca) / na; fA = na;
  }
  // Round 3 (the critic: the spray was a grey, translucent blur that put the rock and moss under it out of focus): spray
  // is white and broken, small crisp clots about two world px across with a pale blue-grey underside, and specks of
  // droplets round them, measured on screen (so a steep bank does not stretch them), with dens (0 to 1) how many there
  // are; nothing in between is veiled. The point on screen: sx, sy (world px)
  function sprayAt(sx, sy, dens, seed, L) {
    if (dens <= 0.02) return;
    const pn = 0.66 * vnoise(sx * 0.32 + seed, sy * 0.38 + 3) + 0.34 * vnoise(sx * 0.75 + 7, sy * 0.85 + seed);
    const thr = 1.0 - 0.5 * dens, pf = sstep((pn - thr) / 0.035);
    const dp = sstep((vnoise(sx * 1.5 + 11, sy * 1.7 + seed) - 1.0 + 0.2 * dens) / 0.03) * 0.85;
    const a = pf > dp ? pf : dp;
    if (a <= 0) return;
    // a clot's core is white, its rim pale blue-grey
    const lit = pf > dp ? sstep((pn - thr - 0.02) / 0.06) : 1;
    const c = L * (0.84 + 0.16 * lit);
    fover(soft(234 * c, CAP_R), soft(240 * c, CAP_G), soft(242 * (c * 0.96 + 0.04 * L), CAP_B), a * 0.95);
  }
  function fallAt(f, tx, ty, z, ph, moving) {
    const rx = tx - f.mx, ry = ty - f.my, along = rx * f.dx + ry * f.dy, across = ry * f.dx - rx * f.dy, aa = across < 0 ? -across : across;
    const foot = f.w / 2, t = (along + foot) / f.w, fa = along - foot; // t: 0 at the brink, 1 at the foot; fa: past the foot
    FA[3] = 0; FALL_DK = 0; FMOV = 0;
    if (t < (f.near ? -0.3 : -0.62) || fa > 0.8 || aa > 0.72) return;
    const L = 1 + 0.06 * (z / LEVEL), tt = t < 0 ? 0 : t > 1 ? 1 : t;
    // how far past the side of the river's water (tiles), its edge wandering down the fall line, never a straight cut
    const sw = (vnoise(along * 9 + f.uo, across * 2 + 3) - 0.5) * 0.1 + (vnoise(along * 23 + 5, across * 6 + f.uo) - 0.5) * 0.045;
    const wl0 = wlineX(tx, ty), sc = shoreCap(tx, ty);
    let ed = aa - (wl0 - 0.02) - sw; if (sc > ed) ed = sc;
    fr = 0; fg = 0; fb = 0; fA = 0;
    // fix round 2 (the critic: no fall had a plunge pool; below the drop the river ran on as the same flat ribbon): where
    // a near fall lands, a pool a little wider than the river, round and ragged-edged, its water deep and dark under the
    // foam (pl: how much of the point is pool beyond the river's own water)
    let pl = 0;
    if (f.near && fa > -0.14 && fa < 0.62) {
      const pw = wl0 + 0.1 + 0.05 * vnoise(along * 6 + f.uo, across * 5 + 2);
      let pc = fa - 0.1;
      // Round 5 (the critic: at 33.5,17, where the river turns below the fall, the pool's far end lay on the bank and cut
      // its foam in one long straight diagonal): over the bank (not the river's own water, where its rim stays as it was)
      // the pool's far end wanders in lobes, the bank reaching into the foam in tongues of different lengths (on the
      // hills; the mountain's falls keep their pools)
      if (pc > 0 && fallOnHill(f)) {
        const lw = sstep(pc / 0.12) * (moving ? 1 : 1 - FALL_WQ);
        // (it only draws back, so the pool's sides, which run along the river, never show longer than they did)
        // (and ragged at a finer scale, so no stretch of it is ruled)
        if (lw > 0) {
          const sx = (tx - ty) * 32, sy = (tx + ty) * 16 - z;
          pc += lw * (0.07 + 0.18 * sstep((vnoise(across * 8 + f.uo + 13, 5.9) - 0.3) / 0.4) + (vnoise(sx * 0.22 + 3, sy * 0.38 + f.uo) - 0.5) * 0.16 + (vnoise(sx * 0.6 + f.uo, sy * 0.9 + 5) - 0.5) * 0.07);
        }
      }
      const pe = (pc / (pc < 0 ? 0.2 : 0.26)) ** 2 + (aa / pw) ** 2;
      // (round 3: its edge crisp and ragged; v3 faded it out over a fifth of a tile, a dark veil over the bank)
      pl = 1 - sstep((pe - 0.86 + (vnoise(tx * 11 + 3, ty * 11 + f.uo) - 0.5) * 0.3) / 0.07);
    }
    if (f.near) {
      // the slope's extent along the fall line, its ends wandering so the wet rock and the spray never end on a rule
      const ew = (vnoise(across * 7 + f.uo, 2.1) - 0.5) * 0.16;
      const onSlope = sstep((t + 0.06 + ew) / 0.14) * (1 - sstep((t - 1.0 - ew) / 0.14));
      // beside the sheet: wet, darker rock, a ragged band with a crisp edge (round 3: the rock's own detail kept, FALL_DK)
      if (!moving && ed > -0.05 && onSlope > 0) {
        const bw = 0.05 + 0.1 * vnoise(along * 8 + 3, across * 4 + f.uo) + (vnoise(along * 23 + 5, across * 9 + f.uo) - 0.5) * 0.04;
        const dk = onSlope * sstep((ed + 0.03) / 0.04) * (1 - sstep((ed - bw) / 0.02)) * 0.28;
        if (dk > FALL_DK) FALL_DK = dk;
      }
      // the sheet, in the slope's own frame: u across the channel, v the screen texels below the brink line
      const k = (1 - sstep((ed + 0.012) / 0.03)) * sstep((t + 0.03) / 0.1) * (1 - sstep((t - 1.03) / 0.08));
      if (k > 0) {
        const u = -across * 64 + f.uo, v = 2 * ((along + foot) * 16 + f.zHi - z) - ph;
        const e = f.edge === 'sw' ? SHEET_LIT : SHEET_SHADE, pd = PX.pieces.d;
        const o = ((e.y + (((Math.floor(v) % 80) + 80) % 80)) * PX.pieces.w + e.x + (((Math.floor(u) % 64) + 64) % 64)) * 4;
        let r = pd[o] * L, g = pd[o + 1] * L, b = pd[o + 2] * L;
        // at the brink it is still the river's own water, smooth and darker, before it breaks
        const glass = (1 - sstep((t - 0.04) / 0.3)) * 0.6;
        r += (60 * L - r) * glass; g += (126 * L - g) * glass; b += (134 * L - b) * glass;
        // white water: streaks that ride down with the sheet, more of them toward the foot, their ends soft (fix round of
        // v8: loopNoise, so they come round to where they started after a loop of the frames; at ph 0 the still's own)
        const nw = loopNoise(u * 0.17 + f.c.x * 7, v * 0.035 + f.c.y * 5, ph, 0.035) + 0.35 * loopNoise(u * 0.5 + 3, v * 0.09 + 1, ph, 0.09);
        const wh = Math.min(1, sstep((t - 0.18) / 0.6) * (0.3 + 0.7 * sstep((nw - 0.5) / 0.45)));
        const wl = L * (0.95 + 0.08 * loopNoise(u * 0.3, v * 0.2 + 9, ph, 0.2));
        r += (soft(224 * wl, CAP_R) - r) * wh * 0.85; g += (soft(236 * wl, CAP_G) - g) * wh * 0.85; b += (soft(232 * wl, CAP_B) - b) * wh * 0.85;
        fover(r, g, b, k);
        if (k > FMOV) FMOV = k;
      }
      // spray drifting off both sides of the drop over the wet rock and the banks, widening toward the foot, where it
      // billows out over the pool's edge (fix round 2: it softens both banks beside the drop)
      if (!moving && ed > -0.08) {
        const reach = 0.04 + 0.13 * tt + 0.06 * vnoise(along * 5 + f.uo, across * 3 + 7) + (fa > 0 ? 0.07 * (1 - sstep(fa / 0.3)) : 0);
        const on = sstep((t + 0.1 + ew) / 0.2) * (1 - sstep((fa - 0.2) / 0.2));
        // white and broken (sprayAt), densest by the sheet near its foot, thinning out over the bank
        let dens = on * (0.42 + 0.8 * tt) * sstep((ed + 0.08) / 0.05) * (1 - sstep((ed - reach * 0.4) / (reach * 0.6 + 0.02)));
        if (dens > 1) dens = 1;
        sprayAt((tx - ty) * 32, (tx + ty) * 16 - z, dens, f.uo, L);
      }
    } else if (!moving) {
      // Over a far edge, whose drop faces away (fix round 1; the critic: a ruler-straight dashed white line across a
      // flat ribbon, no drop to see): the lip curves back upstream toward both banks, so it follows the river's own
      // waterline instead of a line ruled across it. Upstream of it the water darkens and speeds up, and bends over the
      // lip in a soft glassy light; past the lip it breaks into white water, and below (fallMist) mist rises and the
      // lower river starts paler, churned into a pool of foam. (Fix round 2: no streaks upstream; they read as dotted
      // tick marks.)
      const rel = aa / (wl0 > 0.1 ? wl0 : 0.1), inW = 1 - sstep((ed + 0.01) / 0.04);
      // Round 4 (the critic: at 23,11 and 26,3 the lip was a ruler-straight teal diagonal along the tile edge, and at
      // zoom 2 the fall at 23,11 read as a thin white line across the river, like a weir): the lip wanders up and down
      // the river (farLip), never below the brink; white tongues of very different lengths run into it; the white goes on
      // down the whole face (v3 left a strip of the river's teal between the white at the lip and the white at the foot);
      // one or two wet rocks break it, and spray rises past it in uneven puffs
      const lipT = farLip(f, across, rel), u = t - lipT; // u > 0 past the lip
      let oc = inW > 0 && t < 0.45 ? farOcc(tx, ty, z) : 1;
      // round 5 (the critic: a straight, lighter crease through the white along the brink at 23,11): on the face itself
      // the higher ground just in front of it is the brink it drops from, which does not hide it (the face is seen, edge
      // on); there the white thins out only where something is truly about to hide it (FO_HIDE: px from hidden)
      if (oc < 1 && t > 0) { const o2 = 1 - sstep((FO_HIDE + 1.2) / 1.2); if (o2 > oc) oc += (o2 - oc) * sstep(t / 0.1); }
      if (inW > 0 && t < 0.45) {
        const fast = sstep((u + 0.4) / 0.28) * (1 - sstep(u / 0.02));
        if (fast > 0) fover(26 * L, 70 * L, 80 * L, fast * 0.42 * inW);
        const bend = sstep((u + 0.075) / 0.05) * (1 - sstep((u - 0.004) / 0.02)), tear = sstep((vnoise(across * 30 + 11, f.uo + 0.5) - 0.3) / 0.3);
        if (bend > 0) fover(soft(168 * L, CAP_R), soft(214 * L, CAP_G), soft(212 * L, CAP_B), bend * (0.3 + 0.4 * tear) * inW);
        // Round 3 (the critic: at 26,3 the water past the white band ended in a rounded blob, so it read as the river
        // ending, not dropping away): white tongues run along the flow into the lip, more of them and wider toward it,
        // and on over it; round 4: how far upstream they reach wanders across the river, from about a tenth of a tile to
        // two thirds
        // (a white rim right at the lip, so the brink is white water against white water, not a stepped line between the
        // pool and the foam)
        const R = 0.1 + 0.56 * sstep((vnoise(across * 2.6 + f.uo + 11, 5.3) - 0.3) / 0.45);
        const tg = sstep((u + R) / (0.8 * R)) * (1 - sstep((u - 0.03) / 0.05));
        if (tg > 0) {
          const tn = vnoise(across * 22 + f.uo, u * 2.4 + 5) + 0.35 * vnoise(across * 53 + 3, u * 5.5 + f.uo);
          let tw = sstep((tn - 1.12 + 0.8 * tg) / 0.035) * tg;
          // and broad pillows of white water piled up over the lip, reaching upstream by different lengths
          const pil = sstep((u + 0.03 + 0.17 * sstep((vnoise(across * 5.5 + f.uo, 1.3) + 0.3 * vnoise(across * 13 + 3, u * 6 + f.uo) - 0.62) / 0.3)) / 0.03);
          if (pil > tw) tw = pil;
          const rim = sstep((u + 0.07 + (vnoise(across * 31 + f.uo, 9.1) - 0.5) * 0.06 + (vnoise(across * 12 + f.uo, 2.9) - 0.5) * 0.1) / 0.025) * (1 - sstep((u - 0.03) / 0.05));
          if (rim > tw) tw = rim;
          const wl = L * (0.93 + 0.08 * vnoise(across * 40 + 2, u * 12));
          if (tw > 0) fover(soft(222 * wl, CAP_R), soft(234 * wl, CAP_G), soft(232 * wl, CAP_B), tw * 0.94 * inW * oc);
        }
        // the white water tumbling over, broken into clots, on down the face to where its streaks take over (v3 stopped it
        // short of them, which left the river's teal between them in a ruled line)
        const ww = sstep(u / 0.025) * (1 - sstep((t - 0.34) / 0.08));
        if (ww > 0) {
          const cl = sstep((vnoise(across * 19 + f.uo, u * 14 + 2) + 0.45 * vnoise(across * 43 + 7, u * 30 + f.uo) - 0.62) / 0.3), wl = L * (0.92 + 0.1 * vnoise(tx * 15 + 5, ty * 15));
          // Round 5 (the critic: at 23,11 a straight, lighter crease ran through the white along the brink, where the face,
          // seen nearly edge on, kept only half of this white): on the face it is nearly solid, in clots measured on screen
          // (the face's rows are squeezed into a few px, so a pattern along the fall line would draw a line along the brink)
          let cov = 0.55 + 0.42 * cl;
          const face = sstep((t - 0.03) / 0.08);
          if (face > 0) {
            const sx = (tx - ty) * 32, sy = (tx + ty) * 16 - z, cs = sstep((vnoise(sx * 0.33 + f.uo, sy * 0.62 + 3) + 0.4 * vnoise(sx * 0.85 + 7, sy * 1.5 + f.uo) - 0.62) / 0.3);
            const cf = face * (0.86 + 0.12 * cs);
            if (cf > cov) cov = cf;
          }
          fover(soft(220 * wl, CAP_R), soft(233 * wl, CAP_G), soft(230 * wl, CAP_B), ww * cov * inW * oc);
        }
      }
      // round 3: the lower part of the drop's face, which shows from the view past the lip: the water landing, white,
      // streaked down the fall line (v3 left the river's picture there, a dark teal band between the lip and the foam)
      // (round 5: it takes over from the white above it in a wandering line, from nothing, so no row of the face steps)
      // (and gives way to the foam below in a wandering line too)
      if (inW > 0 && t > 0.2 && fa < 0.14) {
        const lw = sstep((t - 0.2 - 0.1 * vnoise(across * 6.5 + f.uo, 2.2)) / 0.14) * (1 - sstep((fa - 0.07 * vnoise(across * 7.5 + f.uo, 6.3)) / 0.05));
        if (lw > 0) {
          const st = vnoise(across * 26 + f.uo, t * 2.2 + 3) + 0.3 * vnoise(across * 61 + 5, t * 5 + f.uo), wl = L * (0.88 + 0.14 * sstep((st - 0.55) / 0.3));
          // (round 5: its gaps are clots measured on screen too, not dots in a row along the brink)
          const sx = (tx - ty) * 32, sy = (tx + ty) * 16 - z, cs = sstep((vnoise(sx * 0.33 + 5, sy * 0.62 + f.uo) + 0.4 * vnoise(sx * 0.85 + f.uo, sy * 1.5 + 9) - 0.62) / 0.3);
          fover(soft(220 * wl, CAP_R), soft(233 * wl, CAP_G), soft(232 * wl, CAP_B), lw * (0.84 + 0.14 * cs) * inW);
        }
      }
      // spray thrown up from below over the lip, in puffs, so the brink is not a ruled line between the water above it
      // and the foam below it (fix round 2); round 4: thickest over the brink and the face, whose ruled edges it hides
      // (its clots are measured on screen, so they run on unbroken where the river's own pattern jumps at the brink),
      // and over the wandering lip, thicker in some stretches than others
      // (over the face it drifts a little past the water's sides, whose line the face's slant draws straight)
      if (t > -0.6 && t < 0.9 && ed < 0.2) {
        const sb = sstep((t + 0.06) / 0.08) * (1 - sstep((t - 0.6) / 0.15)), sl = sstep((u + 0.16 + 0.06 * rel * rel) / 0.1) * (1 - sstep((u - 0.12) / 0.08));
        const sp = Math.max(sb * 0.7 * (1 - sstep((ed - 0.03 - 0.06 * vnoise(tx * 9 + 1, ty * 9 + f.uo)) / 0.08)), sl * 0.8 * (1 - sstep((ed - 0.02) / 0.08)));
        if (sp > 0) sprayAt((tx - ty) * 32, (tx + ty) * 16 - z, sp * (0.6 + 0.5 * vnoise(across * 4.3 + f.uo, 7.7)), f.uo + 17, L);
      }
      // round 4: one or two wet rocks in the lip, well inside the water (farRocks), dark and wet with a glint on top, a
      // collar of white water piled round them
      if (inW > 0.3 && u > -0.35 && u < 0.3) {
        const rks = f.rocks || (f.rocks = farRocks(f)), sx = (tx - ty) * 32, sy = (tx + ty) * 16 - z;
        for (let q = 0; q < rks.length; q++) {
          const R = rks[q], qx = (sx - R.sx) / R.rx, qy = (sy - R.sy) / R.ry;
          if (qx > 1.9 || qx < -1.9 || qy > 1.9 || qy < -1.9) continue;
          const m = bkD(R.sh, qx, qy) * R.ry, k = sstep((0.25 - m) / 0.5);
          const col = (1 - k) * sstep((1.9 - m) / 0.5) * sstep((vnoise(sx * 0.6 + R.sh, sy * 0.9 + 3) - 0.3) / 0.15);
          if (col > 0) fover(soft(224 * L, CAP_R), soft(235 * L, CAP_G), soft(232 * L, CAP_B), col * 0.9);
          if (k <= 0) continue;
          let nx = BKS[BK_E] / R.rx, ny = BKS[BK_E + 1] / R.ry; const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
          const dpx = -m, bw = R.ry * (0.12 + 0.55 * (ny > 0 ? ny : 0)), sideF = 0.86 - 0.3 * (0.55 * nx + 0.83 * ny) - 0.1 * (nx > 0 && ny > 0 ? nx : 0);
          const tw = sstep((dpx - bw) / 0.6), F = sideF + (1.06 - sideF) * tw, rim = ny > 0.15 || nx > 0.8 || nx < -0.8 ? 1 - sstep((dpx - 0.2) / 0.45) : 0;
          sampleMat(M.HIGHROCK, tx, ty, sx, sy);
          const d = 0.62 * F * (1 - 0.45 * rim) * L, gl = tw * sstep((vnoise(sx * 0.9 + 3, sy * 1.6 + 7) - 0.66) / 0.03) * sstep((-0.2 - qy) / 0.2);
          fover(V[0] * d - 8 + (196 * L - V[0] * d + 8) * gl * 0.8, V[1] * d - 6 + (208 * L - V[1] * d + 6) * gl * 0.8, V[2] * d * 0.96 - 6 + (206 * L - V[2] * d * 0.96 + 6) * gl * 0.8, k);
        }
      }
    }
    // where the water lands: white foam fanning down the river in tongues (farther in the middle), darker pool water
    // under and past it, and (near falls) a few rings of ripples
    if (fa > -0.14) {
      // only on the lower river's own water (a turn below the fall takes the foam with it): FALL_WQ, from the painter;
      // and on a near fall's pool
      let inCh = (1 - sstep((ed + 0.005) / 0.035)) * (moving || fa < 0 ? 1 : FALL_WQ);
      if (pl > inCh) inCh = pl;
      if (!f.near) inCh *= FAR_FRONT(f, across, wl0, tx, ty) * farOcc(tx, ty, z);
      const lob = (vnoise(across * 7 + f.uo, fa * 5 + 3) - 0.5) * 0.3 + (vnoise(across * 17 + 1, fa * 11 + f.uo) - 0.5) * 0.1;
      const reach = (f.near ? 0.2 : 0.12) + (f.near ? 0.3 : 0.24) * (1 - (aa < 0.35 ? aa / 0.35 : 1)) + lob;
      const dens = sstep((fa + 0.12) / 0.1) * (1 - sstep((fa - reach) / 0.14)) * inCh;
      if (!moving && fa > -0.06) {
        // the pool's deep water: over the bank ground beyond the river's own water too
        const deep = Math.max(inCh * sstep((fa + 0.04) / 0.08) * (1 - sstep((fa - 0.5) / 0.22)) * (f.near ? 0.42 : 0.3), pl * (1 - FALL_WQ) * 0.94);
        fover(26 * L, 66 * L, 78 * L, deep);
        if (f.near) {
          // a churned rim of foam round the pool's edge, broken up
          const rimF = Math.min(1, pl * (1 - pl) * 5) * sstep((vnoise(tx * 13 + f.uo, ty * 13 + 5) + 0.4 * vnoise(tx * 29 + 3, ty * 29 + 1) - 0.5) / 0.08) * (1 - FALL_WQ * 0.5);
          if (rimF > 0) fover(soft(222 * L, CAP_R), soft(234 * L, CAP_G), soft(232 * L, CAP_B), rimF * 0.92);
          // rings round where the water lands, broken up, fading out downstream
          const rd = Math.hypot(fa + 0.06, across * 0.9), rp = rd * 12 + 0.5 * vnoise(across * 6 + f.uo, fa * 4 + 2.3), ring = Math.abs(rp - Math.round(rp));
          const rk = inCh * sstep((fa - reach) / 0.06) * (1 - sstep((fa - 0.6) / 0.12)) * (1 - sstep(ring / 0.1)) * sstep((vnoise(across * 9 + 3, rd * 7) - 0.35) / 0.2);
          fover(soft(206 * L, CAP_R), soft(226 * L, CAP_G), soft(222 * L, CAP_B), rk * 0.26);
        }
      }
      // (round 3: the foam in crisp clots of white over the dark pool, not a translucent pale veil)
      const pat = (dr, o) => sstep((0.7 * vnoise(across * 11 + f.uo + o, dr * 9 + 3) + 0.5 * vnoise(across * 27 + o, dr * 21) - 0.5) / 0.09);
      let fo = 0;
      if (dens > FMOV) FMOV = dens;
      if (dens <= 0) fo = 0;
      else if (!moving && ph > 0) {
        // fix round of v8: in a near fall's frames the still's own clots drift off downstream, 0.32 tile a loop, a
        // second copy of them a loop further up taking over as the loop goes on (as loopNoise), so the foam is as crisp
        // and as white as the still's in every frame and comes back to it after a loop
        const pn = (dr, o) => 0.7 * vnoise(across * 11 + f.uo + o, dr * 9 + 3) + 0.5 * vnoise(across * 27 + o, dr * 21);
        const w2 = ph / 80, w1 = 1 - w2, dr = fa - 0.32 * w2;
        const n = 0.6 + (w1 * (pn(dr, 0) - 0.6) + w2 * (pn(dr + 0.32, 0) - 0.6)) / Math.sqrt(w1 * w1 + w2 * w2);
        fo = dens * (0.22 + 0.75 * sstep((n - 0.5) / 0.09));
      } else if (!moving) fo = dens * (0.22 + 0.75 * pat(fa, 0));
      else {
        // two layers drifting downstream half a cycle apart, each faded out as it starts over, so the loop never jumps;
        // a moving frame covers the sheet, so it carries the foam where the water lands; past the sheet only flecks
        const fleck = (dr, o) => sstep((vnoise(across * 15 + f.uo + o, dr * 13 + 4) + 0.4 * vnoise(across * 31 + o, dr * 27) - 0.86) / 0.16);
        const pa = (ph / 80) % 1, pb = (pa + 0.5) % 1, wa = 1 - Math.abs(2 * pa - 1), wb = 1 - wa, da = fa - pa * 0.32, db = fa - pb * 0.32;
        const q = fA * 4 < 1 ? fA * 4 : 1;
        const st = q > 0 ? dens * (0.45 + 0.55 * (wa * pat(da, 0) + wb * pat(db, 37))) : 0, fl = q < 1 ? 0.75 * dens * (wa * fleck(da, 0) + wb * fleck(db, 37)) : 0;
        fo = fl + (st - fl) * q;
      }
      if (fo > 0) { const wl = L * (0.93 + 0.12 * vnoise(tx * 15 + 5, ty * 15)); fover(soft(224 * wl, CAP_R), soft(235 * wl, CAP_G), soft(231 * wl, CAP_B), fo); }
    }
    if (!f.near && !moving && fa > -0.1) fallMist(f, tx, ty, z, fa, across, aa, ed, L, wl0);
    FA[0] = fr; FA[1] = fg; FA[2] = fb; FA[3] = fA;
  }
  // a far fall's lip (round 4): where along the fall (t) the water bends over, curving back upstream toward both banks
  // (rel: how far across the water, 0 in the middle, 1 at its edge) and wandering up and down the river by up to about
  // 0.2 tile, never past the brink
  function farLip(f, across, rel) {
    const l = -0.02 - 0.14 * rel * rel - 0.16 * sstep((vnoise(across * 3.4 + f.uo, 8.3) - 0.36) / 0.28) + (vnoise(across * 9 + f.uo, 3.7) - 0.5) * 0.07;
    return l < 0.01 ? l : 0.01;
  }
  // a far fall's rocks in its lip (round 4): one or two, at a place across the river from the fall's own hash, their
  // middle on the lip just upstream of where it bends over; on screen (world px) with their radii and shape (blocksAt's)
  function farRocks(f) {
    const out = [], n = hash2(f.c.x, f.c.y, 611) < 0.55 ? 2 : 1, foot = f.w / 2;
    for (let k = 0; k < n; k++) {
      const ac = (k ? -1 : 1) * (0.06 + 0.16 * hash2(f.c.x, f.c.y, 612 + k)), wl = wlineX(f.mx, f.my), lip = farLip(f, ac, Math.abs(ac) / (wl > 0.1 ? wl : 0.1)) - 0.015;
      const al = lip * f.w - foot, cx = f.mx + al * f.dx - ac * f.dy, cy = f.my + al * f.dy + ac * f.dx, rx = 3.2 + 2.2 * hash2(f.c.x, f.c.y, 614 + k);
      out.push({ sx: (cx - cy) * 32, sy: (cx + cy) * 16 - f.zHi - 0.6, rx, ry: rx * (0.58 + 0.12 * hash2(f.c.x, f.c.y, 616 + k)), sh: Math.floor(hash2(f.c.x, f.c.y, 618 + k) * 64) });
    }
    return out;
  }
  // a far fall's water toward the bank in front of it (the side nearer the view): it thins out before the waterline
  // in a ragged line, so the white never reaches the front bank's lip, which hides the river behind it on a straight
  // line (fix round 2: the white at 26,3 ended in a straight diagonal cut against the rock)
  function FAR_FRONT(f, across, wl0, tx, ty) {
    const fs = -f.dy + f.dx >= 0 ? 1 : -1, af = across * fs; // af > 0 toward the front bank
    return 1 - sstep((af - wl0 + 0.16 + (vnoise(tx * 9 + 3, ty * 9 + f.uo) - 0.5) * 0.12) / 0.1);
  }
  // and its white thins out where higher ground just in front of it on screen is about to hide it, so a lip in front
  // never cuts through white water on a ruled line (1: in the clear)
  let FO_HIDE = 0;
  function farOcc(tx, ty, z) {
    const n = (vnoise(tx * 10 + 7, ty * 10 + 1) - 0.5) * 0.08, q1 = heightAt(tx + 0.1 + n, ty + 0.1 + n) - z, q2 = heightAt(tx + 0.2 + n, ty + 0.2 + n) - z;
    // (round 5: how near the ground in front comes to hiding the point, in px on screen; above 0 it is hidden)
    FO_HIDE = Math.max(q1 - 32 * (0.1 + n), q2 - 32 * (0.2 + n));
    return 1 - sstep((Math.max(q1 - 1, q2 - 4.4) + 0.5) / 2.5);
  }
  // a fall over a far edge, past its foot (fix round 1): the drop faces away, so what shows it is what rises from it.
  // The lower river starts paler (aerated) and churned into broken white water just past where the lip hides the drop;
  // mist rises off it, thickest there and drifting a little over the banks, thinning out downstream. Fix round 2 (the
  // critic: the white water seemed to fall into a hole; at 26,3 a straight white strip): the churned water is a pool of
  // foam, longest in the middle (a crescent, not a strip), on the lower river's own water (FALL_WQ), and spray drifts
  // over the front bank's lip beside it, so that lip is not a straight cut through white
  function fallMist(f, tx, ty, z, fa, across, aa, ed, L, wl0) {
    const oc = farOcc(tx, ty, z), inCh = (1 - sstep((ed + 0.005) / 0.035)) * (fa < 0.05 ? 1 : FALL_WQ), front = FAR_FRONT(f, across, wl0, tx, ty) * oc;
    const rel = aa / (wl0 > 0.1 ? wl0 : 0.1);
    // (round 5: it comes in over the face's lowest rows in a wandering line, with the foam, not at once along a row of
    // the face, where it drew a pale straight crease through the white at 23,11)
    const pale = inCh * (1 - sstep((fa - 0.35 + 0.15 * rel * rel) / 0.45)) * sstep((fa + 0.1 - 0.08 * vnoise(across * 9 + f.uo, 4.1)) / 0.1);
    if (pale > 0) fover(132 * L, 190 * L, 190 * L, pale * 0.38);
    if (fa > 0) {
      const end = 0.34 + 0.14 * vnoise(across * 8 + f.uo, 1.3) - 0.2 * rel * rel;
      const ch = inCh * front * sstep((fa - 0.02) / 0.05) * (1 - sstep((fa - end) / 0.12));
      if (ch > 0) {
        const cl = sstep((vnoise(across * 17 + f.uo, fa * 16 + 5) + 0.45 * vnoise(across * 38 + 3, fa * 33 + f.uo) - 0.58) / 0.3), wl = L * (0.93 + 0.1 * vnoise(tx * 13 + 2, ty * 13));
        fover(soft(222 * wl, CAP_R), soft(234 * wl, CAP_G), soft(231 * wl, CAP_B), ch * (0.45 + 0.5 * cl));
      }
    }
    // mist rising off the pool and drifting over both banks, the front bank's lip included
    const fs = -f.dy + f.dx >= 0 ? 1 : -1, af = across * fs;
    const side = 1 - sstep((ed - 0.03 - (af > 0 ? 0.2 : 0.1) * (1 - sstep((fa - 0.1) / 0.3))) / 0.12);
    // (round 3: white and broken, as the near falls' spray)
    const mist = side * sstep((fa + 0.08) / 0.08) * (1 - sstep((fa - 0.24) / 0.4)) * (0.7 + 0.3 * vnoise(tx * 7 + 3, ty * 7 + f.uo)) * (1 + 0.3 * (1 - sstep(fa / 0.2)));
    sprayAt((tx - ty) * 32, (tx + ty) * 16 - z, mist > 1 ? 1 : mist, f.uo + 29, L);
  }
  // Round 5 (the critic: at 19,7.5 and 22,12.5 the bank in front of the plunge pool, a level higher, hid the pool behind
  // its lip, and that lip sliced the white foam in one long ruled diagonal along the tile grid, bright green against
  // white): a near fall's pool hidden behind higher ground in front of it has that lip found once, on screen (nearLip:
  // for each world px column across the pool, the screen y where the bank's top hides the pool, the lip's height, and how
  // white the pool is just behind it), and the foam spills over the lip (lipSpill): white and broken, in lobes of very
  // different lengths over the bank's top, with spray past them and a wet, darker margin in the grass beyond, and white
  // on just behind the lip too, so the lip runs inside the white and the white meets the green along a wandering edge;
  // two or three wet rocks sit on the lip itself, half over the pool and half on the bank, a collar of foam round them.
  function nearLip(f) {
    f.lip = null;
    if (!fallOnHill(f)) return null; // (the mountain's falls keep the lips of round 4: wet rock and moss)
    const al = f.w / 2 + 0.1, px = f.mx + f.dx * al, py = f.my + f.dy * al, sP = px + py, x0 = Math.round((px - py) * 32) - 56, n = 113;
    const ys = new Float32Array(n).fill(NaN), zb = new Float32Array(n), wk = new Float32Array(n), keep = FALL_WQ;
    let any = 0;
    FALL_WQ = 1;
    for (let c = 0; c < n; c++) {
      const d = (x0 + c) / 32;
      let H = 1e9, zl = 0, zB = 0, hid = false;
      // down the column from the front: a ground point shows only if nothing in front of it takes a screen y above
      // its own, so where the ground drops behind a lip it is hidden until it lies above that lip on screen
      for (let s = sP + 1.6; s >= sP - 1.2; s -= 0.012) {
        const tx = (s + d) / 2, ty = (s - d) / 2, z = heightAt(tx, ty), sy = 16 * s - z;
        if (sy < H) {
          if (hid) {
            hid = false;
            const rx = tx - f.mx, ry = ty - f.my, fa = rx * f.dx + ry * f.dy - f.w / 2, ac = ry * f.dx - rx * f.dy;
            if (zB - z > LEVEL * 0.4 && fa > -0.2 && fa < 0.75 && ac > -0.75 && ac < 0.75) {
              fallAt(f, tx, ty, z, 0, false);
              ys[c] = H; zb[c] = zB; wk[c] = FA[3] * sstep(((FA[0] + FA[1] + FA[2]) / 3 - 150) / 50); any = 1;
              break;
            }
          }
          H = sy; zl = z;
        } else if (!hid && sy > H + 0.05) { hid = true; zB = zl; }
      }
    }
    FALL_WQ = keep;
    if (!any) return null;
    // the whiteness behind the lip, smoothed along it, tapering out toward the lip's ends
    const k = new Float32Array(n);
    for (let c = 0; c < n; c++) {
      if (ys[c] !== ys[c]) continue;
      let s = 0, mx = 0, e = 0;
      for (let q = -4; q <= 4; q++) { const v = c + q >= 0 && c + q < n ? wk[c + q] : 0; s += v; if (v > mx) mx = v; }
      while (e < 4 && c - e - 1 >= 0 && c + e + 1 < n && ys[c - e - 1] === ys[c - e - 1] && ys[c + e + 1] === ys[c + e + 1]) e++;
      k[c] = (s / 18 + mx / 2) * sstep(e / 4);
    }
    // the rocks on the lip: two or three, along its whiter stretch
    const rocks = [];
    let c0 = n, c1 = -1;
    for (let c = 0; c < n; c++) if (k[c] > 0.4) { if (c < c0) c0 = c; c1 = c; }
    for (let q = 0; q < 3 && c1 - c0 > 8; q++) {
      const c = Math.round(c0 + (c1 - c0) * (0.12 + 0.36 * q + 0.1 * hash2(f.c.x, f.c.y, 720 + q)));
      if (ys[c] !== ys[c] || k[c] < 0.4 || (q === 1 && c1 - c0 < 40)) continue;
      const rx = 2.3 + 1.5 * hash2(f.c.x, f.c.y, 723 + q), sx = x0 + c, sy = ys[c] + 0.5, z = zb[c];
      rocks.push({ sx, sy, rx, ry: rx * (0.56 + 0.12 * hash2(f.c.x, f.c.y, 726 + q)), sh: Math.floor(hash2(f.c.x, f.c.y, 732 + q) * 64), tx: (sx / 32 + (sy + z) / 16) / 2, ty: ((sy + z) / 16 - sx / 32) / 2 });
    }
    return (f.lip = { x0, n, ys, zb, k, rocks });
  }
  // a fall on the hills: no mountain tile beside its foot
  function fallOnHill(f) {
    if (f.hill === undefined) {
      f.hill = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inb(f.n.x + dx, f.n.y + dy) && MTNF[idx(f.n.x + dx, f.n.y + dy)]) f.hill = false;
    }
    return f.hill;
  }
  // a point of the ground by a near fall's hidden pool: the foam spilled over the lip (its colour in LSC, how much of
  // the point it covers returned) and how much the wet darkens the grass under it (LS_DK)
  const LSC = new Float64Array(3);
  let LS_DK = 0;
  function lipSpill(f, tx, ty, z, wx, wyg) {
    LS_DK = 0;
    const P = f.lip === undefined ? nearLip(f) : f.lip;
    if (!P) return 0;
    const xi = wx - P.x0;
    if (!(xi >= 0 && xi < P.n - 1)) return 0;
    const i = Math.floor(xi), u = xi - i, a = P.ys[i], b = P.ys[i + 1];
    if (a !== a || b !== b) return 0;
    const d = wyg - (a + (b - a) * u), k = P.k[i] + (P.k[i + 1] - P.k[i]) * u;
    if (d < -6 || d > 10 || k < 0.02) return 0;
    // (which side of the lip: the bank's top in front of it, at about the lip's height, or the pool behind, well below)
    const front = d > 0, zl = P.zb[i];
    if (front ? z < zl - 4 : z > zl - 4) return 0;
    const L = 1 + 0.06 * (f.zLo / LEVEL);
    fr = 0; fg = 0; fb = 0; fA = 0;
    // its clots, measured on screen so they run on unbroken across the lip
    const cn = 0.62 * vnoise(wx * 0.3 + f.uo, wyg * 0.46 + 3) + 0.38 * vnoise(wx * 0.75 + 7, wyg * 1.05 + f.uo), wl = L * (0.9 + 0.1 * cn);
    if (front) {
      // how far the foam spills over the lip here (world px): lobes of very different lengths
      const lo = sstep((0.65 * vnoise(wx * 0.24 + f.uo, 3.7) + 0.35 * vnoise(wx * 0.62 + 7, f.uo + 0.5) - 0.33) / 0.3);
      const reach = k * (0.8 + 6 * lo);
      // the grass beyond it wet and darker, in a wandering margin
      LS_DK = 0.3 * k * (1 - sstep((d - reach - 1.2 - 2.2 * vnoise(wx * 0.2 + 3, f.uo + 9)) / 0.7));
      // (its edge ragged by the clots, by about a world px either way, more on the longer lobes)
      const wv = sstep((reach - d + (1.1 + 0.25 * reach) * (2 * cn - 1)) / 0.35);
      if (wv > 0) fover(soft(224 * wl, CAP_R), soft(235 * wl, CAP_G), soft(231 * wl, CAP_B), wv * 0.96);
      // spray drifting on over the grass
      sprayAt(wx, wyg, k * 0.75 * (1 - sstep((d - reach) / 3)), f.uo + 41, L);
    } else {
      // and white on just behind the lip, over the pool's own foam
      const up = k * (0.9 + 2.6 * vnoise(wx * 0.13 + 11, f.uo + 2.5)), wv = sstep((1 + d / (up + 0.01) + 0.55 * (cn - 0.5) - 0.18) / 0.1);
      if (wv > 0) fover(soft(224 * wl, CAP_R), soft(235 * wl, CAP_G), soft(231 * wl, CAP_B), wv * 0.96);
    }
    // the wet rocks on the lip (as a far fall's rocks in its lip), with a broken collar of foam
    for (let q = 0; q < P.rocks.length; q++) {
      const R = P.rocks[q], qx = (wx - R.sx) / R.rx, qy = (wyg - R.sy) / R.ry;
      if (qx > 1.9 || qx < -1.9 || qy > 1.9 || qy < -1.9) continue;
      const m = bkD(R.sh, qx, qy) * R.ry, kr = sstep((0.25 - m) / 0.5);
      const col = (1 - kr) * sstep((1.9 - m) / 0.5) * sstep((vnoise(wx * 0.6 + R.sh, wyg * 0.9 + 3) - 0.3) / 0.15) * k;
      if (col > 0) fover(soft(224 * L, CAP_R), soft(235 * L, CAP_G), soft(232 * L, CAP_B), col * 0.9);
      if (kr <= 0) continue;
      let nx = BKS[BK_E] / R.rx, ny = BKS[BK_E + 1] / R.ry; const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
      const dpx = -m, bw = R.ry * (0.12 + 0.55 * (ny > 0 ? ny : 0)), sideF = 0.86 - 0.3 * (0.55 * nx + 0.83 * ny) - 0.1 * (nx > 0 && ny > 0 ? nx : 0);
      const tw = sstep((dpx - bw) / 0.6), F = sideF + (1.06 - sideF) * tw, rim = ny > 0.15 || nx > 0.8 || nx < -0.8 ? 1 - sstep((dpx - 0.2) / 0.45) : 0;
      // (the rock's texture from one place, so it does not change where the lip crosses it)
      const s0 = P_IX, s1 = P_IY, s2 = P_NX, s3 = P_NY, s4 = P_WX, s5 = P_WY;
      setPatch(R.tx, R.ty); sampleMat(M.HIGHROCK, R.tx, R.ty, wx, wyg);
      P_IX = s0; P_IY = s1; P_NX = s2; P_NY = s3; P_WX = s4; P_WY = s5;
      const dd = 0.62 * F * (1 - 0.45 * rim) * L, gl = tw * sstep((vnoise(wx * 0.9 + 3, wyg * 1.6 + 7) - 0.66) / 0.03) * sstep((-0.2 - qy) / 0.2);
      fover(V[0] * dd - 8 + (196 * L - V[0] * dd + 8) * gl * 0.8, V[1] * dd - 6 + (208 * L - V[1] * dd + 6) * gl * 0.8, V[2] * dd * 0.96 - 6 + (206 * L - V[2] * dd * 0.96 + 6) * gl * 0.8, kr);
    }
    LSC[0] = fr; LSC[1] = fg; LSC[2] = fb;
    return fA;
  }
  // Round 6 (the critic: at 23,11 the white was still bounded by one straight diagonal, the old crease line: at one end
  // its upper edge met the green bank on it, at the other its lower edge met the near bank on it). Over a far edge the
  // face turns away from the view part way down, and the brink hides the rest of it along one straight line by the
  // tile edge. Where the lower river turns below the fall, its bank shows behind that line at one end (the white in
  // front of it) and the near bank stands in front of it at the other (the white behind it), so the white met the
  // ground on that ruled line at both ends. farSil finds the line once, for each raster column across the fall: the row
  // where the painter leaves it, which side of it is white, and a boundary wandering across it in lobes of very
  // different sizes (overrunning it into the ground, and drawing back so the ground reaches into the white), with wet
  // rocks set across it; farSilPass lays that over the painted columns (the ground drawn into the white is its own
  // picture from beside the line, mirrored), with loose clots and spray past the white, and silFrame gives Animate all
  // water clots that drift off that edge. A fall whose lower river runs straight on has water behind the whole line.
  function farSil(f) {
    f.sil = null;
    if (f.near) return null;
    const nd = f.n.down >= 0 ? map[f.n.down] : null;
    if (!nd || (nd.x - f.n.x === f.dx && nd.y - f.n.y === f.dy)) return null;
    const al = 0.36 * f.w - f.w / 2, sum = f.dx + f.dy;
    const ends = [-0.8, 0.8].map((ac) => (f.mx + f.dx * al - f.dy * ac - (f.my + f.dy * al + f.dx * ac)) * 32);
    const g0 = Math.max(0, Math.floor((Math.min(ends[0], ends[1]) - GX0) * SCALE)), g1 = Math.min(GW, Math.ceil((Math.max(ends[0], ends[1]) - GX0) * SCALE)), n = g1 - g0;
    if (n < 8) return null;
    const yb = new Float32Array(n).fill(NaN), sw = new Float32Array(n), fp = new Float32Array(n * 2), keep = FALL_WQ;
    const white = (s, d) => { const tx = (s + d) / 2, ty = (s - d) / 2; fallAt(f, tx, ty, heightAt(tx, ty), 0, false); return FA[3] * sstep(((FA[0] + FA[1] + FA[2]) / 3 - 150) / 50); };
    const inF = (tx, ty, lo, hi) => { const rx = tx - f.mx, ry = ty - f.my, t = (rx * f.dx + ry * f.dy + f.w / 2) / f.w, ac = ry * f.dx - rx * f.dy; return t > lo && t < hi && ac > -0.8 && ac < 0.8; };
    FALL_WQ = 1;
    for (let c = 0; c < n; c++) {
      // down the column from in front of the brink, as the painter marches it: the first stretch it hides
      const d = (GX0 + (g0 + c) / SCALE) / 32, ac = (f.mx - f.my + al * (f.dx - f.dy) - d) / sum, sP = f.mx + f.my + al * sum + ac * (f.dx - f.dy);
      let ymin = Infinity, ps = 0, pz = 0, pv = false;
      for (let k = Math.floor((sP + 2.5) / DS); k * DS >= sP - 1.5; k--) {
        const s = k * DS, tx = (s + d) / 2, ty = (s - d) / 2, z = heightAt(tx, ty), top = Math.floor((16 * s - z - GY0) * SCALE);
        if (ymin === Infinity) ymin = top + 1;
        if (top >= ymin) continue;
        if (pv && ps - s > 0.08 && pz - z > 2 && inF((ps + d) / 2, (ps - d) / 2, -0.4, 0.75) && inF(tx, ty, 0.3, 1.6)) {
          // how white each side is, at the line and a little away from it
          yb[c] = ymin; fp[c * 2] = (ps + d) / 2; fp[c * 2 + 1] = (ps - d) / 2;
          sw[c] = (white(ps, d) + white(ps + 0.05, d) - white(s, d) - white(s - 0.05, d)) / 2;
          break;
        }
        ymin = top; ps = s; pz = z; pv = true;
      }
    }
    FALL_WQ = keep;
    // which side is white, smoothed along the line (sg > 0: in front of it), and how strongly the two sides differ
    const sg = new Float32Array(n), k = new Float32Array(n), o = new Float32Array(n), ext = new Uint8Array(n);
    let a0 = -1, a1 = -1;
    for (let c = 0; c < n; c++) {
      if (yb[c] !== yb[c]) continue;
      let s = 0, w = 0, e = 0;
      for (let q = -10; q <= 10; q++) if (c + q >= 0 && c + q < n && yb[c + q] === yb[c + q]) { s += sw[c + q]; w++; }
      while (e < 6 && c - e - 1 >= 0 && c + e + 1 < n && yb[c - e - 1] === yb[c - e - 1] && yb[c + e + 1] === yb[c + e + 1]) e++;
      sg[c] = s / w; k[c] = sstep((Math.abs(sg[c]) - 0.12) / 0.3) * sstep((e + 1) / 6);
      if (k[c] > 0.3) { if (a0 < 0) a0 = c; a1 = c; }
    }
    if (a0 < 0) return null;
    // past its ends the white meets the bank on the same line, where the water's side runs into it: there the line
    // is carried on straight (fitted to it) and farSilPass looks for the white's edge near it
    let mx = 0, my = 0, mxx = 0, mxy = 0, m = 0;
    for (let c = a0; c <= a1; c++) if (k[c] > 0.3) { mx += c; my += yb[c]; mxx += c * c; mxy += c * yb[c]; m++; }
    const sl = m > 1 ? (m * mxy - mx * my) / (m * mxx - mx * mx) : 0, ic = (my - sl * mx) / m;
    // (where the white ends, found down the column as the painter marches it, nearest the line carried on; smoothed
    // along it, so the boundary follows the white's edge without copying its every step)
    const off = new Float32Array(n).fill(NaN);
    FALL_WQ = 1;
    for (let c = 0; c < n; c++) {
      if (c >= a0 && c <= a1) continue;
      const e = c < a0 ? a0 : a1, ke = 1 - sstep((Math.abs(c - e) - 10) / 14);
      if (ke <= k[c] || ke <= 0) continue;
      k[c] = ke; sg[c] = sg[e]; yb[c] = ic + sl * c; ext[c] = 1;
      const d = (GX0 + (g0 + c) / SCALE) / 32, ac = (f.mx - f.my + al * (f.dx - f.dy) - d) / sum, sP = f.mx + f.my + al * sum + ac * (f.dx - f.dy);
      let ymin = Infinity, prev = -1, best = 99;
      for (let q = Math.floor((sP + 2.5) / DS); q * DS >= sP - 1.5; q--) {
        const s = q * DS, tx = (s + d) / 2, ty = (s - d) / 2, z = heightAt(tx, ty), top = Math.floor((16 * s - z - GY0) * SCALE);
        if (ymin === Infinity) ymin = top + 1;
        if (top >= ymin) continue;
        if (ymin < yb[c] - 9) break;
        if (ymin <= yb[c] + 9) {
          fallAt(f, tx, ty, z, 0, false);
          const w = FA[3] * sstep(((FA[0] + FA[1] + FA[2]) / 3 - 150) / 50) > 0.5 ? 1 : 0;
          // the white side lies behind the line (above it) when sg < 0: the edge is where white starts going back
          if (prev >= 0 && w !== prev && w === (sg[c] < 0 ? 1 : 0) && Math.abs(ymin - yb[c]) < Math.abs(best)) best = ymin - yb[c];
          prev = w;
        }
        ymin = top;
      }
      if (best !== 99) off[c] = best;
    }
    FALL_WQ = keep;
    for (let c = 0; c < n; c++) {
      if (!ext[c]) continue;
      let s = 0, w = 0;
      for (let q = -8; q <= 8; q++) if (c + q >= 0 && c + q < n && off[c + q] === off[c + q]) { s += off[c + q]; w++; }
      // (and it fades out where the white's edge is no longer found, so no column is cut off square)
      if (w) { yb[c] += s / w; k[c] *= sstep((w - 2) / 10); } else { k[c] = 0; ext[c] = 0; }
    }
    // the boundary (world px past the line, away from the white; below zero the ground reaches into the white): lobes
    // of 2 to 6.5 px along the line, by turns overrunning it and drawing back behind it (now and then two the same
    // way), each its own height, with small bumps on them. The white in front of the line throws its spray highest
    // over the ground behind it; the ground in front of the line reaches furthest up into the white behind it.
    const wa = GX0 + g0 / SCALE, lob = [];
    for (let j = 0, x = wa - 3 * hash2(f.c.x, f.c.y, 779); x < wa + n / SCALE; j++) {
      const len = 2.4 + 4.6 * hash2(j, f.c.x, 780), up = (j & 1) ^ (hash2(j, f.c.y, 781) < 0.2 ? 1 : 0);
      lob.push(x, len, up ? 1 : -1, hash2(j, f.uo, 782)); x += len;
    }
    let any = false;
    for (let c = 0; c < n; c++) {
      if (!(k[c] > 0.02)) continue;
      const wx = wa + c / SCALE;
      let j = 0;
      while (j + 4 < lob.length && lob[j + 4] <= wx) j += 4;
      const u = (wx - lob[j]) / lob[j + 1], up = lob[j + 2] > 0, h = lob[j + 3], hump = Math.sin(Math.PI * (u < 0 ? 0 : u > 1 ? 1 : u)) ** 0.7;
      const amp = up ? (sg[c] > 0 ? 2.2 + 5 * h * h : 1.8 + 3.6 * h) : sg[c] > 0 ? 1 + 1.8 * h : 1.8 + 3.4 * h;
      o[c] = k[c] * ((up ? amp : -amp) * hump + 0.5 * (2 * vnoise(wx * 0.75 + f.uo, 8.9) - 1));
      any = true;
    }
    if (!any) return null;
    // wet rocks across the line where two lobes meet: one or two along each stretch where it showed
    const rocks = [];
    for (let c = 0; c < n; c++) {
      if (!(k[c] > 0.6) || yb[c] !== yb[c] || (c > 0 && k[c - 1] > 0.6)) continue;
      let e = c;
      while (e + 1 < n && k[e + 1] > 0.6 && yb[e + 1] === yb[e + 1]) e++;
      let got = 0, last = -99;
      for (let j = 4; j < lob.length && got < 2; j += 4) {
        const q = Math.round((lob[j] - wa) * SCALE);
        if (q < c + 2 || q > e - 2 || lob[j] - last < 5 || (got && hash2(j, f.c.x, 783) > 0.5)) continue;
        last = lob[j]; got++;
        const rx = 1.5 + 1.5 * hash2(j, f.c.y, 784);
        rocks.push({ sx: lob[j], sy: GY0 + yb[q] / SCALE + (hash2(j, f.c.x, 785) - 0.45) * 1.2, rx, ry: rx * (0.6 + 0.12 * hash2(j, f.c.y, 786)), sh: Math.floor(hash2(j, f.c.x, 787) * 64), tx: fp[q * 2] || f.mx, ty: fp[q * 2 + 1] || f.my });
      }
      c = e;
    }
    return (f.sil = { g0, n, yb, ext, y0: new Float32Array(n).fill(NaN), k, sg, o, rocks, fr: null });
  }
  // the boundary at a point (world px past the line, away from the white), ragged by clots measured on screen
  const silBnd = (f, o, wx, wyg) => o + (2 * (0.62 * vnoise(wx * 0.31 + f.uo, wyg * 0.47 + 3) + 0.38 * vnoise(wx * 0.78 + 7, wyg * 1.1 + f.uo)) - 1) * (0.8 + 0.16 * Math.abs(o));
  const SIL_COL = new Uint32Array(64), SIL_C8 = new Uint8Array(SIL_COL.buffer);
  function farSilPass(c0, c1) {
    for (const f of FALLS) {
      if (f.near) continue;
      const P = f.sil === undefined ? farSil(f) : f.sil;
      if (!P) continue;
      const a = Math.max(c0, P.g0), b = Math.min(c1, P.g0 + P.n);
      if (a < b) P.fr = null;
      for (let gx = a; gx < b; gx++) silColumn(f, P, gx);
    }
  }
  function silColumn(f, P, gx) {
    const c = gx - P.g0, kk = P.k[c];
    if (!(kk > 0.02)) return;
    // the line where the painter left it: a front row whose surface lies well in front of the row above it
    let y0 = -1;
    const sg = P.sg[c] > 0 ? 1 : -1, yb = Math.round(P.yb[c]);
    if (!P.ext[c]) {
      for (let y = yb - 2; y <= yb + 2 && y0 < 0; y++) {
        if (y < 1 || y >= GH) continue;
        const a = DEP[y * GW + gx], b = DEP[(y - 1) * GW + gx];
        if (a && b && (a >> 2) - (b >> 2) > 8) y0 = y;
      }
    } else if (yb > 0 && yb < GH && DEP[yb * GW + gx]) y0 = yb; // past the line's ends: where the white ends (farSil)
    P.y0[c] = y0 < 0 ? NaN : y0;
    if (y0 < 0) return;
    const ya = Math.max(0, y0 - 32), yz = Math.min(GH, y0 + 32), wx = GX0 + gx / SCALE, o = P.o[c];
    for (let y = ya; y < yz; y++) SIL_COL[y - ya] = GD32[y * GW + gx];
    const L = 1 + 0.06 * (f.zHi / LEVEL);
    for (let y = ya; y < yz; y++) {
      const p = y * GW + gx;
      if (!DEP[p]) continue;
      const wyg = GY0 + (y + 0.5) / SCALE, d = (sg > 0 ? y0 - 0.5 - y : y + 0.5 - y0) / SCALE, bnd = silBnd(f, o, wx, wyg);
      if (d > bnd + 7 || d < bnd - 7) continue;
      const q = (y - ya) * 4;
      let r = SIL_C8[q], g = SIL_C8[q + 1], b = SIL_C8[q + 2], uc = 0;
      fr = 0; fg = 0; fb = 0; fA = 0;
      if (d <= 0) {
        // the ground beside the line reaching into the white: its own picture, mirrored across the line
        uc = sstep((d - bnd) / 0.45) * kk;
        const m = 2 * y0 - 1 - y;
        if (uc > 0 && m >= ya && m < yz && DEP[m * GW + gx]) { const mq = (m - ya) * 4; r += (SIL_C8[mq] - r) * uc; g += (SIL_C8[mq + 1] - g) * uc; b += (SIL_C8[mq + 2] - b) * uc; }
      } else {
        // the white over the line: lobes with a pale blue-grey rim, then loose clots of different sizes, then spray
        const ov = sstep((bnd - d) / 0.45) * kk;
        if (ov > 0) { const c2 = L * (0.86 + 0.14 * sstep((bnd - d) / 1.6)); fover(soft(224 * c2, CAP_R), soft(235 * c2, CAP_G), soft(232 * (c2 * 0.97 + 0.03 * L), CAP_B), ov * 0.96); }
        const pd = d - (bnd > 0 ? bnd : 0);
        if (pd > 0) {
          const cl = 0.6 * vnoise(wx * 0.21 + f.uo + 5, wyg * 0.33 + 1) + 0.4 * vnoise(wx * 0.52 + 2, wyg * 0.8 + f.uo);
          const ck = sstep((cl - 0.6 - 0.07 * pd) / 0.04) * kk;
          if (ck > 0) fover(soft(222 * L, CAP_R), soft(234 * L, CAP_G), soft(231 * L, CAP_B), ck * 0.92);
          sprayAt(wx, wyg, kk * 0.85 * (1 - sstep((pd - 0.5) / 5)), f.uo + 53, L);
        }
      }
      // the wet rocks across the line, with a broken collar of white
      for (let q2 = 0; q2 < P.rocks.length; q2++) {
        const R = P.rocks[q2], qx = (wx - R.sx) / R.rx, qy = (wyg - R.sy) / R.ry, lim = 1.2 + 1.9 / R.ry;
        if (qx > lim || qx < -lim || qy > lim || qy < -lim) continue;
        const m = bkD(R.sh, qx, qy) * R.ry, kr = sstep((0.25 - m) / 0.5);
        const col = (1 - kr) * sstep((1.9 - m) / 0.5) * sstep((vnoise(wx * 0.6 + R.sh, wyg * 0.9 + 3) - 0.3) / 0.15);
        if (col > 0) fover(soft(224 * L, CAP_R), soft(235 * L, CAP_G), soft(232 * L, CAP_B), col * 0.9);
        if (kr <= 0) continue;
        let nx = BKS[BK_E] / R.rx, ny = BKS[BK_E + 1] / R.ry; const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
        const dpx = -m, bw = R.ry * (0.12 + 0.55 * (ny > 0 ? ny : 0)), sideF = 0.86 - 0.3 * (0.55 * nx + 0.83 * ny) - 0.1 * (nx > 0 && ny > 0 ? nx : 0);
        const tw = sstep((dpx - bw) / 0.6), F = sideF + (1.06 - sideF) * tw, rim = ny > 0.15 || nx > 0.8 || nx < -0.8 ? 1 - sstep((dpx - 0.2) / 0.45) : 0;
        setPatch(R.tx, R.ty); sampleMat(M.HIGHROCK, R.tx, R.ty, wx, wyg);
        const dd = 0.62 * F * (1 - 0.45 * rim) * L, gl = tw * sstep((vnoise(wx * 0.9 + 3, wyg * 1.6 + 7) - 0.66) / 0.03) * sstep((-0.2 - qy) / 0.2);
        fover(V[0] * dd - 8 + (196 * L - V[0] * dd + 8) * gl * 0.8, V[1] * dd - 6 + (208 * L - V[1] * dd + 6) * gl * 0.8, V[2] * dd * 0.96 - 6 + (206 * L - V[2] * dd * 0.96 + 6) * gl * 0.8, kr);
      }
      if (fA > 0) { r += (fr - r) * fA; g += (fg - g) * fA; b += (fb - b) * fA; }
      if (fA > 0.004 || uc > 0.004) {
        const o4 = p * 4; gd[o4] = r; gd[o4 + 1] = g; gd[o4 + 2] = b; DEP[p] &= ~3;
      }
      // Animate all water: the white moves, and so does the edge just past it (silFrame); the ground drawn back is still
      if (fA > 0.4 || (d > bnd - 1.2 && d < bnd + 3.5)) WM[p] = 3; else if (uc > 0.5) WM[p] = 0;
    }
  }
  // Animate all water's frames at that edge: clots of white drifting off it, two layers half a cycle apart, each faded
  // out as it starts over (as the foam's flecks), so the loop never jumps and the edge changes a little every frame
  function silFrames(f) {
    const P = f.sil;
    if (P.fr) return P.fr;
    const pts = [];
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let c = 0; c < P.n; c++) {
      const yl = P.y0[c];
      if (!(P.k[c] > 0.05) || yl !== yl) continue;
      const gx = P.g0 + c, sg = P.sg[c] > 0 ? 1 : -1, o = P.o[c];
      for (let y = Math.max(0, yl - 24); y < Math.min(GH, yl + 24); y++) {
        const d = (sg > 0 ? yl - 0.5 - y : y + 0.5 - yl) / SCALE;
        if (d < o - 3 || d > o + 6) continue;
        pts.push(gx, y, d, c);
        if (gx < x0) x0 = gx; if (gx > x1) x1 = gx; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (!pts.length) return (P.fr = { c: [], pts, w: 0 });
    return (P.fr = { c: new Array(FALL_FRAMES).fill(null), pts, gx: x0, gy: y0, cw: x1 - x0 + 1, ch: y1 - y0 + 1, x: GX0 + x0 / SCALE, y: GY0 + y0 / SCALE, w: (x1 - x0 + 1) / SCALE, h: (y1 - y0 + 1) / SCALE });
  }
  function silFrame(f, k) {
    const P = f.sil, F = P.fr, cv = document.createElement('canvas'); cv.width = F.cw; cv.height = F.ch;
    const x = cv.getContext('2d'), im = x.createImageData(F.cw, F.ch), dd = im.data, L = 1 + 0.06 * (f.zHi / LEVEL);
    const pa = k / FALL_FRAMES, pb = (pa + 0.5) % 1, wa = 1 - Math.abs(2 * pa - 1), wb = 1 - wa;
    const clot = (wx, e, sd) => sstep((0.62 * vnoise(wx * 0.36 + sd, e * 0.55 + 3) + 0.38 * vnoise(wx * 0.9 + 7, e * 1.3 + sd) - 0.6) / 0.05);
    for (let q = 0; q < F.pts.length; q += 4) {
      const gx = F.pts[q], y = F.pts[q + 1], d = F.pts[q + 2], c = F.pts[q + 3], wx = GX0 + gx / SCALE, wyg = GY0 + (y + 0.5) / SCALE;
      const bnd = silBnd(f, P.o[c], wx, wyg), e = d - bnd;
      const a = P.k[c] * sstep((e + 1.2) / 0.8) * (1 - sstep((e - 0.8) / 2.6)) * (wa * clot(wx, d - pa * 3.2, f.uo) + wb * clot(wx, d - pb * 3.2, f.uo + 37));
      if (a <= 0.01) continue;
      const o = ((y - F.gy) * F.cw + gx - F.gx) * 4, wl = L * (0.9 + 0.1 * vnoise(wx * 0.5 + 1, wyg * 0.7)); // (v8: no new noise each frame, which flickered)
      dd[o] = soft(224 * wl, CAP_R); dd[o + 1] = soft(235 * wl, CAP_G); dd[o + 2] = soft(232 * wl, CAP_B); dd[o + 3] = a * 0.9 * 255;
    }
    x.putImageData(im, 0, 0);
    return (F.c[k] = cv);
  }
  function pairW(a, b) {
    if ((b === a + 1 && FALLE[a] & 1) || (b === a + W && FALLE[a] & 2)) return FALLWE[a * 2 + (b === a + 1 ? 0 : 1)];
    if ((FALLT[a] || FALLT[b]) && Lv[a] !== Lv[b] && RM.bank > 0.25) return 0.25;
    if (glacierName !== 'demo') {
      const va = VALLEY[a], vb = VALLEY[b];
      if (va === 1 && vb === 1) return 0; // an ice cliff where the glacier drops a level
      if (va === 1 || vb === 1) { const o = va === 1 ? map[b] : map[a]; return o.kind !== 'land' || glacierName === 'tongue' ? 0 : 0.24; } // ice front; the tongue's ice wall; the channel's moraine bank
      if (glacierName === 'channel' && va && vb) return Lv[a] !== Lv[b] ? 0 : 0.12; // the banks step down with the ice (v3: in the same clean step)
      // v3: the moraine bank rises softly into the mountain beside it (at 0.5 it was a steep rock band along the channel)
      if (glacierName === 'channel' && (va || vb) && map[a].kind === 'land' && map[b].kind === 'land') return 0.8;
    }
    return RM.bank;
  }
  function levelPlan() {
    for (const c of map) KEEP.forEach((k, q) => { c[k] = BASE[c.i][q]; });
    VALLEY.fill(0);
    if (glacierName !== 'demo') {
      const P = GLACIER_PLAN;
      for (const [y0, y1, lv] of P.steps) for (let y = y0; y <= y1; y++) {
        const g = T(P.x, y); g.level = lv; VALLEY[g.i] = 1;
        for (const fx of [P.x - 1, P.x + 1]) { const f = T(fx, y); if (f.kind === 'land') { f.level = lv; VALLEY[f.i] = 2; } }
      }
      for (const [x, y] of P.melt) T(x, y).level = P.meltLevel;
      for (const [x, y] of P.dry) { const c = T(x, y); c.kind = 'land'; c.terrain = 'rock'; c.biome = 'mountain'; c.headwater = ''; c.snow = false; c.level = P.meltLevel + 1; }
      // land keeps the game's one-step rule (as world.js applies it); water may drop more
      for (let pass = 0; pass < 8; pass++) {
        let changed = false;
        for (const c of map) {
          if (c.kind !== 'land' || VALLEY[c.i]) continue;
          let lo = 9, hiW = -9;
          for (const [dx, dy] of N4) { const o = tileAt(c.x + dx, c.y + dy); if (!o) continue; lo = Math.min(lo, o.level); if (o.kind !== 'land') hiW = Math.max(hiW, o.level); }
          if (c.level > lo + 1) { c.level = lo + 1; changed = true; }
          if (c.level < hiW - 1) { c.level = hiW - 1; changed = true; }
        }
        if (!changed) break;
      }
      for (const c of map) { c.fall = 0; if ((c.kind === 'river' || c.kind === 'lake') && c.down >= 0) { const n = map[c.down]; if ((n.kind === 'river' || n.kind === 'lake' || n.kind === 'ocean') && c.level > n.level) c.fall = c.level - n.level; } }
    }
    for (const c of map) { Lv[c.i] = c.level + (VALLEY[c.i] === 1 ? GM.ice : VALLEY[c.i] === 2 ? GM.flank : 0); ICEW[c.i] = VALLEY[c.i] === 1 ? 1 : 0; }
    // the box where ICEW's blend can be above zero (wamp skips everything outside it: the painter's hottest call)
    ICEW_BOX[0] = 1e9; ICEW_BOX[1] = 1e9; ICEW_BOX[2] = -1e9; ICEW_BOX[3] = -1e9;
    for (const c of map) if (ICEW[c.i]) { ICEW_BOX[0] = Math.min(ICEW_BOX[0], c.x - 1); ICEW_BOX[1] = Math.min(ICEW_BOX[1], c.y - 1); ICEW_BOX[2] = Math.max(ICEW_BOX[2], c.x + 1); ICEW_BOX[3] = Math.max(ICEW_BOX[3], c.y + 1); }
    ICEN.fill(0); for (const c of map) if (VALLEY[c.i] === 1) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inb(c.x + dx, c.y + dy)) ICEN[idx(c.x + dx, c.y + dy)] = 1;
    for (const c of map) { let rel = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const o = tileAt(c.x + dx, c.y + dy); if (o && Lv[o.i] !== Lv[c.i]) rel = 1; } RELIEF[c.i] = rel; }
    fallPlan();
    // two river tiles side by side at different levels with no fall between them (the stub at 30,15 above the river
    // below the fall at 30,14): their step is wet rock, not the river pictures drawn down it (fix round 1)
    RVSTEP.fill(0); FALLB.fill(0);
    for (const c of map) if (c.kind === 'river') for (const [dx, dy] of N4) {
      const o = tileAt(c.x + dx, c.y + dy);
      if (!o || o.kind !== 'river' || Lv[o.i] === Lv[c.i]) continue;
      const fall = (c.down === o.i && c.fall) || (o.down === c.i && o.fall);
      if (!fall) { RVSTEP[c.i] = 1; RVSTEP[o.i] = 1; }
    }
    FALLN.fill(null);
    for (const f of FALLS) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const x = Math.round(f.mx) + dx, y = Math.round(f.my) + dy; if (inb(x, y)) (FALLN[idx(x, y)] ||= []).push(f); }
    // a fall over a far edge: its two tiles (2) and the land just below their banks (1; the bank's foot lies there)
    for (const f of FALLS) if (!f.near) for (const c of [f.c, f.n]) { FALLB[c.i] = 2; for (const [dx, dy] of N4) { const o = tileAt(c.x + dx, c.y + dy); if (o && o.kind === 'land' && Lv[o.i] < Lv[c.i] && !FALLB[o.i]) FALLB[o.i] = 1; } }
    for (let k = 0; k < N; k++) WETT[k] = ICEN[k] ? 0 : FALLB[k] === 2 || RVSTEP[k] ? 1 : FALLB[k] === 1 ? 0.8 : 0;
    WETN.fill(0);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (WETT[j * W + i]) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inb(i + dx, j + dy)) WETN[idx(i + dx, j + dy)] = 1;
    RSIDE.fill(0); RWILD.fill(0); RNAR.fill(0);
    for (const c of map) if (c.kind === 'river') {
      let bits = 0;
      // (no sides on a fall's own tiles: its sheet and wet rock have their own edges, and a fall's source pool keeps its
      // shape; there the waterline only wanders inward, RNAR, so the sheet never spreads over the bank beside it)
      if (FALLT[c.i]) { RWILD[c.i] = 1; RNAR[c.i] = 1; continue; }
      for (const [dx, dy] of N4) {
        const o = tileAt(c.x + dx, c.y + dy);
        if (!o || Lv[o.i] === Lv[c.i] || c.down === o.i || o.down === c.i || VALLEY[o.i] === 1 || ICET[o.i] || isGlacier(o)) continue;
        if (o.kind !== 'land' && !(o.kind === 'river' && RVSTEP[c.i])) continue;
        bits |= dx === 1 ? 1 : dx === -1 ? 2 : dy === 1 ? 4 : 8;
      }
      RSIDE[c.i] = bits; RWILD[c.i] = bits || RVSTEP[c.i] || WETN[c.i] ? 1 : 0;
    }
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; EWX[k] = pairW(k, i + 1 < W ? k + 1 : k); EWY[k] = pairW(k, j + 1 < H ? k + W : k); }
    iceEndPlan();
    frontPlan();
    stackPlan();
    LIPE.fill(null);
    for (const c of map) if (c.kind === 'river') {
      // (the sides as RSIDE has them, and a fall's tiles' too: beside a fall's foot the lip ran on straight)
      let bits = RSIDE[c.i];
      if (FALLT[c.i]) for (const [dx, dy] of N4) {
        const o = tileAt(c.x + dx, c.y + dy);
        if (!o || o.kind !== 'land' || Lv[o.i] === Lv[c.i] || c.down === o.i || o.down === c.i || VALLEY[o.i] === 1 || ICET[o.i] || isGlacier(o)) continue;
        bits |= dx === 1 ? 1 : dx === -1 ? 2 : dy === 1 ? 4 : 8;
      }
      // round 5 (the critic: a thin pale straight line remained on the melt-river lip near 28,11, where the hairpin river
      // at 29,12 drops to the terrace below it): and a side toward lower land whose own drainage runs into the river
      // (RSIDE leaves it out, so the river's water keeps its shape there)
      let drain = 0;
      if (!FALLT[c.i]) for (const [dx, dy] of N4) {
        const o = tileAt(c.x + dx, c.y + dy);
        if (!o || o.kind !== 'land' || Lv[o.i] >= Lv[c.i] || o.down !== c.i || c.down === o.i || VALLEY[o.i] === 1 || ICET[o.i] || isGlacier(o)) continue;
        drain |= dx === 1 ? 1 : dx === -1 ? 2 : dy === 1 ? 4 : 8;
      }
      bits |= drain;
      if (!bits) continue;
      // on the mountain
      let mtn = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inb(c.x + dx, c.y + dy) && MTNF[idx(c.x + dx, c.y + dy)]) mtn = 1;
      if (!mtn) continue;
      for (const [bit, dx, dy] of [[1, 1, 0], [2, -1, 0], [4, 0, 1], [8, 0, -1]]) if (bits & bit) {
        const o = tileAt(c.x + dx, c.y + dy), up = Lv[o.i] > Lv[c.i], ax = dx ? 0 : 1;
        // (not beside the glacier options' ice: the Ice channel's end and its cave stay as approved)
        let ice = 0;
        for (let q = -1; q <= 1; q++) for (const t of [c, o]) { const u = tileAt(t.x + (ax === 0 ? 0 : q), t.y + (ax === 0 ? q : 0)); if (u && (VALLEY[u.i] || ICET[u.i] || isGlacier(u))) ice = 1; }
        if (ice) continue;
        // the bank's profile across this edge (heightAt): it spans half its width either side of the edge, or from
        // centre to centre where the edge is stacked
        const k = ax === 0 ? idx(Math.min(c.x, o.x), c.y) : idx(c.x, Math.min(c.y, o.y));
        const hw = (ax === 0 ? HX0[k] || HX1[k] : HY0[k] || HY1[k]) ? 0.5 : (ax === 0 ? EWX[k] : EWY[k]) / 2;
        // (round 5: such a drain side's band reaches on down its whole face, which faces the light there, E[7])
        const E = [ax, ax === 0 ? c.x + dx / 2 : c.y + dy / 2, ax === 0 ? c.y : c.x, dx || dy, up ? hw : -hw, (c.x * 13 + c.y * 7 + bit) % 37, up ? 0 : drain & bit ? 0.42 : 0.2, drain & bit ? 1 : 0];
        for (let q = -1; q <= 1; q++) for (const t of [c, o]) { const x = t.x + (ax === 0 ? 0 : q), y = t.y + (ax === 0 ? q : 0); if (inb(x, y)) (LIPE[idx(x, y)] ||= []).push(E); }
      }
    }
    // where a relief option without faces can still have one: by the glacier options' valley and the ice's end
    // (faceSetup is asked nowhere else; fix round 1: load time)
    FACEN.fill(0);
    for (const c of map) if (VALLEY[c.i] || ICET[c.i] === 2) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inb(c.x + dx, c.y + dy)) FACEN[idx(c.x + dx, c.y + dy)] = 1;
  }
  // relief v2: a land tile between a lower and a higher neighbour along x (or y) is part of a stack. Its centre is no
  // longer flat but slopes at RM.stack levels per tile, and the edges either side bend through it (a cubic, so the
  // light has no crease at the centre); where the stack ends, the slope rounds off onto the flat as the banks do.
  // Water, falls and their neighbours, the glacier and anything built keep the plain banks.
  const SDX = new Float32Array(N), SDY = new Float32Array(N); // a tile centre's slope along x and y, levels per tile
  const MTN_LV = 3, MTNF = new Uint8Array(N); // the mountain: its tiles (mtnAt)
  const HX0 = new Float32Array(N), HX1 = new Float32Array(N), HY0 = new Float32Array(N), HY1 = new Float32Array(N); // per edge, its ends' slopes over its rise
  // a per-tile plane at a point, blended between tile centres
  function bil(A, tx, ty) {
    const i0 = Math.floor(tx), j0 = Math.floor(ty), u = tx - i0, v = ty - j0;
    const ia = i0 < 0 ? 0 : i0 > W - 1 ? W - 1 : i0, ib = i0 + 1 > W - 1 ? W - 1 : i0 + 1 < 0 ? 0 : i0 + 1;
    const ja = j0 < 0 ? 0 : j0 > H - 1 ? H - 1 : j0, jb = j0 + 1 > H - 1 ? H - 1 : j0 + 1 < 0 ? 0 : j0 + 1;
    const a = A[ja * W + ia], b = A[ja * W + ib], c = A[jb * W + ia], d = A[jb * W + ib];
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  }
  function stackPlan() {
    SDX.fill(0); SDY.fill(0); HX0.fill(0); HX1.fill(0); HY0.fill(0); HY1.fill(0); MTNF.fill(0);
    const free = (x, y) => { if (!inb(x, y)) return false; const c = T(x, y); return c.kind === 'land' && !VALLEY[c.i] && !FALLT[c.i] && !c.track && !c.road && !c.building && !c.paved && !c.field && !c.firn && !c.arm; };
    for (const c of map) {
      if (!free(c.x, c.y) || N4.some(([dx, dy]) => { const o = tileAt(c.x + dx, c.y + dy); return o && (FALLT[o.i] || ICET[o.i]); })) continue; // falls and the ice front keep their steep side banks
      const along = (dx, dy) => {
        if (!free(c.x - dx, c.y - dy) || !free(c.x + dx, c.y + dy)) return 0;
        const a = Lv[idx(c.x - dx, c.y - dy)], b = Lv[idx(c.x + dx, c.y + dy)], d0 = Lv[c.i] - a, d1 = b - Lv[c.i];
        // the mountain only (a stack that climbs to level 3 or more): the hills keep their v1 terraces
        if (Math.max(a, b) < MTN_LV) return 0;
        return d0 * d1 > 0 ? Math.sign(d0) * Math.min(Math.abs(d0), Math.abs(d1)) * RM.stack : 0;
      };
      SDX[c.i] = along(1, 0); SDY[c.i] = along(0, 1);
    }
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (i + 1 < W && (SDX[k] || SDX[k + 1])) { const d = Lv[k + 1] - Lv[k]; HX0[k] = SDX[k] / d; HX1[k] = SDX[k + 1] / d; }
      if (j + 1 < H && (SDY[k] || SDY[k + W])) { const d = Lv[k + W] - Lv[k]; HY0[k] = SDY[k] / d; HY1[k] = SDY[k + W] / d; }
    }
    // the mountain (the v2 options paint it with mountainAt): land at level 3 or more, and the stacks that climb to it
    for (const c of map) MTNF[c.i] = c.kind === 'land' && !VALLEY[c.i] && !isGlacier(c) && (Lv[c.i] >= MTN_LV || SDX[c.i] || SDY[c.i]) ? 1 : 0;
  }
  // whether a point lies on the mountain: any of the four tile centres round it is a mountain tile (the border runs
  // through tile centres, on flat ground)
  function mtnAt(tx, ty) {
    const i0 = Math.floor(tx), j0 = Math.floor(ty);
    const ia = i0 < 0 ? 0 : i0 > W - 1 ? W - 1 : i0, ib = i0 + 1 > W - 1 ? W - 1 : i0 + 1 < 0 ? 0 : i0 + 1;
    const ja = j0 < 0 ? 0 : j0 > H - 1 ? H - 1 : j0, jb = j0 + 1 > H - 1 ? H - 1 : j0 + 1 < 0 ? 0 : j0 + 1;
    return MTNF[ja * W + ia] | MTNF[ja * W + ib] | MTNF[jb * W + ia] | MTNF[jb * W + ib];
  }
  // the glacier's end, in every glacier option: the edge from the last ice tile down to its melt is a vertical ice
  // front (painted by faceAt: Codex's ice-cliff material, its cave at the foot), and the other banks of those two
  // tiles steepen as a fall's do, so the front keeps its full height across the ice (v2: a grey arch on a stone ramp)
  const ICET = new Uint8Array(N); // 2 the last ice tile, 1 its melt
  const ICE_FRONTS = []; // each ice front: its ice tile, its melt, the edge's middle and the flow (frontPlan)
  let SN_BOX = null; // the box round the fronts where the snout swells (snoutAt)
  function iceEndPlan() {
    ICET.fill(0);
    // the Ice channel paints its own front and cave (chanIceFace) on its own banks, as the author approved them in the
    // v3b preview: the snout, the steepened banks and the outflow here are for As now and the Ice tongue
    if (glacierName === 'channel') return;
    for (const c of map) {
      if (c.kind !== 'glacier' || c.down < 0) continue;
      const n = map[c.down];
      if (n.kind !== 'river' || Lv[n.i] >= Lv[c.i]) continue;
      ICET[c.i] = 2; ICET[n.i] = 1;
      for (const t of [c, n]) for (const [dx, dy] of N4) {
        const o = tileAt(t.x + dx, t.y + dy); if (!o) continue;
        const k = dx + dy > 0 ? t.i : o.i, E = dx ? EWX : EWY;
        if ((o === c || o === n) && o !== t) E[k] = 0; // the front itself
        else if (Lv[o.i] !== Lv[t.i] && E[k] > 0.25) E[k] = 0.25;
      }
      // the banks that carry the front's line on either side steepen too, so its ends meet them in a short, steep
      // corner rather than a long stretched slope (v3: a brown column at the front's end)
      const fx = n.x - c.x, fy = n.y - c.y;
      for (const s of [-1, 1]) {
        const a = tileAt(c.x + s * fy, c.y + s * fx), b = a && tileAt(a.x + fx, a.y + fy);
        if (!a || !b || Lv[a.i] === Lv[b.i]) continue;
        const k = fx + fy > 0 ? a.i : b.i, E = fx ? EWX : EWY;
        if (E[k] > 0.2) E[k] = 0.2;
      }
    }
  }
  levelPlan();

  function matOf(c) {
    // all still water looks alike: lakes take the game's water, as the sea does (the author, 2026-10-12)
    if (c.kind === 'ocean' || c.kind === 'lake') return M.WATER;
    if (c.kind === 'river') return M.BANK;
    if (VALLEY[c.i] === 1) return M.ICE; // glacier options: the ice is the glacier-ice swatch, full width
    if (isGlacier(c)) return M.MORAINE;
    if (c.firn && state.redo && glacierName !== 'channel') return M.ICE; // (v3: the Ice channel's firn stays snow, its head grows out of it)
    if (c.paved) return M.CITY;
    if (c.biome === 'beach') return M.BEACH;
    if (c.terrain === 'sand') return c.biome === 'desert' || c.climate === 'desert' ? M.DESERT : M.SAND;
    if (c.terrain === 'rock') return M.ROCKMIX;
    if (c.biome === 'mountain') return M.ALPINE;
    const cl = c.biome === 'plains' || c.biome === 'forest' || c.biome === 'desert' || c.biome === 'taiga' ? c.biome : c.climate;
    if (c.terrain === 'forest') return cl === 'taiga' ? M.TAIGA : M.FOREST;
    return cl === 'forest' ? M.FOREST : cl === 'desert' ? M.DESERT : cl === 'taiga' ? M.TAIGA : M.GRASS;
  }
  const snowOf = (c) => (isGlacier(c) ? 0 : c.firn ? (state.redo && glacierName !== 'channel' ? 0 : 1) : c.snow ? 1 : 0);

  // ---------- scene: decals (draped on the ground), sprites, faces, walkers, and where each picture went
  let DECALS = [], SPRITES = [], FLAT = [], FACES = [], WALKERS = [], PLACES = {}, PICS = [], BUILT = [];
  // a picture laid on the ground. A picture that fills its tiles exactly is read 0.04 tile inside its
  // outermost pixels, so two pictures meet without the dark, half-transparent rim of either.
  const INSET = 0.04;
  // the river pieces whose banks the painter repaints (riverAt): 1 runs along tile x, 2 along y, 3 the round end, 4 open water
  const RVK = { 'water/river-straight-x': 1, 'water/river-strip-x': 1, 'water/river-straight-y': 2, 'water/river-strip-y': 2, 'water/river-end': 3, 'water/river-pool': 4 };
  const mkDec = (key, anchor, clip = 0, core = 0) => {
    const e = CX[key], pd = PX[e.atlas], t = e.tiles || [1, 1];
    const fills = e.w === (t[0] + t[1]) * 64 && e.h === (t[0] + t[1]) * 32;
    // the footprint in tile coords from the anchor tile: its top corner is picture pixel (tiles y * 64, 0)
    const d = (t[1] * 64 - e.anchor[0]) / 64, sm = -e.anchor[1] / 32, a0 = (sm + d) / 2, b0 = (sm - d) / 2;
    // every decal has the same fields, so the painter's loop sees one object shape
    return { pd: pd.d, stride: pd.w, x0: e.x, y0: e.y, w: e.w, h: e.h, ax: e.anchor[0] + 0.0, ay: e.anchor[1] + 0.0, ti: anchor.x, tj: anchor.y, clip, core: core || 0.5, key,
      lim: fills ? [a0 + INSET, a0 + t[0] - INSET, b0 + INSET, b0 + t[1] - INSET] : null, icy: key.startsWith('mountain/glacier'), water: key.startsWith('water/'),
      bend: false, a: null, b: null, cx: 0.5, cy: 0.5, mouths: null, mouthPic: null, fade: 0, run: null, corn: 0, rv: RVK[key] || 0, road: key.startsWith('road/'), street: 0 };
  };
  // wheat fields: painted into the ground with warped, feathered borders (not as tile diamonds)
  const FIELD = new Int8Array(N).fill(-1), FIELD_NEAR = new Uint8Array(N);
  for (const f of WORLD.fields) FIELD[idx(f.x, f.y)] = f.n;
  for (const f of WORLD.fields) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inb(f.x + dx, f.y + dy)) FIELD_NEAR[idx(f.x + dx, f.y + dy)] = 1;
  const FIELD_DEC = [0, 1, 2].map((n) => mkDec(`prop/wheat-${n}`, { x: 0, y: 0 }));
  const isField = (i, j) => i >= 0 && j >= 0 && i < W && j < H && FIELD[j * W + i] >= 0;
  // a field runs right up to a building beside it (fix round of v3: a strip of grass lay between the farm halt's foot
  // and the wheat in front of it), and its stalks stand taller along the building's foot (FIELD_TALL: those buildings)
  // Fix round 1 of the v3 merge (the critic: two lone clumps of wheat stood in the farm halt's yard, in front of the silo
  // plinth beside its door): only a field on the building's left, its NW or SW side (where the farm halt has its dock,
  // ramp and steps), runs up to it and grows taller there; on its right, its NE and SE sides (the door and the yard of
  // the Ground fit), the field keeps the margin it had in the approved preview. The tall stalks belong to that field
  // only (FIELD_TALL by field tile), so no other field's ragged edge grows taller near the building.
  const BLDF = new Uint8Array(N); // land buildings the wheat may run up to (not Codex's own pictures)
  for (const c of map) BLDF[c.i] = c.building && !WORLD.buildings.some((b) => b.x === c.x && b.y === c.y && b.codex) ? 1 : 0;
  const isBld = (i, j) => i >= 0 && j >= 0 && i < W && j < H && BLDF[j * W + i] === 1;
  const RUNUP = new Uint8Array(N); // per field tile: bit 1 runs up to a building at +x, bit 2 at -y (the building's NW, SW sides)
  const FIELD_TALL = new Array(N).fill(null); // per field tile: the building(s) whose foot its stalks stand taller along
  for (const f of WORLD.fields) for (const [dx, dy, bit] of [[1, 0, 1], [0, -1, 2]]) if (isBld(f.x + dx, f.y + dy)) { RUNUP[idx(f.x, f.y)] |= bit; (FIELD_TALL[idx(f.x, f.y)] ||= []).push([f.x + dx, f.y + dy]); }
  let FLD_T = 0; // the field tile fieldAt's point belongs to
  // where a river meets a lake or the sea (its mouth, or a lake's outlet): the river's channel fades out over
  // its last 0.26 tile and the river-water swatch fades into the still water over about 0.6 tile, so the
  // two waters blend instead of meeting at the tile edge
  const wetLink = (c, o) => c.kind === 'river' && o && (o.kind === 'lake' || o.kind === 'ocean') && o.level === c.level && (c.down === o.i || o.down === c.i);
  const MOUTH_NEAR = Array.from({ length: N }, () => []);
  for (const c of map) {
    if (c.kind !== 'river') continue;
    for (const d of DIRS) {
      const n = tileAt(c.x + d.dx, c.y + d.dy);
      if (!wetLink(c, n)) continue;
      const m = { x: (c.x + n.x) / 2, y: (c.y + n.y) / 2, dx: n.x - c.x, dy: n.y - c.y };
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inb(n.x + dx, n.y + dy)) MOUTH_NEAR[idx(n.x + dx, n.y + dy)].push(m);
    }
  }
  // glacier tiles (the side arm too with Redo on): snow keeps off them and their bank, so moraine frames the ice
  const GLAC = new Uint8Array(N);
  const RCORN = new Uint8Array(N); // a river tile's corners open onto still water (1 +x+y, 2 +x-y, 4 -x+y, 8 -x-y)
  const RFADE = new Uint8Array(N); // a river tile's sides toward still water: bits 0-3 not legs, bits 4-7 its mouths (DIRS bits)
  // a river tile's ground away from the water is its neighbours' ground (rivMat): LANDT marks land tiles, RHOST the
  // most common land material round each river tile, for the parts of it that face no land
  const LANDT = new Uint8Array(N), RHOST = new Int16Array(N);
  const HALF = { 1: 1, 2: 2, 4: 3, 8: 4 }, CORE = { 1: 5, 2: 6, 4: 7, 8: 8 };
  const popc = (b) => (b & 1) + ((b >> 1) & 1) + ((b >> 2) & 1) + ((b >> 3) & 1);
  const ROADP = { 3: 'road-straight-x', 12: 'road-straight-y', 9: 'road-curve-ne-se', 5: 'road-curve-se-sw', 6: 'road-curve-sw-nw', 10: 'road-curve-nw-ne', 7: 'road-tee-closed-ne', 14: 'road-tee-closed-se', 11: 'road-tee-closed-sw', 13: 'road-tee-closed-nw', 8: 'road-end-ne', 1: 'road-end-se', 4: 'road-end-sw', 2: 'road-end-nw', 15: 'road-cross' };
  const twc = (x, y, lift = 0) => [(x - y) * 32, (x + y) * 16 - Lv[idx(Math.max(0, Math.min(W - 1, Math.round(x))), Math.max(0, Math.min(H - 1, Math.round(y))))] * LEVEL - lift];

  // the road picture on a tile: the organic set picks one of its three variants per tile with the demo's hash
  const roadKey = (c, piece) => (state.roads === 'organic' ? `road/organic/${piece}-v${Math.floor(hash2(c.x, c.y, 319) * 3)}` : `road/${measured()}/${piece}`);
  const mouthOf = (c, n) => ({ x: (c.x + n.x) / 2, y: (c.y + n.y) / 2, dx: n.x - c.x, dy: n.y - c.y });
  const DECK_WOOD_NOTE = 'For Codex to finish: the wood is lighter and more orange than the game’s timber (sleepers 134, 107, 81), and the deck picture has no piers or supports of its own.';
  const DECK_STONE_NOTE = 'For Codex to finish: the deck picture has no piers or supports of its own.';
  // ---------- a narrow-gauge bridge (0.6 tile wide) over a river, drawn as one piece: the deck's top is Codex's
  // deck picture (its planks or flags only: the picture's raised back kerb and thick front are left out), laid
  // at rail level; under it a thin slab edge, and in the water timber trestles (wood) or stone piers (stone).
  // Low railings or walls run along both long sides. The game's bridges (bridgeLayout.ts) have the same parts.
  // Everything under the deck is cut where the ground under it or in front of it hides it, as the game's
  // Painter.horizon (bridgeMeshes.ts) does: the near bank covers the feet of the near supports and buries the
  // slab where the deck rests on it, so no support shows over the bank in front of it or under the next rails.
  const BR_HW = 0.3, BR_SLAB = 2.5, BR_WATER = 9; // half width (tiles), slab thickness and depth to the waterline (world px)
  const BR_COL = {
    wood: { lit: '#7b5434', shade: '#5a3c25', post: ['#6a4a30', '#4b3422'], rail: ['#8a6440', '#5e4229'] },
    stone: { lit: '#b9aa8c', shade: '#8d826b', post: ['#ab9d80', '#7f7562'], rail: ['#c4b596', '#968a71'] },
  };
  function makeBridge(c, axis, mat, key, o = {}) {
    const e = CX[key], z0 = c.level * LEVEL, col = BR_COL[mat];
    // (v9.2, Road bridges) the deck's edges across (tile units from the tile's centre), the posts and the pier's faces; the
    // narrow line's own bridge has the defaults, a road bridge a narrower deck, and the wider bridge one deck over both tiles
    const W0 = o.w0 ?? -BR_HW, W1 = o.w1 ?? BR_HW, POSTS = o.posts ?? [-0.22, 0.22], PIER = o.pier ?? [-0.27, 0.27];
    const EXT = Math.max(0, W1 - 0.5, -0.5 - W0);
    // a point l along and w across the deck (tile units from the tile centre), z world px up
    const P = (l, w, z) => { const a = axis === 'x' ? l : w, b = axis === 'x' ? w : l; return [(c.x + a - c.y - b) * 32, (c.x + a + c.y + b) * 16 - z]; };
    const quad = (g, pts, fill) => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]); g.closePath(); g.fillStyle = fill; g.fill(); };
    // the face toward +w is lit when it faces SW (+y, a deck along x) and shaded when it faces SE (+x)
    const frontLit = axis === 'x';
    // the ground under a map point, world px up: where the painted ground shows water, the water lies BR_WATER under
    // its tile. Read from WM, the water the ground painter records at each raster pixel (for Animate all water), so
    // the cut stops where the painted bank begins (in the v2 river pictures 0.26 to 0.36 tile from the channel's centre
    // line, not the 0.38 guide) and follows the banks whenever the painter draws them differently.
    const paintedWet = (a, b) => {
      const gx = Math.round(((a - b) * 32 - GX0) * SCALE), gy = Math.floor(((a + b) * 16 - heightAt(a, b) - GY0) * SCALE);
      return gx >= 0 && gy >= 0 && gx < GW && gy < GH && WM[gy * GW + gx] > 0;
    };
    // foam and glints in the water are water too: a point with painted water on both sides of it along x and along y,
    // within 0.09 tile (a notch in the waterline has the rim on one side, so the waterline stays where it is painted).
    // The soft shore's half-water pixels count as bank: a point is water only if the point half a world px below it
    // on screen is too.
    const between = (a, b, da, db) => [0.03, 0.06, 0.09].some((s) => paintedWet(a - s * da, b - s * db) && paintedWet(a + s * da, b + s * db));
    const water = (a, b) => paintedWet(a, b) || (between(a, b, 1, 0) && between(a, b, 0, 1));
    const wetAt = (a, b) => water(a, b) && water(a + 1 / 64, b + 1 / 64);
    const groundAt = (a, b) => heightAt(a, b) - (wetAt(a, b) ? BR_WATER : 0);
    // the height below which the point (l, w) is hidden: the ground under it, or ground in front of it. The camera
    // looks from +x +y and a line of sight climbs 32 world px for each tile it comes forward along both axes.
    // Kept until the painted water round the bridge changes (a repaint redraws the ground and WM column by column).
    const HZ = new Map();
    let hzSig = NaN;
    const [cx0, cy0] = P(0, 0, z0), wx0 = Math.round((cx0 - 48 - 32 * EXT - GX0) * SCALE), wy0 = Math.round((cy0 - 28 - 16 * EXT - GY0) * SCALE);
    const keepCut = () => {
      let sig = 0;
      for (let y = Math.max(0, wy0); y < Math.min(GH, wy0 + (64 + 32 * EXT) * SCALE); y++) for (let x = Math.max(0, wx0); x < Math.min(GW, wx0 + (96 + 64 * EXT) * SCALE); x++) sig = (sig * 31 + WM[y * GW + x]) | 0;
      if (sig !== hzSig) { HZ.clear(); hzSig = sig; }
    };
    const horizon = (l, w) => {
      const key = `${l.toFixed(4)},${w.toFixed(4)}`;
      if (HZ.has(key)) return HZ.get(key);
      const a = c.x + (axis === 'x' ? l : w), b = c.y + (axis === 'x' ? w : l);
      let h = groundAt(a, b);
      for (let d = 1 / 128; d <= (BR_WATER + 1) / 32; d += 1 / 128) h = Math.max(h, groundAt(a + d, b + d) - d * 32);
      HZ.set(key, h);
      return h;
    };
    // a vertical face under the deck from (l0, w0) to (l1, w1), z top down to bot, cut where the ground hides it:
    // one polygon whose lower edge follows the cut, so no seams show between slices; sampled finely, so where the
    // cut jumps (at the rim's inner edge) the face ends in a straight drop, not in a slant over the rim
    const face = (g, l0, w0, l1, w1, top, bot, fill) => {
      const n = Math.max(1, Math.ceil(Math.hypot(l1 - l0, w1 - w0) / 0.008)), low = [];
      let shows = false;
      for (let k = n; k >= 0; k--) {
        const l = l0 + ((l1 - l0) * k) / n, w = w0 + ((w1 - w0) * k) / n, z = Math.min(top, Math.max(bot, horizon(l, w)));
        if (z < top - 0.05) shows = true;
        low.push(P(l, w, z));
      }
      if (shows) quad(g, [P(l0, w0, top), P(l1, w1, top), ...low], fill);
    };
    // Codex's picture: tile offsets (a, b) at deck height sit at (anchor + ((a - b) * 64, (a + b) * 32)) in its pixels.
    // Its top is read from w = -0.22 (in front of the kerb) to 0.3 and stretched over the whole deck.
    const pic = (l, w) => { const w2 = 0.04 + w * (0.52 / 0.6), a = axis === 'x' ? l : w2, b = axis === 'x' ? w2 : l; return [e.anchor[0] + (a - b) * 64, e.anchor[1] + (a + b) * 32]; };
    const q0 = pic(0, 0), q1 = pic(1, 0), q2 = pic(0, 1), p0 = P(0, 0, z0), p1 = P(1, 0, z0), p2 = P(0, 1, z0);
    const ax = q1[0] - q0[0], ay = q1[1] - q0[1], bx = q2[0] - q0[0], by = q2[1] - q0[1], det = ax * by - bx * ay;
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], vx = p2[0] - p0[0], vy = p2[1] - p0[1];
    // M maps picture px to world px: M * [ax bx; ay by] = [ux vx; uy vy]
    const m11 = (ux * by - vx * ay) / det, m12 = (vx * ax - ux * bx) / det, m21 = (uy * by - vy * ay) / det, m22 = (vy * ax - uy * bx) / det;
    const tx0 = p0[0] - (m11 * q0[0] + m12 * q0[1]), ty0 = p0[1] - (m21 * q0[0] + m22 * q0[1]);
    const supports = mat === 'wood' ? [-0.27, 0, 0.27] : [-0.2, 0.2];
    function post(g, l, w, hw, top, bot, lit, cut = false) {
      // a square post (half side hw) from z top down to z bot: its +w and +l faces show (a support's are cut)
      if (cut) { face(g, l - hw, w + hw, l + hw, w + hw, top, bot, frontLit ? lit[0] : lit[1]); face(g, l + hw, w - hw, l + hw, w + hw, top, bot, frontLit ? lit[1] : lit[0]); return; }
      quad(g, [P(l - hw, w + hw, top), P(l + hw, w + hw, top), P(l + hw, w + hw, bot), P(l - hw, w + hw, bot)], frontLit ? lit[0] : lit[1]);
      quad(g, [P(l + hw, w - hw, top), P(l + hw, w + hw, top), P(l + hw, w + hw, bot), P(l + hw, w - hw, bot)], frontLit ? lit[1] : lit[0]);
    }
    function ripple(g, l, w, r) {
      // only round a foot that stands in the water and shows, and only where the whole ring lies on painted water
      // (a point drawn at the waterline shows the ground BR_WATER / 32 tile further forward along both axes)
      if (!wetAt(c.x + (axis === 'x' ? l : w), c.y + (axis === 'x' ? w : l)) || horizon(l, w) > z0 - BR_WATER + 0.5) return;
      const a0 = c.x + (axis === 'x' ? l : w) + BR_WATER / 32, b0 = c.y + (axis === 'x' ? w : l) + BR_WATER / 32;
      for (const [dx, dy] of [[-1.2 * r - 0.5, 0.4], [1.2 * r + 0.5, 0.4], [0, -0.1 - 0.5 * r], [0, 0.9 + 0.5 * r]]) if (!wetAt(a0 + dx / 64 + dy / 32, b0 - dx / 64 + dy / 32)) return;
      const [x, y] = P(l, w, z0 - BR_WATER);
      g.beginPath(); g.ellipse(x, y + 0.4, r * 1.2, r * 0.5, 0, 0, Math.PI * 2); g.strokeStyle = 'rgba(214,232,226,0.38)'; g.lineWidth = 0.5; g.stroke();
    }
    function railing(g, w) {
      if (mat === 'wood') {
        for (let l = -0.45; l <= 0.46; l += 0.225) post(g, l, w, 0.018, z0 + 4.2, z0, col.post);
        quad(g, [P(-0.5, w, z0 + 4.6), P(0.5, w, z0 + 4.6), P(0.5, w, z0 + 3.4), P(-0.5, w, z0 + 3.4)], frontLit ? col.rail[0] : col.rail[1]);
      } else {
        // a low parapet: a course of stone 2.2 px high with a lighter coping
        const t = 0.022, h = 2.2;
        quad(g, [P(-0.5, w + t, z0 + h), P(0.5, w + t, z0 + h), P(0.5, w + t, z0), P(-0.5, w + t, z0)], frontLit ? col.post[0] : col.post[1]);
        quad(g, [P(-0.5, w - t, z0 + h), P(0.5, w - t, z0 + h), P(0.5, w + t, z0 + h), P(-0.5, w + t, z0 + h)], col.rail[0]);
      }
    }
    return {
      back(g) {
        keepCut();
        // supports first (the far ones are hidden behind the near ones), then the slab edge, then the deck top
        for (const l of supports) {
          if (mat === 'wood') {
            for (const w of POSTS) { post(g, l, w, 0.03, z0 - BR_SLAB, z0 - BR_WATER, col.post, true); ripple(g, l + 0.03, w + 0.03, 1.6); }
            // a cross brace between the bent's two posts, drawn where the ground does not hide it
            g.strokeStyle = col.post[1]; g.lineWidth = 0.7; g.beginPath();
            for (const [w0, w1] of POSTS.flatMap((w, q) => (q + 1 < POSTS.length ? [[w, POSTS[q + 1]], [POSTS[q + 1], w]] : []))) {
              for (let k = 0, on = false; k <= 48; k++) {
                const w = w0 + ((w1 - w0) * k) / 48, z = z0 - BR_SLAB - 0.5 - ((BR_WATER - BR_SLAB - 1.5) * k) / 48, q = P(l + 0.03, w, z);
                if (z < horizon(l + 0.03, w)) { on = false; continue; }
                if (on) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]);
                on = true;
              }
            }
            g.stroke();
          } else {
            // a stone pier, long across the deck (along the river's flow)
            const hw = 0.06;
            face(g, l - hw, PIER[1], l + hw, PIER[1], z0 - BR_SLAB, z0 - BR_WATER, frontLit ? col.post[0] : col.post[1]);
            face(g, l + hw, PIER[0], l + hw, PIER[1], z0 - BR_SLAB, z0 - BR_WATER, frontLit ? col.post[1] : col.post[0]);
            ripple(g, l + hw, PIER[1], 2.6);
          }
        }
        // the slab's edge along the near long side, buried where the deck rests on a bank
        face(g, -0.5, W1, 0.5, W1, z0, z0 - BR_SLAB, frontLit ? col.lit : col.shade);
        // the deck top: Codex's picture, clipped to the deck and mapped onto it
        // (v9.2) a deck wider than Codex's picture (0.6 tile) repeats it across: its planks and flags run along the bridge, so
        // each repeat is another run of planks, the next one's edge overlapping a hair so no seam shows between them
        const step = 0.6;
        // (fix round) the stone picture has its own parapet along its back edge (w -0.3 to -0.22); that is right once, on the
        // deck's back edge, and a wall across the middle of a wider deck at every repeat, so the repeats of a stone deck use only
        // the picture's flat top (w -0.22 to 0.3, 0.52 wide) and show no wall; the wood deck has no kerb and keeps its repeats
        const flatOnly = mat === 'stone' && W1 - W0 > step + 1e-6;
        for (let k = 0, wa = W0; wa < W1 - 1e-6; k++) {
          const span = flatOnly && k ? 0.52 : step, wb = Math.min(W1, wa + span), wa2 = k ? wa - 0.01 : wa;
          g.save();
          const t = [P(-0.5, wa2, z0), P(0.5, wa2, z0), P(0.5, wb, z0), P(-0.5, wb, z0)];
          g.beginPath(); g.moveTo(t[0][0], t[0][1]); for (let q = 1; q < 4; q++) g.lineTo(t[q][0], t[q][1]); g.closePath(); g.clip();
          const mid = flatOnly ? (k ? wa + 0.22 : W0 + 0.3) : W1 - W0 <= step + 1e-6 ? (W0 + W1) / 2 : W0 + 0.3 + k * step;
          const sh = P(0, mid, z0); // where the picture's middle lies
          g.transform(m11, m21, m12, m22, tx0 + (sh[0] - p0[0]), ty0 + (sh[1] - p0[1]));
          g.drawImage(IMG[e.atlas], e.x, e.y, e.w, e.h, 0, 0, e.w, e.h);
          g.restore();
          wa += span;
        }
        railing(g, W0 + 0.03);
      },
      front(g) { railing(g, W1 - 0.03); },
    };
  }
  // ---------- road bridges (v9.2, the author's yes to option A: a road may cross water on a bridge platform without rail, and
  // walkers cross on it). WORLD.rb holds the demo's two: the roads that lead to them and the bridge tiles. They apply only
  // while Road bridges is On: Off puts every tile back as v9.1 had it, so the scene is v9.1's.
  const RBR = WORLD.rb;
  function applyRBridges() {
    const on = state.rbridges === 'on';
    for (const [x, y, bits] of RBR.roads) { const c = T(x, y); if (c.road0 === undefined) c.road0 = c.road || 0; c.road = on ? c.road0 | bits : c.road0 || undefined; }
    for (const r of RBR.bridges) T(r.x, r.y).rbr = on ? r.axis : undefined;
  }
  // the side (+1 toward +w, -1 toward -w) a road bridge lies beside this narrow-line bridge tile, 0 if none: the two become one
  const rbBeside = (c) => { for (const s of [1, -1]) { const o = c.bridge === 'x' ? tileAt(c.x, c.y + s) : tileAt(c.x + s, c.y); if (o && o.rbr === c.bridge) return s; } return 0; };
  // a road deck's edges (0.5 wide: the organic road is 0.32 with its soft edge), and the wider bridge's: from the line's
  // outer edge (the narrow deck is 0.6) to the road's, one deck with posts every 0.48 across and one pier under all of it
  const RBR_DECK = { w0: -0.25, w1: 0.25, posts: [-0.18, 0.18], pier: [-0.22, 0.22] };
  const RBR_WIDE = (s) => (s > 0 ? { w0: -0.3, w1: 1.25, posts: [-0.22, 0.26, 0.74, 1.22], pier: [-0.27, 1.22] } : { w0: -1.25, w1: 0.3, posts: [-1.22, -0.74, -0.26, 0.22], pier: [-1.22, 0.27] });
  function buildScene(census) {
    applyRBridges();
    const decals = Array.from({ length: N }, () => []);
    const pics = Array.from({ length: N }, () => []);
    const built = Array.from({ length: N }, () => []);
    const places = {};
    const sprites = [], faces = [];
    const place = (key, c, note) => { (places[key] ||= []).push({ x: c.x, y: c.y }); pics[c.i].push({ key, note }); };
    const dec = mkDec;
    const put = (c, d) => decals[c.i].push(d);
    const putArea = (d, x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inb(x, y)) put(T(x, y), d); };

    for (const c of map) { MAT[c.i] = matOf(c); SNOWT[c.i] = snowOf(c); GLAC[c.i] = isGlacier(c) ? 1 : 0; }
    // snowBrink's lookups: per tile, the highest snow tile round it (-9 none) and the lowest level round it
    for (const c of map) {
      let top = -9, low = 99;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const i = c.x + di, j = c.y + dj;
        if (i < 0 || j < 0 || i >= W || j >= H) continue;
        const k = j * W + i;
        if (Lv[k] < low) low = Lv[k];
        if (SNOWT[k] > 0 && !VALLEY[k] && !GLAC[k] && Lv[k] > top) top = Lv[k];
      }
      SBTOP[c.i] = top; SBLOW[c.i] = low;
    }
    for (const c of map) LANDT[c.i] = c.kind === 'land' && !isGlacier(c) ? 1 : 0;
    for (const c of map) {
      if (c.kind !== 'river') continue;
      const n = new Float32Array(32); let best = M.GRASS, bw = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const o = tileAt(c.x + dx, c.y + dy);
        if (!o || !LANDT[o.i]) continue;
        const m = MAT[o.i], w = (n[m] += dx && dy ? 1 : 2.01); // a side weighs a little more than two corners
        if (w > bw) { bw = w; best = m; }
      }
      RHOST[c.i] = best;
    }

    // channels: rivers and glaciers
    const legsOf = (c) => {
      let bits = 0;
      for (const d of DIRS) {
        const n = tileAt(c.x + d.dx, c.y + d.dy);
        if (!n) { if (c.kind === 'river' && c.down < 0) bits |= d.bit; continue; }
        const wet = n.kind === 'river' || n.kind === 'lake' || n.kind === 'ocean' || isGlacier(n);
        if (!wet) continue;
        if (downOf(c) === n.i || (downOf(n) === c.i && n.kind !== 'ocean')) bits |= d.bit;
      }
      return bits;
    };
    const channel = (c, bits, P, note) => {
      const n = popc(bits);
      if (bits === 3) { put(c, dec(P.sx, c)); place(P.sx, c, note); return; }
      if (bits === 12) { put(c, dec(P.sy, c)); place(P.sy, c, note); return; }
      if (n === 2) {
        // a turn: the demo bends the straight pieces round the corner the two exits share (placeholder: no curves were delivered)
        const bd = dec(P.sx, c);
        bd.bend = true; bd.a = dec(P.sx, c); bd.b = dec(P.sy, c); bd.cx = bits & 1 ? 0.5 : -0.5; bd.cy = bits & 4 ? 0.5 : -0.5; bd.key = `${P.sx}~bend${bits}`;
        put(c, bd);
        const why = 'bent round this turn by the demo: a placeholder, since Codex delivered no curves';
        place(P.sx, c, why); place(P.sy, c, why);
        return;
      }
      const base = n >= 3 ? P.pool : P.end;
      put(c, dec(base, c)); place(base, c, n === 1 ? 'the round end, with half a straight toward its exit' : 'a junction, composed in the demo from the open water and half straights (a placeholder)');
      for (const d of DIRS) if (bits & d.bit) put(c, dec(d.bit & 3 ? P.sx : P.sy, c, HALF[d.bit]));
      if (n >= 2) for (const d of DIRS) if (bits & d.bit) put(c, dec(d.bit & 3 ? P.sx : P.sy, c, CORE[d.bit], P.core));
      const legKeys = new Set(); for (const d of DIRS) if (bits & d.bit) legKeys.add(d.bit & 3 ? P.sx : P.sy);
      for (const k of legKeys) place(k, c, 'half of it, toward each exit');
    };
    // (a river junction's cores draw only their water, riverAt, so they reach past the waterline: 0.45, was 0.37)
    const RIV = { sx: 'water/river-straight-x', sy: 'water/river-straight-y', end: 'water/river-end', pool: 'water/river-pool', core: 0.45 };
    const GLA = { sx: 'mountain/glacier-straight-x', sy: 'mountain/glacier-straight-y', end: 'mountain/glacier-lobe', pool: 'mountain/glacier-lobe', core: 0.39 };
    const used = new Set();
    // one strip of three straights in one picture, along each axis
    const strip = (pred, axis, key) => {
      for (const c of map) {
        if (!pred(c) || used.has(c.i)) continue;
        const a = axis === 'x' ? [tileAt(c.x - 1, c.y), tileAt(c.x + 1, c.y)] : [tileAt(c.x, c.y - 1), tileAt(c.x, c.y + 1)];
        if (a.some((o) => !o || !pred(o) || used.has(o.i))) continue;
        const d = dec(key, c);
        for (const o of [a[0], c, a[1]]) { put(o, d); used.add(o.i); place(key, o, 'three straight tiles in one picture'); }
        return;
      }
    };
    const rivers = map.filter((c) => c.kind === 'river');
    const legs = new Int8Array(N);
    for (const c of map) if (c.kind === 'river' || isGlacier(c)) legs[c.i] = legsOf(c);
    // a three-tile strip is one picture, so it never takes a tile that opens onto still water (that tile fades on its own)
    const stillBeside = (c) => DIRS.some((d) => { const o = tileAt(c.x + d.dx, c.y + d.dy); return o && (o.kind === 'lake' || o.kind === 'ocean'); });
    const plainRiver = (bits) => (c) => c.kind === 'river' && !c.headwater && legs[c.i] === bits && !stillBeside(c);
    RFADE.fill(0); RCORN.fill(0);
    strip(plainRiver(3), 'x', 'water/river-strip-x');
    strip(plainRiver(12), 'y', 'water/river-strip-y');
    const plainIce = (bits) => (c) => isGlacier(c) && legs[c.i] === bits && !(c.arm && !state.redo);
    if (state.redo) strip((c) => c.arm && legs[c.i] === 3, 'x', 'mountain/glacier-strip-x');
    if (glacierName === 'demo') strip((c) => c.kind === 'glacier' && plainIce(12)(c) && c.y >= 6, 'y', 'mountain/glacier-strip-y');
    for (const c of rivers) {
      if (used.has(c.i)) continue;
      const bits = legs[c.i];
      if (c.headwater === 'spring' && state.redo) { const k = `mountain/spring-${c.springExit}`; put(c, dec(k, c)); place(k, c, `a spring leaving through ${c.springExit.toUpperCase()}`); continue; }
      const dn = map[c.down];
      if (dn && (dn.kind === 'lake' || dn.kind === 'ocean')) {
        const d = DIRS.find((q) => q.dx === dn.x - c.x && q.dy === dn.y - c.y);
        const opp = DIRS.find((q) => q.dx === -d.dx && q.dy === -d.dy);
        if ((bits & ~(d.bit | opp.bit)) === 0) {
          // (Codex's NW attempt 2 is left out since feedback 2026-10-12b: its wide stony banks end square on the
          // land and cannot fade like the others, so every mouth is now the channel opening as below)
          const k = state.redo ? `water/river-mouth-${d.edge}` : null;
          if (k) { const dd = dec(k, c); dd.mouthPic = mouthOf(c, dn); put(c, dd); put(dn, dd); place(k, c, `the river opens to the ${d.edge.toUpperCase()}`); place(k, dn, 'the open water of a river mouth, fading out into the open water by the demo'); continue; }
        }
      }
      const before = decals[c.i].length;
      channel(c, bits, RIV, c.headwater === 'spring' ? 'a spring: with Redo on, the spring picture' : '');
      // every leg into a lake or the sea opens into it (mouths and lake outlets alike): the banks end before the
      // edge in a ragged point, and the channel's own water runs on into the still water (the straight picture
      // continued past the edge, banks left out) and fades there. A side that is not a leg but borders still
      // water has no bank: the channel's water meets the still water along a ragged line.
      const mouths = [];
      let fade = 0, mouthBits = 0;
      for (const d of DIRS) {
        const o = tileAt(c.x + d.dx, c.y + d.dy);
        if (!o || (o.kind !== 'lake' && o.kind !== 'ocean')) continue;
        if (bits & d.bit) {
          if (!wetLink(c, o)) continue;
          const m = mouthOf(c, o); mouths.push(m); mouthBits |= d.bit;
          const run = dec(d.bit & 3 ? RIV.sx : RIV.sy, o); run.run = m; run.key = `${run.key}~run`; put(o, run);
        } else fade |= d.bit;
      }
      for (let q = before; q < decals[c.i].length; q++) {
        const dd = decals[c.i][q];
        // the pieces are shared objects only within this tile (dec makes a new one per call)
        if (mouths.length) dd.mouths = mouths;
        if (fade) dd.fade = fade;
      }
      RFADE[c.i] = fade | (mouthBits << 4);
      // a corner between two legs that looks onto still water diagonally (a junction beside a lake's outlet): its
      // bank stones would stand alone in the water once the neighbours' banks are gone, so that corner opens too
      let corn = 0;
      for (const [k, sx, sy] of [[1, 1, 1], [2, 1, -1], [4, -1, 1], [8, -1, -1]]) {
        const o = tileAt(c.x + sx, c.y + sy), a = tileAt(c.x + sx, c.y), b = tileAt(c.x, c.y + sy);
        if (o && (o.kind === 'lake' || o.kind === 'ocean') && a && b && a.kind !== 'land' && b.kind !== 'land' && a.kind !== 'glacier' && b.kind !== 'glacier') corn |= k;
      }
      RCORN[c.i] = corn;
      if (corn) for (let q = before; q < decals[c.i].length; q++) decals[c.i][q].corn = corn;
      if (mouths.length) place('swatch/river-water', c, 'the river’s current, fading into the still water');
    }
    for (const c of map) {
      if (!isGlacier(c) || used.has(c.i) || VALLEY[c.i] === 1) continue; // the glacier options paint their own ice
      channel(c, legs[c.i], GLA, '');
    }

    // roads, raw #319 strips, wheat
    const v = variant();
    const rawX = [24, 25, 26].map((x) => T(x, 28)), rawY = [26, 27, 28].map((y) => T(30, y));
    // the town paving: its tiles and their neighbours, and a doorstep before each paved house's door (paveShape)
    PAVE_NEAR.fill(0);
    for (const c of map) if (MAT[c.i] === M.CITY) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inb(c.x + dx, c.y + dy)) PAVE_NEAR[idx(c.x + dx, c.y + dy)] = 1;
    DOORSTEPS = WORLD.buildings.filter((b) => !b.codex && T(b.x, b.y).paved).map((b) => [b.x, b.y + 0.56, 0.17, 0.2]);
    for (const q of DOORSTEPS) for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 1; dx++) if (inb(q[0] + dx, Math.floor(q[1]) + dy)) PAVE_NEAR[idx(q[0] + dx, Math.floor(q[1]) + dy)] = 1;
    for (const c of map) {
      if (!c.road) continue;
      if (c.track) continue; // a crossing: drawn over the track as a sprite
      if (state.raw && (rawX.includes(c) || (rawY.includes(c) && c.y < 28))) continue;
      const k = roadKey(c, ROADP[c.road]);
      // across the town square the road is paved: its picture gives the street's shape, laid in setts (streetAt)
      const sq = c.paved && pavingName !== 'v2', d = dec(k, c);
      if (sq) d.street = c.road === 12 ? 2 : 1;
      put(c, d); place(k, c, sq ? 'across the town square: its shape laid as a paved street (setts in courses along it), no gravel or verges' : v === 'organic' ? `organic road, variant ${k.slice(-1) * 1 + 1} of 3 (each tile picks one; any variant joins any other)` : '');
    }
    if (state.raw) {
      const dx = dec('road/material/road-strip-x', T(25, 28)), dy = dec('road/material/road-strip-y', T(30, 27));
      for (const c of rawX) { put(c, dx); place('road/material/road-strip-x', c, 'the raw #319 material, 0.5 tile wide, for comparison'); }
      for (const c of rawY) { put(c, dy); place('road/material/road-strip-y', c, 'the raw #319 material, 0.5 tile wide, for comparison'); }
    }
    for (const f of WORLD.fields) { const c = T(f.x, f.y), k = `prop/wheat-${f.n}`; place(k, c, 'a wheat field, its border warped and feathered by the demo'); }

    // ---- sprites
    const gs = (key, wx, wy, depth, o = {}) => {
      const f = GAME[key]; const s = ((o.scale ?? 1) * f.k) / f.res;
      return { img: IMG[f.s], sx: f.x, sy: f.y, sw: f.w, sh: f.h, x: wx - f.ax * s, y: wy - f.ay * s, w: f.w * s, h: f.h * s, depth, flip: !!o.flip, key };
    };
    const cs = (key, wx, wy, depth, sc = 1) => {
      const e = CX[key];
      return { img: IMG[e.atlas], sx: e.x, sy: e.y, sw: e.w, sh: e.h, x: wx - (e.anchor[0] / 2) * sc, y: wy - (e.anchor[1] / 2) * sc, w: (e.w / 2) * sc, h: (e.h / 2) * sc, depth, key };
    };
    const D = (c, layer) => (c.x + c.y) * 100 + layer;
    // track, level crossings and bridges lie flat on the ground: the painter draws them before anything
    // that stands up (trees, buildings, people), so a walker crossing the line is never drawn under the rails
    for (const t of WORLD.track) {
      const c = T(t.x, t.y);
      const key = t.kind === 'curve' ? (t.cls === 'regular' ? `track/curve_regular_${t.rot}_m${t.member}` : `track/curve_narrow_${t.rot}`) : `track/straight_${t.cls}_${t.rot}`;
      const [wx, wy] = twc(c.x, c.y);
      if (c.bridge) {
        // one bridge: Codex's deck surface at rail level under the rails, its edge, railings and supports drawn by the demo
        // the deck the Bridge deck switch asks for, on both bridges. The stone deck along x is a redo: it shows anyway
        // when Stone is chosen, with its red chip in the tooltip (v2 kept the town bridge wood, so the switch seemed dead)
        const k = `bridge/${state.deck}-deck-${c.bridge}-narrow`;
        const redo = CX[k].status === 'flagged-redo';
        const finish = state.deck === 'wood' ? DECK_WOOD_NOTE : DECK_STONE_NOTE;
        const side = rbBeside(c); // (v9.2, Road bridges) a road bridge right beside this one: one wider bridge over both tiles
        const br = makeBridge(c, c.bridge, state.deck, k, side ? RBR_WIDE(side) : {});
        sprites.push({ flat: true, depth: D(c, 3), draw: br.back, key: k }, { flat: true, depth: D(c, 6), draw: br.front, key: k });
        if (side) built[c.i].push('Wider bridge: this bridge and the road bridge beside it share one deck, its piers and the parapets on its two outer edges');
        place(k, c, `${redo ? 'A redo (painted 0.84 tile wide; this is Codex’s version squeezed onto the guide), shown because Stone is chosen. ' : ''}Codex’s deck surface, laid at rail level under the rails; the demo draws its edge, railings and ${state.deck === 'stone' ? 'stone piers' : 'timber trestles'} in the water. ${finish}`);
      }
      sprites.push({ ...sleeperPic(gs(key, wx, wy, D(c, 4)), key, wx, wy), flat: true }); // (v9: Sleepers)
      built[c.i].push(`${t.cls === 'regular' ? 'Regular' : 'Narrow'} track: game ${key.slice(6)}${sleeperNote(key)}`);
      if (c.road) {
        const along = t.rot === 0 ? 0 : 1; // r0: track along tile y
        const k = roadKey(c, `crossing-${t.cls}-r${along}`);
        sprites.push({ ...cs(k, wx, wy, D(c, 5)), flat: true }); place(k, c, `a level crossing over the ${t.cls} track`);
        if (v !== 'organic' && state.crossing === 'stone') place(`road/material/crossing-material-${t.cls}`, c, 'the sett material inside this stone deck');
      }
    }
    // road bridges (v9.2): a deck at the water tile's level with a road leading to it on both banks; one lying beside the
    // narrow line's bridge is drawn with it (above), as one wider bridge
    for (const r of RBR.bridges) {
      const c = T(r.x, r.y);
      if (c.rbr !== r.axis) continue;
      const k = `bridge/${state.deck}-deck-${r.axis}-narrow`, redo = CX[k].status === 'flagged-redo';
      const wide = [1, -1].some((s) => { const o = r.axis === 'x' ? tileAt(c.x, c.y + s) : tileAt(c.x + s, c.y); return o && o.bridge === r.axis; });
      if (!wide) {
        const br = makeBridge(c, r.axis, state.deck, k, RBR_DECK);
        sprites.push({ flat: true, depth: D(c, 3), draw: br.back, key: k }, { flat: true, depth: D(c, 6), draw: br.front, key: k });
      }
      place(k, c, `${redo ? 'A redo (painted 0.84 tile wide; this is Codex’s version squeezed onto the guide), shown because Stone is chosen. ' : ''}A road bridge (v9.2): ${wide ? 'one deck with the narrow line’s bridge beside it, the rail on one half and the road on the other, ' : 'Codex’s deck surface for the roadway, '}its edge, parapets and ${state.deck === 'stone' ? 'stone piers' : 'timber trestles'} drawn by the demo; the road’s gravel runs up to the deck at both banks.`);
      built[c.i].push(`Road bridge (${state.deck})${wide ? ', widened with the line’s bridge' : ''}`);
    }
    // buildings
    gfBegin(census);
    for (const b of WORLD.buildings) {
      const c = T(b.x, b.y);
      const [wx, wy] = twc(c.x, c.y);
      if (b.codex) {
        if (b.redo && !state.redo) continue;
        const k = b.key.slice(6);
        sprites.push(cs(k, wx, wy, D(c, 20), bScale(b.key))); place(k, c, (b.redo ? 'another view of the Fuel Pump, its front toward the track' : 'the Fuel Pump, its front (the hose crane) toward the track') + bsNote(b.key));
        built[c.i].push(`Fuel Pump (Codex, view r${k.slice(-1)})${bsNote(b.key)}`);
      } else {
        sprites.push(gs(b.key, wx, wy, D(c, 20), { scale: bScale(b.key) }));
        built[c.i].push(`${b.name}: game ${b.key.slice(11)}${bsNote(b.key)}`);
      }
      gfDress(b, c, sprites[sprites.length - 1], sprites);
      bsFigureSprites(b, c, sprites); // (v9: Building scale, people at the doors for the shots)
    }
    // props: the game's trees, rocks, bushes, flowers, reeds and cactus
    const busy = (c) => c.road || c.track || c.building || c.field !== undefined || c.paved || c.pond || c.cove || c.coveSand || c.ring;
    const pick = (arr, r) => arr[Math.min(arr.length - 1, Math.floor(r * arr.length))];
    TREEN.fill(0);
    for (const c of map) {
      if (c.kind !== 'land' || busy(c) || (c.arm && state.redo) || SNOWT[c.i] > 0) continue;
      const r = (k) => hash2(c.x, c.y, k);
      const items = [];
      const nearLake = DIRS.some((d) => { const o = tileAt(c.x + d.dx, c.y + d.dy); return o && (o.kind === 'lake' || o.kind === 'river') && !o.pond; });
      if (c.terrain === 'forest') {
        const n = 3 + (r(1) < 0.5 ? 1 : 0);
        const kinds = c.climate === 'taiga' || c.biome === 'taiga' ? ['spruce', 'spruce', 'pine', 'pine', 'birch'] : ['oak', 'tree', 'tree', 'oak', 'birch', 'pine'];
        for (let k = 0; k < n; k++) items.push([`props/${pick(kinds, r(10 + k))}_${Math.floor(r(20 + k) * 3)}`, (r(30 + k) - 0.5) * 0.8, (r(40 + k) - 0.5) * 0.8]);
      } else if (c.terrain === 'rock') {
        if (r(2) < 0.35) items.push([`props/${r(3) < 0.5 ? 'boulder' : 'rock'}_${Math.floor(r(4) * 3)}`, (r(5) - 0.5) * 0.5, (r(6) - 0.5) * 0.5]);
      } else if (c.terrain === 'hill') {
        if (r(2) < 0.3) items.push([`props/${pick(['boulder', 'rock', 'bush', 'pine'], r(3))}_${Math.floor(r(4) * 3)}`, (r(5) - 0.5) * 0.6, (r(6) - 0.5) * 0.6]);
      } else if (c.terrain === 'sand' && c.biome !== 'beach') {
        // (v9.1: the dead trees are a fifth of v9's, the cacti and every other tile as they were: of the quarter of these props that were
        // dead trees, the first fifth of them stay and the rest are no prop)
        if (r(2) < 0.18 && r(3) < 0.8) items.push([`props/${r(3) < 0.75 ? 'cactus' : 'deadtree'}_${Math.floor(r(4) * 2)}`, (r(5) - 0.5) * 0.6, (r(6) - 0.5) * 0.6]);
      } else if (c.biome !== 'beach' && c.biome !== 'mountain') {
        const p = r(2);
        if (nearLake && r(9) < 0.45) items.push([`props/reeds_${Math.floor(r(4) * 2)}`, (r(5) - 0.5) * 0.5, (r(6) - 0.5) * 0.5]);
        else if (p < 0.07) items.push([`props/bush_${Math.floor(r(4) * 3)}`, (r(5) - 0.5) * 0.6, (r(6) - 0.5) * 0.6]);
        else if (p < 0.13) items.push([`props/flowers_${Math.floor(r(4) * 4)}`, (r(5) - 0.5) * 0.6, (r(6) - 0.5) * 0.6]);
        else if (p < 0.155) items.push([`props/rock_${Math.floor(r(4) * 3)}`, (r(5) - 0.5) * 0.6, (r(6) - 0.5) * 0.6]);
        else if (p < 0.19 && c.climate !== 'desert') items.push([`props/${c.climate === 'taiga' ? 'spruce' : 'oak'}_${Math.floor(r(4) * 3)}`, (r(5) - 0.5) * 0.4, (r(6) - 0.5) * 0.4]);
      }
      const names = new Set();
      for (const [key, ox, oy] of items) {
        if (!GAME[key]) continue;
        const tx = c.x + ox, ty = c.y + oy;
        const z = heightAt(tx, ty);
        // no tree stands in front of a waterfall (v2: two falls were hidden behind pines and oaks)
        if (/^props\/(oak|tree|birch|pine|spruce|deadtree|palm)_/.test(key)) {
          const f0 = GAME[key], sc = f0.k / f0.res, px = (tx - ty) * 32, py = (tx + ty) * 16 - z, hw = (f0.w * sc) / 2, ht = f0.h * sc;
          if (FALLS.some((f) => tx + ty > (f.c.x + f.n.x + f.c.y + f.n.y) / 2 && px + hw > f.box[0] && px - hw < f.box[2] && py > f.box[1] && py - ht < f.box[3])) continue;
        }
        sprites.push(gs(key, Math.round((tx - ty) * 32), Math.round((tx + ty) * 16 - z), (tx + ty) * 100 + 10));
        if (/^props\/(oak|tree|birch|pine|spruce)_/.test(key)) TREEN[c.i]++;
        names.add(key.slice(6).replace(/_\d$/, ''));
      }
      if (names.size) built[c.i].push(`game ${[...names].join(', ')}`);
    }
    for (const c of map) MOSSF[c.i] = MAT[c.i] === M.TAIGA || (MAT[c.i] === M.FOREST && !TREEN[c.i]) ? 1 : 0;
    // reeds on a few river banks beside grass or forest (fix round of v3: the river stub by the farm halt read as a canal)
    for (const c of rivers) {
      if (FALLT[c.i] || ICET[c.i] || c.headwater || c.bridge || c.track) continue;
      for (const d of DIRS) {
        const o = tileAt(c.x + d.dx, c.y + d.dy);
        if (!o || legs[c.i] & d.bit || o.kind !== 'land' || busy(o) || o.biome === 'beach' || o.biome === 'mountain' || o.terrain === 'sand' || o.terrain === 'rock' || SNOWT[o.i] || Lv[o.i] !== Lv[c.i]) continue;
        if (hash2(c.x * 4 + d.bit, c.y, 77) > 0.4) continue;
        const al = (hash2(c.x, c.y * 4 + d.bit, 78) - 0.5) * 0.6, tx = c.x + d.dx * 0.43 + (d.dx ? 0 : al), ty = c.y + d.dy * 0.43 + (d.dy ? 0 : al);
        const key = `props/reeds_${Math.floor(hash2(c.x, c.y, 79 + d.bit) * 2)}`;
        if (!GAME[key]) continue;
        sprites.push(gs(key, Math.round((tx - ty) * 32), Math.round((tx + ty) * 16 - heightAt(tx, ty)), (tx + ty) * 100 + 10));
        if (!built[c.i].includes('game reeds')) built[c.i].push('game reeds');
      }
    }
    // wheat stalks: one picture per tile the wheat reaches, drawn at that tile's depth like a prop (after a building on
    // the tile; see cutWheat). Not on track tiles: the rails lie flat and are drawn before anything stands up, so the
    // wheat stays under them there
    for (const c of map) if (FIELD_NEAR[c.i] && !c.track) sprites.push({ depth: D(c, c.building ? 21 : 12), key: 'wheat-layer', c, ver: -1, cv: null, draw(g) { if (this.ver !== WHEAT_VER) cutWheat(this); if (this.cv) g.drawImage(this.cv, this.x, this.y, this.w, this.h); } });

    // waterfalls: the ground painter paints each fall on its slope (fallAt), and its foam where the water lands
    for (const f of FALLS) {
      const { c, n, edge } = f;
      if (!f.near) { pics[c.i].push({ key: null, note: `This waterfall drops away from the camera (${edge.toUpperCase()}): its slope looks away, so the river curls over the brink in a line of broken white water and foams on the water below.` }); continue; }
      place(f.sheet, c, `the falling water, laid along the slope the river drops ${f.d} level${f.d > 1 ? 's' : ''} down (${f.w.toFixed(2)} tile long), as wide as the river’s water, its sides wet rock and spray, river-coloured at the brink and breaking white toward the foot, landing in a plunge pool of foam a little wider than the river; still (Animate all water runs it down the slope)`);
    }
    for (const c of map) {
      // the glacier's end: the ground painter paints its ice front into the vertical step over the melt (iceFront)
      if (ICET[c.i] !== 2) continue;
      const n = map[c.down], d = DIRS.find((q) => q.dx === n.x - c.x && q.dy === n.y - c.y);
      if (d.edge !== 'sw' && d.edge !== 'se') continue;
      const lit = d.edge === 'sw' ? 'lit' : 'shade';
      place(`mountain/face-ice-cliff-${lit}`, c, 'the ice front at the glacier’s end, painted into the step over its melt and drawn toward the glacier’s blue-white: a jagged lip of broken ice, crevasses down the face, a dirty band at its foot and a low, deep-blue cave the melt runs out of, moraine rubble piled either side');
    }
    // v3, the Ice channel: its steps and front are painted from Codex's ice-cliff material, its cave from the portal's
    if (glacierName === 'channel') for (const c of map) {
      if (VALLEY[c.i] !== 1 || c.down < 0) continue;
      const n = map[c.down];
      if (VALLEY[n.i] === 1 && Lv[n.i] < Lv[c.i]) place('mountain/face-ice-cliff-lit', c, 'the channel’s ice step: the cracks of the ice-cliff material, coloured as ice lit from the upper left');
      else if (n.kind === 'river') {
        place('mountain/face-ice-cliff-lit', c, 'the ice front at the channel’s end: the cracks of the ice-cliff material, coloured as ice lit from the upper left');
        place('mountain/face-ice-portal-lit', c, 'the meltwater cave at the foot of the ice front: the dark inside of this material, without its grey frame');
      }
    }
    // ground swatch places (one per material, the first tile that shows it)
    for (const c of map) { if (c.inflow && MOUTH_NEAR[c.i].length) { (places['swatch/river-water'] ||= []).push({ x: c.x, y: c.y }); pics[c.i].push({ key: 'swatch/river-water', note: 'the river’s current, fading out over about 0.6 tile from the mouth' }); } const k = SWATCH[MAT[c.i]]; if (k && !places[k]) (places[k] ||= []).push({ x: c.x, y: c.y }); if (MAT[c.i] === M.ROCKMIX) for (const kk of ['swatch/mountain-rock-high', 'swatch/alpine-ground']) (places[kk] ||= []).push({ x: c.x, y: c.y }); if (SNOWT[c.i]) (places['swatch/snow'] ||= []).push({ x: c.x, y: c.y }); if (MAT[c.i] === M.BEACH && OCEANSIDE[c.i] && state.redo) (places['swatch/wet-sand'] ||= []).push({ x: c.x, y: c.y }); }

    // walkers
    const walkers = [];
    for (const w of WORLD.walkers) {
      if ((w.extra && !state.extras) || (w.redoOnly && !state.redo && !peopleFixed()) || (w.rbr && state.rbridges !== 'on')) continue;
      walkers.push(w);
      const strips = ['front', 'back'].flatMap((f) => ['walk', 'carry'].map((k) => `people/${w.who}-${f}-${k}`)).filter((k) => CX[k]);
      for (const k of strips) {
        const carry = k.endsWith('carry'), front = k.includes('-front-');
        if (carry && !w.carry) continue;
        // which leg uses this strip: out leg directions come from the route, the back leg reverses them
        const segs = []; for (let q = 1; q < w.route.length; q++) segs.push([w.route[q][0] - w.route[q - 1][0], w.route[q][1] - w.route[q - 1][1]]);
        const outFront = segs.some(([dx, dy]) => dx > 0 || dy > 0), outBack = segs.some(([dx, dy]) => dx < 0 || dy < 0);
        const legCarry = (leg) => (leg === 'out' ? w.carry === 'out' : w.carry === 'back');
        const uses = (leg) => legCarry(leg) === carry && (leg === 'out' ? (front ? outFront : outBack) : front ? outBack : outFront);
        if (!uses('out') && !uses('back')) continue;
        if ((CX[k].status === 'flagged-redo' && !state.redo && !peopleR7(k)) || (CX[k].status === 'flagged-extra' && !state.extras)) continue;
        const mid = w.route[Math.floor(w.route.length / 2)], c = T(mid[0], mid[1]);
        place(k, c, `${front ? 'front' : 'back'} view, walking ${front ? 'toward' : 'away from'} the camera${carry ? ', carrying' : ''}${peopleR7(k) ? '; Fixed walk: Codex’s R7 repaint (art/331-people)' : ''}`);
      }
    }
    if (census) return places;
    DECALS = decals; PICS = pics; BUILT = built; PLACES = places; FACES = faces; WALKERS = walkers;
    if (WORLD.walkers[0].outBase) fitWalkers();
    swampDress(sprites, built); // v9, lane L2: the swamp coast's trees, reeds and placeholders
    sprites.sort((a, b) => a.depth - b.depth);
    FLAT = sprites.filter((q) => q.flat); SPRITES = sprites.filter((q) => !q.flat);
    return places;
  }

  // ---------- ground fit (the author's point 12: buildings should sit better on the ground under them)
  // Four steps, for comparison. 'v2' as before. 'shadow': a soft contact shadow, cast a little to the lower right
  // (the one upper-left light), and ambient occlusion where the walls meet the ground, on the ground and on the
  // walls' foot (an overlay drawn just after the picture: the picture itself is never touched or resampled). 'yard':
  // plus a worn apron under and 0.1 to 0.2 tile around each footprint, painted into the ground (trodden earth at the
  // farm and the mill, gravel at the station and in town with a kerbed platform edge toward the track, cinder at the
  // railway's works, stone grit at the quarry, packed sand on the shore), blended into the tile's own ground, and a worn
  // path at each door. 'full': plus weeds and pebbles drawn over the front of the base, the wall's lowest pixel taking
  // the ground's colour, and a plinth wherever the ground under a footprint is not level, so no base floats or sinks.
  const GF_STEPS = ['v2', 'shadow', 'yard', 'full'];
  const GF_LABEL = { v2: 'v2: as before', shadow: 'Shadow: a contact shadow and occlusion at the walls’ foot', yard: 'Yard: the shadow, worn yards and door paths', full: 'Full (default): yards, weeds and plinths (plinths only at the Ground fit test in Show me)' };
  let gfStep = 'full', gfLive = false;
  const gfOn = (s) => GF_STEPS.indexOf(gfStep) >= GF_STEPS.indexOf(s);
  // each picture's footprint in tiles from its tile's centre [x0, x1, y0, y1], fitted by eye to the foot of its walls
  // (legs: the box round its feet); its yard, the yard's margin past the footprint (tiles), the yard's own box where it
  // differs (the station's platform reaches the track; kerb: that edge is a platform's kerb), and its doors [face, place
  // along the face 0..1, path length]. round: a round base (the mill) or legs on a round working area.
  // Faces: 'y' the front-left wall (it faces +y, SW), 'x' the front-right wall (it faces +x, SE); a place runs from the
  // wall's left end on screen. legs: the picture stands on legs (the ground shows under it).
  const GF_FOOT = {
    'structures/town_2': { f: [-0.49, 0.44, -0.29, 0.18], L: 0.26, yard: 'gravel', m: 0.1, doors: [['y', 0.48, 0.3]] },
    'structures/townhouse': { f: [-0.43, 0.37, -0.27, 0.21], yard: 'gravel', m: 0.1, doors: [['y', 0.45, 0.3]] },
    // (v8: the two small towns' town hall and houses, the same pictures as these in other colours)
    'structures/town_3': { f: [-0.49, 0.44, -0.29, 0.18], L: 0.26, yard: 'gravel', m: 0.1, doors: [['y', 0.48, 0.3]] },
    'structures/townhouse_2': { f: [-0.43, 0.37, -0.27, 0.21], yard: 'gravel', m: 0.1, doors: [['y', 0.45, 0.3]] },
    'structures/townhouse_3': { f: [-0.43, 0.37, -0.27, 0.21], yard: 'gravel', m: 0.1, doors: [['y', 0.45, 0.3]] },
    'structures/townhouse_s0': { f: [-0.39, 0.41, -0.2, 0.29], yard: 'gravel', m: 0.1, doors: [['y', 0.5, 0.3]] },
    'structures/townhouse_s1': { f: [-0.41, 0.38, -0.18, 0.26], yard: 'gravel', m: 0.1, doors: [['y', 0.5, 0.3]] },
    'structures/townhouse_s2': { f: [-0.41, 0.38, -0.18, 0.26], yard: 'gravel', m: 0.1, doors: [['y', 0.5, 0.3]] },
    'structures/station_2': { f: [-0.55, 0.72, -0.27, 0.42], yf: [-0.58, 0.76, -0.29, 0.66], kerb: true, yard: 'gravel', m: 0.14, doors: [['x', 0.55, 0.3]] },
    'structures/warehouse_1': { f: [-0.46, 0.44, -0.15, 0.24], yf: [-0.48, 0.48, -0.17, 0.5], kerb: true, yard: 'gravel', m: 0.16, doors: [] },
    'structures/fuel_stop': { f: [-0.42, 0.17, -0.2, 0.17], round: true, yard: 'cinder', m: 0.07, legs: true, doors: [] },
    'structures/water_tower': { f: [-0.14, 0.14, -0.12, 0.17], round: true, yard: 'cinder', m: 0.08, legs: true, doors: [] },
    'structures/lumber_2': { f: [-0.6, 0.62, -0.16, 0.22], yard: 'chips', m: 0.18, doors: [['x', 0.5, 0.35]] },
    'structures/quarry_2': { f: [-0.68, 0.71, -0.31, 0.34], L: 0.24, yard: 'grit', m: 0.18, doors: [['x', 0.5, 0.3]] },
    'structures/farm_2': { f: [-0.37, 0.34, -0.6, 0.52], L: 0.32, yard: 'earth', m: 0.22, doors: [['x', 0.4, 0.4]] },
    'structures/windmill': { f: [-0.68, 0.43, -0.44, 0.67], round: true, L: 0.26, yard: 'earth', m: 0.16, doors: [['y', 0.5, 0.4]] },
    'structures/pump_1': { f: [-0.25, 0.46, -0.12, 0.42], yard: 'sand', m: 0.12, doors: [['x', 0.6, 0.25]] },
    'building/fuel_pump-a1-r0': { f: [-0.46, 0.55, -0.37, 0.38], yard: 'cinder', m: 0.1, doors: [['y', 0.3, 0.3]] },
    'building/fuel_pump-a1-r1': { f: [-0.26, 0.3, -0.74, 0.77], yard: 'cinder', m: 0.1, doors: [] },
    'building/fuel_pump-a1-r2': { f: [-0.74, 0.68, -0.28, 0.35], yard: 'cinder', m: 0.1, doors: [] },
    'building/fuel_pump-a1-r3': { f: [-0.38, 0.4, -0.44, 0.58], yard: 'cinder', m: 0.1, doors: [] },
  };
  // the yards' materials, colours before the light (the game's desert ground gives them broad clusters). Gravel, grit
  // and cinder are neutral greys with no grass in them: warm grey for gravel, a mid grey-brown for cinder (luminance
  // about 120, well above the contact shadow), pale stone grit at the quarry; the painter's spring tint is taken back
  // off them (yardAt), so no green creeps in.
  const GF_YARD = { earth: [142, 116, 82], chips: [146, 120, 86], gravel: [156, 150, 141], cinder: [128, 120, 113], grit: [174, 168, 158] };
  const GF_MIX = { earth: 0.12, chips: 0.1, gravel: 0, cinder: 0, grit: 0 }; // how much of the ground's own colour shows inside
  const GF_SHADOW = [26, 30, 33]; // a cool dark (slate, palette seed #626B6C, darkened), so a shadow on gravel stays grey
  const YARDS = Array.from({ length: N }, () => []); // per tile: the yards that reach it
  const YSIG = new Array(N).fill('');
  const YO = new Float64Array(3);
  let YWL = 0, YARD_ON = false, DES_MEAN = 0;
  { let s = 0, n = 0; for (let y = 150; y <= 436; y += 3) for (let x = 24; x <= 486; x += 3) { const o = ((M.DESERT * 512 + y) * 512 + x) * 4, S0 = PX.surfaces.d; s += S0[o] + S0[o + 1] + S0[o + 2]; n++; } DES_MEAN = s / n; }
  const GF_CONTOUR = new Map(), GF_CANVAS = new Map();
  function gfBegin(census) {
    gfLive = !census;
    if (!gfLive) return;
    for (const l of YARDS) l.length = 0;
    YSIG.fill('');
    YARD_ON = gfOn('yard');
  }
  // the atlas pictures are read from a separate decode of their file: reading the atlas image itself into a canvas
  // before the view had drawn it changed how the browser scaled every building at zoom 1, even in the v2 step. Until a
  // copy is decoded (a few ms) the buildings stand undressed; the scene is built again when it is ready
  const GF_COPY = new Map();
  function gfSource(img) {
    const c = GF_COPY.get(img);
    if (c) return c === 'loading' ? null : c;
    GF_COPY.set(img, 'loading');
    const done = (src) => { GF_COPY.set(img, src); enqueue(async () => { buildScene(false); dirty = true; }); };
    fetch(img.src).then((r) => r.blob()).then((b) => createImageBitmap(b)).then(done, () => done(img)); // failing that, the image itself
    return null;
  }
  // the lowest opaque pixel of each column of a picture (alpha over 170), cached by its key
  function gfContour(spr) {
    let k = GF_CONTOUR.get(spr.key);
    if (k) return k;
    const src = gfSource(spr.img);
    if (!src) return null;
    const cv = document.createElement('canvas'); cv.width = spr.sw; cv.height = spr.sh;
    const x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(src, spr.sx, spr.sy, spr.sw, spr.sh, 0, 0, spr.sw, spr.sh);
    const d = x.getImageData(0, 0, spr.sw, spr.sh).data, bot = new Int32Array(spr.sw).fill(-1);
    for (let i = 0; i < spr.sw; i++) for (let j = spr.sh - 1; j >= 0; j--) if (d[(j * spr.sw + i) * 4 + 3] > 170) { bot[i] = j; break; }
    k = { cv, d, bot };
    GF_CONTOUR.set(spr.key, k);
    return k;
  }
  // world px from a building's base point to its tile coordinates (on level ground at the base)
  const gfTile = (rx, ry) => [(rx / 32 + ry / 16) / 2, (ry / 16 - rx / 32) / 2];
  const gfIn = (F, tx, ty, e) => tx >= F[0] - e && tx <= F[1] + e && ty >= F[2] - e && ty <= F[3] + e;
  function gfDress(b, c, spr, sprites) {
    if (!gfLive) return;
    const fp = GF_FOOT[b.key.replace(/^codex:/, '')];
    if (!fp) return;
    const [bx, by] = twc(c.x, c.y), F = bsFoot(fp.f, b.key), base = Lv[c.i] * LEVEL; // (v9: Building scale)
    const sand = c.terrain === 'sand' || c.biome === 'beach' || c.biome === 'desert';
    const yard = fp.yard === 'earth' && sand ? 'sand' : fp.yard;
    // the yard: painted into the ground by the painter (shadeAt), listed on every tile it reaches
    if (YARD_ON) {
      const yf = bsYardBox(fp, F), m = fp.m;
      const Y = { F: [c.x + yf[0], c.x + yf[1], c.y + yf[2], c.y + yf[3]], round: !!fp.round, m, kind: yard, seed: (c.x * 7 + c.y * 13) % 97, paths: [], kerb: fp.kerb ? c.y + yf[3] : null };
      for (const [face, u, len] of fp.doors) {
        const px = face === 'y' ? F[0] + u * (F[1] - F[0]) : F[1], py = face === 'y' ? F[3] : F[3] - u * (F[3] - F[2]);
        const dx = face === 'x' ? 1 : 0, dy = face === 'y' ? 1 : 0;
        // a road next door: the path runs on to its middle, so the door is reached from the road
        const nb = tileAt(c.x + dx, c.y + dy);
        const toRoad = nb && nb.road && !nb.track && !nb.building;
        const L = toRoad ? (dx ? 1 - px : 1 - py) - 0.05 : len + bsPathMore(fp, F, face);
        Y.paths.push({ ax: c.x + px - dx * 0.04, ay: c.y + py - dy * 0.04, dx, dy, len: L + 0.04, hw: 0.075, open: toRoad });
      }
      const reach = m + 0.12;
      let x0 = Y.F[0] - reach, x1 = Y.F[1] + reach, y0 = Y.F[2] - reach, y1 = Y.F[3] + reach;
      for (const p of Y.paths) { x1 = Math.max(x1, p.ax + p.dx * p.len + 0.1); y1 = Math.max(y1, p.ay + p.dy * p.len + 0.1); }
      for (let j = Math.round(y0); j <= Math.round(y1); j++) for (let i = Math.round(x0); i <= Math.round(x1); i++) if (inb(i, j)) { YARDS[j * W + i].push(Y); YSIG[j * W + i] += `${b.key}@${c.i}${bsTag(b.key)};`; }
    }
    if (!gfOn('shadow')) return;
    const C = gfContour(spr);
    if (!C) return;
    const sw = spr.sw, sh = spr.sh, ppx = spr.w / sw, ppy = spr.h / sh; // world px per picture px
    // the columns whose lowest pixel stands on the ground: inside the footprint (a little past its edges)
    const cols = [], frontX = fp.round ? ((F[0] + F[1]) / 2 - (F[2] + F[3]) / 2) * 32 : (F[1] - F[3]) * 32;
    for (let i = 0; i < sw; i++) {
      const j = C.bot[i]; if (j < 0) continue;
      const wx = spr.x + (i + 0.5) * ppx, wy = spr.y + (j + 1) * ppy;
      const [tx, ty] = gfTile(wx - bx, wy - by);
      if (!gfIn(F, tx, ty, 0.1)) continue;
      cols.push({ i, j, wx, wy, tx, ty, right: wx - bx > frontX });
    }
    // the plinth: the ground under the footprint (and along its front) against the base's level
    let lift = 0;
    const drops = [];
    if (gfOn('full')) {
      let hi = -1e9;
      for (let q = 0; q <= 4; q++) for (let r = 0; r <= 4; r++) hi = Math.max(hi, heightAt(c.x + F[0] + (F[1] - F[0]) * q / 4, c.y + F[2] + (F[3] - F[2]) * r / 4));
      if (hi > base + 0.6) lift = Math.round((hi - base) * 2) / 2;
      for (const k of cols) { const g = heightAt(c.x + k.tx, c.y + k.ty), drop = base + lift - g; drops.push(drop > 0.6 ? drop : 0); }
    }
    const yardCol = yard === 'sand' ? null : GF_YARD[yard];
    const groundRGB = YARD_ON && yardCol ? yardCol : sand ? [196, 172, 120] : c.paved ? [150, 146, 136] : [128, 140, 66];
    // the walls' foot in occlusion (and, in full, its lowest pixel toward the ground's colour): an overlay of the
    // bottom rows only, drawn just after the picture in the same place, the shadow colour masked by the picture's alpha
    // and fading out over 2.6 world px above the foot. The atlas picture itself is drawn untouched (v1 of this swapped
    // in a canvas copy, which the browser resampled more softly, so every building lost a little sharpness)
    spr.y -= lift;
    const ok = `${spr.key}|${gfStep}|${groundRGB.join(',')}${bsTag(b.key)}`;
    let ov = GF_CANVAS.get(ok);
    if (ov === undefined) {
      const band = 2.6 / ppy, seam = 0.9 / ppy;
      let r0 = sh, r1 = -1;
      for (const k of cols) { r0 = Math.min(r0, Math.floor(k.j - band)); r1 = Math.max(r1, k.j); }
      r0 = Math.max(0, r0);
      ov = null;
      if (r1 >= r0) {
        const oh = r1 - r0 + 1, cv = document.createElement('canvas'); cv.width = sw; cv.height = oh;
        const x = cv.getContext('2d'), im = x.createImageData(sw, oh), d = im.data, G = groundRGB.map((v) => v * 0.8);
        for (const k of cols) for (let j = k.j; j >= r0 && j > k.j - band - 1; j--) {
          const ap = C.d[(j * sw + k.i) * 4 + 3] / 255; if (!ap) continue;
          const t = (k.j - j) / band;
          let A = (fp.legs ? 0.22 : 0.32) * Math.pow(Math.max(0, 1 - t), 1.6), R = GF_SHADOW[0], Gc = GF_SHADOW[1], B = GF_SHADOW[2];
          if (gfOn('full') && k.j - j < seam) {
            // the seam over the occlusion, one layer: source-over is associative
            const s = 0.3 * (1 - (k.j - j) / seam), A2 = s + A * (1 - s);
            R = (G[0] * s + R * A * (1 - s)) / A2; Gc = (G[1] * s + Gc * A * (1 - s)) / A2; B = (G[2] * s + B * A * (1 - s)) / A2; A = A2;
          }
          const q = ((j - r0) * sw + k.i) * 4;
          d[q] = R; d[q + 1] = Gc; d[q + 2] = B; d[q + 3] = Math.round(A * ap * 255);
        }
        x.putImageData(im, 0, 0);
        ov = { cv, r0, oh };
      }
      GF_CANVAS.set(ok, ov);
    }
    if (ov) sprites.push({ img: ov.cv, sx: 0, sy: 0, sw, sh: ov.oh, x: spr.x, y: spr.y + ov.r0 * ppy, w: spr.w, h: ov.oh * ppy, depth: spr.depth + 0.001, key: spr.key, gfOver: true });
    // the contact shadow and the occlusion on the ground: one picture at the ground painter's scale
    const L = (fp.L || (fp.legs ? 0.16 : 0.2)) * bScale(b.key), DX = 1, DY = 0.3;
    const xs = [F[0] - F[3], F[1] - F[2], F[1] + L - F[2] - L * DY, F[0] - F[3] + L].map((v) => v * 32);
    const left = Math.floor(bx + Math.min(...xs) - 10), right = Math.ceil(bx + Math.max(...xs) + 12);
    const top = Math.floor(by - lift + (F[0] + F[2]) * 16 - 8), bottom = Math.ceil(by - lift + (F[1] + L + F[3] + L * DY) * 16 + 10);
    const R = SCALE, cw = (right - left) * R, ch = (bottom - top) * R;
    const sk = `${b.key}|${c.i}|${gfStep}|${lift}${bsTag(b.key)}`;
    let sc = GF_CANVAS.get(sk);
    if (!sc) {
      const A = new Float32Array(cw * ch);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const [tx, ty] = gfTile(left + (x + 0.5) / R - bx, top + (y + 0.5) / R - (by - lift));
        if (c.x + tx > W - 0.5 || c.y + ty > H - 0.5) continue; // no shadow past the map's edge
        // back along the light to the footprint: the nearer, the darker
        let t0 = Math.max(0, (tx - F[1]) / DX, (ty - F[3]) / DY), t1 = Math.min((tx - F[0]) / DX, (ty - F[2]) / DY);
        if (fp.round) {
          // a round base: back along the light to its ellipse
          const ea = (F[1] - F[0]) / 2, eb = (F[3] - F[2]) / 2, u = (tx - F[0] - ea) / ea, v = (ty - F[2] - eb) / eb, du = DX / ea, dv = DY / eb;
          const qa = du * du + dv * dv, qb = u * du + v * dv, qc = u * u + v * v - 1, disc = qb * qb - qa * qc;
          t0 = qc <= 0 ? 0 : disc < 0 ? 1e9 : (qb - Math.sqrt(disc)) / qa; if (t0 < 0) t0 = 1e9; t1 = 1e9;
        }
        if (t0 <= t1 && t0 < L) A[y * cw + x] = (fp.legs ? 0.3 : 0.36) * Math.pow(1 - t0 / L, 1.5);
      }
      // occlusion: just below each foot on screen, fading over about 2.5 world px
      for (const k of cols) {
        if (c.x + k.tx > W - 0.55 || c.y + k.ty > H - 0.55) continue;
        const x = Math.round((k.wx - left) * R), y0 = Math.round((k.wy - lift - top) * R);
        for (let dy = 0; dy < 6 * R; dy++) {
          const y = y0 + dy; if (x < 0 || x >= cw || y < 0 || y >= ch) continue;
          const a = (k.right ? 0.4 : 0.3) * Math.exp(-dy / (1.5 * R));
          A[y * cw + x] = 1 - (1 - A[y * cw + x]) * (1 - a);
        }
      }
      // a soft edge: two box blurs, 1.5 world px
      const T2 = new Float32Array(cw * ch), rad = 3;
      for (let pass = 0; pass < 2; pass++) {
        for (let y = 0; y < ch; y++) { let s = 0; for (let x = -rad; x < cw + rad; x++) { if (x + rad < cw) s += A[y * cw + x + rad]; if (x - rad - 1 >= 0) s -= A[y * cw + x - rad - 1]; if (x >= 0 && x < cw) T2[y * cw + x] = s / (2 * rad + 1); } }
        for (let x = 0; x < cw; x++) { let s = 0; for (let y = -rad; y < ch + rad; y++) { if (y + rad < ch) s += T2[(y + rad) * cw + x]; if (y - rad - 1 >= 0) s -= T2[(y - rad - 1) * cw + x]; if (y >= 0 && y < ch) A[y * cw + x] = s / (2 * rad + 1); } }
      }
      sc = document.createElement('canvas'); sc.width = cw; sc.height = ch;
      const x = sc.getContext('2d'), im = x.createImageData(cw, ch);
      for (let p = 0; p < cw * ch; p++) { im.data[p * 4] = GF_SHADOW[0]; im.data[p * 4 + 1] = GF_SHADOW[1]; im.data[p * 4 + 2] = GF_SHADOW[2]; im.data[p * 4 + 3] = Math.min(255, A[p] * 255); }
      x.putImageData(im, 0, 0);
      // none of it under the picture itself: a wall's not quite opaque pixels would let it show through
      x.globalCompositeOperation = 'destination-out';
      x.drawImage(gfSource(spr.img), spr.sx, spr.sy, spr.sw, spr.sh, (spr.x - left) * R, (spr.y - top) * R, spr.w * R, spr.h * R);
      GF_CANVAS.set(sk, sc);
    }
    // on the ground: after the track, crossings and bridges, before anything that stands up
    sprites.push({ flat: true, depth: 1e7 + spr.depth, key: spr.key, gfShadow: true, draw(g) { g.drawImage(sc, left, top, cw / R, ch / R); } });
    sprites.push({ depth: 1e9, key: spr.key, draw(g) { if (gfDebug) gfOutline(g, bx, by - lift, F, cols); } });
    if (!gfOn('full')) return;
    // the plinth: a footing of the building's own base colour from its foot down to the ground, in courses, lit on its
    // left face and shaded on its right, a light top edge and a dark foot (the selective contour)
    if (drops.some((v) => v > 0)) {
      // the wall's own colour 2 to 7 px above its foot (the median, so doors and posts do not count)
      const ch3 = [[], [], []];
      for (const k of cols) for (let j = Math.round(k.j - 2 / ppy); j >= k.j - 7 / ppy && j >= 0; j--) { const o = (j * sw + k.i) * 4; if (C.d[o + 3] > 200) for (let q = 0; q < 3; q++) ch3[q].push(C.d[o + q]); }
      const wall = ch3[0].length ? ch3.map((a) => a.sort((p, q) => p - q)[a.length >> 1]) : [188, 169, 139];
      const base3 = [188, 169, 139].map((v, q) => v * 0.7 + wall[q] * 0.3); // limestone (palette seed #BCA98B), toward the wall
      const pc = document.createElement('canvas'), maxD = Math.max(...drops);
      const pl = Math.floor(spr.x), pt = Math.floor(by - lift - 20), pw = Math.ceil(spr.w) + 2, ph = Math.ceil(20 + maxD + 24);
      pc.width = pw * R; pc.height = ph * R;
      const x = pc.getContext('2d'); x.scale(R, R);
      const rgb = (k, a = 1) => `rgba(${Math.round(Math.min(255, base3[0] * k))},${Math.round(Math.min(255, base3[1] * k))},${Math.round(Math.min(255, base3[2] * k * 0.97))},${a})`;
      // each run of floating columns on one face is one wall: its top follows the foot, its bottom the ground
      const runs = [];
      cols.forEach((k, n) => { const dr = drops[n], l = runs[runs.length - 1]; if (!dr) return; const p = { x: k.wx - pl, y: k.wy - lift - pt - 0.4, d: dr, lit: !k.right }; if (l && l.lit === p.lit && p.x - l.pts[l.pts.length - 1].x < 1.5) l.pts.push(p); else runs.push({ lit: p.lit, pts: [p] }); });
      for (const run of runs) {
        const P = run.pts, f = run.lit ? 0.95 : 0.74, a = P[0], z = P[P.length - 1];
        const wall = new Path2D();
        wall.moveTo(a.x - 0.3, a.y); for (const p of P) wall.lineTo(p.x, p.y); wall.lineTo(z.x + 0.3, z.y);
        wall.lineTo(z.x + 0.3, z.y + z.d); for (let q = P.length - 1; q >= 0; q--) wall.lineTo(P[q].x, P[q].y + P[q].d); wall.lineTo(a.x - 0.3, a.y + a.d); wall.closePath();
        x.save(); x.clip(wall);
        x.fillStyle = rgb(f); x.fillRect(0, 0, pw, ph);
        // courses every 2.5 px, parallel to the foot, and a joint now and then in each course
        x.strokeStyle = rgb(f * 0.8); x.lineWidth = 0.45;
        for (let q = 2.5; q < 40; q += 2.5) { x.beginPath(); P.forEach((p, n) => (n ? x.lineTo(p.x, p.y + q) : x.moveTo(p.x, p.y + q))); x.stroke(); }
        for (let n = 0; n < P.length; n += 1) {
          const p = P[n];
          for (let q = 0; q * 2.5 < p.d; q++) if (hash2(Math.round(p.x * 3), q, 83) < 0.06) { x.beginPath(); x.moveTo(p.x, p.y + q * 2.5); x.lineTo(p.x, p.y + q * 2.5 + 2.5); x.stroke(); }
        }
        // the light catches the top course; the foot is in the dark
        x.strokeStyle = rgb(run.lit ? 1.08 : 0.86); x.lineWidth = 0.6; x.beginPath(); P.forEach((p, n) => (n ? x.lineTo(p.x, p.y + 0.3) : x.moveTo(p.x, p.y + 0.3))); x.stroke();
        x.strokeStyle = 'rgba(46,40,32,0.6)'; x.lineWidth = 0.8; x.beginPath(); P.forEach((p, n) => (n ? x.lineTo(p.x, p.y + p.d) : x.moveTo(p.x, p.y + p.d))); x.stroke();
        x.restore();
      }
      sprites.push({ img: pc, sx: 0, sy: 0, sw: pc.width, sh: pc.height, x: pl, y: pt, w: pw, h: ph, depth: spr.depth - 0.5, key: spr.key });
    }
    // weeds and pebbles over the front of the base: they break its straight line where it meets the ground
    const scatter = [];
    const doorsX = fp.doors.map(([face, u]) => { const px = face === 'y' ? F[0] + u * (F[1] - F[0]) : F[1], py = face === 'y' ? F[3] : F[3] - u * (F[3] - F[2]); return bx + (px - py) * 32; });
    for (let n = 0; n < cols.length; n += Math.max(1, Math.round(1 / ppx))) {
      const k = cols[n], r1 = hash2(Math.round(k.wx * 2), Math.round(k.wy * 2), 77), r2 = hash2(Math.round(k.wx * 2), 5, 78);
      if (doorsX.some((dx) => Math.abs(k.wx - dx) < 5)) continue;
      const gt = tileAt(Math.round(c.x + k.tx + (k.right ? 0.15 : 0)), Math.round(c.y + k.ty + (k.right ? 0 : 0.15)));
      if (!gt || gt.kind !== 'land' || gt.track || gt.road) continue;
      const fl = fp.legs ? 0.22 : yard === 'cinder' || c.paved ? 0.22 : 0.5;
      const gy = k.wy - lift + (drops[n] || 0); // the ground: at a plinth's foot, not over its face
      if (r1 < fl) scatter.push({ t: 'tuft', x: k.wx, y: gy + 0.4 + r2 * 1.1, h: 1.9 + 1.8 * r2, dark: k.right, q: r1 });
      else if (r1 > 0.82) scatter.push({ t: 'stone', x: k.wx, y: gy + 0.9 + r2 * 0.8, s: 0.7 + 0.7 * r2, q: r1 });
    }
    if (scatter.length) {
      const sl = Math.floor(spr.x) - 4, st = Math.floor(by - lift - 24), sw2 = Math.ceil(spr.w) + 8, sh2 = 64 + Math.ceil(Math.max(0, ...drops));
      const pc = document.createElement('canvas'); pc.width = sw2 * R; pc.height = sh2 * R;
      const x = pc.getContext('2d'); x.scale(R, R); x.lineCap = 'round';
      const cinder = yard === 'cinder';
      for (const s of scatter) {
        const X = s.x - sl, Y = s.y - st;
        if (s.t === 'tuft') {
          x.lineWidth = 0.65;
          x.strokeStyle = s.dark ? 'rgba(92,106,46,0.95)' : 'rgba(126,142,58,0.95)';
          x.beginPath();
          for (let q = 0; q < 4; q++) { const o = (q - 1.5) * 0.5, lean = (hash2(Math.round(s.x * 4), q, 79) - 0.5) * 1.1; x.moveTo(X + o, Y); x.lineTo(X + o * 1.8 + lean, Y - s.h * (q === 1 || q === 2 ? 1 : 0.7)); }
          x.stroke();
          x.strokeStyle = s.dark ? 'rgba(130,140,66,0.8)' : 'rgba(168,176,84,0.85)'; x.lineWidth = 0.4;
          x.beginPath(); x.moveTo(X - 0.2, Y - s.h * 0.4); x.lineTo(X - 0.4, Y - s.h * 0.95); x.stroke();
        } else {
          x.fillStyle = 'rgba(70,72,56,0.35)'; x.beginPath(); x.ellipse(X + 0.35 * s.s, Y + 0.3 * s.s, s.s * 1.1, s.s * 0.5, 0, 0, Math.PI * 2); x.fill();
          x.fillStyle = cinder ? '#3e3b38' : '#a8a28c'; x.beginPath(); x.ellipse(X, Y - 0.2 * s.s, s.s, s.s * 0.62, 0, 0, Math.PI * 2); x.fill();
          x.fillStyle = cinder ? '#5a5650' : '#c4bea6'; x.beginPath(); x.ellipse(X - 0.25 * s.s, Y - 0.42 * s.s, s.s * 0.45, s.s * 0.28, 0, 0, Math.PI * 2); x.fill();
        }
      }
      sprites.push({ img: pc, sx: 0, sy: 0, sw: pc.width, sh: pc.height, x: sl, y: st, w: sw2, h: sh2, depth: spr.depth + 0.5, key: spr.key, gfOver: true });
    }
  }
  // the yard at a point of the ground: its weight (YWL) and colour (YO), over the ground colour r, g, b
  function yardAt(tile, tx, ty, wx, wyg, r, g, b) {
    let best = 0, path = 0, Yb = null;
    for (const Y of YARDS[tile]) {
      const [x0, x1, y0, y1] = Y.F;
      const wn = (vnoise(tx * 5.3 + Y.seed, ty * 5.3) - 0.5) * 0.12 + (vnoise(tx * 13 + 7, ty * 13 + Y.seed) - 0.5) * 0.05;
      const ox = Math.max(x0 - tx, tx - x1, 0), oy = Math.max(y0 - ty, ty - y1, 0);
      let d = (ox || oy ? Math.hypot(ox, oy) : -Math.min(tx - x0, x1 - tx, ty - y0, y1 - ty)) + wn;
      if (Y.round) { const ea = (x1 - x0) / 2, eb = (y1 - y0) / 2; d = (Math.hypot((tx - x0 - ea) / ea, (ty - y0 - eb) / eb) - 1) * Math.min(ea, eb) + wn; }
      let w = 1 - sstep((d - Y.m + 0.07) / 0.14);
      // its outer part breaks up into the ground around it
      if (w > 0 && d > 0) w *= 1 - (Y.kind === 'cinder' ? 0.6 : 0.55) * sstep((vnoise(tx * 9 + Y.seed, ty * 9 + 3) - 0.58) / 0.12) * sstep(d / Y.m);
      // a platform ends in a straight kerb toward the track: nothing of the yard past its foot
      if (Y.kerb !== null) w *= 1 - sstep((ty - Y.kerb - 0.04) / 0.012);
      let pw = 0;
      for (const p of Y.paths) {
        let u = ((tx - p.ax) * p.dx + (ty - p.ay) * p.dy) / p.len; u = u < 0 ? 0 : u > 1 ? 1 : u;
        const ds = Math.hypot(tx - (p.ax + p.dx * p.len * u), ty - (p.ay + p.dy * p.len * u)) + wn * 0.35, hw = p.hw * (1 - 0.3 * u);
        const q = (1 - sstep((ds - hw) / 0.04)) * (p.open ? 1 : 1 - sstep((u - 0.7) / 0.3));
        if (q > pw) pw = q;
      }
      const t = Math.max(w, pw);
      if (t > best) { best = t; path = pw; Yb = Y; }
    }
    // a yard is levelled ground: it keeps off a steep bank (its rock or earth face shows)
    if (best > 0 && RELIEF[tile]) {
      const h = 0.05, sl = Math.hypot(heightAt(tx + h, ty) - heightAt(tx - h, ty), heightAt(tx, ty + h) - heightAt(tx, ty - h)) / (2 * h * LEVEL);
      best *= 1 - sstep((sl - 0.25) / 0.35); path *= 1 - sstep((sl - 0.25) / 0.35);
    }
    YWL = best;
    if (!Yb || best <= 0) { YO[0] = r; YO[1] = g; YO[2] = b; return; }
    // the material: the game's desert ground for its broad clusters, recoloured; earth keeps a little of the ground's hue
    sampleMat(M.DESERT, tx, ty, wx, wyg);
    const tex = (V[0] + V[1] + V[2]) / DES_MEAN, kind = Yb.kind, stony = kind === 'gravel' || kind === 'grit' || kind === 'cinder';
    let k = 1 + (tex - 1) * (stony ? 0.6 : 0.85) + (vnoise(tx * 4.1 + 9, ty * 4.1 + 2) - 0.5) * 0.12;
    if (stony) {
      // stone grain: stones about a world px across, lit on their upper left and dark on their lower right (the noise
      // against itself sampled a little toward the light), and darker gaps between them; cinder has dark clinker lumps
      const Fq = kind === 'grit' ? 30 : 36, p = vnoise(tx * Fq + 3, ty * Fq + 1), pu = vnoise((tx - 0.0075) * Fq + 3, (ty - 0.0025) * Fq + 1);
      const st = sstep((p - 0.54) / 0.08);
      k *= 1 + st * (0.05 + 1.3 * (p - pu)) - 0.07 * sstep((0.42 - p) / 0.08);
      if (kind === 'cinder') k *= 1 - 0.16 * sstep((vnoise(tx * 17 + 5, ty * 17 + 8) - 0.66) / 0.05);
    }
    if (kind === 'earth' || kind === 'chips') k *= 1 + 0.07 * sstep((vnoise(tx * 2.2 + 1, ty * 2.2 + 4) - 0.6) / 0.15);
    let cr, cg, cb;
    if (kind === 'sand') { cr = r * 0.9; cg = g * 0.87; cb = b * 0.82; k = 1 + (k - 1) * 0.5; }
    else { const c0 = GF_YARD[kind], mx = GF_MIX[kind]; cr = c0[0] * (1 - mx) + r * mx; cg = c0[1] * (1 - mx) + g * mx; cb = c0[2] * (1 - mx) + b * mx; }
    if (kind === 'cinder') { const rust = sstep((vnoise(tx * 7 + 3, ty * 7) - 0.66) / 0.1) * 0.5; cr += 14 * rust; cg += 4 * rust; }
    if (kind === 'chips') { const p = vnoise(tx * 26 + 2, ty * 26 + 6); const c2 = sstep((p - 0.68) / 0.05); cr += 34 * c2; cg += 26 * c2; cb += 12 * c2; }
    // a path is trodden harder: a little darker
    k *= 1 - 0.08 * path;
    let wt = best, foot = 1;
    if (Yb.kerb !== null) {
      // the platform's kerb toward the track: pale coping stones with joints, the kerb's face (lit, it faces SW), then
      // a dark line where it meets the ground; it fades out at the platform's ends
      const e = ty - Yb.kerb, al = sstep((tx - Yb.F[0] - 0.02) / 0.06) * sstep((Yb.F[1] - tx - 0.02) / 0.06);
      const cop = (sstep((e + 0.07) / 0.008) - sstep((e + 0.018) / 0.006)) * al, face = (sstep((e + 0.018) / 0.006) - sstep((e - 0.012) / 0.006)) * al;
      const past = sstep((e - 0.012) / 0.006) * al;
      if (cop > 0) { const jt = Math.abs(((tx * 7.5) % 1 + 1) % 1 - 0.5) > 0.46 ? 0.86 : 1; k = k + ((1.1 + 0.04 * (vnoise(tx * 7.5, 3) - 0.5)) * jt - k) * cop; cr += (176 - cr) * cop; cg += (170 - cg) * cop; cb += (160 - cb) * cop; }
      if (face > 0) { k = k + (0.8 - k) * face; cr += (170 - cr) * face; cg += (163 - cg) * face; cb += (152 - cb) * face; }
      wt = best * (1 - past);
      foot = 1 - 0.4 * past * (1 - sstep((e - 0.03) / 0.012));
    }
    if (stony) { cr /= TINT[0]; cb /= TINT[2]; } // stone takes no spring tint (the painter tints all land): it stays grey
    YO[0] = (r + (cr * k - r) * wt) * foot; YO[1] = (g + (cg * k - g) * wt) * foot; YO[2] = (b + (cb * k - b) * wt) * foot;
  }
  // debug: the footprint and the columns found standing on the ground
  let gfDebug = false;
  function gfOutline(g, bx, by, F, cols) {
    const P = (tx, ty) => [bx + (tx - ty) * 32, by + (tx + ty) * 16];
    g.save(); g.lineWidth = 0.6; g.strokeStyle = '#ff00ff'; g.beginPath();
    [[F[0], F[2]], [F[1], F[2]], [F[1], F[3]], [F[0], F[3]]].forEach(([a, c], n) => { const [x, y] = P(a, c); if (n) g.lineTo(x, y); else g.moveTo(x, y); });
    g.closePath(); g.stroke();
    g.fillStyle = '#00ffff'; for (const k of cols) g.fillRect(k.wx - 0.25, k.wy - 0.25, 0.5, 0.5);
    g.restore();
  }
  // the columns round some tiles, in whole 240 px chunks as the first paint ran them, so a grass tuft across a chunk's
  // edge is drawn the same way again and the ground away from the yards comes back exactly
  function gfCols(tiles) {
    const out = [];
    for (const [a, b] of columnsFor(tiles)) { const r = [Math.floor(a / 240) * 240, Math.min(GW, Math.ceil(b / 240) * 240)], l = out[out.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else out.push(r); }
    return out;
  }
  // test placements for the Full step, whose plinths show only where the ground drops away under a footprint, and no
  // building of this map stands there: the station on a level-2 tile whose +x and +y sides fall one level (its right end
  // overhangs the bank) and the town hall, one tile, on a level-1 tile whose +x side falls one level (a bank starts 0.25
  // tile inside a level tile, so the right end of its front-right wall, 0.44 tile out, floats about 3 px). Placed once,
  // when Show me asks for them.
  const GF_TESTS = [['structures/station_2', 15, 25], ['structures/town_2', 17, 24]];
  let gfTested = false;
  function gfPlace(items) {
    return enqueue(async () => {
      for (const [key, x, y] of items) { WORLD.buildings.push({ key, x, y, name: 'Ground fit test placement' }); T(x, y).building = key; }
      buildScene(false); dirty = true;
      hint.textContent = 'Repainting the ground…';
      await paint(gfCols(items.map(([, x, y]) => idx(x, y))));
      hint.textContent = hintText();
    });
  }
  function gfTestSites() {
    if (!gfTested) { gfTested = true; gfPlace(GF_TESTS); }
    return GF_TESTS.map(([, x, y]) => T(x, y));
  }
  function setGroundFit(step) {
    if (!GF_STEPS.includes(step)) return Promise.reject(new Error(`no ground fit ${step}`));
    if (step === gfStep) return jobs;
    const yardBefore = gfOn('yard');
    gfStep = step;
    for (const btn of document.querySelectorAll('[data-gfit]')) btn.setAttribute('aria-pressed', String(btn.dataset.gfit === gfStep));
    return enqueue(async () => {
      buildScene(false); dirty = true;
      // the yards are painted into the ground: repaint the columns round the buildings when they come or go
      if (yardBefore !== gfOn('yard')) { hint.textContent = 'Repainting the ground…'; await paint(gfCols(WORLD.buildings.map((q) => idx(q.x, q.y)))); }
    });
  }

  // ---------- heights
  const bank = (u) => (u <= 0.25 ? 0 : u >= 0.75 ? 1 : sstep((u - 0.25) * 2));
  // the bank profile across an edge of width w (in tiles, centred on the edge); w = 0 is a vertical step
  const prof = (u, w) => { if (w < 0.001) return u < 0.5 ? 0 : 1; const t = (u - 0.5) / w + 0.5; return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); };
  // relief v2: an edge with a stacked end (stackPlan) is a cubic from centre to centre whose ends slope at s0 and s1
  // (over its rise); any other edge keeps its bank
  const profS = (u, w, s0, s1) => (s0 || s1 ? u * u * (3 - 2 * u) + s0 * u * (1 - u) * (1 - u) - s1 * u * u * (1 - u) : prof(u, w));
  // The glacier options' ice wanders (GWARP, fading out a tile from the ice; the same warp moves the material borders off
  // its edges), so the ice tongue and the channel are not straight-edged boxes (the check of v2).
  let GWARP = glacierName === 'demo' ? 0 : 0.3; // (as applyModes sets it)
  function wamp(tx, ty) {
    if (!GWARP || tx < ICEW_BOX[0] || ty < ICEW_BOX[1] || tx >= ICEW_BOX[2] || ty >= ICEW_BOX[3]) return 0;
    const i0 = Math.floor(tx), j0 = Math.floor(ty), u = tx - i0, v = ty - j0;
    const ia = i0 < 0 ? 0 : i0 > W - 1 ? W - 1 : i0, ib = i0 + 1 > W - 1 ? W - 1 : i0 + 1 < 0 ? 0 : i0 + 1;
    const ja = j0 < 0 ? 0 : j0 > H - 1 ? H - 1 : j0, jb = j0 + 1 > H - 1 ? H - 1 : j0 + 1 < 0 ? 0 : j0 + 1;
    const a = ICEW[ja * W + ia], b = ICEW[ja * W + ib], c = ICEW[jb * W + ia], d = ICEW[jb * W + ib];
    if (a + b + c + d === 0) return 0;
    return GWARP * ((a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v);
  }
  const warpX = (tx, ty, a) => (vnoise(tx * 2.3 + 13, ty * 2.3 + 7) - 0.5 + (vnoise(tx * 6.1 + 2, ty * 6.1 + 31) - 0.5) * 0.45) * a;
  const warpY = (tx, ty, a) => (vnoise(tx * 2.3 + 51, ty * 2.3 + 3) - 0.5 + (vnoise(tx * 6.1 + 17, ty * 6.1 + 5) - 0.5) * 0.45) * a;
  function heightAt_(tx, ty) {
    if (GWARP) { const a = wamp(tx, ty); if (a) { const qx = tx; tx += warpX(qx, ty, a); ty += warpY(qx, ty, a); } }
    const i0 = Math.floor(tx), j0 = Math.floor(ty), u = tx - i0, v = ty - j0;
    const ia = i0 < 0 ? 0 : i0 > W - 1 ? W - 1 : i0, ib = i0 + 1 < 0 ? 0 : i0 + 1 > W - 1 ? W - 1 : i0 + 1;
    const ja = j0 < 0 ? 0 : j0 > H - 1 ? H - 1 : j0, jb = j0 + 1 < 0 ? 0 : j0 + 1 > H - 1 ? H - 1 : j0 + 1;
    const kaa = ja * W + ia, kab = ja * W + ib, kba = jb * W + ia;
    const a = Lv[kaa], b = Lv[kab], c = Lv[kba], d = Lv[jb * W + ib];
    // flat ground (the four tile centres round the point at one level): every profile below gives that level exactly
    if (a === b && a === c && a === d) { const zf = LEVEL * a; { UB[0] = SN_BOX && tx > SN_BOX[0] && tx < SN_BOX[2] && ty > SN_BOX[1] && ty < SN_BOX[3] ? zf + snoutAt(tx, ty) : zf; return; } }
    // each edge has its own bank width (ice cliffs are vertical whatever the relief option)
    const top = a + (b - a) * profS(u, EWX[kaa], HX0[kaa], HX1[kaa]), bot = c + (d - c) * profS(u, EWX[kba], HX0[kba], HX1[kba]);
    const wa = EWY[kaa], wb = EWY[kab];
    if (HY0[kaa] || HY1[kaa] || HY0[kab] || HY1[kab]) {
      // a stacked edge beside another: the two columns' profiles blend across the tile (beside a fall, at its middle)
      const pa = profS(v, wa, HY0[kaa], HY1[kaa]), pb = profS(v, wb, HY0[kab], HY1[kab]);
      { UB[0] = LEVEL * (top + (bot - top) * (pa + (pb - pa) * (wa && wb ? sstep(u) : u <= 0.4 ? 0 : u >= 0.6 ? 1 : sstep((u - 0.4) / 0.2)))); return; }
    }
    const wy = wa === wb ? wa : wa + (wb - wa) * (u <= 0.4 ? 0 : u >= 0.6 ? 1 : sstep((u - 0.4) / 0.2));
    const zz = LEVEL * (top + (bot - top) * prof(v, wy));
    { UB[0] = SN_BOX && tx > SN_BOX[0] && tx < SN_BOX[2] && ty > SN_BOX[1] && ty < SN_BOX[3] ? zz + snoutAt(tx, ty) : zz; return; }
  }
  function heightAt(tx, ty) { heightAt_(tx, ty); return UB[0]; }
  // the glacier's snout: the ice swells a little toward its front (up to 0.35 level), so the front stands taller than a
  // plain step and its top is rounded, not a flat slab (fix round of v3: the front read as a culvert)
  function snoutAt(tx, ty) {
    for (const f of ICE_FRONTS) {
      const e = (tx - f.mx) * f.dx + (ty - f.my) * f.dy, al = (tx - f.mx) * f.dy - (ty - f.my) * f.dx;
      if (e >= 0 || e < -0.75) continue;
      return LEVEL * 0.32 * sstep((e + 0.5) / 0.4) * (1 - sstep((Math.abs(al) - 0.4) / 0.14));
    }
    return 0;
  }
  // the tile whose level a point stands on (the warp moves level edges, so this is not always the rounded point)
  function ownerAt(tx, ty) {
    if (GWARP) { const a = wamp(tx, ty); if (a) { const qx = tx; tx += warpX(qx, ty, a); ty += warpY(qx, ty, a); } }
    const i = Math.max(0, Math.min(W - 1, Math.round(tx) | 0)), j = Math.max(0, Math.min(H - 1, Math.round(ty) | 0));
    return j * W + i;
  }
  function snowAt(tx, ty) {
    const i0 = Math.floor(tx), j0 = Math.floor(ty);
    const bx = bank(tx - i0), by = bank(ty - j0);
    const ia = Math.max(0, Math.min(W - 1, i0)), ib = Math.max(0, Math.min(W - 1, i0 + 1)), ja = Math.max(0, Math.min(H - 1, j0)), jb = Math.max(0, Math.min(H - 1, j0 + 1));
    const a = SNOWT[ja * W + ia], b = SNOWT[ja * W + ib], c = SNOWT[jb * W + ia], d = SNOWT[jb * W + ib];
    if (a + b + c + d === 0) return 0;
    return (a + (b - a) * bx) * (1 - by) + (c + (d - c) * bx) * by;
  }

  // ---------- the ground painter (ground.md): voxel columns front to back, 2 raster px per world px
  const GX0 = -H * 32 - 48, GX1 = W * 32 + 48, GY0 = -16 - 4 * LEVEL - 32, GY1 = (W + H - 1) * 16 + 24;
  const GW = (GX1 - GX0) * SCALE, GH = (GY1 - GY0) * SCALE;
  const ground = document.createElement('canvas'); ground.width = GW; ground.height = GH;
  const gctx = ground.getContext('2d');
  const gimg = gctx.createImageData(GW, GH), gd = gimg.data;
  const SUR = PX.surfaces.d, SWD = PX.swatches.d;
  // registers for the hot path, in a typed array so the painter allocates nothing per pixel
  const OUT = new Float64Array(3), V = new Float64Array(8);
  const TINT = [0xf4 / 255, 1, 0xf0 / 255]; // spring ground tint
  const PATCH = 0.72, SEAM = 0.08;

  function texel(m, wx, wyg, ox, oy, pcx, pcy) {
    if (m >= 8) { // Codex swatch: 397 px per 198.6 world px, seamless
      let x = (Math.floor(wx * 2) + ox) % 397, y = (Math.floor(wyg * 2) + oy) % 397; if (x < 0) x += 397; if (y < 0) y += 397;
      const o = ((SWY[m] + y) * 397 + x) * 4; V[0] = SWD[o]; V[1] = SWD[o + 1]; V[2] = SWD[o + 2]; return;
    }
    // game cell (512 px), screen-aligned, 2.432 x 4.64 texels per world px, sampled around the patch centre
    let x = 256 + (wx - pcx) * 2.432 + ox, y = 292 + (wyg - pcy) * 4.64 + oy;
    x = x < 24 ? 24 : x > 486 ? 486 : x; y = y < 150 ? 150 : y > 436 ? 436 : y;
    const xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi, base = m * 512;
    const o00 = ((base + yi) * 512 + xi) * 4, o10 = o00 + 4, o01 = o00 + 2048, o11 = o01 + 4;
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    V[0] = SUR[o00] * w00 + SUR[o10] * w10 + SUR[o01] * w01 + SUR[o11] * w11;
    V[1] = SUR[o00 + 1] * w00 + SUR[o10 + 1] * w10 + SUR[o01 + 1] * w01 + SUR[o11 + 1] * w11;
    V[2] = SUR[o00 + 2] * w00 + SUR[o10 + 2] * w10 + SUR[o01 + 2] * w01 + SUR[o11 + 2] * w11;
  }
  // one material at a point, with the patches that keep it from repeating (seams cross-faded)
  // the patch a pixel falls in and its seam weights: computed once per pixel (setPatch), used by every material
  let P_IX = 0, P_IY = 0, P_NX = 0, P_NY = 0, P_WX = 0, P_WY = 0;
  function setPatch(tx, ty) {
    VN_IN[0] = tx * 0.9 + 40; VN_IN[1] = ty * 0.9; VN_IN[2] = tx * 0.9; VN_IN[3] = ty * 0.9 + 40;
    vnoiseN(2);
    const jx = (VN_OUT[0] - 0.5) * 0.3, jy = (VN_OUT[1] - 0.5) * 0.3;
    const px = tx * PATCH + jx, py = ty * PATCH + jy, fx = px - Math.floor(px), fy = py - Math.floor(py);
    P_IX = Math.floor(px); P_IY = Math.floor(py); P_NX = 0; P_NY = 0; P_WX = 0; P_WY = 0;
    if (fx < SEAM) { P_NX = -1; P_WX = 0.5 * sstep((SEAM - fx) / SEAM); } else if (fx > 1 - SEAM) { P_NX = 1; P_WX = 0.5 * sstep((fx - 1 + SEAM) / SEAM); }
    if (fy < SEAM) { P_NY = -1; P_WY = 0.5 * sstep((SEAM - fy) / SEAM); } else if (fy > 1 - SEAM) { P_NY = 1; P_WY = 0.5 * sstep((fy - 1 + SEAM) / SEAM); }
  }
  // the mean colour of the game's water cell: at a patch seam two samples of the water are cross-faded around it with
  // their contrast kept (a plain average flattens the ripples into faint, regular diagonal bands along the seams)
  const WMEAN = [0, 0, 0];
  {
    // the cell is lighter at its upper left and darker at its lower right; every patch showed that slope, so open water
    // carried faint, regular diagonal light bands (one per patch). Its broad light is levelled out (a 97 px box mean),
    // the ripples kept.
    // only the cell's diamond counts (outside it the cell is black)
    const base = M.WATER * 512, R = 48, S2 = 513, I = new Float64Array(S2 * S2 * 4);
    const inside = (x, y) => Math.abs(x - 255.5) + Math.abs(y - 255.5) <= 248;
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const o = ((base + y) * 512 + x) * 4, k = ((y + 1) * S2 + x + 1) * 4, kl = ((y + 1) * S2 + x) * 4, ku = (y * S2 + x + 1) * 4, kul = (y * S2 + x) * 4, m = inside(x, y) ? 1 : 0;
      for (let c = 0; c < 4; c++) I[k + c] = (c < 3 ? SUR[o + c] * m : m) + I[kl + c] + I[ku + c] - I[kul + c];
    }
    const box = (x0, y0, x1, y1, c) => I[(y1 * S2 + x1) * 4 + c] - I[(y0 * S2 + x1) * 4 + c] - I[(y1 * S2 + x0) * 4 + c] + I[(y0 * S2 + x0) * 4 + c];
    const all = [0, 1, 2].map((c) => box(0, 0, 512, 512, c) / box(0, 0, 512, 512, 3));
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      if (!inside(x, y)) continue;
      const x0 = Math.max(0, x - R), x1 = Math.min(512, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(512, y + R + 1), n = box(x0, y0, x1, y1, 3), o = ((base + y) * 512 + x) * 4;
      for (let c = 0; c < 3; c++) SUR[o + c] = SUR[o + c] + all[c] - box(x0, y0, x1, y1, c) / n;
    }
  }
  { let n = 0; for (let y = 150; y <= 436; y += 2) for (let x = 24; x <= 486; x += 2) { const o = ((M.WATER * 512 + y) * 512 + x) * 4; WMEAN[0] += SUR[o]; WMEAN[1] += SUR[o + 1]; WMEAN[2] += SUR[o + 2]; n++; } WMEAN[0] /= n; WMEAN[1] /= n; WMEAN[2] /= n; }
  function sampleMat(m, tx, ty, wx, wyg) { // wyg: screen y of the point (world px); the texture is screen-aligned
    const ix = P_IX, iy = P_IY, wnx = P_WX, wny = P_WY;
    patchTexel(m, ix, iy, wx, wyg);
    if (!wnx && !wny) return;
    const w0 = (1 - wnx) * (1 - wny);
    let r = V[0] * w0, g = V[1] * w0, b = V[2] * w0, ww = w0 * w0;
    if (wnx) { patchTexel(m, ix + P_NX, iy, wx, wyg); const w = wnx * (1 - wny); r += V[0] * w; g += V[1] * w; b += V[2] * w; ww += w * w; }
    if (wny) { patchTexel(m, ix, iy + P_NY, wx, wyg); const w = (1 - wnx) * wny; r += V[0] * w; g += V[1] * w; b += V[2] * w; ww += w * w; }
    if (wnx && wny) { patchTexel(m, ix + P_NX, iy + P_NY, wx, wyg); const w = wnx * wny; r += V[0] * w; g += V[1] * w; b += V[2] * w; ww += w * w; }
    if (m === M.WATER) { const k = 1 / Math.sqrt(ww); r = WMEAN[0] + (r - WMEAN[0]) * k; g = WMEAN[1] + (g - WMEAN[1]) * k; b = WMEAN[2] + (b - WMEAN[2]) * k; }
    V[0] = r; V[1] = g; V[2] = b;
  }
  // patch centres' ground height, for the game cells' patch-relative sampling
  const PHW = 40, PH = new Float32Array(PHW * PHW).fill(NaN);
  const patchZ = (pi, pj) => { const k = (pj + 4) * PHW + pi + 4; let v = PH[k]; if (v !== v) { v = heightAt((pi + 0.5) / PATCH, (pj + 0.5) / PATCH); PH[k] = v; } return v; };
  function patchTexel(m, pi, pj, wx, wyg) {
    if (m >= 8) { texel(m, wx, wyg, Math.floor(hash2(pi, pj, m * 7 + 1) * 397), Math.floor(hash2(pi, pj, m * 7 + 2) * 397), 0, 0); return; }
    const ox = Math.floor(hash2(pi, pj, m * 7 + 1) * 40) - 20, oy = Math.floor(hash2(pi, pj, m * 7 + 2) * 40) - 20;
    const ctx = (pi + 0.5) / PATCH, cty = (pj + 0.5) / PATCH;
    texel(m, wx, wyg, ox, oy, (ctx - cty) * 32, (ctx + cty) * 16 - patchZ(pi, pj));
  }
  // ---------- town paving (the author, 2026-10-12: v2's pattern was far too big, its stones about a tile). Small setts,
  // about a tenth of a tile, lit from the upper left. Fix round of v3 (the critic: still out of place; a dirt road with
  // grass verges ran across the square, the paving was a ragged blob with islands, ending hard on the sand, and its cool
  // light grey read as busy noise): the setts are warm sandstone greys a value step below the house walls, close to one
  // another, so the square reads as one colour cluster; the paving follows the paved tiles (with a gentle wobble, its
  // convex corners rounded) plus a doorstep in front of each house's door, wears out over its last quarter tile (grass in
  // the joints, setts missing) into a fringe of packed earth that fades into the grass or the sand; the roads stop at its
  // edge (their pictures fade out there) and run on across the square as a dustier lane. 'v2' is the game's painted
  // cell, as before.
  const PAVINGS = {
    fan: { label: 'Fan (default): small setts laid in arcs, as in an old town square' },
    setts: { label: 'Setts: small setts in straight courses' },
    flags: { label: 'Flags: the game’s flagstones at a fifth of their size' },
    v2: { label: 'Old (v2): the game’s painted paving, as in v2' },
  };
  let pavingName = 'fan';
  // (each divided by the spring tint the painter puts on all land, so they come out as these)
  const unTint = (c) => [c[0] / TINT[0], c[1], c[2] / TINT[2]];
  const PV_COL = [[166, 149, 119], [171, 154, 123], [161, 145, 116], [173, 153, 119], [152, 139, 114]].map(unTint);
  const PV_JOINT = unTint([140, 126, 101]), PV_DUST = unTint([160, 142, 110]), PV_GRIME = unTint([128, 116, 96]);
  const PV_LU = -0.8, PV_LV = 0.6; // the light in tile coords: from -x (screen upper left), a little from +y
  // one sett at tile coords: its id, its centre, the inside distance to its outline (tile units) and the outward normal
  // of the outline nearest the point
  let PS_ID = 0, PS_CU = 0, PS_CV = 0, PS_D = 0, PS_NX = 0, PS_NY = 0;
  function pvRect(pu, pv, hu, hv, rr) { // the point from a rounded rectangle's centre, its half sizes and corner radius
    const qx = hu - Math.abs(pu), qy = hv - Math.abs(pv);
    if (qx < rr && qy < rr) { const ex = rr - qx, ey = rr - qy, l = Math.hypot(ex, ey) || 1; PS_D = rr - l; PS_NX = (ex / l) * Math.sign(pu); PS_NY = (ey / l) * Math.sign(pv); }
    else if (qx < qy) { PS_D = qx; PS_NX = Math.sign(pu); PS_NY = 0; } else { PS_D = qy; PS_NX = 0; PS_NY = Math.sign(pv); }
  }
  // straight courses along x, 0.1 tile wide; setts 0.09 to 0.17 long, every course offset
  function settsAt(u, v) {
    const h = 0.1, L = 0.13, j = Math.floor(v / h), sh = hash2(j, 7, 811) * L, uu = u - sh;
    const jit = (k) => (hash2(k, j, 812) - 0.5) * 0.6 * L;
    let k = Math.floor(uu / L), a0 = k * L + jit(k), a1 = (k + 1) * L + jit(k + 1);
    if (uu < a0) { k--; a1 = a0; a0 = k * L + jit(k); } else if (uu >= a1) { k++; a0 = a1; a1 = (k + 1) * L + jit(k + 1); }
    PS_ID = hash2(k, j, 813); PS_CU = sh + (a0 + a1) / 2; PS_CV = (j + 0.5) * h;
    pvRect(u - PS_CU, v - PS_CV, (a1 - a0) / 2, h / 2, 0.022);
  }
  // arcs (segmental paving): scales 0.8 tile wide in rows 0.4 apart, rings of setts 0.095 deep; a nearer row lies over
  // the one behind it
  function fanAt(u, v) {
    const A = 0.8, R = A * 0.72, s = 0.095;
    const j0 = Math.floor(v / (A / 2));
    let cu = 0, cv = 0, ci = 0, cj = -99;
    for (let j = j0 + 2; j >= j0 - 1 && cj === -99; j--) {
      const off = (j & 1) * A / 2, i0 = Math.round((u - off) / A);
      for (let i = i0 - 1; i <= i0 + 1; i++) {
        const x = i * A + off, y = j * A / 2;
        if (v <= y + 1e-9 && (u - x) * (u - x) + (v - y) * (v - y) < R * R) { cu = x; cv = y; ci = i; cj = j; break; }
      }
    }
    if (cj === -99) { PS_ID = 0.5; PS_CU = u; PS_CV = v; PS_D = 0; PS_NX = 0; PS_NY = 0; return; }
    const du = u - cu, dv = v - cv, r = Math.hypot(du, dv) || 1e-6, ru = du / r, rv = dv / r;
    const ring = Math.floor(r / s), rm = (ring + 0.5) * s, n = Math.max(1, Math.round((Math.PI * rm) / (s * 1.3)));
    const ph = hash2(ring, ci, 821 + cj), t = (Math.atan2(-dv, du) / Math.PI) * n + ph, k = Math.floor(t), len = (Math.PI * rm) / n;
    PS_ID = hash2(k, ring * 131 + ci, cj * 7 + 822);
    const ac = ((k + 0.5 - ph) / n) * Math.PI; PS_CU = cu + rm * Math.cos(ac); PS_CV = cv - rm * Math.sin(ac);
    pvRect((t - k - 0.5) * len, r - rm, len / 2, s / 2, 0.022);
    // back from the ring's frame (along it, across it) to tile coords; along runs from +u toward -v
    const na = PS_NX, nr = PS_NY;
    PS_NX = nr * ru + na * rv; PS_NY = nr * rv - na * ru;
  }
  // flagstones: a 0.11 tile grid, some cells joined in pairs or fours, so stones of a few sizes (the game's cell, smaller)
  function flagsAt(u, v) {
    const c = 0.11, i = Math.floor(u / c), j = Math.floor(v / c), bi = i >> 1, bj = j >> 1, m = hash2(bi, bj, 831);
    let u0 = i * c, v0 = j * c, lu = c, lv = c;
    PS_ID = hash2(i, j, 832);
    if (m < 0.28) { u0 = bi * 2 * c; lu = 2 * c; PS_ID = hash2(bi, j, 833); }
    else if (m < 0.52) { v0 = bj * 2 * c; lv = 2 * c; PS_ID = hash2(i, bj, 834); }
    else if (m < 0.6) { u0 = bi * 2 * c; v0 = bj * 2 * c; lu = lv = 2 * c; PS_ID = hash2(bi, bj, 835); }
    // each stone sits a little off its cell, so the joints wander
    PS_CU = u0 + lu / 2 + (hash2(Math.floor(PS_ID * 7919), 1, 836) - 0.5) * 0.012; PS_CV = v0 + lv / 2 + (hash2(Math.floor(PS_ID * 7919), 2, 837) - 0.5) * 0.012;
    pvRect(u - PS_CU, v - PS_CV, lu / 2, lv / 2, 0.03);
  }
  const PV_PAT = { setts: settsAt, fan: fanAt, flags: flagsAt };
  // the paving's outline at a point (tile coords, unwarped): PE_D how far inside it (tiles; < 0 outside), PE_M the ground
  // beyond its nearest edge and PE_T that tile. It is the union of the paved tiles (their convex corners rounded by the
  // distance outside) and a doorstep before each paved house's door (its SW side, where the game's houses have theirs),
  // with a gentle wobble (+-0.05 tile), so there are no islands.
  const PAVE_NEAR = new Uint8Array(N); // the paved tiles and their neighbours (buildScene)
  let DOORSTEPS = [];
  let PE_D = 0, PE_M = 0, PE_T = 0;
  const pvd = (i, j) => i >= 0 && j >= 0 && i < W && j < H && MAT[j * W + i] === M.CITY;
  // a paved tile's own outline (signed distance, inside +), counting only its sides that face unpaved ground and
  // rounding the corners between two such sides (radius 0.28 tile), so the square has no sharp tile corners
  function pvTileD(i, j, tx, ty) {
    const L = !pvd(i - 1, j), R = !pvd(i + 1, j), U = !pvd(i, j - 1), Dn = !pvd(i, j + 1), r = 0.28;
    const dx = L && R ? 0.5 - Math.abs(tx - i) : L ? tx - i + 0.5 : R ? i + 0.5 - tx : 9;
    const dy = U && Dn ? 0.5 - Math.abs(ty - j) : U ? ty - j + 0.5 : Dn ? j + 0.5 - ty : 9;
    const qx = r - dx, qy = r - dy;
    return r - Math.hypot(qx > 0 ? qx : 0, qy > 0 ? qy : 0) - (qx > qy ? (qx < 0 ? qx : 0) : qy < 0 ? qy : 0);
  }
  function paveShape(tx, ty) {
    const i0 = Math.round(tx), j0 = Math.round(ty);
    let din = 9, D = -9;
    PE_M = M.GRASS; PE_T = -1;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = i0 + di, j = j0 + dj;
      const ex = Math.abs(tx - i) - 0.5, ey = Math.abs(ty - j) - 0.5, d = Math.hypot(ex > 0 ? ex : 0, ey > 0 ? ey : 0);
      if (i < 0 || j < 0 || i >= W || j >= H) { if (d < din) din = d; continue; }
      const k = j * W + i;
      if (MAT[k] === M.CITY) { if (!(di === 0 && dj === 0)) { const v = pvTileD(i, j, tx, ty); if (v > D && !pvd(i0, j0)) D = v; } }
      else if (d < din) { din = d; if (MAT[k] !== M.BANK && !isWaterMat(MAT[k])) { PE_M = MAT[k]; PE_T = k; } }
    }
    // inside a paved tile: its own outline, and no nearer than any unpaved tile round it (a notch where only the
    // diagonal is unpaved); outside: the nearest paved tile's outline
    if (pvd(i0, j0)) { D = pvTileD(i0, j0, tx, ty); if (din < D) D = din; }
    for (let q = 0; q < DOORSTEPS.length; q++) {
      const s = DOORSTEPS[q], qx = Math.abs(tx - s[0]) - s[2] + 0.08, qy = Math.abs(ty - s[1]) - s[3] + 0.08;
      const sd = 0.08 - Math.hypot(qx > 0 ? qx : 0, qy > 0 ? qy : 0) - (qx > qy ? (qx < 0 ? qx : 0) : qy < 0 ? qy : 0); // inside distance of a rounded box
      if (sd > D) D = sd;
    }
    PE_D = D + (vnoise(tx * 2.2 + 8, ty * 2.2 + 2) - 0.5) * 0.12 + (vnoise(tx * 7 + 3, ty * 7 + 7) - 0.5) * 0.04;
    if (PE_T < 0) { PE_M = M.GRASS; PE_T = i0 >= 0 && j0 >= 0 && i0 < W && j0 < H ? j0 * W + i0 : 0; }
  }
  // how near a point lies to a road's centre line and to a building's foot (tile units)
  function pvRoad(tx, ty) {
    const i0 = Math.round(tx), j0 = Math.round(ty);
    let best = 9;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const c = tileAt(i0 + di, j0 + dj); if (!c || !c.road) continue;
      const la = tx - c.x, lb = ty - c.y;
      for (const d of DIRS) if (c.road & d.bit) { const t = Math.max(0, Math.min(0.5, la * d.dx + lb * d.dy)), e = Math.hypot(la - t * d.dx, lb - t * d.dy); if (e < best) best = e; }
    }
    return best;
  }
  function pvFoot(tx, ty) {
    const i0 = Math.round(tx), j0 = Math.round(ty);
    let best = 9;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const c = tileAt(i0 + di, j0 + dj); if (!c || !c.building) continue;
      const d = Math.max(Math.abs(tx - c.x), Math.abs(ty - c.y)) - 0.34; if (d < best) best = d;
    }
    return best;
  }
  // wear at a point: 1 deep in the paving, 0 at its edge (over its last quarter tile), lower in a road's lane and at a
  // building's foot
  let PW_EDGE = 0, PW_ROAD = 0, PW_FOOT = 0;
  function paveWear(tx, ty) {
    paveShape(tx, ty);
    const rag = (vnoise(tx * 6.3 + 2, ty * 6.3 + 9) - 0.5) * 0.08;
    PW_EDGE = sstep((PE_D + rag) / 0.26);
    PW_ROAD = 1 - sstep((pvRoad(tx, ty) - 0.12 + rag) / 0.18);
    PW_FOOT = 1 - sstep((pvFoot(tx, ty) + rag * 0.5) / 0.12);
    return PW_EDGE * (1 - 0.35 * PW_ROAD) * (1 - 0.3 * PW_FOOT);
  }
  // a little variation from tile to tile (lighter or darker, warmer or greyer), blended between tile centres
  function pvTile(tx, ty, s) {
    const i = Math.floor(tx), j = Math.floor(ty), fx = sstep(tx - i), fy = sstep(ty - j);
    const a = hash2(i, j, s), b = hash2(i + 1, j, s), c = hash2(i, j + 1, s), d = hash2(i + 1, j + 1, s);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy - 0.5;
  }
  // the ground just outside the setts: a fringe of packed earth fading out into the ground beyond (PE_D < 0)
  function paveFringe(tx, ty, wx, wyg) {
    sampleSpecial(PE_M, PE_T, tx, ty, wx, wyg, 0, 0);
    const k = 0.75 * (1 - sstep((-PE_D - 0.02 + (vnoise(tx * 7.1 + 4, ty * 7.1 + 1) - 0.5) * 0.06) / 0.12));
    V[0] += (PV_DUST[0] * 0.92 - V[0]) * k; V[1] += (PV_DUST[1] * 0.92 - V[1]) * k; V[2] += (PV_DUST[2] * 0.92 - V[2]) * k;
  }
  // the paving at a point: the pattern, the sett's colour and light, its joint, then the wear
  // a paved street across the square: setts in straight courses along the road (axis 1: along x, 2: along y), a
  // little darker, with the dust of its traffic
  const settsY = (u, v) => { settsAt(v, u); const c = PS_CU; PS_CU = PS_CV; PS_CV = c; const n = PS_NX; PS_NX = PS_NY; PS_NY = n; };
  function streetAt(axis, tx, ty, wx, wyg) {
    paveAt(0, tx, ty, wx, wyg, axis === 2 ? settsY : settsAt);
    V[0] = V[0] * 0.95 + PV_DUST[0] * 0.05; V[1] = V[1] * 0.95 + PV_DUST[1] * 0.05; V[2] = V[2] * 0.94 + PV_DUST[2] * 0.05;
  }
  function paveAt(tile, tx, ty, wx, wyg, pat) {
    (pat || PV_PAT[pavingName])(tx, ty);
    const id = PS_ID, d = PS_D, nx = PS_NX, ny = PS_NY;
    // whether the sett is there at all is decided at its centre, so setts go whole
    const keepC = paveWear(PS_CU, PS_CV);
    const gone = sstep((id * 0.85 + 0.08 - keepC) / 0.05);
    const keep = paveWear(tx, ty), edge = PW_EDGE, road = PW_ROAD, foot = PW_FOOT;
    // one colour cluster: a slow tint across the square, the sett's own shade a step either way at most
    const lo = vnoise(tx * 1.1 + 31, ty * 1.1 + 17) - 0.5, lo2 = vnoise(tx * 3.2 + 5, ty * 3.2 + 41) - 0.5;
    const ci = id < 0.07 ? 4 : id > 0.94 ? 3 : Math.floor(((id - 0.07) / 0.87) * 2.999 + lo * 1.2 + 3) % 3;
    const tv = pvTile(tx, ty, 851), tw = pvTile(tx, ty, 852) * 6;
    const base = PV_COL[ci], vj = 1 + (hash2(Math.floor(id * 9973), 3, 841) - 0.5) * 0.03 + lo * 0.04 + lo2 * 0.015 + tv * 0.035;
    // the sett's rounded top: lit along its upper-left edges, shaded along the lower right
    const jw = 0.008 + 0.012 * (1 - keep), inS = sstep((d - jw) / 0.007);
    const L = 1 + 0.04 * (1 - sstep((d - jw) / 0.03)) * (nx * PV_LU + ny * PV_LV);
    let r = (base[0] + tw) * vj * L, g = base[1] * vj * L, b = (base[2] - tw) * vj * L;
    // dust on worn setts and in a road's lane, grime at a building's foot
    const dust = Math.min(1, (1 - keep) * 0.5 + road * 0.28);
    r += (PV_DUST[0] - r) * dust; g += (PV_DUST[1] - g) * dust; b += (PV_DUST[2] - b) * dust;
    r += (PV_GRIME[0] - r) * 0.3 * foot; g += (PV_GRIME[1] - g) * 0.3 * foot; b += (PV_GRIME[2] - b) * 0.3 * foot;
    // the joint, and the ground in a sett's place: packed earth, and toward the edge the ground the paving meets
    let jr = PV_JOINT[0] + (PV_DUST[0] * 0.9 - PV_JOINT[0]) * dust, jg = PV_JOINT[1] + (PV_DUST[1] * 0.9 - PV_JOINT[1]) * dust, jb = PV_JOINT[2] + (PV_DUST[2] * 0.9 - PV_JOINT[2]) * dust;
    const open = Math.max(1 - inS, gone);
    if (open > 0) {
      const gw = Math.min(1, (1 - edge) * 1.6);
      let er = PV_DUST[0] * 0.88, eg = PV_DUST[1] * 0.88, eb = PV_DUST[2] * 0.88;
      if (gw > 0.01) { sampleSpecial(PE_M, PE_T, tx, ty, wx, wyg, 0, 0); er += (V[0] - er) * gw * 0.8; eg += (V[1] - eg) * gw * 0.8; eb += (V[2] - eb) * gw * 0.8; }
      // the joint fills with that ground toward the edge; a missing sett shows it all
      const jk = Math.min(1, gw * 0.85);
      jr += (er - jr) * jk; jg += (eg - jg) * jk; jb += (eb - jb) * jk;
      r = jr + (r - jr) * inS; g = jg + (g - jg) * inS; b = jb + (b - jb) * inS;
      r += (er - r) * gone; g += (eg - g) * gone; b += (eb - b) * gone;
    }
    V[0] = r; V[1] = g; V[2] = b;
  }
  // a material with its special rules: stone islands on Rock tiles, wet sand on beaches (redo)
  function sampleSpecial(m, tile, tx, ty, wx, wyg, la, lb) {
    if (m === M.CITY && pavingName !== 'v2') return paveAt(tile, tx, ty, wx, wyg);
    if (m === M.ROCKMIX) {
      const st = sstep((vnoise(tx * 0.85 + 3, ty * 0.85 + 7) + 0.25 * vnoise(tx * 2.6, ty * 2.6) - 0.62) / 0.12);
      if (st >= 1) return sampleMat(M.HIGHROCK, tx, ty, wx, wyg);
      sampleMat(M.ALPINE, tx, ty, wx, wyg);
      if (st <= 0) return;
      const r0 = V[0], g0 = V[1], b0 = V[2]; sampleMat(M.HIGHROCK, tx, ty, wx, wyg);
      V[0] = r0 + (V[0] - r0) * st; V[1] = g0 + (V[1] - g0) * st; V[2] = b0 + (V[2] - b0) * st; return;
    }
    sampleMat(m, tx, ty, wx, wyg);
    if ((m === M.TAIGA || m === M.FOREST) && FALLN[tile]) {
      // fix round 1 (the critic: round the falls at 22-24,10-12 the taiga's cool grey-teal ground read as panes of glass
      // and a forest tile cleared of its trees for a fall's view as a hard brown patch, so the falls sat in glass boxes):
      // near a fall that ground turns to the mountain's mossy alpine ground, fading out with the distance from the fall
      // (no tile edges); a forest floor that keeps its trees stays as it is
      let w = 0;
      const fl = FALLN[tile];
      for (let q = 0; q < fl.length; q++) { const f = fl[q], d = Math.hypot(tx - f.mx, ty - f.my), k = 1 - sstep((d - 1.5) / 1.2); if (k > w) w = k; }
      if (w > 0) w *= bil(MOSSF, tx, ty); // blended between tile centres, so it never stops at a tile's edge
      if (w > 0) { const r0 = V[0], g0 = V[1], b0 = V[2]; sampleMat(M.ALPINE, tx, ty, wx, wyg); w *= 0.92; V[0] = r0 + (V[0] * 0.94 - r0) * w; V[1] = g0 + (V[1] * 0.96 - g0) * w; V[2] = b0 + (V[2] * 0.92 - b0) * w; }
      return;
    }
    if (m === M.BEACH && state.redo && OCEANSIDE[tile]) {
      let dist = 1;
      if (OCEANSIDE[tile] & 1) dist = Math.min(dist, 0.5 - la);
      if (OCEANSIDE[tile] & 2) dist = Math.min(dist, 0.5 + la);
      if (OCEANSIDE[tile] & 4) dist = Math.min(dist, 0.5 - lb);
      if (OCEANSIDE[tile] & 8) dist = Math.min(dist, 0.5 + lb);
      const w = 1 - sstep((dist - 0.22) / 0.12);
      if (w > 0) { const r0 = V[0], g0 = V[1], b0 = V[2]; sampleMat(M.WET, tx, ty, wx, wyg); V[0] = r0 + (V[0] - r0) * w; V[1] = g0 + (V[1] - g0) * w; V[2] = b0 + (V[2] - b0) * w; }
    }
  }
  const SPAN = [[0.75, 0], [-0.75, 0], [0, 0.75], [0, -0.75], [0.53, 0.53], [-0.53, -0.53], [0.53, -0.53], [-0.53, 0.53]];
  const BLW = new Float64Array(4), BLM = new Int16Array(4), BLT = new Int32Array(4);
  const BW = 0.05; // half-width of the blend strip at a (warped) tile border
  // snow and ice: never brighter than the game's cursor white. A soft knee keeps their texture under the cap.
  const CAP_R = 226, CAP_G = 230, CAP_B = 234, KNEE = 14;
  const soft = (v, cap) => { const k = cap - KNEE; return v <= k ? v : k + KNEE * (1 - Math.exp(-(v - k) / KNEE)); };
  // one picture pixel at tile coords (a, b) from the decal's anchor tile
  function pieceAt(dc, a, b) {
    const l = dc.lim;
    if (l) { a = a < l[0] ? l[0] : a > l[1] ? l[1] : a; b = b < l[2] ? l[2] : b > l[3] ? l[3] : b; }
    const px = Math.round(dc.ax + (a - b) * 64) | 0, py = Math.round(dc.ay + (a + b) * 32) | 0;
    if (px < 0 || py < 0 || px >= dc.w || py >= dc.h) { V[6] = 0; return; }
    const o = ((dc.y0 + py) * dc.stride + dc.x0 + px) * 4;
    V[3] = dc.pd[o]; V[4] = dc.pd[o + 1]; V[5] = dc.pd[o + 2]; V[6] = dc.pd[o + 3] / 255;
  }
  // a turn: the straight pieces bent round the tile corner the two exits share, cross-faded at the middle
  function bendAt(dc, la, lb) {
    const u = la - dc.cx, v = lb - dc.cy, across = Math.hypot(u, v) - 0.5;
    if (across > 0.5) { V[6] = 0; return; }
    const t = Math.atan2(Math.abs(v), Math.abs(u)) / (Math.PI / 2);
    const wx = sstep((t - 0.4) / 0.2);
    let r = 0, g = 0, b = 0, a = 0;
    if (wx > 0) { pieceAt(dc.a, dc.cx * (2 * t - 1), -Math.sign(dc.cy) * across); const w = V[6] * wx; r += V[3] * w; g += V[4] * w; b += V[5] * w; a += w; }
    if (wx < 1) { pieceAt(dc.b, -Math.sign(dc.cx) * across, dc.cy * (1 - 2 * t)); const w = V[6] * (1 - wx); r += V[3] * w; g += V[4] * w; b += V[5] * w; a += w; }
    if (a <= 0) { V[6] = 0; return; }
    V[3] = r / a; V[4] = g / a; V[5] = b / a; V[6] = a;
  }
  // ---------- river banks (feedback 2026-10-12b, point 7): they did not blend into what is round them (a rim of grey
  // stones with a hard dark line round the water, and the river-bank swatch filling the rest of the tile).
  // A river tile's ground away from the water is the land's beside it: that of the neighbour the point faces across
  // the nearer tile edge, else across the other edge, else across the corner, else the most common land round the
  // tile. MAT keeps M.BANK for river tiles (the tooltip names the swatch); the painter asks matIn.
  function rivMat(t, mx, my) {
    const i = t % W, j = (t / W) | 0, fx = mx - i, fy = my - j, sx = fx > 0 ? 1 : -1, sy = fy > 0 ? 1 : -1;
    const kx = i + sx >= 0 && i + sx < W ? t + sx : -1, ky = j + sy >= 0 && j + sy < H ? t + sy * W : -1;
    const k1 = Math.abs(fx) >= Math.abs(fy) ? kx : ky, k2 = k1 === kx ? ky : kx;
    if (k1 >= 0 && LANDT[k1]) return MAT[k1];
    if (k2 >= 0 && LANDT[k2]) return MAT[k2];
    if (kx >= 0 && ky >= 0 && LANDT[ky + sx]) return MAT[ky + sx];
    return RHOST[t];
  }
  const matIn = (t, mx, my) => (MAT[t] === M.BANK ? rivMat(t, mx, my) : MAT[t]);
  const BMEAN = [0, 0, 0]; // the river-bank swatch's mean colour
  { let n = 0; for (let y = 0; y < 397; y += 3) for (let x = 0; x < 397; x += 3) { const o = ((SWY[M.BANK] + y) * 397 + x) * 4; BMEAN[0] += SWD[o]; BMEAN[1] += SWD[o + 1]; BMEAN[2] += SWD[o + 2]; n++; } BMEAN[0] /= n; BMEAN[1] /= n; BMEAN[2] /= n; }
  // a river picture read straight across its channel at |across| = s, on the point's side of the centre line
  function rvPick(dc, a, b, s) {
    if (dc.bend) { const u = a - dc.cx, v = b - dc.cy, r = Math.hypot(u, v) || 1e-6, k = (r >= 0.5 ? 0.5 + s : 0.5 - s) / r; bendAt(dc, dc.cx + u * k, dc.cy + v * k); return; }
    if (dc.rv === 1) pieceAt(dc, a, b < 0 ? -s : s);
    else if (dc.rv === 2) pieceAt(dc, a < 0 ? -s : s, b);
    else if (dc.rv === 3) { const r = Math.hypot(a, b) || 1e-6; pieceAt(dc, (a * s) / r, (b * s) / r); }
    else pieceAt(dc, a, b);
  }
  // A river picture at a point, its banks repainted. The water is Codex's, read at least 0.12 tile inside its edge
  // (mirrored back from 0.26 tile off the centre line), so the shadow and foam lines along its banks never show; its
  // edge wanders (+-0.05 tile) instead of following the picture's ruler line and is as soft as the sea's shore, with
  // a little of the bank's gravel showing through the shallows. Past it a margin of earth and gravel, with a few
  // clusters of stones, fades into the ground beside the river over about 0.1 tile, always before the tile's edge,
  // and only where that ground is land. The picture's own stone rim is not used. The ground is drawn too (the decal
  // stays opaque), so a junction's open water under its legs stays hidden.
  // In: the point in the decal's tile coords (a, b) and the map's, the ground colour unlit and how much of it is
  // land. Out: V[3..6] as pieceAt; RV_WQ how much of the point is water, RV_COV how much is water or bank.
  let RV_WQ = 0, RV_COV = 0;
  function riverAt(dc, a, b, tx, ty, wx, wyg, gr, gg, gb, land) {
    if (dc.rv === 4) { pieceAt(dc, a, b); RV_WQ = 1; RV_COV = 1; return; }
    const sa = dc.bend ? Math.hypot(a - dc.cx, b - dc.cy) - 0.5 : dc.rv === 1 ? b : dc.rv === 2 ? a : Math.hypot(a, b);
    if (dc.bend && sa > 0.5) { V[6] = 0; return; }
    const ac = sa < 0 ? -sa : sa;
    let d = ac - wlineX(tx, ty); // how far past the waterline (round 3: and the limit by a side toward other ground)
    const sc = shoreCap(tx, ty); if (sc > d) d = sc;
    let wq = 1 - sstep((d + 0.03) / 0.06);
    if (dc.clip >= 5) { // a junction's core: only its water, over the other legs
      if (wq <= 0) { V[6] = 0; return; }
      rvPick(dc, a, b, ac > 0.26 ? 0.52 - ac : ac); V[6] *= wq; RV_WQ = 1; RV_COV = 1; return;
    }
    let r = gr, g = gg, bl = gb, bk = 0, mr = 0, mg = 0, mb = 0, rw = 0;
    if (d > -0.09 && land > 0) {
      // the margin is the ground beside the river, damp: darker, with the river-bank swatch's gravel (at half its size,
      // its pebbles about as big as the picture's stones) at a third of its contrast, and in a few clusters along the
      // water its stones at full contrast. Fix round of v3: it was the bank swatch's own brown, which read as a ruled line
      // round the water (and round a cove's head on the sand)
      sampleMat(M.BANK, tx, ty, wx * 2, wyg * 2);
      const sm = sstep((vnoise(tx * 6.5 + 1, ty * 6.5 + 63) + 0.35 * vnoise(tx * 15 + 5, ty * 15 + 2) - 0.9) / 0.1) * (1 - sstep((d - 0.03) / 0.04));
      const c = 0.33 + 0.67 * sm, dm = 0.8;
      mr = gr * dm + (V[0] - BMEAN[0]) * c; mg = gg * dm + (V[1] - BMEAN[1]) * c; mb = gb * (dm + 0.03) + (V[2] - BMEAN[2]) * c;
      if (sm > 0) { mr += (V[0] - mr) * sm * 0.7; mg += (V[1] - mg) * sm * 0.7; mb += (V[2] - mb) * sm * 0.7; }
      // round 3: by a fall, wet rock, a step or a lip (RWILD) the margin is a bank of damp rock with crisp clusters of moss
      rw = bil(RWILD, tx, ty);
      if (rw > 0.01) {
        sampleMat(M.HIGHROCK, tx, ty, wx, wyg);
        let rr = V[0] * 0.72 - 6, rg = V[1] * 0.74 - 5, rb = V[2] * 0.7 - 6;
        const mn = 0.6 * vnoise(wx * 0.05 + 13, wyg * 0.1 + 5) + 0.4 * vnoise(wx * 0.115 + 1, wyg * 0.23 + 9), mo = sstep((mn - 0.5) / 0.02);
        if (mo > 0) { const ml = 0.68 + 0.5 * ((V[0] + V[1] + V[2]) / 3) / 140; rr += (56 * ml - rr) * mo; rg += (80 * ml - rg) * mo; rb += (38 * ml - rb) * mo; }
        mr += (rr - mr) * rw; mg += (rg - mg) * rw; mb += (rb - mb) * rw;
      }
    }
    // round 3: by a fall, wet rock, a step or a lip, wet boulders (blocksAt) sit along the waterline, half in the water, so the
    // edge is broken by stones instead of running on as one line
    let bo = 0, bR = 0, bG = 0, bB = 0;
    if (rw > 0.3 && d > -0.2 && d < 0.16 && land > 0) {
      blocksAt(1, wx, wyg, false);
      // a stone shows whole or not at all: only those whose middle lies at the water's edge (none out in the water)
      if (BK_K > 0) {
        const zz = (tx + ty) * 16 - wyg, cx = (BK_CX / 32 + (BK_CY + zz) / 16) / 2, cy = ((BK_CY + zz) / 16 - BK_CX / 32) / 2, ca = a + cx - tx, cb = b + cy - ty;
        const cs = dc.bend ? Math.hypot(ca - dc.cx, cb - dc.cy) - 0.5 : dc.rv === 1 ? cb : dc.rv === 2 ? ca : Math.hypot(ca, cb);
        let dcn = (cs < 0 ? -cs : cs) - wlineX(cx, cy); const sc2 = shoreCap(cx, cy); if (sc2 > dcn) dcn = sc2;
        if (dcn < -0.05 || dcn > 0.04) BK_K = 0;
      }
      if (BK_K > 0) {
        bo = BK_K * sstep((rw - 0.3) / 0.2);
        sampleMat(M.HIGHROCK, tx, ty, wx, wyg);
        const dd = 0.8 * BK_F * (1 - 0.45 * BK_RIM);
        bR = V[0] * dd - 6; bG = V[1] * dd - 4; bB = V[2] * dd * 0.94 - 6;
        if (BK_H > 0.66) { const mc = BK_TOP * sstep((-0.2 + 0.6 * (BK_H - 0.66) - BK_QY) / 0.06); bR += (54 - bR) * mc; bG += (76 - bG) * mc; bB += (36 - bB) * mc; }
      }
    }
    if (wq < 1 && land > 0) {
      // its width varies from a hairline to about 0.13 tile, and it fades out into the ground
      const n3 = vnoise(tx * 4.1 + 3, ty * 4.1 + 77);
      bk = (1 - sstep((d - 0.01 - 0.11 * n3) / 0.09)) * (1 - sstep((ac - 0.46) / 0.05)) * land;
      // (round 3: by a lip the bank reaches on to the lip, opaque, its outer edge crisp and ragged)
      if (rw > 0.01) { const bw = rw * (1 - sstep((d - 0.12 - 0.1 * n3) / 0.03)); if (bw > bk) bk = bw; }
      const k = (0.8 + 0.2 * rw) * bk;
      r += (mr - r) * k; g += (mg - g) * k; bl += (mb - bl) * k;
    }
    if (wq > 0) {
      rvPick(dc, a, b, ac > 0.26 ? 0.52 - ac : ac);
      let wr = V[3], wg = V[4], wb = V[5];
      if (d > -0.09 && land > 0) { const sh = 0.25 * (1 - sstep(-d / 0.09)) * land; wr += (mr - wr) * sh; wg += (mg - wg) * sh; wb += (mb - wb) * sh; }
      // near a mouth the river's water turns toward the still water's own colour, so the two never meet along a line
      let sw = 0;
      if (dc.mouths) for (let k = 0; k < dc.mouths.length; k++) { const m = dc.mouths[k], al = (tx - m.x) * m.dx + (ty - m.y) * m.dy; sw = Math.max(sw, 0.5 * sstep((al + 0.55) / 0.55)); }
      if (dc.run) { const m = dc.run, al = (tx - m.x) * m.dx + (ty - m.y) * m.dy; sw = Math.max(sw, 0.5 + 0.4 * sstep(al / 0.4)); }
      if (sw > 0) { const r0 = wr, g0 = wg, b0 = wb; sampleMat(M.WATER, tx, ty, wx, wyg); wr = r0 + (V[0] - r0) * sw; wg = g0 + (V[1] - g0) * sw; wb = b0 + (V[2] - b0) * sw; }
      r += (wr - r) * wq; g += (wg - g) * wq; bl += (wb - bl) * wq;
    }
    if (bo > 0) { r += (bR - r) * bo; g += (bG - g) * bo; bl += (bB - bl) * bo; wq *= 1 - bo; if (bo > bk) bk = bo; }
    V[3] = r; V[4] = g; V[5] = bl; V[6] = 1; RV_WQ = wq; RV_COV = wq + (1 - wq) * bk;
  }
  // a wheat field at a point: warped, feathered border; inside, the field's picture, mirrored back from its rim
  function fieldAt(tx, ty) {
    V[7] = 0;
    const ti = Math.round(tx) | 0, tj = Math.round(ty) | 0;
    // warped like a material border: +-0.29 tile at frequency 3.1 and +-0.11 at frequency 10
    const n1 = vnoise(tx * 3.1 + 17, ty * 3.1 + 5) - 0.5, n2 = vnoise(tx * 3.1 + 3, ty * 3.1 + 29) - 0.5;
    const n3 = vnoise(tx * 10 + 7, ty * 10 + 11) - 0.5, n4 = vnoise(tx * 10 + 41, ty * 10 + 2) - 0.5;
    const mx = tx + n1 * 0.58 + n3 * 0.22, my = ty + n2 * 0.58 + n4 * 0.22;
    let best = 9, bi = -1, bj = -1;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ti + di, j = tj + dj;
      if (!isField(i, j)) continue;
      const ex = mx - i, ey = my - j;
      const ni = ex > 0 ? i + 1 : i - 1, nj = ey > 0 ? j + 1 : j - 1;
      const ru = RUNUP[j * W + i], hx = isField(ni, j) || (ni > i && ru & 1) ? 0.62 : 0.42, hy = isField(i, nj) || (nj < j && ru & 2) ? 0.62 : 0.42;
      // a rounded patch: corners with a radius of 0.16 tile
      const qx = Math.abs(ex) - hx + 0.16, qy = Math.abs(ey) - hy + 0.16;
      const d = (qx > 0 && qy > 0 ? Math.hypot(qx, qy) : Math.max(qx, qy)) - 0.16;
      if (d < best) { best = d; bi = i; bj = j; }
    }
    if (bi < 0 || best > 0.07) return;
    FLD_T = bj * W + bi;
    const cover = 1 - sstep((best + 0.06) / 0.13);
    if (cover <= 0) return;
    const L = 0.36; let a = tx - bi, b = ty - bj;
    a = a > L ? 2 * L - a : a < -L ? -2 * L - a : a; b = b > L ? 2 * L - b : b < -L ? -2 * L - b : b;
    pieceAt(FIELD_DEC[FIELD[bj * W + bi]], a, b);
    V[7] = cover * V[6];
  }
  function plumeAt(tile, tx, ty) {
    const list = MOUTH_NEAR[tile], rw = (vnoise(tx * 2.2 + 5, ty * 2.2 + 17) - 0.5) * 0.24;
    let w = 0;
    for (let k = 0; k < list.length; k++) {
      const m = list[k], px = tx - m.x, py = ty - m.y, along = px * m.dx + py * m.dy, across = Math.abs(px * m.dy - py * m.dx);
      if (along < -0.3) continue;
      const al = along < 0 ? 0 : along;
      // inside the river's own tile the current shows only where its picture fades out (the last 0.26 tile)
      // as wide as the channel's water (0.38 tile each side of its centre line) where it leaves the river's tile
      // (the decal pass's broad wander, rw, moves both its far end and its sides, so the current ends along no line)
      const v = (along < 0 ? 1 - sstep(-along / 0.26) : 1 - sstep((al + rw) / 0.6)) * (1 - sstep((across - 0.26 - 0.5 * al + rw) / 0.16));
      if (v > w) w = v;
    }
    return w;
  }
  function stoneAt(tx, ty) { return sstep((vnoise(tx * 0.85 + 3, ty * 0.85 + 7) + 0.25 * vnoise(tx * 2.6, ty * 2.6) - 0.62) / 0.12); }
  function iceMargin(tx, ty) {
    const ti = Math.round(tx) | 0, tj = Math.round(ty) | 0;
    let d = 9;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ti + di, j = tj + dj;
      if (i < 0 || j < 0 || i >= W || j >= H || !GLAC[j * W + i]) continue;
      const ex = Math.abs(tx - i) - 0.5, ey = Math.abs(ty - j) - 0.5;
      const dd = Math.hypot(ex > 0 ? ex : 0, ey > 0 ? ey : 0);
      if (dd < d) d = dd;
    }
    return d >= 9 ? 1 : sstep((d - 0.06) / 0.32);
  }
  // v3: the same, searched two tiles out (iceDist sees one tile out only)
  function chanDist(tx, ty) {
    const ti = Math.round(tx) | 0, tj = Math.round(ty) | 0;
    let d = 9;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const i = ti + di, j = tj + dj;
      if (i < 0 || j < 0 || i >= W || j >= H || VALLEY[j * W + i] !== 1) continue;
      const ex = Math.abs(tx - i) - 0.5, ey = Math.abs(ty - j) - 0.5, dd = Math.hypot(ex > 0 ? ex : 0, ey > 0 ? ey : 0);
      if (dd < d) d = dd;
    }
    return d;
  }
  // v3: the firn the Ice channel's head grows out of, along the ice's upper edge: 1 from half a tile above it to 0.3
  // tile onto the ice, 0 from 0.5 tile onto it
  const HEAD_Y = GLACIER_PLAN.steps[0][0];
  function headSnow(tx, ty) {
    const u = ty - HEAD_Y + 0.5, dx = Math.abs(tx - GLACIER_PLAN.x);
    if (u > 0.55 || u < -0.9 || dx > 1.55) return 0;
    return (1 - sstep((u - 0.3) / 0.22)) * sstep((u + 0.9) / 0.35) * (1 - sstep((dx - 1.15) / 0.38));
  }
  // distance from a point to the nearest glacier-option ice tile (0 inside one)
  function iceDist(tx, ty) {
    const ti = Math.round(tx) | 0, tj = Math.round(ty) | 0;
    let d = 9;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ti + di, j = tj + dj;
      if (i < 0 || j < 0 || i >= W || j >= H || VALLEY[j * W + i] !== 1) continue;
      const ex = Math.abs(tx - i) - 0.5, ey = Math.abs(ty - j) - 0.5, dd = Math.hypot(ex > 0 ? ex : 0, ey > 0 ? ey : 0);
      if (dd < d) d = dd;
    }
    return d;
  }
  // how near still or running water a point is (0 to 1), blended between tile centres so it has no edges
  function coastAt(tx, ty) {
    const i0 = Math.floor(tx), j0 = Math.floor(ty), u = tx - i0, v = ty - j0;
    const ia = i0 < 0 ? 0 : i0 > W - 1 ? W - 1 : i0, ib = i0 + 1 > W - 1 ? W - 1 : i0 + 1 < 0 ? 0 : i0 + 1;
    const ja = j0 < 0 ? 0 : j0 > H - 1 ? H - 1 : j0, jb = j0 + 1 > H - 1 ? H - 1 : j0 + 1 < 0 ? 0 : j0 + 1;
    const a = COAST[ja * W + ia], b = COAST[ja * W + ib], c = COAST[jb * W + ia], d = COAST[jb * W + ib];
    if (a + b + c + d === 0) return 0;
    if (a + b + c + d === 4) return 1;
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  }
  // how much a river tile's ground is still water at a point: 1 near (and past) its sides toward a lake or the sea
  // (sides that are not legs: up to 0.4 tile in; mouths: beside the channel, up to 0.25 tile in, so two mouths
  // side by side, or a mouth and a still side, leave no spit of bank between them)
  const CORNERS = [[1, 1, 1], [2, 1, -1], [4, -1, 1], [8, -1, -1]];
  function stillIn(t, tx, ty) {
    const f = RFADE[t] & 15, mo = RFADE[t] >> 4, la = tx - (t % W), lb = ty - ((t / W) | 0);
    const rg = (vnoise(tx * 4.3 + 3, ty * 4.3 + 9) - 0.5) * 0.1 + (vnoise(tx * 11 + 1, ty * 11 + 5) - 0.5) * 0.04;
    let e = 1, w = 0;
    if (RCORN[t]) for (const [k, sx, sy] of CORNERS) if (RCORN[t] & k) { const v = 1 - sstep((Math.hypot(la - 0.5 * sx, lb - 0.5 * sy) - 0.36 + rg) / 0.1); if (v > w) w = v; }
    if (f & 1) e = Math.min(e, 0.5 - la); if (f & 2) e = Math.min(e, 0.5 + la); if (f & 4) e = Math.min(e, 0.5 - lb); if (f & 8) e = Math.min(e, 0.5 + lb);
    if (f) w = Math.max(w, 1 - sstep((e - 0.42 + rg) / 0.1));
    if (mo) {
      const side = (em, across) => { const v = (1 - sstep((em - 0.25 + rg) / 0.1)) * sstep((across - 0.2 + rg) / 0.12); if (v > w) w = v; };
      if (mo & 1) side(0.5 - la, Math.abs(lb)); if (mo & 2) side(0.5 + la, Math.abs(lb)); if (mo & 4) side(0.5 - lb, Math.abs(la)); if (mo & 8) side(0.5 + lb, Math.abs(la));
    }
    return w;
  }
  // ---------- the mountain's flank (the v2 reliefs; the fix round of v3: the flank read as a torn grey sheet with pale
  // rims and holes, and nothing marked where the plateau ended). The flank is one slope painted as ground, under the
  // game's one light from the upper left, darker than the plateau (fix round 1: a value step facing SE, half a step
  // facing SW or NE, and on toward its foot); a soft break of slope under the plateau with a few crags on it (lighter where
  // no snow lies above it; under the snow's edge a band of darker crags instead); the mountain's alpine ground all down the flank, so
  // the forest floor never shows through; outcrops of Codex's mountain rock in broad clusters that run along the slope,
  // darker along their lower and side rims and with a shadow on the ground under them, never a light outline; and at
  // the foot a fan of scree spreading out onto the ground below, over a contact shadow.
  // In: RB the ground colour; rocky 1 for Game v2 (rock over most of the steep flank), less for Smooth v2.
  // Out: RB, MS_SHADE (the face light), MS_EXTRA (shadows), MS_STEEP (how much is rock or scree: no tufts, no snow).
  const RB = new Float64Array(3);
  let RB_M = 0; // the ground's material
  let MS_SHADE = 1, MS_EXTRA = 1, MS_STEEP = 0, MS_FL = 0;
  // the flank's value steps below the plateau (fix round 1): facing SE or away, facing SW, and the most it darkens
  // toward its foot; MTN_TOP is the plateau's level
  const MF_SE = 0.22, MF_SW = 0.12, MF_FOOT = 0.14, MTN_TOP = 4;
  // the outcrops: a broad noise with a band that follows the contours (zz, the level), so they run along the slope
  // Round 3 (the critic: a dead straight dark crack ran 130 px along a bank at 30.5,4): the caller warps the level zz by up
  // to a third of a level (mountainAt), so on a steep straight bank (three levels a tile) the band's edges wander instead
  // of following the tile grid
  function crag(x, y, zz, want) {
    const o = 0.5 * vnoise(x * 1.7 + 31, y * 1.7 + 7) + 0.2 * vnoise(x * 4.6 + 3, y * 4.6 + 19) + 0.3 * vnoise(zz * 2.6 + 5, (x - y) * 1.3 + 11);
    return sstep((o - 0.74 + 0.42 * want) / 0.035);
  }
  // The light off the mountain: Game (terrainRelief.ts with everyBankRock, as in the reference shots: face light, rims,
  // rock on every bank), or Smooth (v1), what the game draws today (terrainRelief.ts DEFAULT_RELIEF: face light, rims,
  // dark bank grass, rock on stacked banks, two levels within about 0.75 tile or Mountain terrain, and the odd outcrop).
  // Game v2 is Game off the mountain, Smooth v2 is Smooth (v1). In: the ground in LT. Out: LT, LT_SHADE, LT_STEEP.
  const LT = new Float64Array(3);
  let NZ1Y = 0, NZ2X = 0, NZ2Y = 0; // (fix round 2) the point's own border noises (shadeAt), reused as free noise
  let LT_SHADE = 1, LT_STEEP = 0;
  // Fix round 2 (v2: the v2 options off the mountain, which until now were their v1 pixel for pixel): a bank that looks
  // away from the view shows only a sliver of itself along its lip, and that sliver was pale rock in a strong light, a
  // crisp line; there it is the bank's own ground in a softer light, so the lip fades into the grass on both sides. And
  // under Game v2 the dressed-stone walls end in rubble and grass instead of a square cut (below).
  function offMtnLight(game, tx, ty, z, gx, gy, levels, hardGround, onIce, wx, wyg, tile, v2) {
    let shade = 1 + gx * 0.016 - gy * 0.019, steep = 0, oR = LT[0], oG = LT[1], oB = LT[2];
    shade = shade < 0.68 ? 0.68 : shade > 1.24 ? 1.24 : shade;
    let away = 0;
    if (v2 && levels > 0.3) { const g = Math.sqrt(gx * gx + gy * gy); away = sstep(((gx + gy) / (g * 1.4142) - 0.1) / 0.45); if (away > 0) shade = 1 + (shade - 1) * (1 - 0.55 * away); }
    if (game) {
      const k = 0.12, lap = FLAT_P ? 0 : (heightAt(tx + k, ty) + heightAt(tx - k, ty) + heightAt(tx, ty + k) + heightAt(tx, ty - k) - 4 * z) / (k * k);
      let rim = 1 - lap * 0.0004; rim = rim < 0.8 ? 0.8 : rim > 1.16 ? 1.16 : rim; if (away > 0 && rim > 1) rim = 1 + (rim - 1) * (1 - 0.55 * away); shade *= rim;
      if (levels > 0.3 && hardGround && !onIce) {
        const n0 = (vnoise(tx * 3 + 61, ty * 3 + 17) - 0.5) * 0.6;
        steep = sstep((levels - 1.4 + n0) / 0.4);
        let rub = 0, t = 0;
        if (v2) {
          // Game v2: the dressed stone keeps to the bank's steep middle; toward its ends and edges it breaks into
          // rubble (the mountain's rock at half size, in lumps) that thins out into the grass
          const wall = sstep((levels - 2.05 + n0 * 1.4 + NZ2Y * 0.9) / 0.3);
          const lump = 0.65 * vnoise(tx * 8.3 + 19, ty * 8.3 + 3) + 0.35 * (NZ2X + 0.5);
          t = sstep((levels - 0.5) / 1.5);
          rub = sstep((lump - 1.05 + 0.62 * t) / 0.06) * (1 - wall);
          steep = wall * (1 - away);
          rub *= 1 - away;
        }
        const slope = sstep((levels - 0.3) / 0.7), kk = slope * (1 - steep);
        oR *= 1 - 0.12 * kk; oG *= 1 - 0.08 * kk; oB *= 1 - 0.05 * kk;
        if (steep > 0.02) { const r0 = oR, g0 = oG, b0 = oB; sampleMat(M.ROCK, tx, ty, wx, wyg); oR = r0 + (V[0] - r0) * steep; oG = g0 + (V[1] - g0) * steep; oB = b0 + (V[2] - b0) * steep; }
        if (rub > 0.02) {
          // each lump with a darker lower rim and a little shadow on the grass below it
          const e = 0.03, ld = 0.65 * vnoise((tx + e) * 8.3 + 19, (ty + e) * 8.3 + 3) + 0.35 * (NZ2X + 0.5);
          const d = 0.9 * (1 - 0.3 * (1 - sstep((ld - 1.05 + 0.62 * t) / 0.06)));
          const r0 = oR, g0 = oG, b0 = oB; sampleMat(M.HIGHROCK, tx, ty, wx * 2, wyg * 2);
          oR = r0 + (V[0] * d - r0) * rub; oG = g0 + (V[1] * d - g0) * rub; oB = b0 + (V[2] * d - b0) * rub;
          if (rub > steep) steep = rub;
        }
      }
    } else {
      const k = 0.12, lap = FLAT_P ? 0 : (heightAt(tx + k, ty) + heightAt(tx - k, ty) + heightAt(tx, ty + k) + heightAt(tx, ty - k) - 4 * z) / (k * k);
      let rim = 1 - lap * 0.0004; rim = rim < 0.8 ? 0.8 : rim > 1.16 ? 1.16 : rim; shade *= rim;
      if (levels > 0.3 && hardGround) {
        const bnk = sstep((levels - 0.8) / 0.6);
        // span: how many levels the surface spans across the point and +-0.75 tile
        let lo = z, hi = z;
        for (const [ox, oy] of SPAN) { const hz = heightAt(tx + ox, ty + oy); if (hz < lo) lo = hz; if (hz > hi) hi = hz; }
        const stacked = MAT[tile] === M.ROCKMIX || MAT[tile] === M.ALPINE ? 1 : sstep(((hi - lo) / LEVEL - 1.4) / 0.4);
        const outcrop = sstep((vnoise(tx * 1.4 + 9, ty * 1.4 + 3) - 0.6) / 0.08);
        steep = bnk * Math.max(stacked, outcrop) * (1 - away);
        const slope = sstep((levels - 0.3) / 0.7), kk = slope * (1 - steep);
        oR *= 1 - 0.12 * kk; oG *= 1 - 0.08 * kk; oB *= 1 - 0.05 * kk;
        if (steep > 0.02) { const r0 = oR, g0 = oG, b0 = oB; sampleMat(M.ROCK, tx, ty, wx, wyg); oR = r0 + (V[0] - r0) * steep; oG = g0 + (V[1] - g0) * steep; oB = b0 + (V[2] - b0) * steep; }
      }
    }
    LT[0] = oR; LT[1] = oG; LT[2] = oB; LT_SHADE = shade; LT_STEEP = steep;
  }
  // Fix round 1 of the v3 merge (the critic: under Game v2 the snow plateau ended in a ruler-straight, see-through cut
  // along x = 32 and on its NE side, which read as a sheet of paper laid on the rock). Where the flank falls away below a
  // snow tile, the snow now ends at a drift line measured down the slope: SB_DROP is how far the point lies below the
  // highest snow tile round it (levels; -1 with none), SB_LIM how far down the snow reaches there (wind-blown tongues,
  // stretched down the fall line, reach about 0.4 level further down; elsewhere the line wanders just under the break of
  // slope), SB_BELOW how far below that line the point is, SB_AHEAD (on the plateau's top) how far the ground falls
  // within half a tile of the point, so the snow turns opaque before its edge. Off the Ice channel's banks only (SB_ON).
  const AHEAD8 = [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5], [0.35, 0.35], [-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35]];
  let SB_ON = 0, SB_DROP = -1, SB_LIM = 0, SB_BELOW = 9, SB_AHEAD = 0, SB_UX = 0, SB_UY = 0; // SB_U*: up the slope
  const SBTOP = new Float32Array(N), SBLOW = new Float32Array(N); // (buildScene)
  let SB_TOP = 0, SB_TX = 0, SB_TY = 0, SB_Z = 0; // for sbAhead, asked only where the snow needs it
  function snowBrink(tx, ty, z, gx, gy) {
    SB_DROP = -1; SB_LIM = 0; SB_BELOW = 9; SB_AHEAD = -1; SB_UX = 0; SB_UY = 0;
    const tile = (Math.max(0, Math.min(H - 1, Math.round(ty) | 0))) * W + Math.max(0, Math.min(W - 1, Math.round(tx) | 0));
    const top = SBTOP[tile];
    if (top < 0) return;
    // nothing lower than the snow round the point: it is on the plateau's top, more than half a tile from any edge
    if (SBLOW[tile] >= top) { SB_DROP = 0; SB_AHEAD = 0; return; }
    // measured at a point warped by up to 0.14 tile: the slope's own contours run square round the plateau's corners
    const hx = tx + (vnoise(tx * 2.9 + 5, ty * 2.9 + 61) - 0.5) * 0.28, hy = ty + (vnoise(tx * 2.9 + 37, ty * 2.9 + 3) - 0.5) * 0.28;
    let dr = top - heightAt(hx, hy) / LEVEL;
    if (dr < 0) dr = 0;
    SB_DROP = dr;
    // well down the flank: no snow and no crag band there, so no tongues to work out
    if (dr > 1.2) { SB_BELOW = dr; return; }
    if (dr > 0.003) {
      // the tongues: lobes of a warped noise, so they are rounded drifts of different lengths, not a comb of teeth.
      // Round 3 (the critic: at 30.5,4 a tongue ended in a ruler-straight vertical edge against the rock face, and ran
      // along a slab in a straight diagonal): the noise is the same whichever way the slope faces (v3 stretched it along
      // the fall line, blending two stretched noises by the slope's direction, which switched from one to the other on a
      // ridge and cut the snow there in a straight line); a tongue reaches less far down a steep face, so it ends short of
      // the face in a rounded drift; and its edge is ragged, measured across the slope (a steep face packs a level into a
      // narrow band, so the same rag in levels would leave its sides ruled)
      const g2 = gx * gx + gy * gy, gl = Math.sqrt(g2), lv = gl / LEVEL;
      if (g2 > 0) { SB_UX = gx / gl; SB_UY = gy / gl; }
      const wpx = tx + (vnoise(tx * 3.3 + 7, ty * 3.3 + 1) - 0.5) * 0.3, wpy = ty + (vnoise(tx * 3.3 + 2, ty * 3.3 + 23) - 0.5) * 0.3;
      const tg = sstep((vnoise(wpx * 2.4 + 13, wpy * 2.4 + 5) + 0.3 * vnoise(wpx * 6.1 + 3, wpy * 6.1 + 1) - 0.66) / 0.4);
      const rag = (vnoise(tx * 8.3 + 3, ty * 8.3 + 29) - 0.5) * 0.1 + (vnoise(tx * 19 + 7, ty * 19 + 1) - 0.5) * 0.045;
      SB_LIM = 0.03 + 0.12 * vnoise(wpx * 1.9 + 41, wpy * 1.9 + 9) + 0.07 * vnoise(wpx * 4.6 + 3, wpy * 4.6 + 17) + 0.42 * tg * (1 - 0.55 * sstep((lv - 1.4) / 1.2)) + rag * (lv > 1 ? lv : 1);
      SB_BELOW = dr - SB_LIM;
    } else { SB_TOP = top; SB_TX = tx; SB_TY = ty; SB_Z = z; }
  }
  // how far the ground falls just behind a point (up the screen; levels): the snow keeps off the lip of a drop that looks
  // away. Round 3 (the critic: the snow along the rock slab at 30.5,4 ended in a straight diagonal): how far behind it
  // looks wanders (0.13 to 0.5 tile), so the line it stops on is ragged, not the tile edge moved back
  function snowBack(tx, ty, z) {
    const jb = 0.32 + (vnoise(tx * 4.7 + 5, ty * 4.7 + 13) - 0.5) * 0.28 + (vnoise(tx * 11 + 2, ty * 11 + 9) - 0.5) * 0.1;
    return (z - Math.min(heightAt(tx - jb, ty), heightAt(tx, ty - jb))) / LEVEL;
  }
  // how far the ground falls within half a tile of a point on the plateau's top (eight directions, so the opaque band
  // rounds the plateau's corners instead of cutting them square); asked by the snow only
  function sbAhead() {
    if (SB_AHEAD >= 0) return SB_AHEAD;
    let lo = SB_Z;
    for (let q = 0; q < 8; q++) { const h = heightAt(SB_TX + AHEAD8[q][0], SB_TY + AHEAD8[q][1]); if (h < lo) lo = h; }
    return (SB_AHEAD = SB_TOP - lo / LEVEL);
  }
  // ---------- v9: the level steps on the mountain's right-hand faces (the author, 16 October: "the right side of the
  // mountain still runs together very much: you cannot tell where the steps are"; the right side is the faces turned to
  // the lower right and the upper right of the screen, the author’s south-east and north-east). There the stacked levels are one
  // slope that faces away from the light from the upper left, so the light that tells a tread from its riser on the faces
  // turned left is gone; each level step is painted on them instead, by the level edge it belongs to (the edge between
  // levels k and k + 1 lies at height k + 0.5, where the stacked slope is steepest): the riser a value step darker, its
  // lip lit, a shadow at its foot, the tread between two risers back toward the plateau's light. Its edges wander a little
  // (the point is moved up to about 0.16 tile along the ground before its level is read), and their widths are measured on
  // screen, so they keep their size whichever way the face turns. Only where the slope's downhill turns to the right of
  // the screen (rightness: 0.71 facing SE or NE, 1 facing E, 0 facing S or N, below 0 facing left); the faces turned
  // left and everything off the mountain stay as they were, pixel for pixel. Game v2's steps are crisp ledges of its
  // rock: the riser filled with the flank's crag rock, cooler in its shade, its top edge lit, the tread just above it
  // clear of rock, the rock thinning along the edge into rubble and grass in places. Smooth v2's are soft lips over
  // grassy risers with a few outcrops.
  // In: the point, its height and slope (gx, gy: world px per tile), game. Out: RS_W how much of a right-hand face the
  // point is on (0: none, and nothing else is set), RS_K the step's light (multiplies the flank's shade), RS_RISE how
  // much of a riser it is, RS_LIP and RS_FOOT its lip's light and its foot's shadow (0 to 1), RS_CLR how clear of rock
  // the tread just above the lip is, RS_RB how much of the riser's rock is left along the edge here (0 to 1).
  // RSP per relief: t0 the rightness the marks begin at (full 0.35 past it); tread, riser, lip, foot their strength; eL
  // and eF where the lip and the foot lie (levels above the edge) and ev how much that wanders; sT, sR the lip's width
  // (screen px at zoom 1) on its tread's side and its riser's, sF, sFr the foot's below and above it, rw how soft the
  // riser's edges are; rock how much more crag rock a riser shows, rbk how much of it thins out along the edge in places;
  // clr how much rock the tread keeps off just above the lip, sC how far (screen px at zoom 1); cool how much cooler a
  // riser is; wa, wb the warp's two octaves (tiles); lb how much the lip is broken along its length, lbk how much a crag
  // breaks it
  const RSP = {
    game: { t0: 0.18, tread: 0.18, riser: 0.22, lip: 0.3, foot: 0.2, eL: 0.24, eF: -0.24, sT: 0.6, sR: 1, sF: 2.2, sFr: 1.2, rock: 0.9, wa: 0.24, wb: 0.08, ev: 0.16, lb: 0.7, rw: 0.7, clr: 0.8, sC: 2.5, cool: 1, lbk: 0, rbk: 0.55 },
    smooth: { t0: 0.18, tread: 0.16, riser: 0.22, lip: 0.26, foot: 0.16, eL: 0.24, eF: -0.26, sT: 2, sR: 1, sF: 3.4, sFr: 2, rock: 0.15, wa: 0.24, wb: 0.06, ev: 0.12, lb: 0.35, rw: 1.4, clr: 0.4, sC: 2.5, cool: 1, lbk: 0.7, rbk: 0.8 },
  };
  let RS_W = 0, RS_K = 1, RS_RISE = 0, RS_LIP = 0, RS_FOOT = 0, RS_CLR = 0, RS_RB = 1;
  function rightSteps(tx, ty, gx, gy, levels, game) {
    RS_W = 0; RS_K = 1; RS_RISE = 0; RS_LIP = 0; RS_FOOT = 0; RS_CLR = 0; RS_RB = 1;
    const gl = Math.sqrt(gx * gx + gy * gy);
    if (gl < 0.4) return;
    const P = game ? RSP.game : RSP.smooth, rr = ((gy - gx) / gl) * Math.SQRT1_2;
    if (rr <= P.t0) return;
    const w = sstep((rr - P.t0) / 0.35) * sstep((levels - 0.08) / 0.25);
    if (w <= 0) return;
    RS_W = w;
    // the level edge nearest the point, read a little off it (two octaves, up to 0.15 tile), and how far above that
    // edge it is (levels)
    const n1 = vnoise(tx * 1.3 + 17, ty * 1.3 + 29), n2 = vnoise(tx * 1.3 + 43, ty * 1.3 + 11), n3 = vnoise(tx * 3.7 + 5, ty * 3.7 + 61);
    const px = tx + (n1 - 0.5) * P.wa + (n3 - 0.5) * P.wb, py = ty + (n2 - 0.5) * P.wa - (n3 - 0.5) * P.wb;
    const zw = heightAt(px, py) / LEVEL, e = zw - Math.floor(zw) - 0.5;
    // along the edge the riser is a little taller or shorter, and its lip is lit more or less (rubble and grass break
    // it in places)
    const nl = vnoise(tx * 2.1 + 71, ty * 2.1 + 5), eL = P.eL + (n2 - 0.5) * P.ev, eF = P.eF - (n1 - 0.5) * P.ev;
    // levels per screen px (zoom 1) along the slope here (the surface's gradient through the iso projection)
    const den = 32 - gx - gy, q = Math.hypot((gx - gy) / 2, gx + gy) / ((den > 4 ? den : 4) * LEVEL);
    const qq = q > 0.004 ? q : 0.004;
    const dL = (e - eL) / qq, dF = (e - eF) / qq; // screen px above the lip and above the foot
    const rise = sstep((dF + 0.5 * P.rw) / P.rw) * (1 - sstep((dL + 0.5 * P.rw) / P.rw));
    const lip = dL >= 0 ? Math.exp(-(dL * dL) / (P.sT * P.sT)) : Math.exp(-(dL * dL) / (P.sR * P.sR));
    const ft = dF <= 0 ? Math.exp(-(dF * dF) / (P.sF * P.sF)) : Math.exp(-(dF * dF) / (P.sFr * P.sFr));
    RS_RISE = rise * w; RS_LIP = lip * w * (1 - P.lb * (1 - sstep((nl - 0.25) / 0.35))); RS_FOOT = ft * w;
    // the tread just above the lip keeps clear of crag rock, so the riser's rock ends at its lip
    RS_CLR = w * sstep((dL + 0.5) / 1) * (dL > 0 ? Math.exp(-(dL * dL) / (P.sC * P.sC)) : 1);
    // and along the edge the riser's rock thins out in places into rubble and grass
    RS_RB = 1 - P.rbk * (1 - sstep((vnoise(tx * 0.9 + 23, ty * 0.9 + 37) - 0.3) / 0.35));
    RS_K = 1 + w * (P.tread * (1 - rise) * (1 - ft) - P.riser * rise);
  }
  function mountainAt(tx, ty, z, gx, gy, levels, wx, wyg, rocky, mtile) {
    // (fix round 2, the critic: at zoom 4 the rock met the top in a straight line along each level edge) where the
    // flank begins wanders with a noise, so the top's ground runs out into the flank's rock in tongues, not on a rule
    const fln = (vnoise(tx * 3.3 + 41, ty * 3.3 + 7) - 0.5) * 0.7 + NZ2Y * 0.3;
    const zl = z / LEVEL, fl = sstep((levels - 0.2 + fln) / 0.55);
    // the break of slope (convex) and the foot (concave): the surface's curvature over about 0.3 tile, in levels/tile²
    const kc = 0.3, cv = FLAT_P ? 0 : (heightAt(tx + kc, ty) + heightAt(tx - kc, ty) + heightAt(tx, ty + kc) + heightAt(tx, ty - kc) - 4 * z) / (kc * kc * LEVEL);
    const brk = sstep((-cv - 1) / 3), foot = sstep((cv - 1) / 3);
    // the top is lightest (art direction: one upper-left light, top faces lightest). Fix round 1 (the critic: at zoom 1
    // the mountain read as a flat grey field, its flank the plateau's own value): the flank is one clear value step
    // darker than the plateau facing SE (away from the light), half a step facing SW or NE, a little facing NW (into the
    // light), and darkens on toward its foot, so the mass stands raised above the forest. A lip with no snow on it catches
    // the light; under a snow edge (SB_*) the break of slope is a band of darker crags in the snow's short cast shadow.
    const gl = Math.hypot(gx, gy) || 1, fse = gx < 0 ? -gx / gl : 0, fnw = gx > 0 ? gx / gl : 0, fsw = gy < 0 ? -gy / gl : 0, fne = gy > 0 ? gy / gl : 0;
    let face = MF_SE * fse + MF_SW * (fsw + fne) + 0.04 * fnw; if (face > MF_SE) face = MF_SE;
    const dep = sstep((MTN_TOP - 0.3 - zl) / 2.6);
    const sb = SB_ON > 0 && SB_DROP > -0.5, band = sb && SB_DROP > 0 ? SB_ON * sstep((SB_BELOW + 0.02) / 0.06) * (1 - sstep((SB_BELOW - 0.3) / 0.2)) : 0;
    MS_SHADE = 1 - fl * (face + MF_FOOT * dep) + 0.08 * brk * (sb ? 1 - SB_ON : 1);
    MS_FL = fl;
    MS_EXTRA = 1 - 0.14 * foot;
    MS_STEEP = 0;
    rightSteps(tx, ty, gx, gy, levels, rocky === 1); // (v9: the level steps on the right-hand faces)
    let r = RB[0], g = RB[1], b = RB[2];
    // the flank's own ground: the mountain's alpine ground, a little darker on the slope
    // (and all over a mountain tile whose own ground is the forest's or the meadow's, so no forest floor shows through)
    const own = RB_M === M.ROCKMIX || RB_M === M.ALPINE, gw = own ? 0 : mtile ? 0.92 : Math.max(fl, foot * 0.8) * 0.92;
    if (gw > 0.01) { sampleMat(M.ALPINE, tx, ty, wx, wyg); const d = 1 - 0.06 * fl; r += (V[0] * d - r) * gw; g += (V[1] * d - g) * gw; b += (V[2] * d - b) * gw; }
    // scree at the foot: Codex's rock at half size, in lobes that spread out onto the ground below
    const lob = 0.6 * vnoise(tx * 3.1 + 7, ty * 3.1 + 3) + 0.4 * vnoise(tx * 7.7 + 1, ty * 7.7 + 5);
    const sc = foot * sstep((lob - 0.72 + 0.5 * foot) / 0.07);
    if (sc > 0.01) { sampleMat(M.HIGHROCK, tx, ty, wx * 2, wyg * 2); const d = 0.84; r += (V[0] * d - r) * sc * 0.9; g += (V[1] * d - g) * sc * 0.9; b += (V[2] * d - b) * sc * 0.9; MS_STEEP = sc; }
    // the outcrops: most where the flank is steepest, none in the scree, a few crags along the break of slope
    // (round 3: how far the crags reach into the foot wanders along the bank, so where the foot stops them is no line ruled
    // along a straight bank; and their lower rims come in short lengths, so no dark line runs on along a contour)
    const fj = foot > 0 ? 0.3 + 0.7 * sstep((vnoise(tx * 3.3 + 5, ty * 3.3 + 1) - 0.3) / 0.4) : 1;
    let want = rocky * fl * (0.48 + 0.32 * sstep((levels - 0.7) / 0.8)) * (1 - 0.85 * foot * fj) + brk * (0.36 + 0.24 * rocky) + 0.42 * band;
    if (RS_W > 0) { const P = rocky === 1 ? RSP.game : RSP.smooth; want += P.rock * RS_RISE * RS_RB - P.clr * RS_CLR; } // (v9: a right-hand riser's own rock, none just above its lip)
    if (want > 0.85) want = 0.85;
    let rkS = 0;
    if (want > 0.02) {
      const zw = zl + 0.65 * (vnoise(tx * 3.1 + 7, ty * 3.1 + 2) - 0.5); // (round 3: the warped level, see crag)
      const rk = crag(tx, ty, zw, want), e = 0.035;
      rkS = rk;
      // the rock just up the screen (its shadow falls here), just below it and to either side (its rims)
      const up = crag(tx - 0.05, ty - 0.05, zw - ((gx + gy) * 0.05) / LEVEL, want);
      if (rk > 0.01) {
        const dn = crag(tx + e, ty + e, zw + ((gx + gy) * e) / LEVEL, want);
        const lf = crag(tx - e, ty + e, zw + ((gy - gx) * e) / LEVEL, want), rt = crag(tx + e, ty - e, zw + ((gx - gy) * e) / LEVEL, want);
        sampleMat(M.HIGHROCK, tx, ty, wx, wyg);
        const seg = dn < 1 ? 0.25 + 0.75 * sstep((vnoise(tx * 6.2 + 9, ty * 6.2 + 3) - 0.38) / 0.14) : 1;
        const rim = 1 - 0.36 * (1 - dn) * seg - 0.18 * (1 - (lf < rt ? lf : rt));
        const d = 0.86 * (rim < 0.5 ? 0.5 : rim) * (1 - 0.14 * band);
        r += (V[0] * d - r) * rk; g += (V[1] * d - g) * rk; b += (V[2] * d - b) * rk;
        if (rk > MS_STEEP) MS_STEEP = rk;
      }
      const sh = up * (1 - rk);
      if (sh > 0) { r *= 1 - 0.24 * sh; g *= 1 - 0.22 * sh; b *= 1 - 0.18 * sh; }
    }
    if (sb && SB_DROP > 0) {
      // the band of crags under the snow edge is darker ground, and the snow's lip throws a short shadow down the slope
      const k = 1 - 0.1 * band;
      r *= k; g *= k; b *= k;
    }
    if (RS_W > 0) {
      // (v9) a right-hand riser is in the shade: a little cooler than its treads
      const c = (rocky === 1 ? RSP.game : RSP.smooth).cool * RS_RISE;
      r *= 1 - 0.07 * c; g *= 1 - 0.03 * c; b *= 1 + 0.03 * c;
    }
    RB[0] = r; RB[1] = g; RB[2] = b;
    if (RS_W > 0) {
      // (v9) the right-hand faces' steps: a crag on the slope takes the riser's shade but breaks the shadow at its foot
      // (and, by lbk, its lip: under Smooth v2; Game v2's riser rock keeps its lit top edge)
      const P = rocky === 1 ? RSP.game : RSP.smooth, br = 1 - 0.7 * rkS;
      MS_SHADE *= RS_K * (1 + P.lip * RS_LIP * (1 - P.lbk * rkS)) * (1 - P.foot * RS_FOOT * br);
    }
  }
  let FLAGV = 0; // what the grass-detail pass may draw on this pixel: 0 nothing, 1 pebbles, 2 grass tufts too, 3 forest tufts too
  const GRASSY = new Uint8Array(32); GRASSY[M.GRASS] = 2; GRASSY[M.ALPINE] = 2; GRASSY[M.ROCKMIX] = 2; GRASSY[M.FOREST] = 3; GRASSY[M.TAIGA] = 3;
  // whether the ground is at one level within FLATK of a point, with no warp moving its edges there: then every slope,
  // rim and curvature the relief light asks heightAt for comes out exactly zero, so they are not asked for (fix round 1:
  // load time; about half the points near a level change are on flat ground)
  const FLATK = 0.3;
  let FLAT_P = false;
  function flatAround(tx, ty) {
    if (GWARP && tx >= ICEW_BOX[0] - 0.9 && ty >= ICEW_BOX[1] - 0.9 && tx < ICEW_BOX[2] + 0.9 && ty < ICEW_BOX[3] + 0.9) return false;
    if (SN_BOX && tx > SN_BOX[0] - 0.4 && tx < SN_BOX[2] + 0.4 && ty > SN_BOX[1] - 0.4 && ty < SN_BOX[3] + 0.4) return false;
    let i0 = Math.floor(tx - FLATK), i1 = Math.floor(tx + FLATK) + 1, j0 = Math.floor(ty - FLATK), j1 = Math.floor(ty + FLATK) + 1;
    i0 = i0 < 0 ? 0 : i0 > W - 1 ? W - 1 : i0; i1 = i1 < 0 ? 0 : i1 > W - 1 ? W - 1 : i1; j0 = j0 < 0 ? 0 : j0 > H - 1 ? H - 1 : j0; j1 = j1 < 0 ? 0 : j1 > H - 1 ? H - 1 : j1;
    const l = Lv[j0 * W + i0];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (Lv[j * W + i] !== l) return false;
    return true;
  }
  // fix round 2: the wet ground by a fall or a step in a river (WETT blended as the snow is between tile centres), and its
  // boulders (about 0.15 tile across). WETN: the tiles where wetAt may be above zero.
  function wetAt(tx, ty) {
    const i0 = Math.floor(tx), j0 = Math.floor(ty);
    const bx = bank(tx - i0), by = bank(ty - j0);
    const ia = Math.max(0, Math.min(W - 1, i0)), ib = Math.max(0, Math.min(W - 1, i0 + 1)), ja = Math.max(0, Math.min(H - 1, j0)), jb = Math.max(0, Math.min(H - 1, j0 + 1));
    const a = WETT[ja * W + ia], b = WETT[ja * W + ib], c = WETT[jb * W + ia], d = WETT[jb * W + ib];
    if (a + b + c + d === 0) return 0;
    return (a + (b - a) * bx) * (1 - by) + (c + (d - c) * bx) * by;
  }
  // the rock that pokes through the v2 mountain's snow (fix round 2): separate outcrops about a fifth of a tile across
  const OC_T = 0.69, ROC = new Float64Array(3);
  // the noises of the snow's thin patches and stone islands (shadeAt)
  const thinN = (tx, ty) => vnoise(tx * 3.3 + 5, ty * 3.3 + 9) + 0.3 * vnoise(tx * 9, ty * 9);
  const stoneN = (tx, ty) => vnoise(tx * 0.85 + 3, ty * 0.85 + 7) + 0.25 * vnoise(tx * 2.6, ty * 2.6);
  const ocN = (tx, ty) => 0.72 * vnoise(tx * 2.7 + 17, ty * 2.7 + 5) + 0.28 * vnoise(tx * 6.3 + 3, ty * 6.3 + 29);
  // Round 3: angular rock blocks (the critic: the outcrops through the plateau's snow read as brown slugs, long sinuous
  // blobs with a dark rim all the way round; the wet rock by the falls was a smear with lilac-grey boulders). A block is a
  // convex six-sided stone on a jittered grid in screen space (world px), its size and facets from its cell's hash (one of
  // 64 shapes): a lit top facet, a lit bevel along its upper edges, a side face along its lower edges (darkest facing SE,
  // less facing SW), a dark rim along its lower and side edges only, and the shadow it throws at its lower right.
  // In: the point on screen (px, py, world px) and the kind (0: outcrops through the mountain's snow, in the clusters of
  // ocN; 1: wet boulders, in loose groups). Out: BK_K how much of the point is block (edges antialiased over a raster
  // px), BK_F its facet light, BK_RIM its rim, BK_TOP how far in onto its top facet, BK_QY the point's height on the
  // block (-1 top to 1 bottom), BK_SH its shadow (off the block), BK_H the block's hash.
  const BKS = new Float64Array(128 * 18);
  {
    const r = makeRng(4242); for (let s = 0; s < 64; s++) { const a0 = r() * 6.2832; for (let k = 0; k < 6; k++) { const a = a0 + k * 1.0472 + (r() - 0.5) * 0.55, o = (s * 6 + k) * 3; BKS[o] = Math.cos(a); BKS[o + 1] = Math.sin(a); BKS[o + 2] = 0.66 + 0.34 * r(); } }
    // Round 4 (the critic: the stones on the snow were nearly all one six-sided shape at one size, some with a light rim
    // like a cut gem, spread evenly, so they read as nuts or gems, not rock): shapes 64 to 127 are the outcrops' own,
    // four-, five- and six-sided, their facets jittered, scaled so the stone's widest extent is its radius (no corner is
    // cut off by the block's box); a facet a shape does not have lies far outside it (99)
    for (let s = 64; s < 128; s++) {
      const n = r() < 0.32 ? 4 : r() < 0.55 ? 5 : 6, a0 = r() * 6.2832, st = 6.2832 / n, ang = [], off = [];
      for (let k = 0; k < n; k++) { ang.push(a0 + k * st + (r() - 0.5) * st * 0.36); off.push(0.7 + 0.3 * r()); }
      let mx = 0;
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n, c1 = Math.cos(ang[k]), s1 = Math.sin(ang[k]), c2 = Math.cos(ang[k2]), s2 = Math.sin(ang[k2]), det = c1 * s2 - s1 * c2;
        const vx = (off[k] * s2 - off[k2] * s1) / det, vy = (c1 * off[k2] - c2 * off[k]) / det;
        mx = Math.max(mx, Math.abs(vx), Math.abs(vy));
      }
      for (let k = 0; k < 6; k++) { const o = (s * 6 + k) * 3; if (k < n) { BKS[o] = Math.cos(ang[k]); BKS[o + 1] = Math.sin(ang[k]); BKS[o + 2] = off[k] / mx; } else { BKS[o] = 1; BKS[o + 1] = 0; BKS[o + 2] = 99; } }
    }
  }
  const BK_CS = [[16, 9, 0.3, 0.32], [11, 6.5, 0.3, 0.3]];
  // the tiles near an outcrop cluster (ocN within 0.16 of its threshold within 0.6 tile): the painter asks blocksAt there only
  const OCT = new Uint8Array(N);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let on = 0; for (let v = -0.6; v <= 0.61 && !on; v += 0.12) for (let u = -0.6; u <= 0.61; u += 0.12) if (ocN(i + u, j + v) > OC_T - 0.16) { on = 1; break; } OCT[j * W + i] = on; } // per kind: cell width and height (world px), radius base and spread (cells)
  let BK_K = 0, BK_F = 1, BK_RIM = 0, BK_TOP = 0, BK_QY = 0, BK_SH = 0, BK_H = 0, BK_E = 0, BK_CX = 0, BK_CY = 0;
  // a direct-mapped cache of the cells' blocks per kind: i, j, how many stones (0 to 3), then each stone's cx, cy, rx,
  // ry, hash and shape
  const BKC = [new Float64Array(256 * 21).fill(NaN), new Float64Array(256 * 21).fill(NaN)];
  function bkCell(kind, i, j) {
    const C = BKC[kind], o = (((i * 7 + j * 13) & 255) >>> 0) * 21;
    if (C[o] === i && C[o + 1] === j) return o;
    const cs = BK_CS[kind], h = hash2(i, j, 501 + kind), h2 = hash2(i, j, 502 + kind), h3 = hash2(i, j, 503 + kind);
    const cx = (i + 0.5 + (hash2(i, j, 505 + kind) - 0.5) * 0.44) * cs[0], cy = (j + 0.5 + (hash2(i, j, 506 + kind) - 0.5) * 0.44) * cs[1];
    C[o] = i; C[o + 1] = j;
    // (a stone reaches at most 0.85 of a cell from its cell's middle, so the 2 x 2 cells round a point always hold it)
    if (kind !== 1) {
      // the outcrops keep to the clusters of v3's broad noise (measured on the plateau's top, level 4), larger in their
      // middle. Round 4: from pebbles to slabs, a third of them long and low, and some in tight clusters of two or three
      const ctx = (cx / 32 + (cy + 40) / 16) / 2, cty = ((cy + 40) / 16 - cx / 32) / 2, dn = ocN(ctx, cty), pr = sstep((dn - OC_T + 0.045) / 0.06) * 0.78, sz = sstep((dn - OC_T) / 0.07);
      if (pr <= 0 || hash2(i, j, 504) >= pr) { C[o + 2] = 0; return o; }
      const r0 = Math.min(0.56, (0.2 + 0.36 * h + 0.1 * sz) * (hash2(i, j, 520) < 0.22 ? 0.7 : 1)), el = hash2(i, j, 507) < 0.34 ? 0.3 + 0.45 * hash2(i, j, 508) : 0;
      const rxc = Math.min(0.6, r0 * (1 + el)), ryc = Math.min(0.6, r0 * (1 - 0.3 * el) * (0.85 + 0.2 * h2));
      const put = (k, x, y, ax, ay, hh, sh) => { const p = o + 3 + k * 6; C[p] = x; C[p + 1] = y; C[p + 2] = ax * cs[0]; C[p + 3] = ay * cs[1]; C[p + 4] = hh; C[p + 5] = sh; };
      put(0, cx, cy, rxc, ryc, h, 64 + Math.floor(h3 * 64));
      let n = 1;
      const hc = hash2(i, j, 509), nc = hc < 0.2 ? 2 : hc < 0.46 ? 1 : 0, mx = cx / cs[0] - i - 0.5, my = cy / cs[1] - j - 0.5;
      for (let k = 1; k <= nc; k++) {
        const a = 6.2832 * hash2(i, j, 510 + k), hk = hash2(i, j, 513 + k), rc = r0 * (0.38 + 0.34 * hk), ryk = rc * (0.8 + 0.3 * hash2(i, j, 516 + k));
        // beside the first, just touching it (its centre a little inside the two radii), kept within the cell's reach
        let ox = Math.cos(a) * (rxc + rc) * 0.82, oy = Math.sin(a) * (ryc + ryk) * 0.82, f = 1;
        if (Math.abs(mx + ox) + rc > 0.85) f = Math.min(f, Math.max(0, (0.85 - rc - Math.sign(ox) * mx) / Math.abs(ox)));
        if (Math.abs(my + oy) + ryk > 0.85) f = Math.min(f, Math.max(0, (0.85 - ryk - Math.sign(oy) * my) / Math.abs(oy)));
        ox *= f; oy *= f;
        if (Math.abs(mx + ox) + rc > 0.86 || Math.abs(my + oy) + ryk > 0.86) continue;
        put(n++, (i + 0.5 + mx + ox) * cs[0], (j + 0.5 + my + oy) * cs[1], rc, ryk, hk, 64 + Math.floor(hash2(i, j, 519 + k) * 64));
      }
      C[o + 2] = n;
      return o;
    }
    const pr = 0.3 + 0.5 * sstep((vnoise((cx / 46) * 1.1 + 4, (cy / 23) * 1.1 + 8) - 0.35) / 0.3); // wet boulders: in loose groups
    const on = hash2(i, j, 504 + kind) < pr ? 1 : 0, rx = Math.min(0.6, cs[2] + cs[3] * h * h) * cs[0];
    C[o + 2] = on; C[o + 3] = cx; C[o + 4] = cy; C[o + 5] = rx; C[o + 6] = rx * (cs[1] / cs[0]) * (0.85 + 0.2 * h2); C[o + 7] = h; C[o + 8] = Math.floor(h3 * 64);
    return o;
  }
  // the block's distance function at q (its own units, about 1 at its edge): the largest of its facets' (BK_E: which)
  function bkD(sh, qx, qy) {
    let m = -9, e = 0;
    for (let k = 0, o = sh * 18; k < 6; k++, o += 3) { const d = qx * BKS[o] + qy * BKS[o + 1] - BKS[o + 2]; if (d > m) { m = d; e = o; } }
    BK_E = e; return m;
  }
  // in: wantShadow, whether to look for a neighbour's shadow when the point is on no block
  function blocksAt(kind, px, py, wantShadow) {
    BK_K = 0; BK_F = 1; BK_RIM = 0; BK_TOP = 0; BK_QY = 0; BK_SH = 0; BK_H = 0;
    const cs = BK_CS[kind], C = BKC[kind], u = px / cs[0] - 0.5, v = py / cs[1] - 0.5, i0 = Math.floor(u), j0 = Math.floor(v);
    let best = 9, bo = -1, be = 0;
    for (let j = j0; j <= j0 + 1; j++) for (let i = i0; i <= i0 + 1; i++) {
      const o = bkCell(kind, i, j), n = C[o + 2];
      for (let k = 0, p = o + 3; k < n; k++, p += 6) {
        const qx = (px - C[p]) / C[p + 2], qy = (py - C[p + 1]) / C[p + 3];
        if (qx > 1.1 || qx < -1.1 || qy > 1.1 || qy < -1.1) continue;
        const m = bkD(C[p + 5], qx, qy) * C[p + 3]; // in world px (a block's height is its smaller radius)
        if (m < best) { best = m; bo = p; be = BK_E; BK_QY = qy; }
      }
    }
    if (bo >= 0 && best < 0.25) {
      BK_K = sstep((0.25 - best) / 0.5); BK_H = C[bo + 4]; BK_CX = C[bo]; BK_CY = C[bo + 1];
      // the facet's normal on screen, and the light on it (from the upper left)
      let sx = BKS[be] / C[bo + 2], sy = BKS[be + 1] / C[bo + 3]; const sl = Math.hypot(sx, sy); sx /= sl; sy /= sl;
      const dl = -(0.55 * sx + 0.83 * sy), dpx = -best, ry = C[bo + 3];
      // a wide side face along the lower edges, a thin bevel along the upper ones
      const bw = ry * (0.12 + 0.55 * (sy > 0 ? sy : 0));
      let sideF = 0.86 + 0.3 * dl - 0.1 * (sx > 0 && sy > 0 ? sx : 0);
      // (round 4: an outcrop's upper bevel is no brighter than its top, so it has no light rim like a cut gem)
      if (kind !== 1 && sy <= 0 && sideF > 1.02) sideF = 1.02;
      const tw = sstep((dpx - bw) / 0.6);
      BK_TOP = tw; BK_F = sideF + (1.06 - sideF) * tw;
      if (sy > 0.15 || sx > 0.8 || sx < -0.8) BK_RIM = 1 - sstep((dpx - 0.2) / 0.45);
      return;
    }
    if (!wantShadow) return;
    // the shadow at its lower right: the point is in it if it lies on the block moved down and right by a third of its size
    for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0 + 1; i++) {
      const o = bkCell(kind, i, j), n = C[o + 2];
      for (let k = 0, p = o + 3; k < n; k++, p += 6) {
        const rx = C[p + 2], ry = C[p + 3], qx = (px - C[p] - 0.42 * rx) / rx, qy = (py - C[p + 1] - 0.45 * ry) / ry;
        if (qx > 1.1 || qx < -1.1 || qy > 1.1 || qy < -1.1) continue;
        const m = bkD(C[p + 5], qx, qy) * ry, s = sstep((0.25 - m) / 0.5);
        if (s > BK_SH) BK_SH = s;
      }
    }
  }
  // Round 5 (the critic: above the rubble island beside the Ice channel's head the snow ended in a ruled, nearly level
  // line, where the stone islands' size test switched on along one contour of its noise): beside the head (headZone)
  // the switch wanders in lobes and is ragged (the test asked a little to one side, by a wandering amount: lobes about a
  // quarter of a tile across), so the rubble pokes up into the snow; the snow keeps a little blue-grey just inside its
  // edge (HI_RIM), and over the island it is snow or bare rubble with a crisp edge, as on the rest of the plateau, even
  // where the head's firn reaches it (HI_ISL). In: the island's stone, the plain test's verdict (cut) and the zone.
  let HI_RIM = 0, HI_ISL = 0;
  const headZone = (tx, ty) => (1 - sstep((ty - HEAD_Y - 0.6) / 0.5)) * (1 - sstep((Math.abs(tx - GLACIER_PLAN.x) - 2) / 0.5));
  function headIsle(tx, ty, stone, cut, hz) {
    const ux = tx + (vnoise(tx * 3.8 + 5, ty * 3.8 + 1) - 0.5) * 0.32 + (vnoise(tx * 9 + 2, ty * 9 + 8) - 0.5) * 0.1;
    const uy = ty + (vnoise(tx * 3.8 + 17, ty * 3.8 + 9) - 0.5) * 0.32 + (vnoise(tx * 9 + 13, ty * 9 + 4) - 0.5) * 0.1;
    const g = Math.max(stoneN(ux + 0.2, uy), stoneN(ux - 0.2, uy), stoneN(ux, uy + 0.2), stoneN(ux, uy - 0.2)) - 0.97 + (vnoise(tx * 13 + 7, ty * 13 + 1) - 0.5) * 0.07 + (vnoise(tx * 31 + 3, ty * 31 + 9) - 0.5) * 0.035, fk = sstep(g / 0.012);
    HI_RIM = hz * (1 - fk) * (1 - sstep(-g / 0.03));
    stone *= cut + (fk - cut) * hz;
    HI_ISL = hz * stone;
    return stone;
  }
  // Round 3 (the critic: by the Ice channel, where the plateau's edge rules give way to the channel's banks, the snow
  // turned see-through, the rubble showing through it like a double exposure, and blurred grey blots lay on it; on the
  // plateau's brink, where crags thin it, smoky grey smears): on the v2 reliefs the snow is opaque. What would be thin
  // snow is either snow or bare ground, ending in a ragged edge with a little blue-grey just inside it (SO_RIM; on the
  // rubble too; the Ice channel's head snow, hd, is kept as it is). (The rarer paths of the painter are functions of
  // their own, so the painter's hot path stays small enough for the compiler to keep its helpers inlined.)
  let SO_RIM = 0;
  function snowOpaque(cover, hd, tx, ty) {
    const rg = (vnoise(tx * 9.1 + 5, ty * 9.1 + 2) - 0.5) * 0.16 + (vnoise(tx * 23 + 1, ty * 23 + 7) - 0.5) * 0.06;
    const kk = 1 - hd, cs = sstep((cover - 0.42 + rg) / 0.05);
    SO_RIM = kk * cs * (1 - sstep((cover - 0.47 + rg) / 0.16));
    return cover + (cs - cover) * kk;
  }
  // Round 3: the outcrops through the mountain's snow are angular blocks (blocksAt) in the clusters of v3's outcrops, a
  // long cluster now a row of separate stones, each with a lit top that keeps a little snow on its upper part, its side
  // face darker facing SE, dark lower and side rims, and a crisp pale-blue shadow on the snow at its lower right.
  // Out: OC_R how much of the point is rock (its colour in ROC, lit by S), OC_S the snow on its top, OC_SH the shadow.
  let OC_R = 0, OC_S = 0, OC_SH = 0;
  function snowRocks(tx, ty, wx, wyg, S, mE) {
    OC_R = 0; OC_S = 0; OC_SH = 0;
    blocksAt(0, wx, wyg, true);
    const me = sstep((mE - 0.3) / 0.25);
    if (BK_K > 0) {
      sampleMat(M.HIGHROCK, tx, ty, wx, wyg);
      const d = 0.9 * BK_F * (1 - 0.36 * BK_RIM) * S;
      ROC[0] = V[0] * d; ROC[1] = V[1] * d; ROC[2] = V[2] * d * 0.98;
      OC_R = BK_K * me;
      // the snow on its top: on the upper part of the top facet, a ragged line across it
      const capL = -0.66 + 0.55 * BK_H + (vnoise(wx * 0.9 + 3, wyg * 1.6 + 17) - 0.5) * 0.3;
      OC_S = BK_H > 0.35 ? BK_TOP * sstep((capL - BK_QY) / 0.06) * 0.95 : 0;
    } else OC_SH = BK_SH * me;
  }
  // Round 4 (the critic: below the melt river on the mountain's lower terrace a grey-brown lip ran dead straight along
  // the tile grid for about 400 px at zoom 4, and on the hairpin island at 29.5,13 a pale wedge of lit ground with a
  // straight lower edge lay between the bank and the wet rock): beside a river on the mountain, where the ground past a
  // side is at another level (LIPE), a band of the bank's damp rock and moss runs from the river over the break of slope
  // and on by a wandering amount (about -0.06 to 0.3 tile past it; over a drop on down to its wet rock), its outer edge
  // crisp and ragged, with wet boulders sitting on the lip, so the lip wanders like the rest of the flank.
  // Out: LB_L how much of the slope's shade is left out, LB_K how much of the point is the band's rock and moss or a
  // boulder, their colour (unlit) in LBC.
  const LBC = new Float64Array(3);
  let LB_K = 0, LB_L = 0;
  function lipBand(list, tx, ty, wx, wyg, z) {
    LB_K = 0; LB_L = 0;
    let k = 0, kl = 0, kb = 0, best = null, nb = 9, fd = 0;
    for (let q = 0; q < list.length; q++) {
      const E = list[q], e = ((E[0] ? ty : tx) - E[1]) * E[3], s = E[0] ? tx : ty, aal = Math.abs(s - E[2]);
      if (e < -0.5 || e > 0.9 || aal > 0.95) continue;
      // its ends are ragged, and a neighbouring side's band carries on where this one fades (the two add up)
      const fe = 1 - sstep((aal - 0.42 - 0.14 * vnoise(s * 4.3 + E[5], e * 3 + 1)) / 0.22);
      if (fe <= 0) continue;
      const wv = -0.06 + E[6] + 0.36 * vnoise(s * 2.2 + E[5], 1.7) + 0.09 * (vnoise(wx * 0.11 + E[5], wyg * 0.2 + 3) - 0.5), ee = e - E[4];
      k += fe * (1 - sstep((ee - wv) / 0.02)) * sstep((e + 0.49) / 0.03);
      // the light: the slope's face and foot shade left out over the lip, fading back in past the band
      kl += fe * (1 - sstep((ee - 0.1 - wv) / 0.16)) * sstep((e + 0.49) / 0.1);
      if (fe > kb) { kb = fe; best = E; }
      if (fe > 0.5 && Math.abs(ee) < nb) nb = Math.abs(ee);
      // (round 5: on a drain side's face, lit and seen edge on, the clusters lie close all the way down it)
      if (E[7]) { const d = fe * (1 - sstep((ee - wv + 0.06) / 0.08)); if (d > fd) fd = d; }
    }
    LB_L = kl > 1 ? 1 : kl;
    // wet boulders whose middle lies on the lip (within about 0.1 tile of the break of slope, give or take), drawn whole
    let bo = 0;
    if (best) {
      blocksAt(1, wx, wyg, false);
      if (BK_K > 0) {
        const cx = (BK_CX / 32 + (BK_CY + z) / 16) / 2, cy = ((BK_CY + z) / 16 - BK_CX / 32) / 2;
        // (how far from the break they may sit wanders along it, so they do not stand in a ruled row)
        const sc = best[0] ? cx : cy, ec = ((best[0] ? cy : cx) - best[1]) * best[3] - best[4] - 0.3 * (vnoise(sc * 2.9 + best[5], 4.1) - 0.5);
        if (ec > -0.1 && ec < 0.07 && Math.abs(sc - best[2]) < 0.5 && BK_H < 0.66) bo = BK_K;
      }
    }
    // in the band, the bank's damp rock in clusters with moss in them (the ground's own between them), closest together
    // over the break of slope itself, so its line only shows in short gaps between them
    const pn = 0.62 * vnoise(wx * 0.07 + 31, wyg * 0.14 + 7) + 0.38 * vnoise(wx * 0.19 + 5, wyg * 0.38 + 21) + 0.22 * (1 - sstep(nb / 0.14)) + 0.2 * fd;
    const pk = (k > 1 ? 1 : k) * sstep((pn - 0.46) / 0.03);
    if (pk <= 0.004 && bo <= 0) return;
    LB_K = Math.max(pk, bo);
    sampleMat(M.HIGHROCK, tx, ty, wx, wyg);
    let r = V[0] * 0.72 - 6, g = V[1] * 0.74 - 5, b = V[2] * 0.7 - 6;
    if (bo > 0) {
      // a boulder: its facet light, a dark rim below; a cap of moss on some
      const dd = 0.8 * BK_F * (1 - 0.45 * BK_RIM), mc = BK_H > 0.5 ? BK_TOP * sstep((-0.2 + 0.6 * (BK_H - 0.5) - BK_QY) / 0.06) : 0;
      const br = V[0] * dd - 6 + (54 - V[0] * dd + 6) * mc, bgg = V[1] * dd - 4 + (76 - V[1] * dd + 4) * mc, bb = V[2] * dd * 0.94 - 6 + (36 - V[2] * dd * 0.94 + 6) * mc;
      r += (br - r) * bo; g += (bgg - g) * bo; b += (bb - b) * bo;
    }
    // (moss in smaller clusters than the bank's, the rock's texture showing in it)
    const mn = 0.6 * vnoise(wx * 0.05 + 13, wyg * 0.1 + 5) + 0.4 * vnoise(wx * 0.16 + 1, wyg * 0.32 + 9), mo = sstep((mn - 0.55) / 0.02) * (1 - bo);
    if (mo > 0) { const ml = 0.5 + 0.62 * ((V[0] + V[1] + V[2]) / 3) / 140, k = mo * 0.82; r += (54 * ml - r) * k; g += (74 * ml - g) * k; b += (38 * ml - b) * k; }
    LBC[0] = r; LBC[1] = g; LBC[2] = b;
  }
  // Round 3 (the critic: the wet rock was a murky, low-resolution smear with lilac-grey boulders): the bank's own rock,
  // darker with the wet but keeping its detail, with crisp clusters of moss and angular wet boulders (blocksAt), their
  // tops lit with a few small glints of wet light. Out: its colour in ROC.
  function wetRock(tx, ty, wx, wyg, S) {
    // measured on screen (a steep bank would stretch them down the rows): rock, moss, boulders
    const su = wx / 46, sv = wyg / 23;
    sampleMat(M.HIGHROCK, tx, ty, wx, wyg);
    const lu = (V[0] + V[1] + V[2]) / 3;
    // the rock, darker with the wet, its contrast kept (a little more than the dry rock's)
    let r = (V[0] * 0.68 - 18) * S, g = (V[1] * 0.7 - 16) * S, b = (V[2] * 0.66 - 16) * S;
    if (r < 8) r = 8; if (g < 9) g = 9; if (b < 8) b = 8;
    // moss in crisp clusters, lighter on their upper left, the rock's texture showing in it
    const mn = 0.6 * vnoise(su * 2.3 + 13, sv * 2.3 + 5) + 0.4 * vnoise(su * 5.2 + 1, sv * 5.2 + 9);
    const mo = sstep((mn - 0.47) / 0.02);
    if (mo > 0) {
      const ml = (0.62 + 0.55 * lu / 140) * S * (1 + 0.22 * sstep((mn - 0.52) / 0.05));
      r += (50 * ml - r) * mo * 0.9; g += (72 * ml - g) * mo * 0.9; b += (34 * ml - b) * mo * 0.9;
    }
    blocksAt(1, wx, wyg, false);
    if (BK_K > 0) {
      // a wet boulder: the dark rock lit by its facet, a dark rim below; a cap of moss on some, a glint on others
      const d = 0.8 * BK_F * (1 - 0.45 * BK_RIM) * S;
      let br = V[0] * d - 6, bg = V[1] * d - 4, bb = V[2] * d * 0.94 - 6;
      if (BK_H > 0.62) { const mc = BK_TOP * sstep((-0.15 + 0.6 * (BK_H - 0.62) - BK_QY + (vnoise(wx * 0.8 + 1, wyg * 1.4) - 0.5) * 0.4) / 0.06); br += (54 * S - br) * mc; bg += (76 * S - bg) * mc; bb += (36 * S - bb) * mc; }
      else { const gl = BK_TOP * sstep((vnoise(wx * 0.9 + 3, wyg * 1.6 + 7) - 0.72) / 0.03) * sstep((-0.2 - BK_QY) / 0.2); br += (196 * S - br) * gl * 0.8; bg += (208 * S - bg) * gl * 0.8; bb += (206 * S - bb) * gl * 0.8; }
      r += (br - r) * BK_K; g += (bg - g) * BK_K; b += (bb - b) * BK_K;
    }
    ROC[0] = r; ROC[1] = g; ROC[2] = b;
  }
  function shadeAt(tx, ty, z, wx, wyg) {
    const ti = Math.max(0, Math.min(W - 1, Math.round(tx) | 0)), tj = Math.max(0, Math.min(H - 1, Math.round(ty) | 0));
    const tile = tj * W + ti;
    // warped material borders: crisp, irregular; calmer along coasts
    VN_IN[0] = tx * 3.1; VN_IN[1] = ty * 3.1; VN_IN[2] = tx * 3.1 + 71; VN_IN[3] = ty * 3.1 + 13; VN_IN[4] = tx * 10 + 5; VN_IN[5] = ty * 10; VN_IN[6] = tx * 10; VN_IN[7] = ty * 10 + 5;
    vnoiseN(4);
    const n1x = VN_OUT[0] - 0.5, n1y = VN_OUT[1] - 0.5;
    const n2x = VN_OUT[2] - 0.5, n2y = VN_OUT[3] - 0.5;
    NZ1Y = n1y; NZ2X = n2x; NZ2Y = n2y;
    // along a waterline the border is calmer (the game's 0.12; a little more here so it never reads as diamonds).
    // The calm is blended between tile centres: switched per tile, it moved the border by a different amount on
    // each side of a tile edge, which cut the shore along that edge in a straight line (feedback 2026-10-12).
    const ck = coastAt(tx, ty), a1 = 0.58 - 0.18 * ck, a2 = 0.22 - 0.12 * ck;
    let mx = tx + n1x * a1 + n2x * a2, my = ty + n1y * a1 + n2y * a2;
    // the warp never looks past the map edge: there the edge tile owns the point (no blend weights above one)
    mx = mx < -0.499 ? -0.499 : mx > W - 0.501 ? W - 0.501 : mx; my = my < -0.499 ? -0.499 : my > H - 0.501 ? H - 0.501 : my;
    // the glacier options' valley: a warped material border never crosses a level edge there, so a lip never shows the
    // ground below it
    const own = ownerAt(tx, ty), lockLv = glacierName !== 'demo';
    if (lockLv) {
      const ii = Math.max(0, Math.min(W - 1, Math.round(mx) | 0)), jj = Math.max(0, Math.min(H - 1, Math.round(my) | 0)), o2 = jj * W + ii;
      if (Lv[o2] !== Lv[own] && (VALLEY[own] || VALLEY[o2])) { const a = wamp(tx, ty); mx = a ? tx + warpX(tx, ty, a) : tx; my = a ? ty + warpY(tx, ty, a) : ty; }
    }
    // the texture's patches: on the mountain (away from the Ice channel) they are picked by the point's place on screen,
    // so where a lip hides the ground behind it the rock runs on across the line instead of changing there (fix round 2,
    // the critic: straight seams in the rock where two rock textures met at a level edge)
    if (MTNF[tile] && !ICEN[tile]) setPatch((wx / 32 + wyg / 16) / 2, (wyg / 16 - wx / 32) / 2); else setPatch(tx, ty);
    const i0 = Math.round(mx) | 0, j0 = Math.round(my) | 0;
    const fx = mx - i0, fy = my - j0;
    const ex = 0.5 - Math.abs(fx), ey = 0.5 - Math.abs(fy);
    const wxn = ex < BW ? 0.5 * (1 - ex / BW) : 0, wyn = ey < BW ? 0.5 * (1 - ey / BW) : 0;
    const i1 = Math.max(0, Math.min(W - 1, i0 + (fx > 0 ? 1 : -1))), j1 = Math.max(0, Math.min(H - 1, j0 + (fy > 0 ? 1 : -1)));
    const t00 = j0 * W + i0, t10 = j0 * W + i1, t01 = j1 * W + i0, t11 = j1 * W + i1;
    let m00 = matIn(t00, mx, my), t0 = t00;
    // the town paving keeps its own outline (paveShape: the paved tiles and doorsteps, a gentle wobble), not the
    // materials' warped border, which broke it into a ragged blob with islands: inside it the paving alone; outside it
    // the paving's tiles count as the ground beyond, with a fringe of packed earth next to it
    let pvD = -9, pvM = 0, pvT = 0;
    if (PAVE_NEAR[tile] && pavingName !== 'v2') {
      paveShape(tx, ty); pvD = PE_D; pvM = PE_M; pvT = PE_T;
      if (pvD > 0) { m00 = M.CITY; t0 = tile; } else if (m00 === M.CITY) { m00 = pvM; t0 = pvT; }
    }
    let r = 0, g = 0, b = 0, land = 0, stillW = 0;
    if ((!wxn && !wyn) || pvD > 0) { sampleSpecial(m00, t0, tx, ty, wx, wyg, fx, fy); r = V[0]; g = V[1]; b = V[2]; land = isWaterMat(m00) ? 0 : 1; if (RFADE[t00] || RCORN[t00]) stillW = stillIn(t00, tx, ty); }
    else {
      BLW[0] = (1 - wxn) * (1 - wyn); BLW[1] = wxn * (1 - wyn); BLW[2] = (1 - wxn) * wyn; BLW[3] = wxn * wyn;
      BLM[0] = m00; BLM[1] = matIn(t10, mx, my); BLM[2] = matIn(t01, mx, my); BLM[3] = matIn(t11, mx, my);
      BLT[0] = t0; BLT[1] = t10; BLT[2] = t01; BLT[3] = t11;
      if (pvD > -9) for (let k = 1; k < 4; k++) if (BLM[k] === M.CITY) { BLM[k] = pvM; BLT[k] = pvT; }
      // (fix round 1: only for the glacier's valley, as the warp above; elsewhere the Ice channel's lock left a straight
      // material border along every level edge on the map: the taiga panes by the falls)
      if (lockLv) { let tot = 0; for (let k = 0; k < 4; k++) { if (Lv[BLT[k]] !== Lv[t00] && (VALLEY[BLT[k]] || VALLEY[t00])) BLW[k] = 0; tot += BLW[k]; } for (let k = 0; k < 4; k++) BLW[k] /= tot; }
      for (let k = 0; k < 4; k++) if (BLW[k] > 0 && (RFADE[BLT[k]] || RCORN[BLT[k]])) stillW += BLW[k] * stillIn(BLT[k], tx, ty);
      for (let k = 0; k < 4; k++) {
        let w = BLW[k]; if (w <= 0) continue;
        for (let q = k + 1; q < 4; q++) if (BLM[q] === BLM[k] && BLW[q] > 0) { w += BLW[q]; BLW[q] = 0; }
        sampleSpecial(BLM[k], BLT[k], tx, ty, wx, wyg, fx, fy);
        r += V[0] * w; g += V[1] * w; b += V[2] * w; if (!isWaterMat(BLM[k])) land += w;
      }
    }
    // just outside the paving: packed earth fading out into the ground beyond
    if (pvD > -0.16 && pvD <= 0) {
      const k = 0.75 * (1 - sstep((-pvD - 0.02 + (vnoise(tx * 7.1 + 4, ty * 7.1 + 1) - 0.5) * 0.06) / 0.12)) * (land > 1 ? 1 : land);
      r += (PV_DUST[0] * 0.92 - r) * k; g += (PV_DUST[1] * 0.92 - g) * k; b += (PV_DUST[2] * 0.92 - b) * k;
    }
    let wf = land < 0.5 ? 1 : 0;
    // a river tile's side toward still water: the still water reaches in under the channel's ragged edge. Asked of the
    // tile that owns the (warped) ground here, so the river's bank ground never shows past its edge either.
    {
      // stillW is the river tile's share of the blend that turns to water, so it replaces that much of the land part
      // (v2 took it of the whole mix, which left a thin line of the bank's ground along every tile edge it crossed)
      const ws = land > 0 ? Math.min(1, stillW / land) : 0;
      if (ws > 0) { const r0 = r, g0 = g, b0 = b; sampleMat(M.WATER, tx, ty, wx, wyg); r = r0 + (V[0] - r0) * ws; g = g0 + (V[1] - g0) * ws; b = b0 + (V[2] - b0) * ws; land *= 1 - ws; if (land < 0.5) wf = 1; }
    }
    // a river's current fading into the lake or sea from its mouth (the river-water swatch)
    if (MOUTH_NEAR[tile].length) {
      // the current cuts through the beach: past the mouth it is water whatever the warped coast says
      const pw = plumeAt(tile, tx, ty) * 0.92;
      if (pw > 0.005) { sampleMat(M.RIVERW, tx, ty, wx, wyg); r += (V[0] - r) * pw; g += (V[1] - g) * pw; b += (V[2] - b) * pw; land *= 1 - pw; if (pw > 0.4) wf = 2; }
    }
    // the channel option: the lateral moraine. Rubble covers the bank up from the ice and the flank, then climbs the
    // slope beside it in ragged tongues and thins into the rock and snow there (v3: v2 ended it in a straight line half
    // way across the flank, with a snow strip and a rock band between it and the mountain)
    // The moraine is lateral only: none on the firn the head grows out of, a thin line beside the head that widens
    // over the next tile (v3, the check: it covered the firn, and the ice began in a gravel bed with no source)
    // v9, lane L2: the swamp coast (Coast: Swamp) paints its own ground and waterline where it reaches (swampAt)
    if (SWAMP.on && SWN[tile] && swampAt(tx, ty, wx, wyg, mx, my, r, g, b, land)) { r = SWO[0]; g = SWO[1]; b = SWO[2]; land = SWO[3]; wf = land < 0.5 ? 1 : 0; }
    let chMor = 0, chSteep = 0, mor = 0, chZone = 0;
    const lat = glacierName === 'channel' ? sstep((ty - HEAD_Y - 0.1 + n1y * 0.25) / 0.7) : 0;
    if (glacierName === 'channel' && ICEN[own] && VALLEY[own] !== 1 && land > 0.5) {
      const reach = (0.88 + n1x * 0.4 + n2x * 0.16 + (vnoise(tx * 1.3 + 7, ty * 1.3 + 3) - 0.5) * 0.4) * lat, cd = chanDist(tx, ty);
      // the channel's banks up to their top (about 1.4 tile from the ice), where the v2 reliefs' mountain flank gives way
      // to the channel's own look (the relief light below)
      chZone = 1 - sstep((cd - 1.45 + (vnoise(tx * 1.9 + 2, ty * 1.9 + 5) - 0.5) * 0.2) / 0.35);
      chMor = lat * (1 - sstep((cd - reach + 0.15) / 0.3));
      chSteep = Math.max(chMor, 1 - sstep((cd - 0.3) / 0.2)); // the bank right beside the ice is rubble up to the head
      if (chMor > 0) { sampleMat(M.MORAINE, tx, ty, wx, wyg); r += (V[0] - r) * chMor; g += (V[1] - g) * chMor; b += (V[2] - b) * chMor; mor = sstep((chMor - 0.5) / 0.12); }
    }
    // the glacier options: the slopes beside the ice are lateral moraine (rubble at its own scale), not the stretched
    // ground of the mountain above (the check of v2); snow keeps off them
    if (glacierName === 'tongue' && (land > 0.5 && !VALLEY[own] || VALLEY[own] === 2)) {
      const di = iceDist(tx, ty);
      if (di > 0 && di < 1.5) {
        const h = 0.05, gx = (heightAt(tx + h, ty) - heightAt(tx - h, ty)) / (2 * h), gy = (heightAt(tx, ty + h) - heightAt(tx, ty - h)) / (2 * h);
        mor = sstep((Math.hypot(gx, gy) / LEVEL - 0.35) / 0.5) * (1 - sstep((di - 1.1 + n1x * 0.3 + n2x * 0.1) / 0.25));
        if (mor > 0) { sampleMat(M.MORAINE, tx, ty, wx, wyg); r += (V[0] * 0.95 - r) * mor; g += (V[1] * 0.95 - g) * mor; b += (V[2] * 0.97 - b) * mor; }
      }
    }
    // ground fit: a building's worn yard, under the light like the ground it lies on
    YWL = 0; if (YARD_ON && YARDS[tile].length && land > 0.5 && m00 !== M.CITY) { yardAt(tile, tx, ty, wx, wyg, r, g, b); r = YO[0]; g = YO[1]; b = YO[2]; }
    let oR = r, oG = g, oB = b;
    // relief: face light, rims, rock on banks, bank grass, or the mountain's flank
    let shade = 1, steep = 0, extra = 1, bare = 0, slopeLv = 0, slopeUx = 0, slopeUy = 0;
    SB_ON = 0;
    const onIce = VALLEY[own] === 1;
    if (RELIEF[tile]) {
      const h = 0.05;
      FLAT_P = flatAround(tx, ty);
      const gx = FLAT_P ? 0 : (heightAt(tx + h, ty) - heightAt(tx - h, ty)) / (2 * h), gy = FLAT_P ? 0 : (heightAt(tx, ty + h) - heightAt(tx, ty - h)) / (2 * h);
      const levels = Math.hypot(gx, gy) / LEVEL;
      slopeLv = levels; slopeUx = levels > 0 ? gx / (levels * LEVEL) : 0; slopeUy = levels > 0 ? gy / (levels * LEVEL) : 0;
      const hardGround = land > 0.5 && m00 !== M.CITY && m00 !== M.BEACH && m00 !== M.DESERT && m00 !== M.SAND;
      const plainLv = !VALLEY[own];
      if (hardGround && !onIce && plainLv && mtnAt(tx, ty) && chZone < 1) {
        // on the mountain: its flank is one slope, painted as ground (mountainAt)
        RB[0] = oR; RB[1] = oG; RB[2] = oB; RB_M = m00;
        const e0 = extra;
        if (chZone > 0) { LT[0] = oR; LT[1] = oG; LT[2] = oB; }
        snowBrink(tx, ty, z, gx, gy); SB_ON = SB_DROP > -0.5 ? 1 - chZone : 0;
        mountainAt(tx, ty, z, gx, gy, levels, wx, wyg, RM.v2 === 'game' ? 1 : 0.3, MTNF[own]);
        bare = MS_FL;
        oR = RB[0]; oG = RB[1]; oB = RB[2]; shade = MS_SHADE; extra *= MS_EXTRA; steep = MS_STEEP;
        if (chZone > 0) {
          // the Ice channel's banks keep the look approved in the v3b preview (the off-mountain light, its snow and the
          // moraine thinning into it), blending into the mountain's flank over about a third of a tile above the bank
          offMtnLight(RM.v2 === 'game', tx, ty, z, gx, gy, levels, hardGround, onIce, wx, wyg, tile, false);
          const k = chZone;
          oR += (LT[0] - oR) * k; oG += (LT[1] - oG) * k; oB += (LT[2] - oB) * k;
          shade += (LT_SHADE - shade) * k; steep += (LT_STEEP - steep) * k; extra = e0 * (MS_EXTRA + (1 - MS_EXTRA) * k); bare *= 1 - k;
        }
      } else {
        // off the mountain (offMtnLight)
        LT[0] = oR; LT[1] = oG; LT[2] = oB;
        offMtnLight(RM.v2 === 'game', tx, ty, z, gx, gy, levels, hardGround, onIce, wx, wyg, tile, !ICEN[tile]);
        oR = LT[0]; oG = LT[1]; oB = LT[2]; shade = LT_SHADE; steep = LT_STEEP;
      }
    }
    if (onIce && glacierName === 'tongue') shade *= 1.06 - 0.16 * sstep(tx - Math.round(tx) + 0.5); // the tongue's crown: lit on its left
    // v3, the Ice channel: its moraine stays rubble on its steep banks too (the game's rock there made a stone band along
    // the channel and a stone staircase at each drop)
    if (chSteep > 0 && steep > 0) { const r0 = oR, g0 = oG, b0 = oB, k = chSteep * steep; sampleMat(M.MORAINE, tx, ty, wx, wyg); oR = r0 + (V[0] * 0.9 - r0) * k; oG = g0 + (V[1] * 0.9 - g0) * k; oB = b0 + (V[2] * 0.92 - b0) * k; }
    // season tint on land only, then the light: relief and height
    if (land > 0) { oR *= 1 + (TINT[0] - 1) * land; oB *= 1 + (TINT[2] - 1) * land; }
    const S = shade * extra * (1 + 0.06 * (z / LEVEL)), SW = (1 + (shade - 1) * 0.25) * (1 + 0.06 * (z / LEVEL));
    oR *= S; oG *= S; oB *= S;
    // snow and ice take only part of the relief light, no height light and no tint, and stay under the cursor white
    const ss = (1 + (shade - 1) * 0.85) * extra;
    let cover = 0;
    // the snow's edge is warped like a material border; inside, stone islands and thin patches show through
    let sn = snowAt(tx + n1x * 0.55 + n2x * 0.2, ty + n1y * 0.55 + n2y * 0.2);
    // v3, the Ice channel's head grows out of the firn: the snow lies over the ice's first 0.3 to 0.4 tile, thinning
    // in a ragged line, and reaches the ice beside it (iceMargin keeps a bare strip along the rest of the ice)
    const hd = glacierName === 'channel' ? headSnow(tx + n1x * 0.3 + n2x * 0.12, ty + n1y * 0.3 + n2y * 0.12) : 0;
    if (hd > sn) sn = hd;
    // the plateau's outer edge on the v2 reliefs' mountain (snowBrink; not on the Ice channel's banks or its head)
    const mE = SB_ON * (1 - hd);
    if (sn > 0 || (mE > 0 && SB_DROP > 0.003)) {
      const sm = Math.max(sn * iceMargin(tx, ty), hd), qn = (vnoise(tx * 1.7 + 11, ty * 1.7) - 0.5) * 0.5 + (vnoise(tx * 5.3, ty * 5.3 + 3) - 0.5) * 0.3 - 0.5;
      let q = sm + qn, edgeK = 0, lipF = 0;
      const below = mE > 0 && SB_DROP > 0.003;
      if (mE > 0) {
        // below the brink the snow reaches down to its drift line (SB_LIM), past it bare rock; near the line patches of
        // rock break through. On the top it is opaque white along the edge (edgeK: no thin snow or stones showing through)
        if (SB_DROP > 0.003) {
          const hole = sstep((vnoise(tx * 4.4 + 31, ty * 4.4 + 17) + 0.4 * vnoise(tx * 10 + 3, ty * 10 + 11) - 0.95) / 0.1) * sstep(SB_DROP / 0.08);
          // only under a brink the plateau's snow reaches: the snow half a tile up the slope (as the top's border has it)
          const up = snowAt(tx + n1x * 0.55 + n2x * 0.2 + SB_UX * 0.45, ty + n1y * 0.55 + n2y * 0.2 + SB_UY * 0.45) + qn;
          let qf = (SB_LIM - SB_DROP) * 2.2 - 0.6 * hole; if (up < qf) qf = up;
          const fk = sstep(SB_DROP / 0.05) * mE;
          q += (qf - q) * fk;
          // fix round 2 (the critic: thin straight white slivers along level edges): a slope that looks away from the
          // view (its uphill side toward the viewer) keeps no snow; from the view it was only a sliver along its lip
          const away = SB_UX + SB_UY, an = (vnoise(tx * 4.1 + 9, ty * 4.1 + 21) - 0.5) * 0.3;
          if (away > 0.15 + an) q -= 1.4 * mE * sstep((away - 0.15 - an) / 0.45);
          if (SB_DROP < 0.6) { const back = snowBack(tx, ty, z); if (back > 0.04) q -= mE * (0.55 + 0.5 * vnoise(tx * 5.7 + 13, ty * 5.7 + 2)) * sstep((back - 0.04) / 0.3); }
          // how much the snow's lower edge here faces the view (its thickness and shadow show there)
          lipF = 1 - sstep((away + 0.1) / 0.5);
        } else if (sbAhead() > 0.05) {
          q -= 0.6 * mE * sstep((vnoise(tx * 4.4 + 31, ty * 4.4 + 17) + 0.4 * vnoise(tx * 10 + 3, ty * 10 + 11) - 1.0) / 0.1) * sstep((SB_AHEAD - 0.05) / 0.2);
          // and the wind scours the lip of a drop that looks away: the snow stops short of it in a ragged line, so the
          // lip is a rim of rock, not a white sliver ruled along the level edge (fix round 2)
          const back = snowBack(tx, ty, z);
          if (back > 0.04) q -= mE * (0.55 + 0.5 * vnoise(tx * 5.7 + 13, ty * 5.7 + 2)) * sstep((back - 0.04) / 0.3);
        }
        // Round 4 (the critic: at 30.5,4 a bare patch in the snow had a dead-horizontal top edge, 48 px at zoom 4, where
        // the snow's edge followed one tile's blend line that the border warp happened to lay flat on the screen): on
        // the plateau's top its edge wanders at a finer scale too (in lobes, not specks), so no stretch of it is ruled
        // (only where the snow tiles' own blend is the edge, not inside a snowy tile, where it would open specks)
        if (SB_DROP <= 0.003 && q > -0.7 && q < 0.7 && sn < 0.95) q += mE * (1 - sstep((sn - 0.8) / 0.15)) * ((vnoise(tx * 7.3 + 3, ty * 7.3 + 41) - 0.5) * 0.7);
        edgeK = mE * Math.max(SB_DROP > 0.003 ? 1 : sstep(sbAhead() / 0.3), 1 - sstep((q - 0.08) / 0.3));
      }
      // (fix round 2: on the plateau's top the crags of the break of slope stay under the snow; they cut holes there and
      // left rows of dark specks along the brink, where the snow's top met its slope)
      cover = sstep(q / (0.1 - 0.065 * mE)) * (1 - (0.7 - 0.7 * mE) * steep * (1 - hd)) * (1 - mE * sstep((steep - 0.55) / 0.08) * (below ? sstep((SB_BELOW + 0.1) / 0.08) : 0)) * (1 - 0.85 * mor);
      // the mountain's flank (v2) is bare: the snow ends at the break of slope, so the plateau's edge reads
      // (the Ice channel's head snow is kept; elsewhere the drift line above decides)
      if (bare > 0) cover *= 1 - sstep((bare - 0.25) / 0.35) * (1 - hd) * (1 - mE);
      let hRim = 0, hIsl = 0;
      if (cover > 0 && (m00 === M.ROCKMIX || m00 === M.ALPINE)) {
        let thin = sstep((thinN(tx, ty) - 0.92) / 0.12);
        let stone = m00 === M.ROCKMIX ? sstep((stoneN(tx, ty) - 0.8) / 0.1) : 0;
        // Round 5: beside the Ice channel's head (hz) the size test of a stone island wanders (headIsle)
        const hz = stone > 0 && glacierName === 'channel' && ICEN[own] ? headZone(tx, ty) : 0;
        // (round 4, the critic: small blurred dark specks on the snow by the Ice channel and at 32,8): where the snow
        // is opaque, a thin patch or a stone island shows only if it is of some size (its noise
        // rises well past the threshold within a little of the point); the small ones only came out as pinholes
        if (hd < 1 || hz > 0) {
          if (hd < 1 && thin > 0 && Math.max(thinN(tx + 0.07, ty), thinN(tx - 0.07, ty), thinN(tx, ty + 0.07), thinN(tx, ty - 0.07)) < 1.08) thin = 0;
          if (stone > 0) {
            const cut = hd >= 1 || Math.max(stoneN(tx + 0.2, ty), stoneN(tx - 0.2, ty), stoneN(tx, ty + 0.2), stoneN(tx, ty - 0.2)) >= 0.97 ? 1 : 0;
            if (hz > 0) { stone = headIsle(tx, ty, stone, cut, hz); hRim = HI_RIM; hIsl = HI_ISL; } else stone *= cut;
          }
        }
        // (fix round 2: on the v2 reliefs' mountain the snow is opaque; its rock pokes through as outcrops, below)
        cover *= 1 - 0.75 * Math.max(thin, stone * (0.85 + 0.42 * hIsl)) * (1 - edgeK) * (1 - mE);
      }
      // Round 3 (the critic: by the Ice channel, where the plateau's edge rules give way to the channel's banks, the snow
      // turned see-through, the rubble showing through it like a double exposure, and blurred grey blots lay on it; on the
      // plateau's brink, where crags thin it, smoky grey smears): on the v2 reliefs the snow is opaque. What would be thin
      // snow is either snow or bare ground, ending in a ragged edge with a little blue-grey just inside it (on the rubble
      // too; the Ice channel's head snow is kept as it is)
      let rimS = 0;
      if (cover > 0 && cover < 1 && (hd < 1 || hIsl > 0)) { cover = snowOpaque(cover, hd * (1 - hIsl), tx, ty); rimS = SO_RIM; }
      if (hRim > rimS) rimS = hRim;
      // fix round 2 (the critic: the plateau's snow was a see-through veil with the rock showing through in bands): on
      // the v2 reliefs' mountain the snow lies opaque on the rock, and the rock pokes through it as separate outcrops
      // (round 3: angular blocks, snowRocks)
      let ocR = 0, ocS = 0, ocSh = 0;
      if (mE > 0.3 && cover > 0.01 && OCT[tile]) { snowRocks(tx, ty, wx, wyg, S, mE); ocR = OC_R; ocS = OC_S; ocSh = OC_SH; }
      if (cover > 0) {
        sampleMat(M.SNOW, tx, ty, wx, wyg);
        // (on the mountain's flank the snow takes half its face light: a shaded slope's snow is not a grey veil)
        const k = (mE > 0 ? 1 + (ss - 1) * (1 - 0.5 * mE) : ss) * (1.03 + 0.07 * vnoise(tx * 0.8 + 21, ty * 0.8 + 4));
        let sr = soft(V[0] * k, CAP_R), sg = soft(V[1] * k, CAP_G), sb = soft(V[2] * k, CAP_B);
        if (rimS > 0) { sr *= 1 - 0.1 * rimS; sg *= 1 - 0.07 * rimS; sb *= 1 - 0.03 * rimS; }
        if (mE > 0) {
          // fix round 2: broad pale-blue clusters in the hollows, opaque (not a veil)
          const cl = mE * sstep((0.65 * vnoise(tx * 1.5 + 8, ty * 1.5 + 2) + 0.35 * (NZ1Y + 0.5) - 0.6) / 0.04);
          if (cl > 0) { sr *= 1 - 0.09 * cl; sg *= 1 - 0.045 * cl; sb *= 1 - 0.005 * cl; }
          // the snow's thickness at its lower edge: a lit top that turns over into a blue-grey shaded lip
          if (below && lipF > 0) {
            // (its width measured along the slope: q falls about 2.2 levels per level the ground drops, so the lip is
            // about 0.07 tile deep whatever the slope)
            const lw = 0.15 * (slopeLv > 0.4 ? slopeLv : 0.4), lk = lipF * mE * (1 - sstep((q - 0.25 * lw) / lw)), lt = lipF * mE * Math.exp(-(((q - 1.7 * lw) / (0.5 * lw)) ** 2)) * 0.06;
            sr *= 1 - 0.3 * lk + lt; sg *= 1 - 0.24 * lk + lt; sb *= 1 - 0.14 * lk + lt;
          }
          if (ocSh > 0) { sr *= 1 - 0.16 * ocSh; sg *= 1 - 0.1 * ocSh; sb *= 1 - 0.025 * ocSh; }
          if (ocR > 0.01) {
            // the outcrop: rock, with a little snow left on its top
            const cr = ROC[0] + (sr - ROC[0]) * ocS, cg = ROC[1] + (sg - ROC[1]) * ocS, cb = ROC[2] + (sb - ROC[2]) * ocS;
            sr += (cr - sr) * ocR; sg += (cg - sg) * ocR; sb += (cb - sb) * ocR;
          }
        }
        oR += (sr - oR) * cover; oG += (sg - oG) * cover; oB += (sb - oB) * cover;
      }
      // the shadow the snow's lip throws on the rock just below it: attached to the edge, short and blue-grey
      if (below && lipF > 0 && q < 0.06) {
        const sh = lipF * mE * (1 - sstep((0.02 - q) / 0.16)) * (1 - cover);
        if (sh > 0) { oR *= 1 - 0.36 * sh; oG *= 1 - 0.32 * sh; oB *= 1 - 0.24 * sh; }
      }
    }
    // decals draped over the relief: Codex rivers, glaciers, rings, roads
    let decA = 0, rvWater = 0, SL = S;
    if (LIPE[tile] && land > 0.5) {
      lipBand(LIPE[tile], tx, ty, wx, wyg, z);
      // lit as the ground round it, with only a little of the slope's face shade and none of its foot's or the contour
      // lines (they drew the lip as a dark ruled line); no tufts on the rock
      const Sb = (1 + (shade - 1) * 0.3) * (1 + 0.06 * (z / LEVEL));
      // (and so is the river's bank where it reaches the lip, SL)
      if (LB_L > 0) { SL = S + (Sb - S) * LB_L; const f = SL / S; oR *= f; oG *= f; oB *= f; }
      if (LB_K > 0) { oR += (LBC[0] * Sb - oR) * LB_K; oG += (LBC[1] * Sb - oG) * LB_K; oB += (LBC[2] * Sb - oB) * LB_K; decA = LB_K; }
    }
    // the glacier options' warp moves a level edge off the tile edge: a point there stands on its owner's ground, so
    // it takes its owner's decals (v2: the melt river's water showed as a cyan line along the ice front's lip)
    const dt = GWARP && Lv[own] !== Lv[tile] ? own : tile, list = DECALS[dt];
    if (list.length) {
      const la = tx - (dt % W), lb = ty - ((dt / W) | 0), gR = oR / SL, gG = oG / SL, gB = oB / SL; // the ground, unlit, for river banks
      for (let q = 0; q < list.length; q++) {
        const dc = list[q];
        if (dc.clip) {
          const cl = dc.clip;
          if (cl === 1 && la < 0) continue; if (cl === 2 && la > 0) continue; if (cl === 3 && lb < 0) continue; if (cl === 4 && lb > 0) continue;
          if (cl >= 5 && cl <= 8) {
            if ((cl === 5 && la < 0) || (cl === 6 && la > 0) || (cl === 7 && lb < 0) || (cl === 8 && lb > 0)) continue;
            if ((cl <= 6 ? Math.abs(lb) : Math.abs(la)) > dc.core) continue;
          }
          if (cl === 9 && la * la + lb * lb > dc.core * dc.core) continue;
        }
        if (dc.rv) riverAt(dc, tx - dc.ti, ty - dc.tj, tx, ty, wx, wyg, gR, gG, gB, land); else if (dc.bend) bendAt(dc, tx - dc.ti, ty - dc.tj); else pieceAt(dc, tx - dc.ti, ty - dc.tj);
        if (!V[6]) continue;
        if (dc.street) {
          // a road across the town square: where its picture is solid, a paved street (setts in courses along it, a
          // little darker and dustier than the square), no gravel and no verges
          const lane = sstep((V[6] - 0.55) / 0.3) * (pvD > 0 ? sstep(pvD / 0.12) : 0);
          if (lane <= 0.002) continue;
          streetAt(dc.street, tx, ty, wx, wyg);
          oR += (V[0] * S * TINT[0] - oR) * lane; oG += (V[1] * S - oG) * lane; oB += (V[2] * S * TINT[2] - oB) * lane;
          continue;
        }
        // a road stops at the town paving, fading out over its fringe (inside it is the paved street above)
        if (dc.road && pvD > -0.3) { V[6] *= sstep((-pvD - 0.03) / 0.14); if (V[6] <= 0.002) continue; }
        if (dc.mouths || dc.mouthPic || dc.fade || dc.run || dc.corn) {
          // where a river opens onto a lake or the sea: which of the picture's pixels are its water (blue-green, wq 1)
          // and which its banks (wq 0; a river piece's riverAt says), and a ragged line (rg, +-0.06 tile) so nothing
          // ends along a straight tile edge
          const wq = dc.rv ? RV_WQ : sstep((Math.min(V[5] - V[3], V[4] - V[3]) - 4) / 18);
          const rg = (vnoise(tx * 4.3 + 3, ty * 4.3 + 9) - 0.5) * 0.1 + (vnoise(tx * 11 + 1, ty * 11 + 5) - 0.5) * 0.04;
          // and a broad wander (+-0.12 tile), so the river's water fades into the still water along no line (feedback 2026-10-12b)
          const rw = (vnoise(tx * 2.2 + 5, ty * 2.2 + 17) - 0.5) * 0.24;
          let kW = 1, kB = 1;
          if (dc.mouths) for (let k = 0; k < dc.mouths.length; k++) {
            // a mouth or a lake's outlet: the banks end before the edge, the outer side first, in a ragged point
            // (v2: both stopped in a square block on the edge); the water runs on (the run piece next door)
            // the water beside the banks (their shadow and rim) tapers off with them; the middle runs on to the edge
            const m = dc.mouths[k], along = (tx - m.x) * m.dx + (ty - m.y) * m.dy, across = Math.abs((tx - m.x) * m.dy - (ty - m.y) * m.dx);
            kB *= sstep((-0.13 - 0.7 * Math.max(0, across - 0.3) + rg - along) / 0.09);
            kW *= sstep((0.12 - 1.3 * Math.max(0, across - 0.2) + rg - along) / 0.12);
          }
          if (dc.mouthPic) {
            // Codex's mouth picture keeps its flared water, which fades out over about 0.6 tile; its banks end at the
            // edge in a ragged point instead of running on as faint lines into the still water
            const m = dc.mouthPic, along = (tx - m.x) * m.dx + (ty - m.y) * m.dy, across = Math.abs((tx - m.x) * m.dy - (ty - m.y) * m.dx);
            if (along > 0) kW *= 1 - sstep((Math.hypot(tx - m.x, ty - m.y) - 0.12) / 0.5);
            kB *= sstep((-0.03 - 0.7 * Math.max(0, across - 0.3) + rg - along) / 0.09);
          }
          if (dc.run) {
            // the channel's own water carried on past the mouth into the still water: no banks, widening a little
            // and fading out over about 0.55 tile along a ragged line
            const m = dc.run, along = (tx - m.x) * m.dx + (ty - m.y) * m.dy, across = Math.abs((tx - m.x) * m.dy - (ty - m.y) * m.dx);
            kB = 0;
            kW *= (1 - sstep((along - 0.05 + rg * 2 + rw) / 0.45)) * (1 - sstep((across - 0.16 - 0.2 * Math.max(0, along) + rg + rw) / 0.22));
          }
          if (dc.fade) {
            // a side toward still water that is not a leg has no bank: the channel's water meets the still water
            // along a ragged line (v2: a thin spit of bank stones ran along the lake and ended in a square block)
            const f = dc.fade;
            let e = 1;
            if (f & 1) e = Math.min(e, 0.5 - la); if (f & 2) e = Math.min(e, 0.5 + la); if (f & 4) e = Math.min(e, 0.5 - lb); if (f & 8) e = Math.min(e, 0.5 + lb);
            kB *= sstep((e - 0.22 + rg) / 0.08); kW *= sstep((e - 0.12 + rg * 1.6 + rw) / 0.32);
          }
          if (dc.corn) for (const [k, sx, sy] of CORNERS) if (dc.corn & k) { const dco = Math.hypot(la - 0.5 * sx, lb - 0.5 * sy); kB *= sstep((dco - 0.3 + rg) / 0.1); kW *= sstep((dco - 0.16 + rg) / 0.16); }
          V[6] *= kW * wq + kB * (1 - wq);
          if (V[6] <= 0.002) continue;
        }
        let cr, cg, cb;
        if (dc.icy) { cr = soft(V[3] * ss, CAP_R); cg = soft(V[4] * ss, CAP_G); cb = soft(V[5] * ss, CAP_B); }
        else {
          // water lies flat: it takes a quarter of the relief's face light (v3 lit the rivers on the falls' slopes up to
          // 24% and washed them out); a river picture's ground part takes all of it
          const Sx = dc.rv ? SL + (SW - SL) * RV_WQ : dc.water ? SW : S;
          cr = V[3] * Sx; cg = V[4] * Sx; cb = V[5] * Sx;
        }
        // which of the picture's pixels are water (blue-green), for Animate all water
        if (V[6] > 0.5) wf = dc.rv ? (RV_WQ > 0.5 ? 2 : RV_COV > 0.5 ? 0 : wf) : dc.water && V[5] - V[3] > 15 && V[4] - V[3] > 20 ? 2 : 0;
        oR += (cr - oR) * V[6]; oG += (cg - oG) * V[6]; oB += (cb - oB) * V[6];
        if (dc.rv) rvWater += (RV_WQ * V[6] - rvWater) * V[6];
        const cv = dc.rv ? V[6] * RV_COV : V[6]; // a river's ground part leaves room for tufts
        if (cv > decA) decA = cv;
      }
    }
    if (ICET[tile]) { RB[0] = oR; RB[1] = oG; RB[2] = oB; meltAt(tile, tx, ty, wx, wyg, S); oR = RB[0]; oG = RB[1]; oB = RB[2]; }
    // fix round 1 (the critic: light bank stones showed through the water under the far fall at 23,11, and a smeared,
    // striped grey slab lay beside the fall at 30,14): the steep banks of a far fall's tiles, and a step between two
    // river tiles with no fall, are wet dark rock (the mountain's rock, screen-aligned, so it never stretches down a
    // steep face), with a few wet glints; the water is left to the river and the fall (not by the Ice channel's melt)
    // Fix round 2 (the critic: the wet rock was drawn as dark parallelograms, straight-topped and straight-sided, and
    // under the far fall at 23,11 as a dark box the water seemed to fall into): how wet the ground is blends between
    // the tiles' centres along a warped line (wetAt), so it has no tile edges; it takes the steep part of the bank
    // only, from a ragged line, and fades out into the ground round it. Inside, it is rounded wet boulders, dark and
    // glinting on top, in dark moss; the water itself is left to the river and the fall.
    const wb = WETN[tile] ? wetAt(tx + n1x * 0.5 + n2x * 0.2, ty + n1y * 0.5 + n2y * 0.2) : 0;
    if (wb > 0.01 && slopeLv > 0.12) {
      const sn = (vnoise(tx * 3.7 + 3, ty * 3.7 + 19) - 0.5) * 0.5 + (vnoise(tx * 9.1 + 7, ty * 9.1 + 2) - 0.5) * 0.25;
      const k0 = wb * sstep((slopeLv - 0.4 + sn) / 0.5) * (RVSTEP[dt] && !FALLT[dt] ? 1 - 0.6 * sstep((rvWater - 0.5) / 0.3) : 1 - sstep((rvWater - 0.25) / 0.35));
      // Round 3 (the critic: the wet rock was a murky, low-resolution smear with lilac-grey boulders): it ends in a crisp
      // ragged line instead of fading out over half a tile (a veil over the ground), and it is the bank's own rock, darker
      // with the wet but keeping its detail, with crisp clusters of moss and angular wet boulders (blocksAt), their tops
      // lit with a few small glints of wet light
      const k = k0 > 0.02 ? sstep((k0 - 0.3 + (vnoise(wx * 0.23 + 5, wyg * 0.4 + 1) - 0.5) * 0.3) / 0.06) : 0;
      if (k > 0.004) {
        wetRock(tx, ty, wx, wyg, S); const r = ROC[0], g = ROC[1], b = ROC[2];
        oR += (r - oR) * k; oG += (g - oG) * k; oB += (b - oB) * k;
        if (k > 0.5) { wf = 0; decA = 1; }
      }
    }
    // fix round of v8: the ground before the falls are laid over it, for a near fall's frames (fallRec, nearFrame)
    if (FALLP[tile]) { FB[0] = oR; FB[1] = oG; FB[2] = oB; FB[3] = rvWater; FB_SEQ++; }
    if (FALLP[tile]) for (const f of FALLP[tile]) {
      // the falls this tile takes part in (fallAt): the sheet down the slope, its white water and the foam below
      FALL_WQ = rvWater;
      fallAt(f, tx, ty, z, 0, false);
      // (the wet darkens light ground most: dark forest floor would turn black)
      if (FALL_DK > 0) { const k = 1 - FALL_DK * sstep((oR + oG + oB - 150) / 210); oR *= k; oG *= k * 1.02; oB *= k; }
      const fa = FA[3];
      if (fa > 0.004) { oR += (FA[0] - oR) * fa; oG += (FA[1] - oG) * fa; oB += (FA[2] - oB) * fa; if (fa > 0.4) wf = 3; }
      // round 5: a near fall's foam spilling over the lip of higher ground in front of its pool (lipSpill)
      if (f.near && f.lip !== null) {
        const ka = lipSpill(f, tx, ty, z, wx, wyg);
        if (LS_DK > 0) { const k = 1 - LS_DK; oR *= k; oG *= k * 1.02; oB *= k; }
        if (ka > 0.004) { oR += (LSC[0] - oR) * ka; oG += (LSC[1] - oG) * ka; oB += (LSC[2] - oB) * ka; if (ka > decA) decA = ka; }
      }
    }
    // wheat fields (fieldAt ran in the column painter, which raised the field): Codex's picture with a stalk
    // texture, short vertical streaks, darker between the stalks
    if (FLD_C > 0) {
      const st = 0.8 + 0.42 * vnoise(wx * 1.45 + 7, wyg * 0.36 + 3) - 0.12 * sstep((vnoise(wx * 0.9 + 1, wyg * 0.22) - 0.62) / 0.1);
      const k = S * st;
      oR += (FLD_R * k - oR) * FLD_C; oG += (FLD_G * k - oG) * FLD_C; oB += (FLD_B * k * 0.96 - oB) * FLD_C;
      if (FLD_C > decA) decA = FLD_C;
      if (FLD_C > 0.5) wf = 0;
    }
    // nothing on the ground outshines the cursor white
    if (oR > 190 && oG > 190 && oB > 190) { oR = soft(oR, CAP_R + 6); oG = soft(oG, CAP_G + 4); oB = soft(oB, CAP_B + 2); }
    // where the grass-detail pass may put tufts and pebbles
    FLAGV = 0;
    if (land > 0.5 && decA < 0.25 && cover < 0.3) {
      FLAGV = 1;
      const gk = GRASSY[m00];
      if (gk && steep < 0.5 && !(m00 === M.ROCKMIX && stoneAt(tx, ty) > 0.5)) FLAGV = gk;
    }
    if (SWAMP.on && SWN[tile] && SW_HIT && FLAGV) FLAGV = SW_FL; // v9, lane L2: the swamp's own (no pebbles on its mud)
    if (YWL > 0.45 && FLAGV > 1) FLAGV = 1; // no grass tufts on a worn yard, pebbles still
    if (cover > 0.5) wf = 0;
    WFLAG = wf;
    OUT[0] = oR; OUT[1] = oG; OUT[2] = oB;
  }
  // ---------- hills lab: faces. Where the surface folds (a step steeper than the view), the painter shows the
  // wall under the lip; these say what that wall is: glacier ice, or the Ice channel's moraine (F_MAT 1 both; the
  // reliefs that drew their own faces, Blocks and Terraces, are gone since v9).
  let F_MAT = 0, F_SE = 0, F_LIP = 0, F_FOOT = 0, F_OWN = 0, F_PORTAL = 0, F_ALONG = 0;
  const ICE_LIT = CX['mountain/face-ice-cliff-lit'], ICE_SHADE = CX['mountain/face-ice-cliff-shade'];
  function faceSetup(tx, ty, z) {
    const own = ownerAt(tx, ty), v = glacierName !== 'demo' ? VALLEY[own] : 0;
    if (glacierName === 'channel' && v === 2 && RELIEF[own]) return moraineStep(tx, ty, z, own); // (v3: but its step is a wall)
    // the channel's moraine banks are slopes, painted as ground (as faces they made a dotted rim in v2)
    const ice = v === 1 || ICET[own] === 2; // the glacier's end is an ice front in every option
    if (!ice || !RELIEF[own]) return false;
    const zx = heightAt(tx + 0.1, ty), zy = heightAt(tx, ty + 0.1), dx = z - zx, dy = z - zy;
    if (dx <= 0.5 && dy <= 0.5) return false; // the fold at the back of a bank, not a wall toward the camera
    const px = dx > 0 ? dx : 0, py = dy > 0 ? dy : 0;
    // a waterfall lies on its own slope, painted as ground (fallAt), never as a wall (v3; the walls beside it stay)
    if (FALLL[own]) for (const f of FALLL[own]) { const al = (tx - f.mx) * f.dx + (ty - f.my) * f.dy; if (al > -f.w / 2 - 0.05 && al < f.w / 2 + 0.05 && (f.dx ? px >= py : py >= px)) return false; }
    // the lip: the level of the ground just behind the edge (a point low on a bank belongs to the lower tile)
    const up = px >= py ? ownerAt(tx - 0.15, ty) : ownerAt(tx, ty - 0.15);
    // a bank coming down onto the ice from higher ground (the channel's moraine) is that ground's slope, not an ice wall
    // (v3: but in the Ice channel a drop of more than half a level here is the end of an ice step, so it is ice too)
    if (VALLEY[up] !== 1 && Lv[up] > Lv[own] && (glacierName !== 'channel' || z - Math.min(zx, zy) < 0.6 * LEVEL)) return false;
    F_Z = z; // v3: the column's own top, which the Ice channel's lit lip follows
    F_SE = px / (px + py); F_OWN = own;
    F_LIP = Math.max(z, Math.max(Lv[own], Lv[up]) * LEVEL); F_FOOT = Math.min(zx, zy);
    const c = map[own];
    F_MAT = 1;
    // the ice front over its melt: a cave at the foot of the wall
    F_PORTAL = 0;
    {
      // the last ice tile's front faces its melt whatever the slope's direction says at the corners (v3: a strip of
      // plain ice face cut through the cave where the two directions swapped)
      const fr = ICET[own] === 2 ? ICE_FRONTS.find((f) => f.c.i === own) : null;
      if (fr) F_SE = fr.dx ? 1 : 0;
      const low = fr ? fr.n : px >= py ? tileAt(c.x + 1, c.y) : tileAt(c.x, c.y + 1);
      if (low && low.kind === 'river') {
        // only the step itself: a bank beside it whose (warped) owner is the ice tile is ground, not a front (v3: it
        // painted the front's edge down a moraine bank as a brown column)
        if (glacierName !== 'channel' && (px > py ? px : py) < 5) return false;
        F_PORTAL = 1; F_ALONG = px >= py ? ty - c.y : tx - c.x;
      }
    }
    return true;
  }
  // v3, the Ice channel's steps and its front: Codex's ice-cliff material read for its cracks only (its tan bands made the
  // steps read as stone), coloured as glacier ice in the one light from the upper left: a bright lip, clear ice that
  // deepens to blue toward the foot, a side facing SE a step darker. In the front over the melt, the meltwater cave:
  // the dark inside of Codex's face-ice-portal material without its grey frame, stretched over an arch 0.42 tile wide
  // and up to 7.5 world px high, with the stream running out at its foot onto the river below.
  const CH_CAVE = (() => {
    const e = CX['mountain/face-ice-portal-lit'], pd = PX.pieces.d, st = PX.pieces.w;
    const lum = (o) => 0.3 * pd[o] + 0.59 * pd[o + 1] + 0.11 * pd[o + 2];
    let x0 = 99, x1 = -1, y0 = 99, y1 = -1, n = 0, mr = 0, mg = 0, mb = 0;
    for (let y = 0; y < 80; y++) for (let x = 0; x < 64; x++) {
      const o = ((e.y + y) * st + e.x + x) * 4;
      if (pd[o + 3] < 200 || lum(o) >= 110) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); n++; mr += pd[o]; mg += pd[o + 1]; mb += pd[o + 2];
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, c = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      // the frame's pixels inside the box take the dark inside's mean, so no grey shows in the cave
      const o = ((e.y + y0 + y) * st + e.x + x0 + x) * 4, k = (y * w + x) * 3, dark = pd[o + 3] >= 200 && lum(o) < 110;
      c[k] = dark ? pd[o] : mr / n; c[k + 1] = dark ? pd[o + 1] : mg / n; c[k + 2] = dark ? pd[o + 2] : mb / n;
    }
    return { w, h, c };
  })();
  let F_Z = 0; // the height of the point a face hangs from (faceSetup)
  function chanIceFace(tx, ty, zr, wx, wyg, row) {
    const pd = PX.pieces.d, st = PX.pieces.w;
    if (VALLEY[F_OWN] === 2) {
      // a moraine bank's step (moraineStep): its rubble, screen-aligned as on the ground, lit facing SW, darker facing SE
      // and toward the foot
      const h = zr - F_FOOT, f = (1.12 - 0.3 * F_SE) * (1 - 0.2 * (1 - (h > 6 ? 1 : h < 0 ? 0 : h / 6)));
      sampleMat(M.MORAINE, tx, ty, wx, wyg); OUT[0] = V[0] * f * 0.96; OUT[1] = V[1] * f; OUT[2] = V[2] * f * 0.99; WFLAG = 0; return;
    }
    // The lit lip runs from the face's own top down to just under the ice's top: where a moraine bank comes down onto
    // the end of a step, the face hangs from the bank's height, and the band of lit ice keeps one straight lower edge
    // along the whole step (the check of v3: measured from the bank's level, an unlit ice tooth rose above the lip)
    const depth = Math.min(F_Z, Lv[F_OWN] * LEVEL) - zr, hF = zr - F_FOOT, fh = F_Z - F_FOOT;
    // read at twice its size: broad seracs rather than a fine grille of cracks
    const u = ((Math.floor(wx) % 64) + 64) % 64, v = ((Math.floor(row / 2) % 80) + 80) % 80;
    const oL = ((ICE_LIT.y + v) * st + ICE_LIT.x + u) * 4, oS = ((ICE_SHADE.y + v) * st + ICE_SHADE.x + u) * 4;
    // the material's light about its mean (lit 177, shade 143): its cracks and seracs, not its colour
    const dL = 0.3 * pd[oL] + 0.59 * pd[oL + 1] + 0.11 * pd[oL + 2] - 177, dS = 0.3 * pd[oS] + 0.59 * pd[oS + 1] + 0.11 * pd[oS + 2] - 143;
    const det = (dL + (dS - dL) * F_SE) * 0.45;
    const q = fh > 0.5 ? (hF / fh < 0 ? 0 : hF / fh > 1 ? 1 : hF / fh) : 1; // 0 at the foot, 1 at the lip
    const lit = 1 - 0.24 * F_SE;
    // a little darker than the ice on top, which takes the light first
    let cr = (96 + 74 * q) * lit + det, cg = (140 + 58 * q) * lit + det, cb = (166 + 46 * q) * lit + det;
    // the lip: white ice catching the light
    if (depth < 1.1) { const k = depth < 0 ? 1 : 1 - depth / 1.1; cr += (216 - cr) * k; cg += (226 - cg) * k; cb += (232 - cb) * k; }
    if (F_PORTAL && fh > 5) {
      const a = F_ALONG / 0.21;
      if (a > -1 && a < 1) {
        const top = Math.min(fh - 1.8, 7.5), archTop = top * Math.sqrt(1 - a * a);
        const e = sstep((archTop - hF) / 1.1);
        if (e > 0) {
          // inside: the portal's dark texels; darkest under the roof and on its left (the light comes from the upper
          // left, so the cave's right wall catches a little); the meltwater along its floor
          const cx = Math.min(CH_CAVE.w - 1, Math.floor((a * 0.5 + 0.5) * CH_CAVE.w)), cy = Math.min(CH_CAVE.h - 1, Math.max(0, Math.floor((1 - hF / top) * CH_CAVE.h)));
          const k = (cy * CH_CAVE.w + cx) * 3, f = (0.5 + 0.22 * (a * 0.5 + 0.5)) * (0.78 + 0.3 * (1 - hF / top));
          let ir = CH_CAVE.c[k] * f, ig = CH_CAVE.c[k + 1] * f, ib = CH_CAVE.c[k + 2] * f;
          if (hF < 1.6) { const w = 1 - hF / 1.6; ir += (84 - ir) * w; ig += (146 - ig) * w; ib += (152 - ib) * w; }
          cr += (ir - cr) * e; cg += (ig - cg) * e; cb += (ib - cb) * e;
        } else if (archTop - hF > -1) { const k = 0.12 * (1 + (archTop - hF)); cr += (236 - cr) * k; cg += (240 - cg) * k; cb += (244 - cb) * k; } // the arch's rim of clear ice
      }
    }
    OUT[0] = soft(cr, CAP_R); OUT[1] = soft(cg, CAP_G); OUT[2] = soft(cb, CAP_B); WFLAG = 0;
  }
  // v3, the Ice channel: where the ice steps down a level its moraine banks step down with it, in the same vertical
  // step, as a wall of their rubble (the banks' gentler slopes stay ground). v2 ran the banks' step at 0.12 tile beside
  // the ice's vertical one, and the corner between them drew the end of the ice step as a tooth above its lip.
  function moraineStep(tx, ty, z, own) {
    const zx = heightAt(tx + 0.1, ty), zy = heightAt(tx, ty + 0.1), dx = z - zx, dy = z - zy;
    if (dx < 0.6 * LEVEL && dy < 0.6 * LEVEL) return false;
    const px = dx > 0 ? dx : 0, py = dy > 0 ? dy : 0;
    F_SE = px / (px + py); F_OWN = own; F_Z = z; F_LIP = z; F_FOOT = Math.min(zx, zy); F_MAT = 1; F_PORTAL = 0; // (chanIceFace paints it)
    return true;
  }
  function faceAt(tx, ty, zr, wx, wyg, row) {
    if (F_MAT === 1 && glacierName === 'channel') { chanIceFace(tx, ty, zr, wx, wyg, row); return; } // v3: the Ice channel's own faces
    const depth = F_LIP - zr, hF = zr - F_FOOT, fh = F_LIP - F_FOOT;
    let cr, cg, cb;
    if (F_MAT === 1) {
      // Codex's ice-cliff face material, lit facing SW and shaded facing SE
      const u = ((Math.floor(wx * 2) % 64) + 64) % 64, v = ((row % 80) + 80) % 80, pd = PX.pieces.d, st = PX.pieces.w;
      const oL = ((ICE_LIT.y + v) * st + ICE_LIT.x + u) * 4, oS = ((ICE_SHADE.y + v) * st + ICE_SHADE.x + u) * 4;
      cr = pd[oL] + (pd[oS] - pd[oL]) * F_SE; cg = pd[oL + 1] + (pd[oS + 1] - pd[oL + 1]) * F_SE; cb = pd[oL + 2] + (pd[oS + 2] - pd[oL + 2]) * F_SE;
      // drawn toward the ice's own blue, as the front is (the material's tan strata read as stone blocks)
      { const L = cr * 0.3 + cg * 0.59 + cb * 0.11, Lc = 168 + (L - 172) * 1.3; cr += (Lc * 0.8 - cr) * 0.75; cg += (Lc * 0.96 - cg) * 0.75; cb += (Lc * 1.1 - cb) * 0.75; }
      if (depth < 1.2) { cr = cr * 0.6 + 226 * 0.4; cg = cg * 0.6 + 232 * 0.4; cb = cb * 0.6 + 238 * 0.4; }
      if (F_PORTAL) { iceFront(tx, ty, wx, wyg, depth, hF, fh); cr = OUT[0]; cg = OUT[1]; cb = OUT[2]; }
      cr = soft(cr, CAP_R); cg = soft(cg, CAP_G); cb = soft(cb, CAP_B);
    }
    // darker toward the foot of the wall
    const ao = 1 - 0.22 * (1 - (hF > 5 ? 1 : hF < 0 ? 0 : hF / 5));
    OUT[0] = cr * ao; OUT[1] = cg * ao; OUT[2] = cb * ao; WFLAG = 0;
  }
  // The glacier's end (the face over its melt). Fix round of v3 (the critic: it read as a culvert, with a flat straight
  // top, vertical sides, a symmetric dark arch and the melt butting on a straight edge). Codex's ice-cliff material,
  // drawn toward the glacier's blue-white, with: a jagged lip of broken ice blocks of different heights, each with a
  // blue shadow under its overhang; crevasses that run over the lip and down the face; the ice narrower at the lip than
  // at the foot, so the snout leans back, with the moraine's rubble either side (v3: the tan cliff rock, a brown column
  // against the moraine bank); a dirty band of debris-laden ice along the foot; and a low cave, wider than tall and lop-
  // sided, deep glacial blue inside, lighter toward its mouth, its floor the melt running out (meltAt carries it on).
  const CAVE_C = 0.035, CAVE_HW = 0.23; // the cave's middle along the edge and its half width (tiles)
  // the crevasses: thin cracks along the flow, at irregular spacing (al: along the edge, tiles)
  function crevasse(al, k) {
    const q = al * 8 + 0.35 * vnoise(k * 2 + 3, al * 2), n = Math.round(q), d = Math.abs(q - n);
    return hash2(n, 3, 913) < 0.45 ? 1 - sstep((d - 0.05) / 0.07) : 0;
  }
  function iceFront(tx, ty, wx, wyg, depth, hF, fh) {
    const c = map[F_OWN], al = wx / 32 - (c.x - c.y + (F_SE < 0.5 ? -0.5 : 0.5)); // along the edge from its middle, in tiles
    const pd = PX.pieces.d, st = PX.pieces.w, u = ((Math.floor(wx * 2) % 64) + 64) % 64, v = ((Math.floor(depth * 2 + 6) % 80) + 80) % 80;
    const oL = ((ICE_LIT.y + v) * st + ICE_LIT.x + u) * 4, oS = ((ICE_SHADE.y + v) * st + ICE_SHADE.x + u) * 4;
    let r = pd[oL] + (pd[oS] - pd[oL]) * F_SE, g = pd[oL + 1] + (pd[oS + 1] - pd[oL + 1]) * F_SE, b = pd[oL + 2] + (pd[oS + 2] - pd[oL + 2]) * F_SE;
    // the tan strata read as stone: the material is drawn toward the ice's own blue (its light and shade kept, a
    // little stronger), lighter toward the lip, so the front reads as ice, not as a wall of grey blocks
    const L = r * 0.3 + g * 0.59 + b * 0.11, Lc = (168 + (L - 172) * 1.3) * (1.04 - 0.2 * (fh > 0 ? 1 - hF / fh : 0));
    r += (Lc * 0.8 - r) * 0.82; g += (Lc * 0.96 - g) * 0.82; b += (Lc * 1.1 - b) * 0.82;
    // the lip: broken blocks of ice, each its own height, with a blue shadow under its overhang
    const bi = Math.floor(al * 15 + 0.6 * vnoise(al * 3 + 1, 5.1)), jag = 0.4 + 3.4 * hash2(bi, 7, 911) * (0.55 + 0.45 * vnoise(al * 5, 1.3));
    if (depth < jag) {
      const lit = 0.92 + 0.12 * hash2(bi, 9, 912);
      r = 222 * lit; g = 232 * lit; b = 240 * lit;
    } else if (depth < jag + 1.6) { const k = 0.66 + 0.2 * ((depth - jag) / 1.6); r *= k * 0.92; g *= k * 0.97; b *= k; }
    // the crevasses run on over the lip and down the face
    const cr = crevasse(al, depth * 0.1) * (1 - sstep((depth - fh * 0.7) / (fh * 0.25 + 0.5)));
    if (cr > 0) { r += (70 - r) * cr * 0.7; g += (112 - g) * cr * 0.7; b += (140 - b) * cr * 0.7; }
    // the ice's width: narrower at the lip than at the foot (the snout leans back), its edge wandering; moraine beyond.
    // The glacier options' ice fills its tile, so their front spans the whole edge (v3: the moraine part of the step
    // read as a brown column beside the moraine bank); the glacier picture (As now) is about 0.4 tile wide.
    const half = (glacierName === 'demo' ? 0.32 : 0.6) + 0.07 * (fh > 0 ? 1 - hF / fh : 0) + 0.05 * (vnoise(depth * 0.4 + al * 3, 17.3) - 0.5);
    const iw = sstep((half - Math.abs(al)) / 0.04);
    if (iw < 1) {
      sampleMat(M.MORAINE, tx, ty, wx * 1.5, wyg * 1.5); // as the rubble piled in front of it (meltAt)
      const k = (0.8 - 0.2 * F_SE) * (0.85 + 0.15 * (fh > 0 ? hF / fh : 1));
      r = V[0] * k + (r - V[0] * k) * iw; g = V[1] * k + (g - V[1] * k) * iw; b = V[2] * k + (b - V[2] * k) * iw;
    }
    // a dirty band of debris-laden ice along the foot
    const dirt = (1 - sstep((hF - 0.6 - 1.2 * vnoise(al * 11 + 3, 2.2)) / 0.8)) * iw;
    if (dirt > 0) { r += (118 - r) * dirt * 0.6; g += (112 - g) * dirt * 0.6; b += (100 - b) * dirt * 0.6; }
    // the cave: low and wider than tall, its crown off the middle, deep blue inside, lighter toward its mouth
    const x = (al - CAVE_C) / CAVE_HW;
    if (x > -1 && x < 1) {
      const H = fh * (0.52 + 0.06 * vnoise(al * 7 + 2, 4.4)) * Math.sqrt(1 - x * x) * (1 + 0.28 * x);
      if (hF < H) {
        const q = hF / H, deep = sstep((0.8 - Math.abs(x)) / 0.5) * sstep((0.95 - q) / 0.45);
        let mr = 92 + (22 - 92) * deep, mg = 160 + (60 - 160) * deep, mb = 188 + (96 - 188) * deep;
        // its floor is the melt, running out
        const fl = 1 - sstep((hF - 0.4) / 0.9);
        mr += (84 - mr) * fl; mg += (160 - mg) * fl; mb += (170 - mb) * fl;
        const e = sstep((H - hF) / 0.8); // a thin light rim of ice round the mouth
        r = r + (mr - r) * e; g = g + (mg - g) * e; b = b + (mb - b) * e;
      }
    }
    OUT[0] = r; OUT[1] = g; OUT[2] = b;
  }
  // in front of the ice front, on the melt's tile: the meltwater runs out of the cave as a lighter, milky tongue that
  // breaks up downstream, rubble of the moraine lies piled either side of it, and a dirty band runs along the foot, so
  // the melt never meets the ice along a straight edge. Over the last ice tile near the front, the crevasses and the
  // broken blocks of the lip. Works on the colour in RB; returns how much it covered.
  function frontPlan() {
    ICE_FRONTS.length = 0; SN_BOX = null;
    for (const c of map) if (ICET[c.i] === 2) { const n = map[c.down]; ICE_FRONTS.push({ c, n, mx: (c.x + n.x) / 2, my: (c.y + n.y) / 2, dx: n.x - c.x, dy: n.y - c.y }); }
    // where the snout's swell can be (snoutAt), so heightAt asks only there
    for (const f of ICE_FRONTS) { const b = [f.c.x - 0.8, f.c.y - 0.8, f.c.x + 0.8, f.c.y + 0.8]; SN_BOX = SN_BOX ? [Math.min(SN_BOX[0], b[0]), Math.min(SN_BOX[1], b[1]), Math.max(SN_BOX[2], b[2]), Math.max(SN_BOX[3], b[3])] : b; }
  }
  function meltAt(tile, tx, ty, wx, wyg, S) {
    for (const f of ICE_FRONTS) {
      if (f.c.i !== tile && f.n.i !== tile) continue;
      const e = (tx - f.mx) * f.dx + (ty - f.my) * f.dy, al = (tx - f.mx) * f.dy - (ty - f.my) * f.dx; // past the front; along it
      if (e < 0) {
        // the ice's top near the front: the swell of the snout catches the light (its back would fall into shade), then
        // crevasses and the broken blocks of the lip
        if (e > -0.55) { const sw = 0.1 * (1 - Math.abs((e + 0.3) / 0.25)) * (1 - sstep((Math.abs(al) - 0.4) / 0.14)); if (sw > 0) { RB[0] *= 1 + sw; RB[1] *= 1 + sw; RB[2] *= 1 + sw; } }
        const k = 1 - sstep((-e - 0.12) / 0.2);
        if (k <= 0) return;
        const cr = crevasse(al, 0) * k * sstep((0.36 - Math.abs(al)) / 0.05);
        const blk = (1 - sstep((-e - 0.04 - 0.05 * hash2(Math.floor(al * 15), 5, 914)) / 0.03)) * (hash2(Math.floor(al * 15), 6, 915) - 0.5) * 0.1;
        RB[0] *= 1 + blk; RB[1] *= 1 + blk; RB[2] *= 1 + blk;
        if (cr > 0) { RB[0] += (70 * S - RB[0]) * cr * 0.55; RB[1] += (112 * S - RB[1]) * cr * 0.55; RB[2] += (140 * S - RB[2]) * cr * 0.55; }
        return;
      }
      if (e > 0.5) return;
      const n1 = vnoise(tx * 7 + 3, ty * 7 + 11), n2 = vnoise(tx * 17 + 5, ty * 17 + 2), ac = Math.abs(al - CAVE_C);
      // the moraine's rubble piled either side of the outflow, in lobes, thinning out away from the ice
      const tw = CAVE_HW * (0.85 + 0.9 * e) + (n1 - 0.5) * 0.08;
      const mor = sstep((ac - tw - 0.02) / 0.05) * (1 - sstep((e - 0.12 - 0.22 * n1) / 0.08)) * (1 - sstep((ac - 0.52) / 0.06));
      if (mor > 0) { sampleMat(M.MORAINE, tx, ty, wx * 1.5, wyg * 1.5); const k = 0.8 * S; RB[0] += (V[0] * k - RB[0]) * mor; RB[1] += (V[1] * k - RB[1]) * mor; RB[2] += (V[2] * k * 0.98 - RB[2]) * mor; }
      // the milky meltwater tongue, broken up downstream
      const tg = (1 - sstep((ac - tw) / 0.04)) * (1 - sstep((e - 0.14 - 0.3 * n1) / 0.12)) * (0.65 + 0.35 * sstep((n2 - 0.35) / 0.3));
      if (tg > 0) { const w = 0.88 + 0.2 * n2, k = S * w; RB[0] += (soft(150 * k, CAP_R) - RB[0]) * tg * 0.8; RB[1] += (soft(204 * k, CAP_G) - RB[1]) * tg * 0.8; RB[2] += (soft(204 * k, CAP_B) - RB[2]) * tg * 0.8; }
      // flecks of white where it tumbles out, and the dirty band at the foot
      const fk = tg * sstep((n2 - 0.62) / 0.1) * (1 - sstep((e - 0.22) / 0.1));
      if (fk > 0) { RB[0] += (soft(228 * S, CAP_R) - RB[0]) * fk; RB[1] += (soft(236 * S, CAP_G) - RB[1]) * fk; RB[2] += (soft(234 * S, CAP_B) - RB[2]) * fk; }
      const dirt = (1 - sstep((e - 0.02 - 0.03 * n1) / 0.03)) * (1 - tg * 0.6);
      if (dirt > 0) { RB[0] *= 1 - 0.22 * dirt; RB[1] *= 1 - 0.24 * dirt; RB[2] *= 1 - 0.26 * dirt; }
      return;
    }
  }
  // per raster pixel: the surface it shows (s = tx + ty) and what details may go on it, for the grass-detail pass
  const DEP = new Uint16Array(GW * GH);
  // per raster pixel: which water it shows (0 none, 1 still water, 2 a river's current, 3 a falling cascade), for Animate all water
  const WM = new Uint8Array(GW * GH);
  let WFLAG = 0, FLD_C = 0, FLD_R = 0, FLD_G = 0, FLD_B = 0;
  const COLLO = new Int16Array(GW), COLHI = new Int16Array(GW); // the rows each column painted last time
  // one raster column, marched front to back (its own function, so the optimiser compiles it whole)
  const DS = 1 / (16 * SCALE);
  // Columns are painted CBK at a time into a column-major scratch (CB, CD, CW: a column's rows lie side by side), then
  // copied into the row-major raster row by row: painting straight into the raster wrote one cache line per pixel in
  // each of three buffers, a tenth of the painter's time (fix round 1: load time). Rows a column painted last time and
  // not now are cleared by the same copy.
  const CBK = 16, CB = new Uint8ClampedArray(CBK * GH * 4), CD = new Uint16Array(CBK * GH), CW = new Uint8Array(CBK * GH);
  const CB32 = new Uint32Array(CB.buffer), GD32 = new Uint32Array(gd.buffer); // a pixel's four bytes copied as one
  // Fix round of v8 (the critic: a near fall's moving frames drifted from the approved still: softer and bluer, the
  // broad white plunge foam turned teal, the broken spray beside it thinner; and its loop jumped). Each near fall keeps
  // a record of the painter's own points over the part of the ground its water reaches, a ground raster px each: the
  // point (tx, ty, z and the screen y it was shaded for) and the ground there before the falls were laid over it (FB).
  // Its frames are the painter's picture made again from those (nearFrame), with the sheet and the foam moved on.
  const FS = new Float64Array(4);
  function fallRecSetup() {
    FREC_COL = new Array(GW);
    for (const f of FALLS) {
      f.rec = null;
      if (!f.near) continue;
      // where fallAt can reach: from a little above the brink to 0.84 tile past the foot, 0.74 tile either side
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      const lo = -f.w / 2 - 0.32 * f.w, hi = f.w / 2 + 0.84;
      for (let al = lo; al <= hi + 1e-9; al += 0.03) for (let ac = -0.74; ac <= 0.74 + 1e-9; ac += 0.03) {
        const tx = f.mx + f.dx * al - f.dy * ac, ty = f.my + f.dy * al + f.dx * ac, z = heightAt(tx, ty), sx = (tx - ty) * 32, sy = (tx + ty) * 16 - z;
        if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
      }
      const gx0 = Math.max(0, Math.floor((x0 - 3 - GX0) * SCALE)), gx1 = Math.min(GW, Math.ceil((x1 + 3 - GX0) * SCALE));
      const gy0 = Math.max(0, Math.floor((y0 - 4 - GY0) * SCALE)), gy1 = Math.min(GH, Math.ceil((y1 + 4 - GY0) * SCALE));
      if (gx1 <= gx0 || gy1 <= gy0) continue;
      const R = (f.rec = { gx0, gy0, cw: gx1 - gx0, ch: gy1 - gy0, P: new Float64Array((gx1 - gx0) * (gy1 - gy0) * 8).fill(NaN) });
      for (let gx = gx0; gx < gx1; gx++) (FREC_COL[gx] ||= []).push(R);
    }
  }
  // the painter's point for rows y0 to y1 of column gx, with the ground before the falls (B: FB or a copy of it)
  function fallRec(fr, gx, y0, y1, tx, ty, z, wyg, B) {
    for (const R of fr) {
      const a = y0 > R.gy0 ? y0 : R.gy0, b = y1 < R.gy0 + R.ch ? y1 : R.gy0 + R.ch, P = R.P, st = R.cw * 8;
      for (let y = a, o = ((a - R.gy0) * R.cw + gx - R.gx0) * 8; y < b; y++, o += st) {
        P[o] = tx; P[o + 1] = ty; P[o + 2] = z; P[o + 3] = wyg; P[o + 4] = B[0]; P[o + 5] = B[1]; P[o + 6] = B[2]; P[o + 7] = B[3];
      }
    }
  }
  function paintColumns(c0, c1) {
    // (fix round of v8: the near falls' records of their painted points, and their frames made again from them)
    if (!FREC_COL) fallRecSetup();
    for (const f of FALLS) if (f.rec && f.rec.gx0 < c1 && f.rec.gx0 + f.rec.cw > c0) f.frames = null;
    for (let b0 = c0; b0 < c1; b0 += CBK) {
      const n = Math.min(CBK, c1 - b0);
      CB32.fill(0); CD.fill(0); CW.fill(0);
      let lo = GH, hi = 0;
      for (let l = 0; l < n; l++) {
        const gx = b0 + l;
        if (COLLO[gx] < lo) lo = COLLO[gx]; if (COLHI[gx] > hi) hi = COLHI[gx];
        paintColumn(gx, l * GH);
        if (COLLO[gx] < lo) lo = COLLO[gx]; if (COLHI[gx] > hi) hi = COLHI[gx];
      }
      for (let y = lo; y < hi; y++) {
        let p = y * GW + b0;
        for (let l = 0, q = y; l < n; l++, p++, q += GH) { GD32[p] = CB32[q]; DEP[p] = CD[q]; WM[p] = CW[q]; }
      }
      farSilPass(b0, b0 + n); // round 6: a far fall's brink line, where the ground shows beside it (farSil)
    }
  }
  function paintColumn(gx, cb) {
    const ds = DS, fr = FREC_COL[gx];
    if (fr !== undefined) for (const R of fr) for (let y = 0, o = (gx - R.gx0) * 8; y < R.ch; y++, o += R.cw * 8) R.P[o] = NaN;
    {
      COLLO[gx] = GH; COLHI[gx] = 0;
      const wx = GX0 + gx / SCALE, d = wx / 32;
      const sLo = Math.max(-1 - d, d - 1), sHi = Math.min(2 * W - 1 - d, 2 * H - 1 + d);
      if (sLo > sHi) return;
      let ymin = Infinity, front = true, zfPrev = 0, lastTop = Infinity;
      for (let k = Math.floor(sHi / ds); k * ds >= sLo; k--) {
        const s = k * ds, tx = (s + d) / 2, ty = (s - d) / 2;
        const z = heightAt(tx, ty);
        const ti = tx < 0 ? 0 : tx > W - 1 ? W - 1 : Math.round(tx) | 0, tj = ty < 0 ? 0 : ty > H - 1 ? H - 1 : Math.round(ty) | 0, tile = tj * W + ti;
        // a wheat field stands a little above the ground: its stalks are 2.6 to 3.5 world px tall
        let zf = 0;
        FLD_C = 0;
        if (FIELD_NEAR[tile]) {
          fieldAt(tx, ty); FLD_C = V[7]; FLD_R = V[3]; FLD_G = V[4]; FLD_B = V[5];
          if (FLD_C > 0) {
            // the stalks: 2.6 to 3.5 px, up to 1.8 px taller along a building's foot; toward the field's edge they get
            // shorter stalk by stalk (a ragged edge, not a cut-off wall)
            let tall = 0;
            const ftl = FIELD_TALL[FLD_T];
            if (ftl) for (let q = 0; q < ftl.length; q++) { const b = ftl[q], e = Math.max(Math.abs(tx - b[0]), Math.abs(ty - b[1])) - 0.34; if (e < 0.5) tall = Math.max(tall, 1 - sstep((e - 0.05) / 0.4)); }
            const sn = vnoise(tx * 23 + 3, ty * 23 + 9) * 0.6 + vnoise(tx * 9 + 1, ty * 9 + 4) * 0.4;
            zf = (2.6 + 0.9 * vnoise(tx * 2.7 + 5, ty * 2.7 + 1) + 1.8 * tall) * sstep((FLD_C - 0.08 - 0.4 * sn * (1 - FLD_C)) / 0.55);
          }
        }
        const rise = zf - zfPrev; zfPrev = zf;
        let top = Math.floor((16 * s - z - zf - GY0) * SCALE);
        const topRaw = top, prevTop = lastTop; lastTop = topRaw;
        if (ymin === Infinity) ymin = top + 1;
        if (top >= ymin) continue;
        if (top < 0) top = 0;
        const sq = FB_SEQ;
        shadeAt(tx, ty, z, wx, 16 * s - z - zf);
        const hit = fr !== undefined && FB_SEQ !== sq;
        if (hit) { FS[0] = FB[0]; FS[1] = FB[1]; FS[2] = FB[2]; FS[3] = FB[3]; }
        let r = OUT[0] > 255 ? 255 : OUT[0], g = OUT[1] > 255 ? 255 : OUT[1], b = OUT[2] > 255 ? 255 : OUT[2];
        const dv = (Math.round((s + 1) * 100) << 2) | FLAGV, wf = WFLAG;
        if (FACEN[tile] && faceSetup(tx, ty, z) && (F_LIP - z >= 0.75 || ymin - top >= 3)) {
          // a face below this point's lip, down to the surface in front of it: painted row by row
          // the lip keeps its ground colour; a point already down the bank is face all the way
          const lip = F_LIP - z < 0.75, dv0 = dv & ~3;
          if (lip) { const o0 = (cb + top) * 4; CB[o0] = r; CB[o0 + 1] = g; CB[o0 + 2] = b; CB[o0 + 3] = 255; CD[cb + top] = dv; CW[cb + top] = wf; if (hit) fallRec(fr, gx, top, top + 1, tx, ty, z, 16 * s - z - zf, FS); }
          for (let y = lip ? top + 1 : top; y < ymin; y++) {
            faceAt(tx, ty, z - (y - top) / SCALE, wx, GY0 + y / SCALE, y);
            const o = (cb + y) * 4; CB[o] = OUT[0] > 255 ? 255 : OUT[0]; CB[o + 1] = OUT[1] > 255 ? 255 : OUT[1]; CB[o + 2] = OUT[2] > 255 ? 255 : OUT[2]; CB[o + 3] = 255; CD[cb + y] = dv0; CW[cb + y] = WFLAG;
          }
        } else if (rise > 0.02 && ymin - top > 1) {
          // the front of a wheat field: its stalks in the shade of their own heads, darker toward the ground
          const side = sstep(rise / 0.5), n = ymin - top;
          for (let y = top; y < ymin; y++) {
            const q = (y - top) / n, f = 1 - side * (0.18 + 0.3 * q), o = (cb + y) * 4;
            CB[o] = r * f * (1 - 0.06 * side); CB[o + 1] = g * f * (1 - 0.1 * side); CB[o + 2] = b * f * (1 - 0.22 * side); CB[o + 3] = 255; CD[cb + y] = dv & ~3; CW[cb + y] = 0;
          }
        } else if (ymin - top >= 2 && prevTop - topRaw >= 2 && prevTop < topRaw + 400) {
          // a slope turned toward the view spreads one step of the march over several rows: each row shows its own
          // point of the surface, found between this sample and the one before, so a steep bank keeps its texture
          // at its own scale instead of a colour stretched down the rows (v2: streaks and sawtooth edges)
          { const o = (cb + top) * 4; CB[o] = r; CB[o + 1] = g; CB[o + 2] = b; CB[o + 3] = 255; CD[cb + top] = dv; CW[cb + top] = wf; }
          if (hit) fallRec(fr, gx, top, top + 1, tx, ty, z, 16 * s - z - zf, FS);
          const span = prevTop - topRaw, fc = FLD_C;
          for (let y = top + 1; y < ymin; y++) {
            const s2 = s + ds * ((y - topRaw) / span), tx2 = (s2 + d) / 2, ty2 = (s2 - d) / 2, z2 = heightAt(tx2, ty2);
            FLD_C = fc > 0 ? fc : 0;
            const sq2 = FB_SEQ;
            shadeAt(tx2, ty2, z2, wx, 16 * s2 - z2);
            if (fr !== undefined && FB_SEQ !== sq2) fallRec(fr, gx, y, y + 1, tx2, ty2, z2, 16 * s2 - z2, FB);
            const o = (cb + y) * 4; CB[o] = OUT[0] > 255 ? 255 : OUT[0]; CB[o + 1] = OUT[1] > 255 ? 255 : OUT[1]; CB[o + 2] = OUT[2] > 255 ? 255 : OUT[2]; CB[o + 3] = 255;
            CD[cb + y] = (Math.round((s2 + 1) * 100) << 2) | FLAGV; CW[cb + y] = WFLAG;
          }
        } else {
          for (let y = top, p = cb + top; y < ymin; y++, p++) { const o = p * 4; CB[o] = r; CB[o + 1] = g; CB[o + 2] = b; CB[o + 3] = 255; CD[p] = dv; CW[p] = wf; }
          if (hit) fallRec(fr, gx, top, ymin, tx, ty, z, 16 * s - z - zf, FS);
        }
        if (top < COLLO[gx]) COLLO[gx] = top;
        if (ymin > COLHI[gx]) COLHI[gx] = Math.min(GH, ymin);
        if (front) {
          // the map's front edge: a dark earth (or deep water) skirt down to one straight line below level 0
          front = false;
          const water = isWaterMat(MAT[Math.max(0, Math.min(H - 1, Math.round(ty))) * W + Math.max(0, Math.min(W - 1, Math.round(tx)))]);
          const se = tx > W - 0.52, base = Math.floor((16 * s + 7 - GY0) * SCALE), y0 = top + 1;
          const dim = se ? 0.72 : 1;
          if (base > COLHI[gx]) COLHI[gx] = Math.min(GH, base);
          for (let y = y0; y < base && y < GH; y++) {
            const f = (y - y0) / Math.max(1, base - y0), o = (cb + y) * 4;
            if (water) { CB[o] = (30 - 12 * f) * dim; CB[o + 1] = (62 - 24 * f) * dim; CB[o + 2] = (72 - 26 * f) * dim; }
            else { CB[o] = (92 - 44 * f) * dim; CB[o + 1] = (72 - 34 * f) * dim; CB[o + 2] = (50 - 22 * f) * dim; }
            CB[o + 3] = 255; CW[cb + y] = 0;
          }
        }
        ymin = top;
        if (ymin <= 0) break;
      }
    }
  }
  // grass tufts and pebbles over the painted ground (ground.md): tufts every 0.18 tile, kept with
  // probability grassDetail * 0.34, four short strokes each; pebbles every 0.4 tile, kept 4.5% of the time
  const DETAILS = [];
  function buildDetails() {
    DETAILS.length = 0;
    const add = (step, kind) => {
      const n = Math.ceil(Math.max(W, H) / step);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const tx = -0.5 + (i + 0.15 + 0.7 * hash2(i, j, kind * 13 + 1)) * step, ty = -0.5 + (j + 0.15 + 0.7 * hash2(i, j, kind * 13 + 2)) * step;
        if (tx > W - 0.5 || ty > H - 0.5) continue;
        const keep = kind === 1 ? (0.48 + 0.52 * vnoise(tx * 0.24 + 50, ty * 0.24 + 50)) * 0.34 : 0.045;
        if (hash2(i, j, kind * 13 + 3) >= keep) continue;
        const z = heightAt(tx, ty), wx = (tx - ty) * 32, wy = (tx + ty) * 16 - z;
        DETAILS.push({ kind, s: tx + ty, gx: Math.round((wx - GX0) * SCALE), gy: Math.round((wy - GY0) * SCALE), r: hash2(i, j, kind * 13 + 4), q: hash2(i, j, kind * 13 + 5) });
      }
    };
    add(0.18, 1); add(0.4, 2);
    DETAILS.sort((a, b) => a.gx - b.gx);
  }
  buildDetails();
  function drawDetails(c0, c1) {
    let lo = 0, hi = DETAILS.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (DETAILS[m].gx < c0 - 8) lo = m + 1; else hi = m; }
    const grass = new Path2D(), forest = new Path2D(), shadows = [], stones = [];
    for (let k = lo; k < DETAILS.length && DETAILS[k].gx < c1 + 8; k++) {
      const t = DETAILS[k];
      if (t.gy < 0 || t.gy >= GH || t.gx < 0 || t.gx >= GW) continue;
      const v = DEP[t.gy * GW + t.gx], fl = v & 3;
      if (!fl || Math.abs(((v >> 2) / 100 - 1) - t.s) > 0.07) continue;
      if (t.kind === 1) {
        if (fl < 2) continue;
        const path = fl === 3 ? forest : grass;
        for (let q = 0; q < 4; q++) {
          const o = (q - 1.5) * 1.15, h = (1.6 + 1.5 * hash2(k, q, 7)) * SCALE, lean = (hash2(k, q, 9) - 0.5) * 1.2;
          path.moveTo(t.gx + o, t.gy); path.lineTo(t.gx + o * 1.8 + lean, t.gy - h);
        }
      } else {
        const sz = (0.8 + 1.1 * t.r) * SCALE;
        shadows.push([t.gx + 0.5 * sz, t.gy + 0.25 * sz, sz * 1.1, sz * 0.5]);
        stones.push([t.gx, t.gy - 0.3 * sz, sz, t.q]);
      }
    }
    gctx.save();
    gctx.beginPath(); gctx.rect(c0, 0, c1 - c0, GH); gctx.clip();
    gctx.lineCap = 'round'; gctx.lineWidth = 0.65 * SCALE;
    gctx.strokeStyle = 'rgba(164,175,79,0.68)'; gctx.stroke(grass); // [172, 175, 84] with the spring tint
    gctx.strokeStyle = 'rgba(125,145,66,0.65)'; gctx.stroke(forest); // [131, 145, 70] on forest ground
    gctx.fillStyle = 'rgba(88,91,70,0.3)';
    for (const [x, y, rx, ry] of shadows) { gctx.beginPath(); gctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); gctx.fill(); }
    gctx.fillStyle = 'rgba(162,160,130,0.66)';
    for (const [x, y, sz, q] of stones) {
      gctx.beginPath();
      for (let p = 0; p < 6; p++) { const a = (p / 6) * Math.PI * 2 + q * 2, rr = sz * (0.75 + 0.25 * Math.sin(q * 17 + p * 2.3)); const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.62; if (p) gctx.lineTo(px, py); else gctx.moveTo(px, py); }
      gctx.closePath(); gctx.fill();
    }
    gctx.restore();
  }
  // ---------- wheat stalks as a depth-sorted layer (v3: the author's feedback 6). The painter still paints each field
  // into the ground. After each paint, the wheat on each tile it reaches is cut out of the painted ground into a picture
  // of its own, drawn at that tile's depth like a prop, so wheat in front of a building stands over the building's foot
  // (the farm halt's steps and ramp). The picture keeps only the wheat that covers a sprite drawn before it, and leaves
  // out wheat behind such a sprite's foot, which stays under it: the foot is the lowest opaque pixel of each of the
  // sprite's columns, widened 2 px so the gaps between a ramp's legs count as its foot.
  let WHEAT_VER = 0;
  // (cached per picture: a building's ground-fit plinth shares its key, so the key alone would mix up their feet)
  const WFOOT = new WeakMap();
  function footLine(s) {
    let byRect = WFOOT.get(s.img);
    if (!byRect) WFOOT.set(s.img, (byRect = new Map()));
    const rk = `${s.sx},${s.sy},${s.sw},${s.sh},${Math.max(1, Math.round((2 * s.sw) / s.w))}`; // (v9: and its widening, which the drawn size sets: Building scale draws one picture at two sizes)
    let f = byRect.get(rk);
    if (f) return f;
    const cv = document.createElement('canvas'); cv.width = s.sw; cv.height = s.sh;
    const x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(s.img, s.sx, s.sy, s.sw, s.sh, 0, 0, s.sw, s.sh);
    const px = x.getImageData(0, 0, s.sw, s.sh).data, raw = new Int16Array(s.sw).fill(-1), k = Math.max(1, Math.round((2 * s.sw) / s.w));
    for (let u = 0; u < s.sw; u++) for (let v = s.sh - 1; v >= 0; v--) if (px[(v * s.sw + u) * 4 + 3] >= 128) { raw[u] = v; break; }
    f = new Int16Array(s.sw);
    for (let u = 0; u < s.sw; u++) { let m = -1; for (let q = Math.max(0, u - k); q <= Math.min(s.sw - 1, u + k); q++) if (raw[q] > m) m = raw[q]; f[u] = m; }
    byRect.set(rk, f);
    return f;
  }
  // the raster rectangle a tile's wheat can reach: its diamond, 8 px above for the stalks
  function wheatBox(t) {
    const cx = (t.x - t.y) * 32, cy = (t.x + t.y) * 16;
    let zlo = Infinity, zhi = -Infinity;
    for (let q = 0; q <= 4; q++) for (let r = 0; r <= 4; r++) { const z = heightAt(t.x - 0.5 + q / 4, t.y - 0.5 + r / 4); if (z < zlo) zlo = z; if (z > zhi) zhi = z; }
    return [Math.max(0, Math.floor((cx - 34 - GX0) * SCALE)), Math.max(0, Math.floor((cy - 16 - zhi - 8 - GY0) * SCALE)), Math.min(GW, Math.ceil((cx + 34 - GX0) * SCALE)), Math.min(GH, Math.ceil((cy + 16 - zlo + 2 - GY0) * SCALE))];
  }
  function cutWheat(L) {
    L.ver = WHEAT_VER; L.cv = null;
    const t = L.c, [x0, y0, x1, y1] = wheatBox(t), w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    const wx0 = GX0 + x0 / SCALE, wy0 = GY0 + y0 / SCALE, wx1 = GX0 + x1 / SCALE, wy1 = GY0 + y1 / SCALE;
    // the sprites drawn before this picture that it overlaps: with none, it would only repeat the painted ground
    // (not the ground fit's overlays at a building's foot, its occlusion band and weeds: the wheat covers them with the
    // building's foot, and as pictures of their own their lower edge would hide the wheat in front of the building)
    const before = SPRITES.filter((s) => s.img && !s.gfOver && s.depth < L.depth && s.x < wx1 && s.x + s.w > wx0 && s.y < wy1 && s.y + s.h > wy0);
    if (!before.length) return;
    // the colours come from the painter's own raster (gd: the ground without its tufts, which keep off the wheat)
    const img = new ImageData(w, h), p = img.data;
    let any = false;
    for (let gy = y0; gy < y1; gy++) for (let gx = x0; gx < x1; gx++) {
      const o = ((gy - y0) * w + gx - x0) * 4, go = (gy * GW + gx) * 4, v = DEP[gy * GW + gx];
      p[o] = gd[go]; p[o + 1] = gd[go + 1]; p[o + 2] = gd[go + 2]; p[o + 3] = gd[go + 3];
      let a = 0;
      if (v && p[o + 3]) {
        // the surface point this pixel shows (the painter's march stores it), and whether it is wheat on this tile
        const s = (v >> 2) / 100 - 1, d = (GX0 + gx / SCALE) / 32, tx = (s + d) / 2, ty = (s - d) / 2;
        if (Math.round(tx) === t.x && Math.round(ty) === t.y) {
          fieldAt(tx, ty);
          a = sstep((V[7] - 0.05) / 0.45);
          if (a > 0) {
            // kept only where it can cover a sprite drawn before it (at or above that sprite's foot, in its columns)
            // and is not behind any such sprite's foot; everywhere else the painted ground already shows the same wheat
            const wx = GX0 + (gx + 0.5) / SCALE, wy = GY0 + (gy + 0.5) / SCALE, yg = 16 * s - heightAt(tx, ty);
            let over = false;
            for (const sp of before) {
              if (wx < sp.x || wx >= sp.x + sp.w || wy < sp.y) continue;
              let u = Math.floor(((wx - sp.x) * sp.sw) / sp.w);
              if (sp.flip) u = sp.sw - 1 - u;
              const fr = footLine(sp)[u];
              if (fr < 0) continue;
              const fy = sp.y + ((fr + 1) * sp.h) / sp.sh;
              if (yg < fy - 0.5) { over = false; break; }
              if (wy <= fy + 1) over = true;
            }
            if (!over) a = 0;
          }
        }
      }
      p[o + 3] = Math.round(a * p[o + 3]);
      if (a > 0) any = true;
    }
    if (!any) return;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    cv.getContext('2d').putImageData(img, 0, 0);
    L.cv = cv; L.x = wx0; L.y = wy0; L.w = w / SCALE; L.h = h / SCALE;
  }
  const colOf = (tx, ty) => Math.floor(((tx - ty) * 32 - GX0) * SCALE);
  // Before the first paint, the painter is asked once at a few thousand scattered points of the whole map (nothing is
  // drawn). Painting column by column, it met each kind of ground (a river, a fall, snow, paving) for the first time
  // part way through, and the engine threw its optimised code away and rebuilt it each time: about ninety times on a
  // load, for some two seconds (fix round 1: load time). Asked everywhere first, it is optimised once with all of it.
  function warmPainter() {
    const r = makeRng(77);
    // round 3: and the tiles where the rarer paths run (falls, rivers by a lip, wet rock, the snow's outcrops), so the
    // painter's optimised code has seen them before the paint instead of being thrown away and rebuilt during it
    const rare = [];
    for (let k = 0; k < N; k++) if (FALLP[k] || RWILD[k] || WETN[k] || (OCT[k] && SNOWT[k])) rare.push(k);
    const n0 = W * H * 6, n1 = n0 + rare.length * 20;
    for (let q = 0; q < n1; q++) {
      const rt = q < n0 ? -1 : rare[(q - n0) % rare.length];
      const tx = rt < 0 ? r() * W - 0.5 : (rt % W) + r() - 0.5, ty = rt < 0 ? r() * H - 0.5 : ((rt / W) | 0) + r() - 0.5, z = heightAt(tx, ty), ti = Math.max(0, Math.min(W - 1, Math.round(tx))), tj = Math.max(0, Math.min(H - 1, Math.round(ty)));
      const tile = tj * W + ti, wx = (tx - ty) * 32, wyg = (tx + ty) * 16 - z;
      FLD_C = 0;
      if (FIELD_NEAR[tile]) { fieldAt(tx, ty); FLD_C = V[7]; FLD_R = V[3]; FLD_G = V[4]; FLD_B = V[5]; }
      shadeAt(tx, ty, z, wx, wyg);
      if (FACEN[tile] && faceSetup(tx, ty, z)) faceAt(tx, ty, z - 1, wx, wyg + 1, 0);
    }
    FLD_C = 0;
  }
  async function paint(cols, onProgress) {
    // cols: sorted list of [c0, c1) ranges
    const total = cols.reduce((s, [a, b]) => s + b - a, 0);
    let done = 0;
    for (const [a, b] of cols) {
      for (let c = a; c < b; c += 240) {
        const e = Math.min(b, c + 240);
        paintColumns(c, e);
        gctx.putImageData(gimg, 0, 0, c, 0, e - c, GH);
        drawDetails(c, e);
        done += e - c;
        if (onProgress) onProgress(done / total);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    maskDirty = true; WHEAT_VER++; TB_VER++; warmFrames();
  }
  // the columns a set of tiles touches (plus the warp and the 3-tile pictures around them)
  function columnsFor(tiles) {
    const iv = [];
    for (const i of tiles) { const x = i % W, y = (i / W) | 0; const c = colOf(x, y); iv.push([Math.max(0, c - 70 * SCALE), Math.min(GW, c + 70 * SCALE)]); }
    iv.sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const r of iv) { const l = out[out.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else out.push([...r]); }
    return out;
  }
  const signature = () => map.map((c) => `${MAT[c.i]}|${SNOWT[c.i]}|${DECALS[c.i].map((d) => d.key + d.clip).join(',')}|${YSIG[c.i]}`);

  // ---------- camera and drawing
  const view = $('view'), vctx = view.getContext('2d');
  const stage = $('stage');
  let dpr = 1, VW = 0, VH = 0;
  const cam = { x: (27 - 21) * 32, y: (27 + 21) * 16 - 20, z: 1 };
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = stage.getBoundingClientRect();
    VW = Math.max(1, Math.round(r.width)); VH = Math.max(1, Math.round(r.height));
    view.width = Math.round(VW * dpr); view.height = Math.round(VH * dpr);
    dirty = true;
  }
  const ZMIN = 0.35, ZMAX = 4;
  function setZoom(z, sx = VW / 2, sy = VH / 2) {
    z = Math.max(ZMIN, Math.min(ZMAX, z));
    const wx = cam.x + (sx - VW / 2) / cam.z, wy = cam.y + (sy - VH / 2) / cam.z;
    cam.z = z; cam.x = wx - (sx - VW / 2) / z; cam.y = wy - (sy - VH / 2) / z;
    clampCam(); $('z-val').textContent = `${z >= 1 ? z.toFixed(z % 1 ? 1 : 0) : z.toFixed(2)}×`; dirty = true;
  }
  function clampCam() { cam.x = Math.max(GX0, Math.min(GX1, cam.x)); cam.y = Math.max(GY0, Math.min(GY1, cam.y)); }
  const toWorld = (sx, sy) => [cam.x + (sx - VW / 2) / cam.z, cam.y + (sy - VH / 2) / cam.z];
  let dirty = true, hover = null, flash = null;
  const t0 = performance.now();
  // the animation clock in seconds (freezeT pins it, for still pictures of a moving scene)
  let clockT = 0, freezeT = null;

  // ---------- Water: Animated (v8's default, the author's ask of 2026-10-12: "let's try animating everything, but keep
  // the current non-animated version") or Still (v7's still water). The ground stays the painted picture; the motion is
  // drawn over it in three passes, each masked to the water the painter recorded (WM), with the stones, foam and wet
  // rock in it left out by their colour, so they stay still:
  // - still water (the sea and the lakes): two layers of the game's short ripple strokes (drawn at the painter's own
  //   2 px per world px, so they stay crisp at zoom 4), in loose clusters, drifting slowly two ways, so patches of
  //   glints come and go instead of the whole surface pulsing at once (v7);
  // - running water: light streaks carried downstream along each river's own line (riverChains), from source or lake
  //   outlet to its mouth, across tile edges; each streak is born and fades out over its own short run, so there is no
  //   loop to jump at; past a mouth they slow down and fade out into the still water, as the river's colour does;
  //   the meltwater's run from the ice front's cave;
  // - cascades: each fall's frames (the sheet running down its slope, its foam drifting off; 16 a loop, 0.07 s apart,
  //   each laid over the one before it by how far the clock is past it, so the sheet slides instead of stepping).
  // Still things (banks, rocks, ice, bridge piers, everything drawn after the ground) never move.
  const MW = GW / SCALE, MH = GH / SCALE;
  let maskStill = null, maskRun = null, maskDirty = true, layer = null, lctx = null, ripplePat = null;
  // whether a painted pixel is water to move: blue-green, and not the near-white of foam or spray (stones, wet rock,
  // reeds and foam inside the water mask stay still)
  const waterish = (r, g, b) => g - r > 14 && b - r > 10 && r + g + b < 560;
  // the masks, a world px a pixel: still water; all the water that moves (the still water too, so a river's streaks
  // carry on past its mouth, the rivers' current and the falls' water); and, a block of 32 world px a cell, where each
  // kind lies (WBLK bit 1 still water, bit 2 moving), so each pass works only on the part of the view that has its water
  let WBLK = null;
  const WB = 32, WBW = Math.ceil(MW / WB), WBH = Math.ceil(MH / WB);
  function buildMasks() {
    const mk = () => { const c = document.createElement('canvas'); c.width = MW; c.height = MH; return c; };
    maskStill = maskStill || mk(); maskRun = maskRun || mk();
    WBLK = WBLK || new Uint8Array(WBW * WBH); WBLK.fill(0);
    const a = new ImageData(MW, MH), b = new ImageData(MW, MH), da = a.data, db = b.data;
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const i0 = (y * SCALE) * GW + x * SCALE;
      let still = 0, run = 0;
      for (let q = 0; q < 4; q++) {
        const p = i0 + (q & 1) + (q >> 1) * GW, v = WM[p];
        if (!v) continue;
        if (v === 3) { run++; continue; } // a fall's water, white or not: its frames are made to fit it
        if (!waterish(gd[p * 4], gd[p * 4 + 1], gd[p * 4 + 2])) continue;
        if (v === 1) still++; else run++;
      }
      const o = (y * MW + x) * 4 + 3; da[o] = still * 63.75; db[o] = (still + run) * 63.75;
      if (still || run) WBLK[((y / WB) | 0) * WBW + ((x / WB) | 0)] |= (still ? 1 : 0) | (run ? 2 : 0);
    }
    maskStill.getContext('2d').putImageData(a, 0, 0); maskRun.getContext('2d').putImageData(b, 0, 0);
    maskDirty = false;
  }
  // the part of the view (screen px of the canvas) whose blocks hold a kind of water, or null
  const WR = new Float64Array(4);
  function waterRect(bit, k, ox, oy, vx0, vy0, vx1, vy1) {
    const bx0 = Math.max(0, Math.floor((vx0 - GX0) / WB)), bx1 = Math.min(WBW - 1, Math.floor((vx1 - GX0) / WB)), by0 = Math.max(0, Math.floor((vy0 - GY0) / WB)), by1 = Math.min(WBH - 1, Math.floor((vy1 - GY0) / WB));
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let j = by0; j <= by1; j++) for (let i = bx0; i <= bx1; i++) if (WBLK[j * WBW + i] & bit) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
    if (x1 < x0) return null;
    WR[0] = Math.max(0, Math.floor((GX0 + x0 * WB) * k + ox)); WR[1] = Math.max(0, Math.floor((GY0 + y0 * WB) * k + oy));
    WR[2] = Math.min(view.width, Math.ceil((GX0 + (x1 + 1) * WB) * k + ox)); WR[3] = Math.min(view.height, Math.ceil((GY0 + (y1 + 1) * WB) * k + oy));
    return WR[2] > WR[0] && WR[3] > WR[1] ? WR : null;
  }
  // the game's ripples (worldRenderer.ts: short, slightly curved light strokes along the screen's horizontal), a tile
  // of 384 x 192 world px drawn at 2 px per world px. The strokes lie in loose clusters with open water between them,
  // so where the two drifting layers cross, patches of glints come and go (v7 pulsed the whole surface at once)
  function makeRipples() {
    const c = document.createElement('canvas'); c.width = 768; c.height = 384;
    const x = c.getContext('2d'), r = makeRng(7);
    x.scale(2, 2); x.lineCap = 'round';
    const cl = []; for (let k = 0; k < 14; k++) cl.push([r() * 384, r() * 192, 0.4 + 0.6 * r()]);
    for (let k = 0; k < 150; k++) {
      const q = cl[k % cl.length], px = q[0] + (r() - 0.5) * 70, py = q[1] + (r() - 0.5) * 34, l = 4 + r() * 8, a = (0.18 + r() * 0.3) * q[2];
      x.strokeStyle = `rgba(214,236,228,${a.toFixed(2)})`; x.lineWidth = 0.8 + r() * 0.4;
      for (const [ox, oy] of [[0, 0], [-384, 0], [0, -192], [-384, -192], [384, 0], [0, 192], [384, 192], [-384, 192], [384, -192]]) { x.beginPath(); x.moveTo(px + ox, py + oy); x.quadraticCurveTo(px + ox + l / 2, py + oy + 0.9, px + ox + l, py + oy - 0.2); x.stroke(); }
    }
    return c;
  }
  // a river tile's flow: in from its upstream edge (the largest river or lake running into it, or the ice front a melt
  // runs out of; else its far side), through its middle, out over its downstream edge
  const mainUp = (c) => { let best = null; for (const d of DIRS) { const o = tileAt(c.x + d.dx, c.y + d.dy); if (o && o.down === c.i && (o.kind === 'river' || o.kind === 'lake' || o.kind === 'glacier') && (!best || o.acc > best.acc)) best = o; } return best; };
  function flowOf(c) {
    const n = c.down >= 0 ? map[c.down] : null;
    const out = n ? { x: (n.x - c.x) / 2, y: (n.y - c.y) / 2 } : { x: 0, y: 0 };
    const best = mainUp(c);
    const inn = best ? { x: (best.x - c.x) / 2, y: (best.y - c.y) / 2 } : { x: -out.x, y: -out.y };
    return { inn, out, from: best };
  }
  // The rivers as chains: each runs down from a tile no river feeds as its main stream (a source, a lake's outlet, a melt
  // or a side stream) for as long as it is the main stream of each next tile, then ends: at a junction in the middle of
  // the tile it joins, at a mouth 0.7 tile out into the still water, or where the river stops. Sampled every 0.05 tile
  // along its middle (P, five numbers a sample): tile x, y, the water's height, how fast it runs there (1 on the river,
  // slowing past a mouth) and how hidden it is (1 on a fall's slope, where the fall's own frames run, and behind a far
  // fall's lip); S the distance down it, DX/DY the way it runs. fin / fout: how far its streaks fade in from its start
  // and out toward its end (tiles).
  let CHAINS = null;
  const FLOW_V = 0.42; // tiles per second
  function riverChains() {
    const out = [], riv = (c) => c && c.kind === 'river';
    for (const c0 of map) {
      if (!riv(c0)) continue;
      const up = mainUp(c0);
      if (up && up.kind === 'river') continue; // its main stream runs on from above: not a chain's head
      const P = [];
      let fin = up && up.kind === 'lake' ? 0.35 : up && up.kind === 'glacier' ? 0.25 : 0.5, fout = 0.4;
      const push = (x, y, z, v) => {
        // hidden on a fall's slope (and a little past a far fall's foot, behind its lip)
        let hid = 0;
        const tl = FALLL[Math.max(0, Math.min(H - 1, Math.round(y))) * W + Math.max(0, Math.min(W - 1, Math.round(x)))];
        if (tl) for (const f of tl) {
          const al = (x - f.mx) * f.dx + (y - f.my) * f.dy, ft = f.w / 2;
          const h = sstep((al + ft + 0.14) / 0.1) * (1 - sstep((al - ft - (f.near ? 0.02 : 0.3)) / 0.1));
          if (h > hid) hid = h;
        }
        P.push(x, y, z, v, hid);
      };
      let c = c0;
      for (let guard = 0; guard < N && c; guard++) {
        const f = flowOf(c), n = c.down >= 0 ? map[c.down] : null;
        const endHere = !n || !(riv(n) || n.kind === 'lake' || n.kind === 'ocean');
        for (let u = P.length ? 0.05 : 0; u <= 1.0001; u += 0.05) {
          if (endHere && u > 0.5001) break;
          const iu = 1 - u, x = c.x + iu * iu * f.inn.x + u * u * f.out.x, y = c.y + iu * iu * f.inn.y + u * u * f.out.y;
          push(x, y, heightAt(x, y), 1);
        }
        if (endHere) { fout = 0.3; break; }
        if (riv(n) && mainUp(n) !== c) {
          // a side stream: on into the river it joins, to that tile's middle, where it has merged
          for (let u = 0.05; u <= 0.5001; u += 0.05) { const x = n.x + ((c.x - n.x) / 2) * (1 - 2 * u), y = n.y + ((c.y - n.y) / 2) * (1 - 2 * u); push(x, y, heightAt(x, y), 1); }
          fout = 0.3; break;
        }
        if (!riv(n)) {
          // a mouth: on out into the lake or the sea, slowing and fading as the river's colour fades into it
          const dx = n.x - c.x, dy = n.y - c.y, zl = Lv[n.i] * LEVEL;
          for (let s = 0.05; s <= 0.7001; s += 0.05) push(c.x + dx * (0.5 + s), c.y + dy * (0.5 + s), zl, 1 - 0.65 * (s / 0.7));
          fout = 0.55; break;
        }
        c = n;
      }
      const n = P.length / 5;
      if (n < 4) continue;
      const S = new Float32Array(n), DX = new Float32Array(n), DY = new Float32Array(n);
      for (let k = 1; k < n; k++) S[k] = S[k - 1] + Math.hypot(P[k * 5] - P[k * 5 - 5], P[k * 5 + 1] - P[k * 5 - 4]);
      for (let k = 0; k < n; k++) {
        const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1), ex = P[b * 5] - P[a * 5], ey = P[b * 5 + 1] - P[a * 5 + 1], l = Math.hypot(ex, ey) || 1;
        DX[k] = ex / l; DY[k] = ey / l;
      }
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let k = 0; k < n; k++) { const sx = (P[k * 5] - P[k * 5 + 1]) * 32, sy = (P[k * 5] + P[k * 5 + 1]) * 16 - P[k * 5 + 2]; if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy; }
      const L = S[n - 1], seed = c0.x * 131 + c0.y * 17;
      // its streaks, each at its own place across the channel, its own pace and its own run: broad, faint glints (three
      // a tile, drawn first) and fine light streaks over them (eight a tile)
      const st = [];
      const mb = Math.max(2, Math.round(L * 3)), mf = Math.max(3, Math.round(L * 8));
      for (let k = 0; k < mb + mf; k++) {
        const h = (q) => hash2(seed, k, q), broad = k < mb;
        st.push(broad ? { w: (h(1) - 0.5) * 0.16, T: 2.6 + 1.4 * h(2), ph: h(3), len: 0.18 + 0.12 * h(4), a: 0.07 + 0.06 * h(5), lw: 1.9, k }
          : { w: (h(1) - 0.5) * 0.27, T: 2.0 + 1.4 * h(2), ph: h(3), len: 0.06 + 0.1 * h(4), a: 0.16 + 0.15 * h(5), lw: 0.6, k });
      }
      out.push({ P, S, DX, DY, n, L, fin, fout, st, seed, box: [x0 - 8, y0 - 8, x1 + 8, y1 + 8] });
    }
    return out;
  }
  // a point of a chain at distance s (tiles from its start), offset w across it: screen x, y, speed and hidden in CP
  const CP = new Float64Array(4);
  function chainAt(ch, s, w) {
    const S = ch.S, n = ch.n;
    let lo = 0, hi = n - 1;
    if (s <= 0) hi = 1; else if (s >= ch.L) lo = n - 2; else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    let f = (s - S[lo]) / ((S[hi] - S[lo]) || 1); f = f < 0 ? 0 : f > 1 ? 1 : f;
    const P = ch.P, a = lo * 5, b = hi * 5;
    const x = P[a] + (P[b] - P[a]) * f, y = P[a + 1] + (P[b + 1] - P[a + 1]) * f, z = P[a + 2] + (P[b + 2] - P[a + 2]) * f;
    const dx = ch.DX[lo] + (ch.DX[hi] - ch.DX[lo]) * f, dy = ch.DY[lo] + (ch.DY[hi] - ch.DY[lo]) * f;
    const px = x - dy * w, py = y + dx * w;
    CP[0] = (px - py) * 32; CP[1] = (px + py) * 16 - z; CP[2] = P[a + 3] + (P[b + 3] - P[a + 3]) * f; CP[3] = P[a + 4] + (P[b + 4] - P[a + 4]) * f;
  }
  // the streaks of a chain at time t. Each is born at a place picked afresh every run (a hash of the run), moves down
  // the channel for T seconds and fades in and out over it (sin), so it never jumps; near the chain's ends, and where the
  // chain is hidden, it fades too. Past a mouth the water slows: the run is shortened by the speed where it starts.
  function drawChain(L, ch, t) {
    const len = ch.L;
    for (const q of ch.st) {
      const r = t / q.T + q.ph, run = Math.floor(r), f = r - run;
      const D = FLOW_V * q.T, s0 = hash2(ch.seed, q.k, 100 + run) * (len + D * 0.6) - D * 0.6;
      chainAt(ch, s0 < 0 ? 0 : s0, q.w);
      const s = s0 + D * f * (CP[2] < 0.999 ? 0.35 + 0.65 * CP[2] : 1);
      if (s < 0 || s > len) continue;
      chainAt(ch, s, q.w);
      const e = Math.min(1, s / ch.fin, (len - s) / ch.fout);
      const a = q.a * Math.sin(f * Math.PI) * (e < 0 ? 0 : e) * (1 - CP[3]);
      if (a < 0.01) continue;
      const l = q.len * (0.6 + 0.4 * CP[2]), ax = CP[0], ay = CP[1];
      chainAt(ch, Math.min(len, s + l * 0.5), q.w); const mx = CP[0], my = CP[1];
      chainAt(ch, Math.min(len, s + l), q.w);
      L.lineWidth = q.lw; L.globalAlpha = a; L.beginPath(); L.moveTo(ax, ay); L.quadraticCurveTo(mx, my, CP[0], CP[1]); L.stroke();
    }
  }
  function drawWaterMotion(g, t, k, vx0, vy0, vx1, vy1) {
    if (maskDirty || !maskStill) { buildMasks(); wvStale = true; }
    if (!layer || layer.width !== view.width || layer.height !== view.height) { layer = layer || document.createElement('canvas'); layer.width = view.width; layer.height = view.height; lctx = layer.getContext('2d'); }
    if (!ripplePat) ripplePat = lctx.createPattern(makeRipples(), 'repeat');
    if (!CHAINS) CHAINS = riverChains();
    const ox = view.width / 2 - cam.x * k, oy = view.height / 2 - cam.y * k;
    const L = lctx;
    // each pass: cleared and clipped to its water's part of the view, drawn in world px, masked, laid over the map
    const begin = (R) => { L.setTransform(1, 0, 0, 1, 0, 0); L.globalCompositeOperation = 'source-over'; L.globalAlpha = 1; L.clearRect(R[0], R[1], R[2] - R[0], R[3] - R[1]); L.save(); L.beginPath(); L.rect(R[0], R[1], R[2] - R[0], R[3] - R[1]); L.clip(); L.setTransform(k, 0, 0, k, ox, oy); };
    const end = (R, mask) => { L.globalAlpha = 1; L.globalCompositeOperation = 'destination-in'; L.drawImage(mask, GX0, GY0, MW, MH); L.restore(); g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(layer, R[0], R[1], R[2] - R[0], R[3] - R[1], R[0], R[1], R[2] - R[0], R[3] - R[1]); g.restore(); };
    // still water: the ripples drifting slowly two ways (the second layer mirrored, so the two never line up)
    let R = waterRect(1, k, ox, oy, vx0, vy0, vx1, vy1);
    if (R) {
      begin(R);
      // (v9: with a Waves treatment and any wind, the treatment's layer instead, and its waves on the shores after it)
      if (wavesOn()) drawStillWaves(L, t, k, ox, oy, R, vx0, vy0, vx1, vy1);
      else for (const [vx, vy, al, sx] of [[2.1, 0.7, 0.9, 0.5], [-1.4, 1.1, 0.65, -0.5]]) {
        ripplePat.setTransform(new DOMMatrix([sx, 0, 0, 0.5, (t * vx) % 384, (t * vy + 1.5 * Math.sin(t * 0.45 + al * 5)) % 192]));
        L.globalAlpha = al; L.fillStyle = ripplePat; L.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
      }
      end(R, maskStill);
      if (wavesOn()) drawShore(g, t, vx0, vy0, vx1, vy1);
    }
    // running water: the rivers' streaks (masked to all the water, so past a mouth they carry on into the lake) and the
    // cascades, each fall's frames with the next one laid over by how far the clock is past this one
    R = waterRect(2, k, ox, oy, vx0, vy0, vx1, vy1);
    if (R) {
      R = [R[0], R[1], R[2], R[3]];
      begin(R);
      const fp = t / FALL_SPF, fk = Math.floor(fp), fw = fp - fk, k0 = ((fk % FALL_FRAMES) + FALL_FRAMES) % FALL_FRAMES, k1 = (k0 + 1) % FALL_FRAMES;
      // (fix round of v8: a near fall's frames are its whole picture, the still's own but for the moving water, on the
      // ground's own raster and drawn as the ground is, so they go first and the rivers' streaks run on over them)
      L.imageSmoothingQuality = 'high';
      for (const fl of FALLS) {
        if (!fl.near) continue;
        const fr = fallFrames(fl);
        if (!fr.w || fr.x + fr.w < vx0 || fr.x > vx1 || fr.y + fr.h < vy0 || fr.y > vy1) continue;
        L.globalAlpha = 1; L.drawImage(fr.c[k0] || fallFrame(fl, k0), fr.x, fr.y, fr.w, fr.h);
        L.globalAlpha = fw; L.drawImage(fr.c[k1] || fallFrame(fl, k1), fr.x, fr.y, fr.w, fr.h);
      }
      L.imageSmoothingQuality = 'low'; L.globalAlpha = 1;
      L.lineCap = 'round'; L.strokeStyle = 'rgb(228,243,238)';
      for (const ch of CHAINS) {
        const b = ch.box;
        if (b[2] < vx0 || b[0] > vx1 || b[3] < vy0 || b[1] > vy1) continue;
        drawChain(L, ch, t);
      }
      for (const fl of FALLS) {
        if (fl.near) continue;
        if (fl.sil) {
          const sf = silFrames(fl);
          if (sf.w && sf.x + sf.w >= vx0 && sf.x <= vx1 && sf.y + sf.h >= vy0 && sf.y <= vy1) {
            L.globalAlpha = 1; L.drawImage(sf.c[k0] || silFrame(fl, k0), sf.x, sf.y, sf.w, sf.h);
            L.globalAlpha = fw; L.drawImage(sf.c[k1] || silFrame(fl, k1), sf.x, sf.y, sf.w, sf.h);
          }
        }
        if (fl.box[2] < vx0 || fl.box[0] > vx1 || fl.box[3] < vy0 || fl.box[1] > vy1) continue;
        const fr = fallFrames(fl);
        L.globalAlpha = 1; L.drawImage(fr.c[k0] || fallFrame(fl, k0), fr.x, fr.y, fr.w, fr.h);
        L.globalAlpha = fw; L.drawImage(fr.c[k1] || fallFrame(fl, k1), fr.x, fr.y, fr.w, fr.h);
      }
      end(R, maskRun);
    }
  }
  // ---------- Waves on still water (v9; the author's notes of 16 October, item 3: "the water animation is very good;
  // only on still water I would experiment with more waves, and, depending on the wind direction, with waves breaking
  // on the shore. Show me examples"). The Waves switch picks how the sea and the lakes move in the wind; rivers, falls,
  // mouths, the meltwater and the Ice channel keep v8's motion, and with Calm (or v8 picked) the still water is v8's
  // exactly. Each treatment follows WIND, its crests lying across the wind and travelling downwind, larger and faster
  // as it blows harder, and windGust's bands show on it as patches of darker, rougher water running downwind:
  // - Ripples: fine crests across the wind in two layers drifting downwind at two paces, denser and longer with
  //   strength, kept to the gusts: patches of them (cat's paws) run downwind over glassy water;
  // - Swell: a few long, slow crests lit on their windward side and shaded in their lee, over faint ripples. They
  //   slow down in the shallows
  //   (wavesDir: their phase is a travel time over the water, slower near the shore), so near it they bunch up, turn to
  //   meet it and bend round headlands, and they fade where they break;
  // - Chop: short, broken crests in two layers that cross at an angle and break each other up, and from Windy up small
  //   white caps that form and fade.
  // On the shores the wind blows toward, each wave breaks into a line of foam that runs up the beach or the bank and
  // draws back, leaving the sand behind it wet until it dries before the next one (drawShore). The swash follows the
  // waterline the painter drew (wavesShores), never reaches further up than its run-up, keeps out of river mouths, is
  // smaller on lakes (and on any shore with little open water upwind of it) and almost nothing where the wind blows
  // off the shore. Every effect is a function of the clock, so nothing loops or jumps, and of the map's own lines, so
  // nothing shows a tile edge.
  const WAVES = { v8: { hint: 'v8’s still water' }, ripples: { hint: 'wind ripples' }, swell: { hint: 'swell' }, chop: { hint: 'chop' } };
  let wavesName = 'swell';
  // Wave strength (v9.1): 'gentle' (the default) draws the open water's crests slighter and smaller than v9 did; 'v9' is v9's
  // open water exactly. c: how much of v9's contrast (the crests' and the gust tint's alpha), z: how much of its size (the
  // crests' length, width and wavelength; the swell's period goes with its wavelength, so its crests keep v9's speed), dn: the
  // crests' number in the ripples' and the chop's tile, cp: the share of v9's white caps (cc and zc: the chop's own contrast and stroke size). The shore's swash is v9's in both.
  let waveStr = 'gentle';
  const GENT = { c: 0.5, cc: 0.65, z: 2 / 3, zc: 0.55, dn: 1.2, cp: 0.5 };
  const wavesOn = () => wavesName !== 'v8' && WIND.strength > 0;
  // the fields' grid: a node every 4 world px across and 2 down, a square of 0.088 tile on the ground (the iso picture
  // halves the height), so distances and the waves' fronts come out the same in every direction
  const WVC = 4, WVR = 2, WVH = (WVC * Math.SQRT2) / 64;
  const WNI = Math.floor((GW - 1) / (WVC * SCALE)) + 1, WNJ = Math.floor((GH - 1) / (WVR * SCALE)) + 1, WNN = WNI * WNJ;
  let WVF = null, wvStale = true;
  // what the painter put at a world point: 1 still water, 2 a river's current, 3 a fall, 0 land, 255 off the raster
  const wmAt = (wx, wy) => { const gx = Math.round((wx - GX0) * SCALE), gy = Math.round((wy - GY0) * SCALE); return gx >= 0 && gy >= 0 && gx < GW && gy < GH ? WM[gy * GW + gx] : 255; };
  // past the map's edge (the open sea beyond it, for the fetch)
  const offMap = (wx, wy) => { const tx = wx / 64 + wy / 32, ty = wy / 32 - wx / 64; return tx < -0.5 || ty < -0.5 || tx > W - 0.5 || ty > H - 0.5; };
  // The fields that do not depend on the wind, made again only when a repaint changed the painter's water: K, what each
  // node is (1 still water, 2 other water, 0 land); D, how far it is from land (tiles; a river's water is not land);
  // the shorelines (wavesShores); the places white caps may form (a third of a tile and more from the shore)
  function wavesFields() {
    wvStale = false;
    let sig = 0;
    for (let p = 0; p < WM.length; p += 3) sig = (Math.imul(sig, 31) + WM[p] + 1) | 0;
    if (WVF && WVF.sig === sig) return WVF;
    const t0 = performance.now();
    const K = new Uint8Array(WNN), D = new Float32Array(WNN);
    for (let j = 0; j < WNJ; j++) for (let i = 0; i < WNI; i++) { const v = WM[j * WVR * SCALE * GW + i * WVC * SCALE]; K[j * WNI + i] = v === 1 ? 1 : v ? 2 : 0; }
    // two chamfer passes (steps of one node and of a diagonal)
    const d1 = WVH, d2 = WVH * Math.SQRT2;
    for (let n = 0; n < WNN; n++) D[n] = K[n] ? 9 : 0;
    for (let j = 0; j < WNJ; j++) for (let i = 0; i < WNI; i++) {
      const n = j * WNI + i; let d = D[n]; if (!d) continue;
      if (i > 0 && D[n - 1] + d1 < d) d = D[n - 1] + d1;
      if (j > 0) { const u = n - WNI; if (D[u] + d1 < d) d = D[u] + d1; if (i > 0 && D[u - 1] + d2 < d) d = D[u - 1] + d2; if (i < WNI - 1 && D[u + 1] + d2 < d) d = D[u + 1] + d2; }
      D[n] = d;
    }
    for (let j = WNJ - 1; j >= 0; j--) for (let i = WNI - 1; i >= 0; i--) {
      const n = j * WNI + i; let d = D[n]; if (!d) continue;
      if (i < WNI - 1 && D[n + 1] + d1 < d) d = D[n + 1] + d1;
      if (j < WNJ - 1) { const u = n + WNI; if (D[u] + d1 < d) d = D[u] + d1; if (i < WNI - 1 && D[u + 1] + d2 < d) d = D[u + 1] + d2; if (i > 0 && D[u - 1] + d2 < d) d = D[u - 1] + d2; }
      D[n] = d;
    }
    const t1 = performance.now();
    const lines = wavesShores();
    // white caps: a site about every 0.6 tile of open water, jittered, at least 0.35 tile from the shore
    const caps = [];
    for (let j = 3; j < WNJ; j += 7) for (let i = 3; i < WNI; i += 7) {
      const h = hash2(i, j, 71), ii = Math.min(WNI - 1, i + Math.round((hash2(i, j, 72) - 0.5) * 6)), jj = Math.min(WNJ - 1, j + Math.round((h - 0.5) * 6)), n = jj * WNI + ii;
      if (K[n] === 1 && D[n] >= 0.35) caps.push(GX0 + ii * WVC, GY0 + jj * WVR, caps.length / 3 + 1);
    }
    WVF = { sig, K, D, lines, caps: Float32Array.from(caps), dirs: {}, ms: { grid: Math.round(t1 - t0), shores: Math.round(performance.now() - t1) } };
    return WVF;
  }
  // The shorelines of the still water, as the painter drew them: the line where half of each world px's four raster px
  // are still water (marching squares over the whole raster), chained into polylines, smoothed a little (the raster's
  // steps) and sampled every 3 world px. Each point knows the way up the shore on the ground (gx, gy) and on screen
  // (nx, ny: world px for a tile up the shore), how far it is along its line (s), whether it is a shore at all (st:
  // 0 beside a river's current, so the swash fades out at a mouth), what the land is (tr: sand takes the longest
  // run-up, rock and paving the least), whether it is a lake's (bd), how much water lies off it (ws, so a breaker never
  // reaches the far side of a channel) and how much land lies behind it (wl, so the swash never crosses a spit).
  function wavesShores() {
    const C = new Uint8Array(MW * MH);
    for (let y = 0; y < MH; y++) {
      const r0 = 2 * y * GW, r1 = r0 + GW;
      for (let x = 0; x < MW; x++) { const g2 = 2 * x; C[y * MW + x] = (WM[r0 + g2] === 1) + (WM[r0 + g2 + 1] === 1) + (WM[r1 + g2] === 1) + (WM[r1 + g2 + 1] === 1); }
    }
    const TH = 1.5, ept = new Map(), PX = [], ADJ = [];
    const pt = (id, x, y) => { let q = ept.get(id); if (q === undefined) { q = PX.length / 2; ept.set(id, q); PX.push(x, y); ADJ.push(-1, -1); } return q; };
    const link = (a, b) => { if (ADJ[2 * a] < 0) ADJ[2 * a] = b; else ADJ[2 * a + 1] = b; if (ADJ[2 * b] < 0) ADJ[2 * b] = a; else ADJ[2 * b + 1] = a; };
    for (let y = 0; y < MH - 1; y++) for (let x = 0; x < MW - 1; x++) {
      const o = y * MW + x, a = C[o], b = C[o + 1], c = C[o + MW + 1], d = C[o + MW];
      const cs = (a > TH ? 1 : 0) | (b > TH ? 2 : 0) | (c > TH ? 4 : 0) | (d > TH ? 8 : 0);
      if (cs === 0 || cs === 15) continue;
      const X = GX0 + x + 0.5, Y = GY0 + y + 0.5;
      const top = () => pt(2 * o, X + (TH - a) / (b - a), Y), right = () => pt(2 * (o + 1) + 1, X + 1, Y + (TH - b) / (c - b));
      const bot = () => pt(2 * (o + MW), X + (TH - d) / (c - d), Y + 1), left = () => pt(2 * o + 1, X, Y + (TH - a) / (d - a));
      switch (cs) {
        case 1: case 14: link(left(), top()); break;
        case 2: case 13: link(top(), right()); break;
        case 3: case 12: link(left(), right()); break;
        case 4: case 11: link(right(), bot()); break;
        case 6: case 9: link(top(), bot()); break;
        case 7: case 8: link(left(), bot()); break;
        case 5: link(left(), top()); link(right(), bot()); break;
        case 10: link(top(), right()); link(bot(), left()); break;
      }
    }
    const NP = PX.length / 2, seen = new Uint8Array(NP), out = [];
    const walk = (s0) => {
      const ch = [s0]; seen[s0] = 1; let prev = -1, cur = s0;
      for (;;) {
        const a = ADJ[2 * cur], b = ADJ[2 * cur + 1];
        const nx = a >= 0 && a !== prev && !seen[a] ? a : b >= 0 && b !== prev && !seen[b] ? b : -1;
        if (nx < 0) break;
        seen[nx] = 1; ch.push(nx); prev = cur; cur = nx;
      }
      return ch;
    };
    for (let pass = 0; pass < 2; pass++) for (let q = 0; q < NP; q++) {
      if (seen[q] || (pass === 0 && ADJ[2 * q] >= 0 && ADJ[2 * q + 1] >= 0)) continue; // open lines first, from an end
      const ch = walk(q);
      if (ch.length < 10) continue;
      const last = ch[ch.length - 1], closed = pass === 1 && (ADJ[2 * last] === q || ADJ[2 * last + 1] === q);
      const ln = shoreLine(ch, PX, closed);
      if (ln) out.push(ln);
    }
    return out;
  }
  function shoreLine(ch, PX, closed) {
    let n = ch.length, xs = new Float64Array(n), ys = new Float64Array(n);
    for (let q = 0; q < n; q++) { xs[q] = PX[2 * ch[q]]; ys[q] = PX[2 * ch[q] + 1]; }
    // smoothed (the raster's half-pixel steps), the ends of an open line kept
    for (let pass = 0; pass < 6; pass++) {
      const ax = xs.slice(), ay = ys.slice();
      for (let q = 0; q < n; q++) {
        let a = q - 1, b = q + 1;
        if (closed) { a = (a + n) % n; b = b % n; } else if (a < 0 || b >= n) continue;
        xs[q] = (ax[a] + 2 * ax[q] + ax[b]) / 4; ys[q] = (ay[a] + 2 * ay[q] + ay[b]) / 4;
      }
    }
    // sampled every 3 world px along it
    const SP = 3, rx = [xs[0]], ry = [ys[0]];
    let acc = 0;
    const m = closed ? n + 1 : n;
    for (let q = 1; q < m; q++) {
      const x0 = xs[(q - 1) % n], y0 = ys[(q - 1) % n], x1 = xs[q % n], y1 = ys[q % n], l = Math.hypot(x1 - x0, y1 - y0);
      let u = SP - acc;
      while (u <= l) { rx.push(x0 + ((x1 - x0) * u) / l); ry.push(y0 + ((y1 - y0) * u) / l); u += SP; }
      acc = l - (u - SP);
    }
    if (closed && rx.length > 2 && Math.hypot(rx[rx.length - 1] - rx[0], ry[ry.length - 1] - ry[0]) < SP * 0.5) { rx.pop(); ry.pop(); }
    n = rx.length;
    if (n < 5) return null;
    const L = { n, closed, x: Float32Array.from(rx), y: Float32Array.from(ry), nx: new Float32Array(n), ny: new Float32Array(n), gx: new Float32Array(n), gy: new Float32Array(n), s: new Float32Array(n), st: new Float32Array(n), tr: new Float32Array(n), bd: new Float32Array(n), ws: new Float32Array(n), wl: new Float32Array(n), sx: new Float32Array(n), sy: new Float32Array(n), chunks: [] };
    // the line smoothed further (about 18 world px each way): the swash follows it the further it runs from the waterline,
    // so the painter's small wiggles never fold the foam into zigzags
    smoothAlong(L.x, L.sx, n, closed, 6); smoothAlong(L.y, L.sy, n, closed, 6);
    // the way up the shore: square to the line on the ground, toward the side that is not still water (a vote along
    // the whole line, so a narrow spot never turns it round)
    let vote = 0;
    for (let q = 0; q < n; q++) {
      const a = closed ? (q - 2 + n) % n : Math.max(0, q - 2), b = closed ? (q + 2) % n : Math.min(n - 1, q + 2);
      const sx = L.sx[b] - L.sx[a], sy = L.sy[b] - L.sy[a];
      let gx = -(sy / 32 - sx / 64), gy = sx / 64 + sy / 32; // the ground tangent turned a quarter
      const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;
      L.gx[q] = gx; L.gy[q] = gy; L.nx[q] = (gx - gy) * 32; L.ny[q] = (gx + gy) * 16;
      L.s[q] = q * SP;
      const v = wmAt(L.x[q] + L.nx[q] * 0.12, L.y[q] + L.ny[q] * 0.12);
      if (v === 1) vote--; else if (v !== 255) vote++;
    }
    if (vote < 0) for (let q = 0; q < n; q++) { L.gx[q] = -L.gx[q]; L.gy[q] = -L.gy[q]; L.nx[q] = -L.nx[q]; L.ny[q] = -L.ny[q]; }
    // (fix round of v9) the smoothed line kept within 3.5 world px of the waterline: it only irons out the painter's small
    // wiggles, and never cuts across the water of a notch or over the land of a spit's tip or a corner where two shores meet
    for (let q = 0; q < n; q++) {
      const dx = L.sx[q] - L.x[q], dy = L.sy[q] - L.y[q], dl = Math.hypot(dx, dy);
      if (dl > 3.5) { L.sx[q] = L.x[q] + (dx * 3.5) / dl; L.sy[q] = L.y[q] + (dy * 3.5) / dl; }
    }
    const wet = { [M.BEACH]: 1, [M.SAND]: 1, [M.DESERT]: 1, [M.WET]: 1, [M.BANK]: 0.7, [M.GRASS]: 0.6, [M.FOREST]: 0.55, [M.TAIGA]: 0.55, [M.ROCK]: 0.45, [M.HIGHROCK]: 0.4, [M.CITY]: 0.45 };
    const tileOf = (wx, wy) => { const tx = Math.round(wx / 64 + wy / 32), ty = Math.round(wy / 32 - wx / 64); return inb(tx, ty) ? idx(tx, ty) : -1; };
    const riv = new Float32Array(n), swv = new Float32Array(n);
    for (let q = 0; q < n; q++) {
      const x = L.x[q], y = L.y[q], nx = L.nx[q], ny = L.ny[q];
      let r = 0;
      for (const f of [0.06, 0.14, 0.24]) { const v = wmAt(x + nx * f, y + ny * f); if (v === 2 || v === 3) r = 1; }
      for (const f of [0.06, 0.2]) { const v = wmAt(x - nx * f, y - ny * f); if (v === 2 || v === 3) r = 1; }
      // (fix round of v9) no shore at all where the water runs off the board: its land side is past the map's edge
      for (const f of [0.1, 0.2, 0.35]) { const lx = x + nx * f, ly = y + ny * f; if (offMap(lx, ly) || wmAt(lx, ly) === 255) r = 1; }
      riv[q] = r;
      const tl = tileOf(x + nx * 0.18, y + ny * 0.18), ts = tileOf(x - nx * 0.2, y - ny * 0.2);
      L.tr[q] = tl >= 0 ? (wet[MAT[tl]] ?? 0.6) : 0.6;
      L.bd[q] = ts >= 0 && map[ts].kind === 'lake' ? 0.6 : 1;
      // (merge, v9) the swamp coast (Coast: Swamp): its mangroves and mud take most of the waves, so they come in low
      // and run a short way up the mud, as on a bank (applied below, eased along the line)
      swv[q] = SWAMP.on ? bil(SWF, x / 64 + y / 32, y / 32 - x / 64) : 0;
      let f = 0.03; for (; f < 0.9; f += 0.03) if (wmAt(x - nx * f, y - ny * f) !== 1) break;
      L.ws[q] = f;
      f = 0.03; for (; f < 0.6; f += 0.03) if (wmAt(x + nx * f, y + ny * f) === 1) break;
      L.wl[q] = f;
    }
    // (fix round of v9) the swamp's share eased along the shore over about a tile each way (two box passes of 10 points),
    // so where the swamp's mud line meets a beach its damping, and its fainter foam (fm), fade in and out over a tile
    // rather than at a corner of the waterline
    L.fm = new Float32Array(n).fill(1);
    if (SWAMP.on) {
      const a = new Float32Array(n); smoothAlong(swv, a, n, closed, 10); smoothAlong(a, swv, n, closed, 10);
      for (let q = 0; q < n; q++) { const sw = swv[q]; if (sw > 0.01) { L.tr[q] += (0.5 - L.tr[q]) * sw; L.bd[q] *= 1 - 0.6 * sw; L.fm[q] = 1 - 0.7 * sw; } }
    }
    // beside a river's current (and along the board's edge) no swash, fading in over about 20 world px either side of it
    const stp = new Float32Array(n);
    for (let q = 0; q < n; q++) { let r = 0; for (let d = -4; d <= 4; d++) { const p = closed ? (q + d + n) % n : q + d; if (p >= 0 && p < n && riv[p]) r = 1; } stp[q] = 1 - r; }
    smoothAlong(stp, L.st, n, closed, 4);
    const trs = L.tr.slice(); smoothAlong(trs, L.tr, n, closed, 3);
    // the room off and behind the shore, eased along it (the least over 4 points either side, then averaged)
    for (const F of [L.ws, L.wl]) {
      const mn = new Float32Array(n);
      for (let q = 0; q < n; q++) { let v = 9; for (let d = -4; d <= 4; d++) { const p = closed ? (q + d + n) % n : q + d; if (p >= 0 && p < n && F[p] < v) v = F[p]; } mn[q] = v; }
      smoothAlong(mn, F, n, closed, 4);
    }
    // chunks of 40 segments with their boxes (padded by the farthest a swash reaches), for culling
    for (let q0 = 0; q0 < (closed ? n : n - 1); q0 += 40) {
      const q1 = Math.min(closed ? n : n - 1, q0 + 40);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let q = q0; q <= q1; q++) { const p = q % n; if (L.x[p] < x0) x0 = L.x[p]; if (L.x[p] > x1) x1 = L.x[p]; if (L.y[p] < y0) y0 = L.y[p]; if (L.y[p] > y1) y1 = L.y[p]; }
      L.chunks.push([q0, q1, x0 - 18, y0 - 12, x1 + 18, y1 + 12]);
    }
    return L;
  }
  // a box filter of radius r along a line
  function smoothAlong(src, dst, n, closed, r) {
    for (let q = 0; q < n; q++) {
      let s = 0, c = 0;
      for (let d = -r; d <= r; d++) { let p = q + d; if (closed) p = (p + n) % n; else if (p < 0 || p >= n) continue; s += src[p]; c++; }
      dst[q] = s / c;
    }
  }
  // a node's value at a world point, bilinear over the nodes that have one (NaN where none does)
  function gridAt(F, wx, wy) {
    const fi = (wx - GX0) / WVC, fj = (wy - GY0) / WVR, i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= WNI - 1 || j >= WNJ - 1) return NaN;
    const u = fi - i, v = fj - j, n = j * WNI + i;
    let s = 0, w = 0;
    const add = (m, k) => { const f = F[m]; if (f === f && f !== Infinity && k > 0) { s += f * k; w += k; } };
    add(n, (1 - u) * (1 - v)); add(n + 1, u * (1 - v)); add(n + WNI, (1 - u) * v); add(n + WNI + 1, u * v);
    return w > 1e-6 ? s / w : NaN;
  }
  // a box blur (radius r nodes, passes times each way) over the still water's nodes only
  function blurStill(F, K, r, passes) {
    const tmp = new Float32Array(WNN), w = 2 * r + 1;
    for (let pass = 0; pass < passes; pass++) {
      for (let j = 0; j < WNJ; j++) {
        const r0 = j * WNI; let s = 0, c = 0;
        for (let i = 0; i < WNI + r; i++) {
          if (i < WNI && K[r0 + i] === 1) { s += F[r0 + i]; c++; }
          const b = i - w; if (b >= 0 && K[r0 + b] === 1) { s -= F[r0 + b]; c--; }
          const o = i - r; if (o >= 0 && o < WNI) tmp[r0 + o] = c ? s / c : 0;
        }
      }
      for (let i = 0; i < WNI; i++) {
        let s = 0, c = 0;
        for (let j = 0; j < WNJ + r; j++) {
          if (j < WNJ && K[j * WNI + i] === 1) { s += tmp[j * WNI + i]; c++; }
          const b = j - w; if (b >= 0 && K[b * WNI + i] === 1) { s -= tmp[b * WNI + i]; c--; }
          const o = j - r; if (o >= 0 && o < WNJ && K[o * WNI + i] === 1) F[o * WNI + i] = c ? s / c : 0;
        }
      }
    }
  }
  // The fields for the wind's direction (kept for each of the eight once made):
  // F, the fetch: how much open water lies upwind of each node (tiles, up to 10; open sea past the map's edge);
  // A, how big the waves are there: they grow with the fetch, spread a little into the lee (blurred) and are smaller on
  //   lakes (by their fetch);
  // S, the waves' phase: how far a wave front has come over the water (in tiles of open water), from the upwind edge of
  //   each water. A travel time (fast marching over the grid) at a speed that drops in the shallows, so near the shore
  //   fronts lag, bunch up and turn to meet it, and bend round a headland. A wave crest is wherever S / its wavelength
  //   less the clock over its period is a whole number;
  // and for each shoreline, at each point: E, how hard the waves come in (onshore wind, fetch, river mouths), and PS,
  //   the phase there.
  function wavesDir() {
    const key = WIND.from;
    if (WVF.dirs[key]) return WVF.dirs[key];
    const t0 = performance.now();
    const { K, D } = WVF, tox = WIND.toTile.x, toy = WIND.toTile.y, ux = (tox - toy) * 32, uy = (tox + toy) * 16;
    const F = new Float32Array(WNN), A = new Float32Array(WNN), S = new Float32Array(WNN).fill(Infinity);
    const FC = 10, FS = 0.25;
    for (let j = 0; j < WNJ; j++) for (let i = 0; i < WNI; i++) {
      const n = j * WNI + i; if (K[n] !== 1) continue;
      let x = GX0 + i * WVC, y = GY0 + j * WVR, f = 0;
      for (; f < FC; f += FS) { x -= ux * FS; y -= uy * FS; const v = wmAt(x, y); if (v === 1 || v === 2) continue; if (v === 255 || offMap(x, y)) f = FC; break; }
      F[n] = f;
      // (a lake's waves smaller again: its water is shallower and sheltered)
      const nx0 = GX0 + i * WVC, ny0 = GY0 + j * WVR, tx = Math.round(nx0 / 64 + ny0 / 32), ty = Math.round(ny0 / 32 - nx0 / 64);
      A[n] = (1 - Math.exp(-f / 4)) * (inb(tx, ty) && map[idx(tx, ty)].kind === 'lake' ? 0.6 : 1);
    }
    // blurred over the still water only (two box passes each way, radius 5 nodes), so a lee fills in a little
    blurStill(A, K, 5, 2);
    // the phase: fast marching from the still water's upwind edges, where it starts as a plane wave
    const SL = new Float32Array(WNN), known = new Uint8Array(WNN);
    let still = 0;
    for (let n = 0; n < WNN; n++) if (K[n] === 1) { still++; SL[n] = WVH / Math.sqrt(Math.tanh(Math.max(0.03, D[n]) / 0.9)); }
    let cap = still * 4 + 1024, HI = new Int32Array(cap), HK = new Float64Array(cap), hn = 0;
    const push = (n, k) => {
      if (hn >= cap) { cap *= 2; const a = new Int32Array(cap), b = new Float64Array(cap); a.set(HI); b.set(HK); HI = a; HK = b; }
      let c = hn++;
      while (c > 0) { const p = (c - 1) >> 1; if (HK[p] <= k) break; HI[c] = HI[p]; HK[c] = HK[p]; c = p; }
      HI[c] = n; HK[c] = k;
    };
    const pop = () => {
      const top = HI[0], ln = HI[--hn], lk = HK[hn];
      let c = 0;
      for (;;) { let m = 2 * c + 1; if (m >= hn) break; if (m + 1 < hn && HK[m + 1] < HK[m]) m++; if (HK[m] >= lk) break; HI[c] = HI[m]; HK[c] = HK[m]; c = m; }
      HI[c] = ln; HK[c] = lk;
      return top;
    };
    const bi = (-ux * WVH * 1.5) / WVC, bj = (-uy * WVH * 1.5) / WVR;
    for (let j = 0; j < WNJ; j++) for (let i = 0; i < WNI; i++) {
      const n = j * WNI + i; if (K[n] !== 1) continue;
      const ui = Math.round(i + bi), uj = Math.round(j + bj);
      if (ui >= 0 && uj >= 0 && ui < WNI && uj < WNJ && K[uj * WNI + ui] === 1) continue;
      const wx = GX0 + i * WVC, wy = GY0 + j * WVR;
      S[n] = (wx / 64 + wy / 32) * tox + (wy / 32 - wx / 64) * toy; push(n, S[n]);
    }
    const solve = (m) => {
      const mi = m % WNI;
      let a = Infinity, b = Infinity;
      if (mi > 0 && known[m - 1]) a = S[m - 1];
      if (mi < WNI - 1 && known[m + 1] && S[m + 1] < a) a = S[m + 1];
      if (m >= WNI && known[m - WNI]) b = S[m - WNI];
      if (m + WNI < WNN && known[m + WNI] && S[m + WNI] < b) b = S[m + WNI];
      if (a > b) { const q = a; a = b; b = q; }
      const f = SL[m];
      if (b === Infinity || b - a >= f) return a + f;
      return (a + b + Math.sqrt(2 * f * f - (b - a) * (b - a))) / 2;
    };
    while (hn) {
      const n = pop(); if (known[n]) continue; known[n] = 1;
      const i = n % WNI;
      for (let q = 0; q < 4; q++) {
        const m = q === 0 ? (i > 0 ? n - 1 : -1) : q === 1 ? (i < WNI - 1 ? n + 1 : -1) : q === 2 ? n - WNI : n + WNI;
        if (m < 0 || m >= WNN || known[m] || K[m] !== 1) continue;
        const v = solve(m); if (v < S[m]) { S[m] = v; push(m, v); }
      }
    }
    // smoothed (where fronts from two shores meet they would fold in a sharp V; the waves bend there instead), and
    // warped a little by a slow noise (fixed in place, as if by the bottom), so no crest is a ruled line
    blurStill(S, K, 4, 2);
    for (let n = 0; n < WNN; n++) {
      if (S[n] === Infinity) continue;
      const x = GX0 + (n % WNI) * WVC, y = GY0 + ((n / WNI) | 0) * WVR, gx = x / 64 + y / 32, gy = y / 32 - x / 64;
      S[n] += 0.55 * (vnoise((gx * -toy + gy * tox) * 0.28 + 31, (gx * tox + gy * toy) * 0.11 + 17) - 0.5);
    }
    // carried three nodes onto the land beside it (by its neighbours' mean), so a crest reaches the painted waterline
    for (let pass = 0; pass < 3; pass++) {
      const ch = [];
      for (let n = 0; n < WNN; n++) {
        if (S[n] !== Infinity) continue;
        const i = n % WNI; let s = 0, a = 0, c = 0;
        for (const m of [i > 0 ? n - 1 : -1, i < WNI - 1 ? n + 1 : -1, n - WNI, n + WNI]) if (m >= 0 && m < WNN && S[m] !== Infinity) { s += S[m]; a += A[m]; c++; }
        if (c) ch.push(n, s / c, a / c);
      }
      for (let q = 0; q < ch.length; q += 3) { S[ch[q]] = ch[q + 1]; A[ch[q]] = ch[q + 2]; }
    }
    // the shores: how hard the waves come in at each point, and their phase there
    const lines = WVF.lines.map((L) => {
      const n = L.n, E = new Float32Array(n), PS = new Float32Array(n), e0 = new Float32Array(n);
      for (let q = 0; q < n; q++) {
        const on = L.gx[q] * tox + L.gy[q] * toy, onf = sstep((on + 0.12) / 0.72);
        const x = L.x[q], y = L.y[q];
        let amp = gridAt(A, x - L.nx[q] * 0.14, y - L.ny[q] * 0.14); if (amp !== amp) amp = 0;
        let ps = gridAt(S, x - L.nx[q] * 0.03, y - L.ny[q] * 0.03); if (ps !== ps) ps = (x / 64 + y / 32) * tox + (y / 32 - x / 64) * toy;
        e0[q] = onf * amp * L.bd[q] * L.st[q]; PS[q] = ps;
      }
      smoothAlong(e0, E, n, L.closed, 3);
      return { E, PS };
    });
    const dd = { F, A, S, lines, ms: Math.round(performance.now() - t0) };
    WVF.dirs[key] = dd;
    return dd;
  }
  // ----- the open water
  // a treatment's settings at the wind's strength s: its crest tiles (kind, layers: pace, seed, turn, alpha), how the
  // gusts show (a darker tint of the water under them, a faint sheen in the lulls, and with a base under 0.2, the
  // ripples', its crests kept at base + gain x gust), and its shore
  // (wavelength and period of its rhythm, run-up and breaker reach in tiles, how much foam, water film and wet sand,
  // and how irregular it is)
  function wvParams() {
    const P = wvParams0();
    if (waveStr !== 'gentle') return P;
    const G = GENT, c = P.kind === 'chop' ? G.cc : G.c; // (the chop's strokes are thinner when smaller, so it keeps a little more alpha)
    P.tint *= c; P.sheen *= c;
    P.layers = P.layers.map(([pace, seed, turn, al]) => [pace, seed, turn, al * c]);
    P.z = P.kind === 'chop' ? G.zc : G.z; P.dn = G.dn;
    if (P.swell) P.swell = { lam: P.swell.lam * G.z, T: P.swell.T * G.z, z: G.z, c: G.c };
    if (P.caps) P.caps = { z: G.z, p: G.cp };
    return P;
  }
  function wvParams0() {
    const s = WIND.strength, w = wavesName;
    if (w === 'ripples') return { kind: 'rip', pace: 0.1 + 0.26 * s, layers: [[1, 11, 0, 1], [0.68, 23, 0.12, 0.85]], base: 0.06, gain: 0.94, tint: 0.16 + 0.1 * s, sheen: 0.07,
      shore: { lam: 0.42, T: 2.3 - 0.7 * s, R: 0.035 + 0.09 * s, B: 0.08 + 0.08 * s, ua: 0.3, foam: 0.75, film: 0.7, wet: 0.55, jit: 0.12 } };
    if (w === 'swell') {
      const lam = 1.3 + 1.1 * s, T = 3.4 + 1.2 * s;
      return { kind: 'rip', pace: 0.08 + 0.14 * s, layers: [[1, 11, 0, 0.2]], base: 0.3, gain: 0.7, tint: 0.06 + 0.04 * s, sheen: 0.02, swell: { lam, T },
        shore: { lam, T, R: 0.06 + 0.2 * s, B: 0.16 + 0.22 * s, ua: 0.32, foam: 1, film: 1, wet: 1, jit: 0.05 } };
    }
    return { kind: 'chop', pace: 0.16 + 0.3 * s, layers: [[1, 31, 0, 0.95], [1.35, 47, 0.38, 0.85]], base: 0.45, gain: 0.55, tint: 0.08 + 0.06 * s, sheen: 0.03, caps: s >= 0.6,
      shore: { lam: 0.6, T: 2.1 - 0.6 * s, R: 0.04 + 0.13 * s, B: 0.1 + 0.12 * s, ua: 0.3, foam: 0.9, film: 0.75, wet: 0.7, jit: 0.45 } };
  }
  // A periodic tile of crests across the wind, 384 x 192 world px drawn at the painter's 2 px each (as v8's ripples):
  // each crest a short stroke square to the wind on the ground, bowed downwind, lit, with its darker trough just
  // downwind of it; in loose clusters, so some water is rougher than the rest. Ripples are fine and long; chop is
  // shorter, thicker, broken in two and turned this way and that. turn: the whole tile turned off the wind (radians).
  const WV_TILES = new Map();
  function crestTile(kind, seed, turn, z = 1, dn = 1) {
    const s = WIND.strength, key = `${kind}|${WIND.from}|${WIND.level}|${seed}|${turn}|${z}|${dn}`;
    let e = WV_TILES.get(key);
    if (e) { WV_TILES.delete(key); WV_TILES.set(key, e); return e; }
    const ct = Math.cos(turn), sn = Math.sin(turn), ax = WIND.toTile.x * ct - WIND.toTile.y * sn, ay = WIND.toTile.x * sn + WIND.toTile.y * ct;
    const Ux = (ax - ay) * 32, Uy = (ax + ay) * 16, Vx = (-ay - ax) * 32, Vy = (-ay + ax) * 16; // a tile downwind and a tile across it, on screen
    const c = document.createElement('canvas'); c.width = 768; c.height = 384;
    const x = c.getContext('2d'), r = makeRng(seed);
    x.scale(2, 2); x.lineCap = 'round';
    const TW = 384, TH = 192, chop = kind === 'chop';
    const n = Math.round(((TW * TH) / 1024) * (chop ? 2.2 + 3.4 * s : 3 + 8 * s) * dn);
    const cl = []; for (let k = 0; k < 12; k++) cl.push([r() * TW, r() * TH, 0.45 + 0.55 * r()]);
    const st = [];
    for (let k = 0; k < n; k++) {
      let px, py, w;
      if (r() < (chop ? 0.85 : 0.75)) { const q = cl[k % cl.length]; px = q[0] + (r() - 0.5) * 96; py = q[1] + (r() - 0.5) * 48; w = q[2]; } else { px = r() * TW; py = r() * TH; w = 0.5; }
      const l = (chop ? 0.07 + 0.08 * s + 0.06 * r() : 0.07 + 0.16 * s + 0.08 * r()) * z, tw = (r() - 0.5) * (chop ? 1.2 : 0.25);
      const c2 = Math.cos(tw), s2 = Math.sin(tw), cx = Vx * c2 + Ux * s2, cy = Vy * c2 + Uy * s2; // across, turned by tw
      const a = (chop ? 0.3 + 0.3 * r() : 0.2 + 0.3 * r()) * w;
      if (chop) { const g = 0.12 + 0.2 * r(); st.push([px - cx * l * 0.55, py - cy * l * 0.55, cx * l * (0.5 - g / 2), cy * l * (0.5 - g / 2), a]); st.push([px + cx * l * g / 2, py + cy * l * g / 2, cx * l * (0.5 - g / 2), cy * l * (0.5 - g / 2), a * (0.6 + 0.4 * r())]); }
      else st.push([px - (cx * l) / 2, py - (cy * l) / 2, cx * l, cy * l, a]);
    }
    const bow = chop ? 0.36 : 0.38, dk = chop ? 0.05 : 0.035;
    for (const dark of [true, false]) {
      x.lineWidth = (dark ? (chop ? 1.9 : 0.9) : chop ? 1.2 : 0.8) * z;
      for (const [sx, sy, dx, dy, a] of st) {
        const l = Math.hypot(dx / 32, dy / 16) / Math.SQRT2 || 0.1, ox = dark ? Ux * dk : 0, oy = dark ? Uy * dk : 0;
        x.strokeStyle = dark ? `rgba(14,46,60,${(a * 0.62).toFixed(3)})` : `rgba(212,238,232,${a.toFixed(3)})`;
        for (const [qx, qy] of [[0, 0], [-TW, 0], [TW, 0], [0, -TH], [0, TH], [-TW, -TH], [TW, -TH], [-TW, TH], [TW, TH]]) {
          const x0 = sx + ox + qx, y0 = sy + oy + qy;
          if (x0 > TW + 40 || x0 < -40 - Math.abs(dx) || y0 > TH + 24 || y0 < -24 - Math.abs(dy)) continue;
          x.beginPath(); x.moveTo(x0, y0); x.quadraticCurveTo(x0 + dx / 2 + Ux * l * bow, y0 + dy / 2 + Uy * l * bow, x0 + dx, y0 + dy); x.stroke();
        }
      }
    }
    e = { c, pat: null, Ux: (WIND.toTile.x - WIND.toTile.y) * 32, Uy: (WIND.toTile.x + WIND.toTile.y) * 16 };
    WV_TILES.set(key, e);
    while (WV_TILES.size > 14) WV_TILES.delete(WV_TILES.keys().next().value);
    return e;
  }
  // the gusts over the part of the view being drawn, a cell every 16 world px or more: an alpha the crests are kept by
  // (base + gain x gust), and a dark tint where it gusts with a light sheen where it lulls
  const GC_W = 200, GC_H = 128;
  let gcA = null, gcT = null, giA = null, giT = null;
  function gustLayers(t, wx0, wy0, wx1, wy1, base, gain, tint, sheen) {
    if (!gcA) {
      const mk = () => { const c = document.createElement('canvas'); c.width = GC_W; c.height = GC_H; return c; };
      gcA = mk(); gcT = mk(); giA = new ImageData(GC_W, GC_H); giT = new ImageData(GC_W, GC_H);
    }
    const C = Math.max(16, Math.ceil((wx1 - wx0) / (GC_W - 3)), Math.ceil((wy1 - wy0) / (GC_H - 3)));
    const x0 = Math.floor(wx0 / C) * C - C, y0 = Math.floor(wy0 / C) * C - C;
    const cw = Math.min(GC_W, Math.ceil((wx1 - x0) / C) + 2), ch = Math.min(GC_H, Math.ceil((wy1 - y0) / C) + 2);
    const a = giA.data, b = giT.data, s = WIND.strength;
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      const g0 = windGust(x0 + (i + 0.5) * C, y0 + (j + 0.5) * C, t), o = (j * GC_W + i) * 4;
      a[o + 3] = 255 * Math.min(1, base + gain * g0);
      if (g0 > 0.45) { b[o] = 10; b[o + 1] = 34; b[o + 2] = 46; b[o + 3] = 255 * tint * sstep((g0 - 0.45) / 0.5) * (0.5 + 0.5 * s); }
      else { b[o] = 150; b[o + 1] = 196; b[o + 2] = 200; b[o + 3] = 255 * sheen * sstep((0.45 - g0) / 0.35); }
    }
    gcA.getContext('2d').putImageData(giA, 0, 0, 0, 0, cw, ch); gcT.getContext('2d').putImageData(giT, 0, 0, 0, 0, cw, ch);
    return [x0, y0, cw, ch, C];
  }
  // segments and quads gathered by how opaque they are (WB_N steps), so each step is one path
  const WB_N = 16;
  const mkBuckets = (k) => Array.from({ length: WB_N + 1 }, () => ({ n: 0, k, a: new Float32Array(512 * k) }));
  const bPush = (B, al, v0, v1, v2, v3, v4, v5, v6, v7) => {
    let q = Math.round(al * WB_N); if (q <= 0) return; if (q > WB_N) q = WB_N;
    const b = B[q], k = b.k;
    if ((b.n + 1) * k > b.a.length) { const a = new Float32Array(b.a.length * 2); a.set(b.a); b.a = a; }
    const a = b.a, o = b.n++ * k;
    a[o] = v0; a[o + 1] = v1; a[o + 2] = v2; a[o + 3] = v3; if (k > 4) { a[o + 4] = v4; a[o + 5] = v5; } if (k > 6) { a[o + 6] = v6; a[o + 7] = v7; }
  };
  const bClear = (B) => { for (const b of B) b.n = 0; };
  // stroke a bucket set of segments (x0 y0 x1 y1 [dx dy]), each moved by off along its (dx, dy)
  function bStroke(L, B, colour, width, alpha, off) {
    L.strokeStyle = colour; L.lineWidth = width;
    for (let q = 1; q <= WB_N; q++) {
      const b = B[q]; if (!b.n) continue;
      const a = b.a, k = b.k;
      L.beginPath();
      // (a segment that starts where the one before it ended carries on its line, so their ends never overlap)
      let lx = NaN, ly = NaN;
      for (let p = 0, o = 0; p < b.n; p++, o += k) {
        const dx = k > 4 ? a[o + 4] * off : 0, dy = k > 4 ? a[o + 5] * off : 0;
        if (a[o] !== lx || a[o + 1] !== ly) L.moveTo(a[o] + dx, a[o + 1] + dy);
        L.lineTo(a[o + 2] + dx, a[o + 3] + dy); lx = a[o + 2]; ly = a[o + 3];
      }
      L.globalAlpha = Math.min(1, (q / WB_N) * alpha); L.stroke();
    }
    L.globalAlpha = 1;
  }
  function bFill(L, B, colour, alpha) {
    L.fillStyle = colour;
    for (let q = 1; q <= WB_N; q++) {
      const b = B[q]; if (!b.n) continue;
      const a = b.a;
      L.beginPath();
      for (let p = 0, o = 0; p < b.n; p++, o += 8) { L.moveTo(a[o], a[o + 1]); L.lineTo(a[o + 2], a[o + 3]); L.lineTo(a[o + 4], a[o + 5]); L.lineTo(a[o + 6], a[o + 7]); L.closePath(); }
      L.globalAlpha = Math.min(1, (q / WB_N) * alpha); L.fill();
    }
    L.globalAlpha = 1;
  }
  const WB_CAP = mkBuckets(6), WB_DOT = mkBuckets(4);
  // The still water's layer for the treatment, drawn in world px into the still-water pass of drawWaterMotion (which
  // masks it to the still water): the crest tiles drifting downwind, kept by the gusts, a darker tint under the
  // gusts, then the swell's crests or the chop's white caps.
  function drawStillWaves(L, t, k, ox, oy, R, vx0, vy0, vx1, vy1) {
    if (wvStale || !WVF) wavesFields();
    const P = wvParams();
    const wx0 = Math.max(vx0, (R[0] - ox) / k), wy0 = Math.max(vy0, (R[1] - oy) / k), wx1 = Math.min(vx1, (R[2] - ox) / k), wy1 = Math.min(vy1, (R[3] - oy) / k);
    for (const [pace, seed, turn, al] of P.layers) {
      const e = crestTile(P.kind, seed, turn, P.z, P.dn);
      if (!e.pat) e.pat = L.createPattern(e.c, 'repeat');
      const d = t * P.pace * pace, ex = (((e.Ux * d) % 384) + 384) % 384, ey = (((e.Uy * d) % 192) + 192) % 192;
      e.pat.setTransform(new DOMMatrix([0.5, 0, 0, 0.5, ex, ey]));
      L.globalAlpha = al; L.fillStyle = e.pat; L.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
    }
    L.globalAlpha = 1;
    const [gx0, gy0, cw, ch, C] = gustLayers(t, wx0, wy0, wx1, wy1, P.base, P.gain, P.tint, P.sheen);
    L.imageSmoothingEnabled = true; L.imageSmoothingQuality = 'low';
    // (only the ripples are kept by the gusts; the swell's and the chop's show them by the tint alone, a pass less)
    if (P.base < 0.2) { L.globalCompositeOperation = 'destination-in'; L.drawImage(gcA, 0, 0, cw, ch, gx0, gy0, cw * C, ch * C); }
    L.globalCompositeOperation = 'destination-over'; L.drawImage(gcT, 0, 0, cw, ch, gx0, gy0, cw * C, ch * C);
    L.globalCompositeOperation = 'source-over';
    if (P.swell) drawSwell(L, t, P.swell, wx0, wy0, wx1, wy1);
    if (P.caps) drawCaps(L, t, wx0, wy0, wx1, wy1, P.caps);
  }
  // The swell's crests: where S / lam - t / T is a whole number, each lit on its windward side and shaded on its lee, as
  // strong as the waves are there (A), in long stretches that come and go along each crest, a little brighter where they
  // rise in the shallows and gone where they break (the shore's foam takes over). (Fix round of v9: drawn as a soft
  // field, not as strokes: for each cell of a small grid over the view, about 4 screen px, how far it is from the nearest
  // crest across it (the phase over its gradient, in world px) gives the light on the face and the shade in the lee, laid
  // over the water smoothly scaled up. So a crest is one continuous band with no joints, and below zoom 1.6 its bands keep
  // their width on screen, broad and soft; the crest's fine top line fades out from zoom 1.8 to 1.2.)
  const SWG_W = 480, SWG_H = 320;
  let swgC = null, swgI = null;
  function drawSwell(L, t, sw, wx0, wy0, wx1, wy1) {
    const dd = wavesDir(), S = dd.S, A = dd.A, D = WVF.D;
    if (!swgC) { swgC = document.createElement('canvas'); swgC.width = SWG_W; swgC.height = SWG_H; swgI = new ImageData(SWG_W, SWG_H); }
    const z = cam.z, il = 1 / sw.lam, ph = t / sw.T, tox = WIND.toTile.x, toy = WIND.toTile.y, sk = WIND.strength;
    const C = Math.max(4 / (z * dpr), (wx1 - wx0) / (SWG_W - 3), (wy1 - wy0) / (SWG_H - 3));
    const x0 = Math.floor(wx0 / C) * C - C, y0 = Math.floor(wy0 / C) * C - C;
    const cw = Math.min(SWG_W, Math.ceil((wx1 - x0) / C) + 2), ch = Math.min(SWG_H, Math.ceil((wy1 - y0) / C) + 2);
    const zs = sw.z || 1, cs = sw.c || 1, ws = Math.max(1, 1.6 / z) * zs, top = sstep((z - 1.2) / 0.6), o = swgI.data;
    for (let jy = 0; jy < ch; jy++) {
      const y = y0 + (jy + 0.5) * C, fj = (y - GY0) / WVR, j = Math.floor(fj), v = fj - j;
      for (let ix = 0; ix < cw; ix++) {
        const x = x0 + (ix + 0.5) * C, p = (jy * SWG_W + ix) * 4;
        o[p + 3] = 0;
        // the phase (bilinear over the nodes) and its gradient (world px), where all four nodes have one
        const fi = (x - GX0) / WVC, i = Math.floor(fi);
        if (i < 0 || j < 0 || i >= WNI - 1 || j >= WNJ - 1) continue;
        const u = fi - i, nn = j * WNI + i, a = S[nn], b = S[nn + 1], cc = S[nn + WNI], dd4 = S[nn + WNI + 1];
        if (a === Infinity || b === Infinity || cc === Infinity || dd4 === Infinity) continue;
        const f = (a + (b - a) * u + (cc - a + (a - b - cc + dd4) * u) * v) * il - ph;
        const gxp = ((b - a) * (1 - v) + (dd4 - cc) * v) * il / WVC, gyp = ((cc - a) * (1 - u) + (dd4 - b) * u) * il / WVR;
        const gm = Math.hypot(gxp, gyp); if (gm < 1e-5) continue;
        const c = Math.round(f), wl = Math.min(ws, 0.043 / gm), d = (f - c) / gm / wl; // world px from the crest (- upwind), in band widths
        if (d < -10.5 || d > 5) continue;
        const amp = gridAt(A, x, y), dep = gridAt(D, x, y);
        if (!(amp > 0.01) || dep !== dep) continue;
        const shoal = sstep((dep - 0.03) / 0.22) * (1 + 0.7 * (1 - sstep(dep / 0.9)));
        const across = (x / 64 + y / 32) * -toy + (y / 32 - x / 64) * tox;
        const run = sstep((vnoise((across * 0.6) / zs + c * 3.17, c * 1.93) - 0.3) / 0.36);
        const al = amp * shoal * run * (0.55 + 0.45 * sk) * cs;
        if (al < 0.03) continue;
        // the face: lit up to the crest, brightest just below its top; the lee: shade just past it; the top: a fine line
        const lit = al * (0.12 + 0.18 * sstep((d + 5.5) / 4)) * sstep((d + 10.4) / 2.2) * sstep((0.7 - d) / 1.3);
        const tl = top > 0 ? top * 0.62 * al * sstep((vnoise((across * 3.1) / zs + c * 5.3, c * 0.71 + 9) - 0.32) / 0.22) * Math.max(0, 1 - Math.abs(d + 0.3) / (0.9 / wl)) : 0;
        const dk = al * 0.26 * sstep(d / 1.1) * sstep((4.3 - d) / 1.7);
        const la = Math.min(1, lit + tl), da = dk * (1 - la), A_ = la + da;
        if (A_ < 0.004) continue;
        const wt = la > 0 ? tl / (lit + tl) : 0;
        o[p] = (la * (152 + 56 * wt) + da * 8) / A_; o[p + 1] = (la * (208 + 28 * wt) + da * 36) / A_; o[p + 2] = (la * (207 + 25 * wt) + da * 50) / A_;
        o[p + 3] = 255 * Math.min(1, A_);
      }
    }
    swgC.getContext('2d').putImageData(swgI, 0, 0, 0, 0, cw, ch);
    L.imageSmoothingEnabled = true; L.imageSmoothingQuality = 'low';
    L.drawImage(swgC, 0, 0, cw, ch, x0, y0, cw * C, ch * C);
  }
  // the chop's white caps (from Windy up): at each site, now and then, a small white crest forms, drifts downwind a
  // little and fades, a few flecks of spray trailing it; more of them in the gusts and in a storm
  function drawCaps(L, t, wx0, wy0, wx1, wy1, P_caps) {
    const cs = WVF.caps, s = WIND.strength, tox = WIND.toTile.x, toy = WIND.toTile.y;
    const Ux = (tox - toy) * 32, Uy = (tox + toy) * 16, Vx = (-toy - tox) * 32, Vy = (-toy + tox) * 16;
    bClear(WB_CAP); bClear(WB_DOT);
    const cg = typeof P_caps === 'object' && P_caps ? P_caps : null, cz = cg ? cg.z : 1, p0 = (s - 0.45) * 1.1 * (cg ? cg.p : 1);
    for (let q = 0; q < cs.length; q += 3) {
      const sx = cs[q], sy = cs[q + 1], id = cs[q + 2];
      if (sx < wx0 - 20 || sx > wx1 + 20 || sy < wy0 - 12 || sy > wy1 + 12) continue;
      const Tc = 2.4 + 1.8 * hash2(id, 1, 73), c = t / Tc + hash2(id, 2, 73), m = Math.floor(c), f = c - m;
      if (f > 0.5) continue;
      if (hash2(id, m, 74) > p0 * (0.45 + 1.1 * windGust(sx, sy, t))) continue;
      const a = sstep(f / 0.07) * (1 - sstep((f - 0.1) / 0.4));
      if (a < 0.03) continue;
      const jx = (hash2(id, m, 75) - 0.5) * 0.5, jy = (hash2(id, m, 76) - 0.5) * 0.5, dr = 0.05 + 0.22 * f; // tiles
      const x = sx + Ux * (jx + dr) + Vx * jy, y = sy + Uy * (jx + dr) + Vy * jy, l = (0.08 + 0.08 * hash2(id, m, 77) + 0.05 * s) * cz;
      bPush(WB_CAP, a, x - Vx * l * 0.5, y - Vy * l * 0.5, x + Vx * l * 0.5, y + Vy * l * 0.5, Ux * 0.02, Uy * 0.02);
      for (let k = 0; k < 3; k++) { const u = 0.04 + 0.05 * k + 0.12 * f, v = (hash2(id, m, 80 + k) - 0.5) * l; bPush(WB_DOT, a * (0.8 - 0.2 * k), x + Ux * u + Vx * v, y + Uy * u + Vy * v, (0.7 + 0.5 * hash2(id, m, 90 + k)) * cz, 0); }
    }
    L.lineCap = 'round';
    bStroke(L, WB_CAP, 'rgb(20,52,64)', 2.4 * cz, 0.35, 1.2 * cz);
    bStroke(L, WB_CAP, 'rgb(214,232,228)', 3.4 * cz, 0.35, -0.3 * cz);
    bStroke(L, WB_CAP, 'rgb(226,236,232)', 1.7 * cz, 0.95 * (cg ? 0.8 : 1), 0);
    L.fillStyle = 'rgb(222,234,230)';
    for (let q = 1; q <= WB_N; q++) {
      const b = WB_DOT[q]; if (!b.n) continue;
      L.beginPath(); for (let p = 0, o = 0; p < b.n; p++, o += 4) { L.moveTo(b.a[o] + b.a[o + 2], b.a[o + 1]); L.arc(b.a[o], b.a[o + 1], b.a[o + 2], 0, 6.2832); }
      L.globalAlpha = (q / WB_N) * 0.8; L.fill();
    }
    L.globalAlpha = 1; L.lineCap = 'butt';
  }
  // ----- the shore
  // One wave's swash at u, its phase (0 as it reaches the waterline; from -ua it comes in and breaks): SW[0] where its
  // foam line is (up the shore as a share of the run-up, or out on the water as a share of the breaker's reach when
  // negative), SW[1] how much foam, SW[2] how far its film of water reaches up the shore (share of the run-up), SW[3] how
  // far up the sand is still wet behind it (the same share; the sand dries from the top down until the next wave). Its
  // foam runs up fast and slows, the water draws back slower and the foam thins out on the way; every term is
  // continuous, and 0 at both ends. (Drying narrows the wet strip rather than fading it, so each layer is drawn at one
  // opacity and the shore's strips never show where one stretch meets the next.)
  const SW = new Float64Array(4);
  function swashAt(u, ua) {
    SW[0] = SW[1] = SW[2] = SW[3] = 0;
    if (u < -ua || u >= 1.3) return;
    if (u < 0) { const q = (u + ua) / ua; SW[0] = -(1 - q); SW[1] = sstep(q / 0.45) * (0.45 + 0.55 * q); return; }
    SW[3] = u < 0.3 ? 1 - (1 - u / 0.3) * (1 - u / 0.3) : 1 - sstep((u - 0.42) / 0.88);
    if (u < 0.3) { const q = u / 0.3; SW[0] = SW[2] = 1 - (1 - q) * (1 - q); SW[1] = 1; return; }
    if (u < 0.82) { const q = (u - 0.3) / 0.52; SW[0] = SW[2] = 1 - sstep(q); SW[1] = 1 - sstep(Math.min(1, q * 1.3)); }
  }
  const WB_FOAM = mkBuckets(4), WB_CLOT = mkBuckets(4), WB_TRAIL = mkBuckets(4);
  // a point off the shoreline: off tiles up the shore (negative: out on the water), drawn from the smoothed line the
  // further it is from the waterline (exactly on it at 0); into AT
  const AT = new Float64Array(2);
  function shoreAt(L, p, off) {
    const w = Math.min(1, Math.abs(off) / 0.08), x = L.x[p] + (L.sx[p] - L.x[p]) * w, y = L.y[p] + (L.sy[p] - L.y[p]) * w;
    AT[0] = x + L.nx[p] * off; AT[1] = y + L.ny[p] * off;
  }
  const SV = { e: new Float32Array(64), ps: new Float32Array(64), R: new Float32Array(64), B: new Float32Array(64), fk: new Float32Array(64), wet: new Float32Array(64), film: new Float32Array(64) };
  // The waves on the shores, drawn in world px straight over the ground (it reaches up the land, so it is not masked
  // to the water; ws and wl keep it in its own strip): the wet sand, the water film running up and back, the foam
  // line at its front and broken foam behind the breaker. Each wave is one event along a whole stretch of shore,
  // meeting it where the wave's phase says (straight shores facing the wind all at once, others in a run along them).
  function drawShore(g, t, vx0, vy0, vx1, vy1) {
    if (wvStale || !WVF) wavesFields();
    const P = wvParams().shore, dd = wavesDir();
    bClear(WB_FOAM); bClear(WB_CLOT); bClear(WB_TRAIL);
    const pWet = new Path2D(), pWet2 = new Path2D(), pFilm = new Path2D(), pFilm2 = new Path2D(), rb = [1e9, 1e9, -1e9, -1e9];
    const il = 1 / P.lam, ph = t / P.T, ua = P.ua;
    for (let li = 0; li < WVF.lines.length; li++) {
      const L = WVF.lines[li], ld = dd.lines[li], n = L.n;
      for (const [q0, q1, bx0, by0, bx1, by1] of L.chunks) {
        if (bx1 < vx0 || bx0 > vx1 || by1 < vy0 || by0 > vy1) continue;
        let emax = 0; for (let q = q0; q <= q1; q++) { const e = ld.E[q % n]; if (e > emax) emax = e; }
        if (emax < 0.02) continue;
        // each point's energy, phase, run-up and breaker reach now, and how far up the shore it is wet and how far
        // the water runs (the most of the waves on it)
        let wmax = 0;
        for (let q = q0; q <= q1; q++) {
          const p = q % n, o = q - q0, e = ld.E[p];
          SV.e[o] = e; SV.wet[o] = 0; SV.film[o] = 0;
          if (e < 0.01) { SV.R[o] = SV.B[o] = SV.fk[o] = 0; continue; }
          const gu = windGust(L.x[p], L.y[p], t);
          const ps = (SV.ps[o] = ld.PS[p] * il - ph + P.jit * (2 * vnoise(L.s[p] * 0.016 + li * 7.7, t * 0.09) - 1));
          const R = (SV.R[o] = Math.min(P.R * Math.pow(e, 0.6) * L.tr[p] * (0.82 + 0.36 * gu), 0.45 * L.wl[p]));
          SV.B[o] = Math.min(P.B * Math.sqrt(e), 0.45 * L.ws[p]);
          SV.fk[o] = sstep(e / 0.22) * (0.8 + 0.2 * gu);
          for (let m = Math.floor(ps - 1.3) + 1; m <= Math.floor(ps + ua); m++) {
            swashAt(ps - m, ua); const big = R * (0.8 + 0.4 * hash2(m, li, 61));
            if (SW[3] * big > SV.wet[o]) SV.wet[o] = SW[3] * big;
            if (SW[2] * big > SV.film[o]) SV.film[o] = SW[2] * big;
          }
          if (SV.wet[o] > wmax) wmax = SV.wet[o];
        }
        // the wet sand (darker below, a lighter rim at its top) and the water film: one ribbon each along the chunk,
        // from the waterline up the shore, so a strip never shows where one stretch meets the next
        if (wmax > 0.002) {
          for (const [path, F, k] of [[pWet, SV.wet, 1], [pWet2, SV.wet, 0.68], [pFilm, SV.film, 1], [pFilm2, SV.film, 0.5]]) {
            path.moveTo(L.x[q0 % n], L.y[q0 % n]);
            for (let q = q0 + 1; q <= q1; q++) path.lineTo(L.x[q % n], L.y[q % n]);
            for (let q = q1; q >= q0; q--) { shoreAt(L, q % n, F[q - q0] * k); path.lineTo(AT[0], AT[1]); if (AT[0] < rb[0]) rb[0] = AT[0]; if (AT[1] < rb[1]) rb[1] = AT[1]; if (AT[0] > rb[2]) rb[2] = AT[0]; if (AT[1] > rb[3]) rb[3] = AT[1]; }
            path.closePath();
          }
          for (let q = q0; q <= q1; q++) { const x = L.x[q % n], y = L.y[q % n]; if (x < rb[0]) rb[0] = x; if (y < rb[1]) rb[1] = y; if (x > rb[2]) rb[2] = x; if (y > rb[3]) rb[3] = y; }
        }
        // the foam: each wave's own line, at its front as it comes in, runs up and draws back
        for (let q = q0; q < q1; q++) {
          const oa = q - q0, ob = oa + 1, ea = SV.e[oa], eb = SV.e[ob];
          if (ea < 0.01 && eb < 0.01) continue;
          const pa = q % n, pb = (q + 1) % n;
          const psa = ea < 0.01 ? SV.ps[ob] : SV.ps[oa], psb = eb < 0.01 ? psa : SV.ps[ob];
          const Ra = SV.R[oa], Rb = SV.R[ob], Ba = SV.B[oa], Bb = SV.B[ob], fa = SV.fk[oa], fb = SV.fk[ob];
          const mlo = Math.floor(Math.min(psa, psb) - 1.3) + 1, mhi = Math.floor(Math.max(psa, psb) + ua);
          const sm = (L.s[pa] + L.s[pb]) / 2;
          for (let m = mlo; m <= mhi; m++) {
            const big = 0.8 + 0.4 * hash2(m, li, 61);
            swashAt(psa - m, ua); const a0 = SW[0], a1 = SW[1];
            swashAt(psb - m, ua); const b0 = SW[0], b1 = SW[1];
            // lacy: broken up along the shore (each wave its own way), in clots
            const fo = ((a1 * fa + b1 * fb) / 2) * P.foam * (L.fm[pa] + L.fm[pb]) * 0.5;
            if (fo < 0.03) continue;
            const lace = sstep((vnoise(sm * 0.075 + m * 13.7, m * 5.31 + li) - 0.2) / 0.42) * (0.55 + 0.45 * vnoise(sm * 0.33, m * 2.1));
            const clot = sstep((vnoise(sm * 0.21 + m * 7.9, m * 3.7 + 2) - 0.52) / 0.2);
            shoreAt(L, pa, a0 >= 0 ? a0 * Ra * big : a0 * Ba); const o0 = AT[0], o1 = AT[1]; shoreAt(L, pb, b0 >= 0 ? b0 * Rb * big : b0 * Bb);
            bPush(WB_FOAM, fo * lace, o0, o1, AT[0], AT[1]);
            if (clot > 0.03) bPush(WB_CLOT, fo * lace * clot, o0, o1, AT[0], AT[1]);
            // broken white water left behind the breaker, out on the water
            const ua_ = psa - m, ub_ = psb - m;
            if (ua_ > 0 && ua_ < 0.75) {
              const tr = (1 - sstep(ua_ / 0.75)) * sstep((vnoise(sm * 0.14 + m * 3.3, m * 1.7 + 4) - 0.35) / 0.3);
              if (tr > 0.03) { shoreAt(L, pa, -Ba * (0.3 + 0.5 * sstep(ua_ / 0.4))); const t0 = AT[0], t1 = AT[1]; shoreAt(L, pb, -Bb * (0.3 + 0.5 * sstep(ub_ / 0.4))); bPush(WB_TRAIL, tr * fo, t0, t1, AT[0], AT[1]); }
            }
          }
        }
      }
    }
    g.save();
    // (fix round of v9) the wet sand and the water film are laid on the land only: each drawn into the water pass's layer
    // (free again by now), the still water cut out of it by its mask, then laid over the map. The wet sand darkens the
    // ground under it (a warm brown laid thin: a darker, warmer sand, never a grey), most toward the water; the film is a
    // light sheen, thicker in its lower half, so the water running up reads as water and not as a smear
    if (rb[2] > rb[0]) {
      const m = g.getTransform(), k = m.a, ox = m.e, oy = m.f;
      const X0 = Math.max(0, Math.floor(rb[0] * k + ox) - 2), Y0 = Math.max(0, Math.floor(rb[1] * k + oy) - 2);
      const X1 = Math.min(view.width, Math.ceil(rb[2] * k + ox) + 2), Y1 = Math.min(view.height, Math.ceil(rb[3] * k + oy) + 2);
      if (X1 > X0 && Y1 > Y0) {
        const Lc = lctx;
        const pass = (fills, op) => {
          Lc.setTransform(1, 0, 0, 1, 0, 0); Lc.globalCompositeOperation = 'source-over'; Lc.globalAlpha = 1; Lc.clearRect(X0, Y0, X1 - X0, Y1 - Y0);
          Lc.save(); Lc.beginPath(); Lc.rect(X0, Y0, X1 - X0, Y1 - Y0); Lc.clip(); Lc.setTransform(k, 0, 0, k, ox, oy);
          for (const [path, colour, a] of fills) { Lc.fillStyle = colour; Lc.globalAlpha = a; Lc.fill(path); }
          // (only the part of the mask under the ribbons, a few px wider)
          const mx0 = Math.max(0, Math.floor((X0 - ox) / k - GX0) - 2), my0 = Math.max(0, Math.floor((Y0 - oy) / k - GY0) - 2);
          const mx1 = Math.min(MW, Math.ceil((X1 - ox) / k - GX0) + 2), my1 = Math.min(MH, Math.ceil((Y1 - oy) / k - GY0) + 2);
          Lc.globalAlpha = 1; Lc.globalCompositeOperation = 'destination-out'; Lc.imageSmoothingEnabled = true;
          if (mx1 > mx0 && my1 > my0) Lc.drawImage(maskStill, mx0, my0, mx1 - mx0, my1 - my0, GX0 + mx0, GY0 + my0, mx1 - mx0, my1 - my0);
          Lc.restore();
          g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = op; g.drawImage(layer, X0, Y0, X1 - X0, Y1 - Y0, X0, Y0, X1 - X0, Y1 - Y0);
          g.globalCompositeOperation = 'source-over'; g.setTransform(m);
        };
        pass([[pWet, 'rgb(122,84,40)', 0.17 * P.wet], [pWet2, 'rgb(122,84,40)', 0.13 * P.wet], [pFilm, 'rgb(176,218,212)', 0.15 * P.film], [pFilm2, 'rgb(120,176,176)', 0.14 * P.film]], 'source-over');
      }
    }
    g.globalAlpha = 1; g.lineCap = 'round';
    bStroke(g, WB_TRAIL, 'rgb(214,232,228)', 1.1, 0.5, 0);
    bStroke(g, WB_FOAM, 'rgb(220,234,230)', 2.8, 0.3, 0);
    bStroke(g, WB_CLOT, 'rgb(224,236,232)', 2.2, 0.75, 0);
    bStroke(g, WB_FOAM, 'rgb(228,238,234)', 1, 0.9, 0);
    g.restore();
  }
  // the Waves switch (v9): its buttons, the hint line, and __demo.setWaves
  function setWaves(name) {
    if (!(name in WAVES)) throw new Error(`no waves ${name}`);
    wavesName = name;
    for (const b of document.querySelectorAll('[data-waves]')) b.setAttribute('aria-pressed', String(b.dataset.waves === name));
    dirty = true; hint.textContent = hintText();
    return name;
  }
  const wavesHint = () => (wavesName === 'v8' ? 'Waves: v8' : `Waves: ${WAVES[wavesName].hint}${wavesName === 'swell' ? ' (default)' : ''}${waveStr === 'gentle' ? ', gentle' : ', v9’s strength'}${WIND.strength ? '' : ', still as v8’s while calm'}`);
  // the Wave strength switch (v9.1): Gentle (default) or v9 (v9's open water as published)
  function setWaveStrength(name) {
    if (name !== 'gentle' && name !== 'v9') throw new Error(`no wave strength ${name}`);
    waveStr = name;
    for (const b of document.querySelectorAll('[data-wstr]')) b.setAttribute('aria-pressed', String(b.dataset.wstr === name));
    dirty = true; hint.textContent = hintText();
    return name;
  }
  for (const b of document.querySelectorAll('[data-wstr]')) b.addEventListener('click', () => setWaveStrength(b.dataset.wstr));
  for (const b of document.querySelectorAll('[data-waves]')) b.addEventListener('click', () => setWaves(b.dataset.waves));
  // the frames still to make, made a few at a time while the page is idle, so a fall never stops the drawing the first
  // time its loop comes round
  let framesJob = 0;
  function warmFrames() {
    if (framesJob || !state.anim) return;
    const todo = [];
    for (const f of FALLS) {
      const fr = fallFrames(f); for (let k = 0; k < FALL_FRAMES; k++) if (!fr.c[k]) todo.push(() => fr.c[k] || fallFrame(f, k));
      if (f.sil) { const sf = silFrames(f); if (sf.w) for (let k = 0; k < FALL_FRAMES; k++) if (!sf.c[k]) todo.push(() => sf.c[k] || silFrame(f, k)); }
    }
    const step = () => { const t1 = performance.now() + 12; while (todo.length && performance.now() < t1) todo.shift()(); framesJob = todo.length ? setTimeout(step, 30) : 0; };
    if (todo.length) framesJob = setTimeout(step, 30);
  }
  // a fall's moving water, as frames laid over the painted ground (masked to its water like the rivers' streaks): the
  // sheet runs down the slope 5 texels a frame (Codex's 20 px per 0.28 s, in steps a quarter as long) and flecks of foam
  // drift off downstream. Each frame is the fall's ground sampled from the slope (fallAt), once per raster px (a far
  // fall's; fix round of v8: a near fall's frames are its whole picture, made again from the painter's points, nearFrames)
  const FALL_FRAMES = 16, FALL_SPF = 0.07;
  function fallFrames(f) {
    if (f.frames) return f.frames;
    if (f.near) return nearFrames(f);
    const [x0, y0, x1, y1] = f.box, cw = Math.ceil((x1 - x0) * SCALE), ch = Math.ceil((y1 - y0) * SCALE);
    // what moves: the sheet from its brink (none over a far edge) and the flecks past the foot; one sample per raster px
    const pts = [], st = 1 / 150, seen = new Uint8Array(cw * ch);
    for (let al = f.near ? -f.w / 2 - 0.03 : f.w / 2 - 0.17; al <= f.w / 2 + 0.6; al += st) for (let ac = -0.47; ac <= 0.47; ac += st) {
      const tx = f.mx + f.dx * al - f.dy * ac, ty = f.my + f.dy * al + f.dx * ac, z = heightAt(tx, ty);
      const px = Math.floor(((tx - ty) * 32 - x0) * SCALE), py = Math.floor(((tx + ty) * 16 - z - y0) * SCALE), o = py * cw + px;
      if (px >= 0 && px < cw && py >= 0 && py < ch && !seen[o]) { seen[o] = 1; pts.push(tx, ty, z, o); }
    }
    f.frames = { c: new Array(FALL_FRAMES).fill(null), pts, cw, ch, x: x0, y: y0, w: cw / SCALE, h: ch / SCALE };
    return f.frames;
  }
  function fallFrame(f, k) {
    if (f.near) return nearFrame(f, k);
    const { pts, cw, ch } = f.frames, cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const x = cv.getContext('2d'), im = x.createImageData(cw, ch), d = im.data;
    for (let q = 0; q < pts.length; q += 4) {
      fallAt(f, pts[q], pts[q + 1], pts[q + 2], k * (80 / FALL_FRAMES), true);
      if (FA[3] <= 0.01) continue;
      const o = pts[q + 3] * 4; d[o] = FA[0]; d[o + 1] = FA[1]; d[o + 2] = FA[2]; d[o + 3] = FA[3] * 255;
    }
    x.putImageData(im, 0, 0);
    return (f.frames.c[k] = cv);
  }
  // Fix round of v8: a near fall's frames, from its record of the painter's points (fallRec). They cover the points
  // where its sheet or its foam is (FMOV), on the ground's own raster, and each is the painter's picture there made
  // again: the ground before the falls (FB), the falls of the point's tile laid over it as shadeAt lays them, its wet
  // rock, spray, pool, rings and the foam spilling over a lip all as the still has them, with only the sheet and the
  // foam moved on (fallAt with ph > 0: 5 texels a frame, and both come round after 16). Frame 0 is the still.
  function nearFrames(f) {
    const R = f.rec;
    if (!R) return (f.frames = { c: [], w: 0 });
    const P = R.P, idx = [];
    for (let i = 0, n = R.cw * R.ch; i < n; i++) {
      const o = i * 8, tx = P[o];
      if (tx !== tx) continue;
      FALL_WQ = P[o + 7]; fallAt(f, tx, P[o + 1], P[o + 2], 0, false);
      if (FMOV > 0) idx.push(i);
    }
    return (f.frames = { c: new Array(FALL_FRAMES).fill(null), idx: Int32Array.from(idx), cw: R.cw, ch: R.ch, x: GX0 + R.gx0 / SCALE, y: GY0 + R.gy0 / SCALE, w: R.cw / SCALE, h: R.ch / SCALE });
  }
  function nearFrame(f, k) {
    const F = fallFrames(f);
    if (!F.w) return null;
    const R = f.rec, P = R.P, ph = k * (80 / FALL_FRAMES), cv = document.createElement('canvas'); cv.width = F.cw; cv.height = F.ch;
    const x = cv.getContext('2d'), im = x.createImageData(F.cw, F.ch), d = im.data;
    for (let q = 0; q < F.idx.length; q++) {
      const i = F.idx[q], o = i * 8, tx = P[o], ty = P[o + 1], z = P[o + 2], wyg = P[o + 3], rv = P[o + 7], wx = GX0 + (R.gx0 + (i % R.cw)) / SCALE;
      let oR = P[o + 4], oG = P[o + 5], oB = P[o + 6];
      const tile = Math.max(0, Math.min(H - 1, Math.round(ty) | 0)) * W + Math.max(0, Math.min(W - 1, Math.round(tx) | 0));
      // (as shadeAt lays the falls over the ground: every near fall at this frame, a far one as the still has it)
      for (const g of FALLP[tile] || []) {
        FALL_WQ = rv;
        fallAt(g, tx, ty, z, g.near ? ph : 0, false);
        if (FALL_DK > 0) { const kd = 1 - FALL_DK * sstep((oR + oG + oB - 150) / 210); oR *= kd; oG *= kd * 1.02; oB *= kd; }
        const fa = FA[3];
        if (fa > 0.004) { oR += (FA[0] - oR) * fa; oG += (FA[1] - oG) * fa; oB += (FA[2] - oB) * fa; }
        if (g.near && g.lip !== null) {
          const ka = lipSpill(g, tx, ty, z, wx, wyg);
          if (LS_DK > 0) { const kd = 1 - LS_DK; oR *= kd; oG *= kd * 1.02; oB *= kd; }
          if (ka > 0.004) { oR += (LSC[0] - oR) * ka; oG += (LSC[1] - oG) * ka; oB += (LSC[2] - oB) * ka; }
        }
      }
      if (oR > 190 && oG > 190 && oB > 190) { oR = soft(oR, CAP_R + 6); oG = soft(oG, CAP_G + 4); oB = soft(oB, CAP_B + 2); }
      const p = i * 4; d[p] = oR > 255 ? 255 : oR; d[p + 1] = oG > 255 ? 255 : oG; d[p + 2] = oB > 255 ? 255 : oB; d[p + 3] = 255;
    }
    x.putImageData(im, 0, 0);
    return (F.c[k] = cv);
  }
  function drawFaceImage(g, e, frame, cx, cyLow, edge, d) {
    const fw = e.frames ? e.frames.w : e.w, fh = e.frames ? e.frames.h : e.h;
    let a, b, c, dd, ex, fy;
    if (edge === 'sw') { a = 0.5 + 0.4 / d; b = 0.25 - (10 * d + 8) / (40 * d); c = -0.8 / d; dd = (10 * d + 8) / (20 * d); ex = cx - 24; fy = cyLow - 10 * d - 4; }
    else { a = 0.5 + 0.4 / d; b = -0.25 + (10 * d + 8) / (40 * d); c = 0.8 / d; dd = (10 * d + 8) / (20 * d); ex = cx - 8 - 25.6 / d; fy = cyLow - 10 * d + 12 - ((10 * d + 8) * 1.6) / d; }
    g.save(); g.transform(a, b, c, dd, ex, fy);
    g.drawImage(IMG[e.atlas], e.x + frame * fw, e.y, fw, fh, 0, 0, fw, fh);
    g.restore();
  }
  function drawFace(g, f, t) {
    const c = f.c, n = f.n;
    const cx = (c.x - c.y) * 32, cyLow = (c.x + c.y) * 16 - n.level * LEVEL;
    const e = CX[f.key];
    const frame = e.frames ? e.frames.order[Math.floor(t / e.frames.secondsPerFrame) % e.frames.order.length] : 0;
    drawFaceImage(g, e, frame, cx, cyLow, f.edge, f.d);
    if (f.kind === 'ice') drawFaceImage(g, CX[f.portal], 0, cx, cyLow, f.edge, 1);
    if (f.foam) {
      const fe = CX[f.foam];
      g.save();
      const pulse = still ? 1 : 0.85 + 0.15 * Math.sin(t * 5 + c.x);
      g.globalAlpha = pulse;
      if (f.edge === 'se') g.drawImage(IMG[fe.atlas], fe.x, fe.y, fe.w, fe.h, cx + 8, cyLow + 4, fe.w / 2, fe.h / 2);
      else if (f.mirror) { g.translate(cx - 8, cyLow + 4); g.scale(-1, 1); g.drawImage(IMG[fe.atlas], fe.x, fe.y, fe.w, fe.h, 0, 0, fe.w / 2, fe.h / 2); }
      else g.drawImage(IMG[fe.atlas], fe.x, fe.y, fe.w, fe.h, cx - 8 - fe.anchor[0] / 2, cyLow + 4, fe.w / 2, fe.h / 2);
      g.restore();
    }
  }
  // walkers along their routes: each leg is a smooth path along the road's own centre line, found in the road
  // picture on each tile (the organic roads wander), a little to the right of it (0.035 tile; v2 kept 0.08 to the
  // right of the tile's middle, so on a wandering road they walked on its edge), its corners rounded (radius 0.32
  // tile). The figure moves at a calm, steady pace (0.4 tile/s), its walk cycle steps with the distance it has walked
  // (a frame every 0.0825 tile, so the feet never slide), and it faces where it walks: the front view going down the
  // screen, the back view going up, mirrored when it heads left (Codex's strips face right).
  const SPEED0 = 0.4, PAUSE = 1.4, STRIDE0 = 0.0825, SIDE = 0.035, TURN = 0.32;
  function smoothPath(route) {
    const pts = route.map(([x, y]) => ({ x, y }));
    const seg = []; for (let k = 1; k < pts.length; k++) seg.push({ dx: Math.sign(pts[k].x - pts[k - 1].x), dy: Math.sign(pts[k].y - pts[k - 1].y) });
    const out = [];
    const add = (x, y) => { const l = out[out.length - 1]; if (!l || Math.hypot(x - l.x, y - l.y) > 1e-6) out.push({ x, y }); };
    add(pts[0].x, pts[0].y);
    for (let k = 1; k < pts.length - 1; k++) {
      const a = seg[k - 1], b = seg[k];
      if (a.dx === b.dx && a.dy === b.dy) continue;
      // the corner, rounded with a quadratic curve
      const cx = pts[k].x, cy = pts[k].y;
      const p0 = { x: cx - a.dx * TURN, y: cy - a.dy * TURN }, p2 = { x: cx + b.dx * TURN, y: cy + b.dy * TURN };
      for (let q = 0; q <= 10; q++) { const t = q / 10, u = 1 - t; add(u * u * p0.x + 2 * u * t * cx + t * t * p2.x, u * u * p0.y + 2 * u * t * cy + t * t * p2.y); }
    }
    add(pts[pts.length - 1].x, pts[pts.length - 1].y);
    // resampled every 0.05 tile, so the fit to the road below has points to move
    const fine = [out[0]];
    for (let k = 1; k < out.length; k++) {
      const a = out[k - 1], b = out[k], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.05));
      for (let q = 1; q <= n; q++) fine.push({ x: a.x + ((b.x - a.x) * q) / n, y: a.y + ((b.y - a.y) * q) / n });
    }
    return measure(fine);
  }
  function measure(pts) {
    const len = [0]; for (let k = 1; k < pts.length; k++) len.push(len[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
    return { pts, len, L: len[len.length - 1] };
  }
  // the road picture's opacity at a point (0 where no road picture lies: a level crossing, a building's tile)
  function roadAlpha(x, y) {
    const i = Math.round(x), j = Math.round(y);
    if (!inb(i, j)) return 0;
    const list = DECALS[j * W + i];
    for (let q = 0; q < list.length; q++) { const dc = list[q]; if (!dc.key.startsWith('road/')) continue; pieceAt(dc, x - dc.ti, y - dc.tj); return V[6]; }
    return 0;
  }
  // a centre line moved onto the road's own centre (the opacity-weighted middle across it), smoothed along the way,
  // then kept SIDE to the right of it
  function fitPath(base) {
    const P = base.pts, n = P.length, off = new Float64Array(n), got = new Uint8Array(n);
    const dirAt = (k) => { const a = P[Math.max(0, k - 1)], b = P[Math.min(n - 1, k + 1)], l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return [(b.x - a.x) / l, (b.y - a.y) / l]; };
    for (let k = 0; k < n; k++) {
      const [dx, dy] = dirAt(k), nx = -dy, ny = dx;
      let sa = 0, so = 0;
      for (let o = -0.3; o <= 0.3001; o += 0.02) { const a = roadAlpha(P[k].x + nx * o, P[k].y + ny * o); sa += a; so += a * o; }
      if (sa > 3) { off[k] = so / sa; got[k] = 1; }
    }
    // where no picture says (a crossing), the nearest measured offsets carry on
    for (let k = 0; k < n; k++) if (!got[k]) { let a = k, b = k; while (a >= 0 && !got[a]) a--; while (b < n && !got[b]) b++; off[k] = a >= 0 && b < n ? (off[a] + off[b]) / 2 : a >= 0 ? off[a] : b < n ? off[b] : 0; }
    const sm = new Float64Array(n);
    for (let k = 0; k < n; k++) { let s2 = 0, c2 = 0; for (let q = -4; q <= 4; q++) { const m = k + q; if (m < 0 || m >= n) continue; const w = 5 - Math.abs(q); s2 += off[m] * w; c2 += w; } sm[k] = s2 / c2; }
    const out = [];
    for (let k = 0; k < n; k++) { const [dx, dy] = dirAt(k); out.push({ x: P[k].x - dy * (sm[k] + SIDE), y: P[k].y + dx * (sm[k] + SIDE) }); }
    return measure(out);
  }
  function along(path, d) {
    const { pts, len } = path;
    let lo = 0, hi = len.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (len[m] <= d) lo = m; else hi = m; }
    const f = len[hi] > len[lo] ? (d - len[lo]) / (len[hi] - len[lo]) : 0;
    const a = pts[lo], b = pts[hi];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, dx: b.x - a.x, dy: b.y - a.y };
  }
  for (const w of WORLD.walkers) { w.outBase = smoothPath(w.route); w.backBase = smoothPath([...w.route].reverse()); }
  // after every scene build: the walkers' paths follow the road pictures now on the map
  function fitWalkers() { for (const w of WORLD.walkers) { w.out = fitPath(w.outBase); w.back = fitPath(w.backBase); } }
  function walkerAt(w, t) {
    if (peopleFixed()) return walkerAtFixed(w, t); // (v9: People, Fixed walk)
    const SPEED = SPEED0 * peopleK(), STRIDE = STRIDE0 * peopleK(); // (v9.2, People larger: a larger person walks faster with a longer stride, at the same cadence)
    const Lo = w.out.L, Lb = w.back.L, cyc = (Lo + Lb) / SPEED + 2 * PAUSE;
    const u = (((t + (w.phase || 0) * cyc) % cyc) + cyc) % cyc;
    let back = false, dist, path;
    if (u < Lo / SPEED) { path = w.out; dist = u * SPEED; }
    else if (u < Lo / SPEED + PAUSE) { path = w.out; dist = Lo; }
    else if (u < (Lo + Lb) / SPEED + PAUSE) { path = w.back; back = true; dist = (u - Lo / SPEED - PAUSE) * SPEED; }
    else { path = w.back; back = true; dist = Lb; }
    const moving = dist > 0 && dist < path.L;
    const p = along(path, Math.max(1e-4, Math.min(path.L - 1e-4, dist)));
    // the screen direction of travel: down the screen is toward the camera (front view), left is mirrored
    const sx = (p.dx - p.dy) * 32, sy = (p.dx + p.dy) * 16;
    const front = sy > 0.01 * Math.abs(sx) || (Math.abs(sy) <= 0.01 * Math.abs(sx) && w.lastFront !== false);
    w.lastFront = front;
    const flip = sx < 0;
    const carry = back ? w.carry === 'back' : w.carry === 'out';
    let key = `people/${w.who}-${front ? 'front' : 'back'}-${carry ? 'carry' : 'walk'}`;
    if (!CX[key]) key = `people/${w.who}-${front ? 'front' : 'back'}-walk`;
    const e = CX[key];
    const hidden = (e.status === 'flagged-redo' && !state.redo) || (e.status === 'flagged-extra' && !state.extras) || (w.redoOnly && !state.redo);
    // the walked distance over the whole cycle sets the step, so the feet never slide
    const walked = (back ? Lo : 0) + dist;
    const frame = moving ? Math.floor(walked / STRIDE) % e.frames.order.length : 0;
    return { tx: p.x, ty: p.y, key, e, flip, moving, hidden, frame };
  }
  function drawWalker(g, s) {
    if (s.fixed) { drawWalkerFixed(g, s); return; } // (v9: People, Fixed walk)
    const z = heightAt(s.tx, s.ty), wx = (s.tx - s.ty) * 32, wy = (s.tx + s.ty) * 16 - z;
    const e = s.e, order = e.frames.order;
    const frame = order[s.frame];
    const big = cam.z * dpr >= 2.5 && e.z4;
    const [ax, ay] = big ? e.zoom4.anchor : e.anchor;
    const fw = big ? e.zoom4.w : e.frames.w, fh = big ? e.zoom4.h : e.frames.h, sc = big ? 0.25 : 0.5;
    const sx = (big ? e.z4[0] : e.x) + frame * fw, sy = big ? e.z4[1] : e.y;
    g.save(); g.translate(wx, wy); const pk = peopleK(); if (pk !== 1) g.scale(pk, pk); if (s.flip) g.scale(-1, 1);
    g.drawImage(IMG.people, sx, sy, fw, fh, -ax * sc, -ay * sc, fw * sc, fh * sc);
    g.restore();
  }
  // ---------- People (v9, the author's note of 16 October: "the people's movement animations are a bit odd ... put
  // together in odd poses, it does not look like a good walking animation"). The People switch: v8 walks as before;
  // Fixed walk (the default) is what a check of every strip, frame by frame, asked for:
  // - the feet stay put: v8 showed the next pose every 0.0825 tile at 0.4 tile a second, but a painted planted foot
  //   moves back about 1 px (0.031 tile) a pose, so v8's people skated 1.3 to 4 px a pose. Here a pose lasts
  //   PEOPLE_FRAME_S and the person moves PEOPLE_GAIT in it (half the distance between the feet of its front strip's
  //   contact poses): 0.21 to 0.27 tile a second, the pose still following the distance walked;
  // - Codex's R7 repaints (branch art/331-people, 4dcd054: the back strips and the pump hand's carry strips as
  //   four-pose cycles) replace the C5 strips v8 hid as redo, so nobody vanishes when they turn to walk away;
  // - each strip plays its poses in walking order (PEOPLE_STRIPS.order): the R7 back strips backwards (0, 3, 2, 1:
  //   played forwards their planted foot slides 1.6 to 2.6 px forward each pose), the pump hand's front carry 0, 3, 2, 3
  //   (its f1 is not a passing pose), and the back strips whose painted poses repeat hold each of their two supports for
  //   a step (0, 0, 3, 3); a person standing at the end of a leg stands on its stand pose, not mid-stride;
  // - a small bob that keeps the planted foot on the ground: going down the screen the passing poses are drawn half a
  //   pose's drop (16 x gait, about 0.5 px) higher, going up it lower, so the body moves on in a step of 1 px at each
  //   footfall (PEOPLE_STRIPS.dy, by position in the order).
  const PEOPLE_FRAME_S = 0.125;
  // tiles a person moves per pose
  const PEOPLE_GAIT = { passenger: 0.031, lumberjack: 0.029, 'stone-mason': 0.031, farmer: 0.031, 'pump-hand': 0.034, 'railway-worker': 0.028,
    'passenger-variant-01': 0.031, 'passenger-variant-02': 0.026, 'passenger-variant-03': 0.028, 'passenger-variant-04': 0.034 };
  // per strip: order (the poses played, one per PEOPLE_GAIT), stand (the pose standing), dy (each position's bob in
  // 16 x gait px), r7 (its row in the R7 picture below; without it the strip is v8's own, from people.png), verdict
  // (the tooltip's, for an R7 strip with the Fixed walk on)
  const PEOPLE_STRIPS = {
    'passenger-front-walk': { order: [0, 1, 0, 3], stand: 1, dy: [0, -1, 0, -1], off: [[0.0, 0.0], [0.5, 0.0], [0.0, 0.0], [-0.5, 0.0]] },
    'passenger-back-walk': { order: [0, 3, 2, 3], stand: 1, dy: [0, 1, 0, 1], gm: 0.9, off: [[1.25, 0.0], [-0.25, 0.0], [-0.75, 0.0], [-0.25, 0.0]] },
    'lumberjack-front-walk': { order: [0, 1, 2, 3], stand: 1, dy: [0, -1, 0, -1], off: [[0.0, 0.0], [0.0, 0.0], [0.0, 0.0], [-0.25, 0.0]] },
    'lumberjack-back-walk': { r7: 3, order: [0, 3, 2, 1], stand: 1, dy: [0, 1, 0, 1], verdict: 'Use after finishing', off: [[-0.25, 0.5], [0.5, -0.5], [-0.75, -0.5], [0.5, 0.5]] },
    'lumberjack-front-carry': { order: [0, 1, 2, 3], stand: 1, dy: [0, -1, 0, -1], off: [[0.25, 0.0], [-0.25, 0.0], [0.25, 0.0], [-0.25, 0.0]] },
    'lumberjack-back-carry': { r7: 4, order: [0, 3, 2, 1], stand: 1, dy: [0, 1, 0, 1], verdict: 'Use after finishing', off: [[1.0, 0.5], [0.0, 0.0], [-1.25, -0.25], [0.25, -0.25]] },
    'stone-mason-front-walk': { order: [0, 1, 2, 3], stand: 1, dy: [0, -1, 0, -1], off: [[0.25, 0.0], [-0.25, 0.0], [0.25, 0.0], [-0.25, 0.0]] },
    'stone-mason-back-walk': { r7: 5, order: [0, 3, 2, 1], stand: 1, dy: [0, 1, 0, 1], verdict: 'Use after finishing', off: [[0.5, 0.25], [-0.75, -0.25], [0.5, 0.5], [-0.25, -0.5]] },
    'stone-mason-front-carry': { order: [0, 1, 2, 3], stand: 1, dy: [0, -1, 0, -1], off: [[0.25, 0.0], [-0.25, 0.0], [0.5, 0.0], [-0.75, 0.0]] },
    'stone-mason-back-carry': { r7: 6, order: [0, 3, 2, 1], stand: 1, dy: [0, 1, 0, 1], verdict: 'Use after finishing', off: [[0.5, 0.25], [-0.75, -0.25], [0.5, 0.5], [-0.25, -0.5]] },
    'farmer-front-walk': { order: [0, 1, 2, 3], stand: 1, dy: [0, -1, 0, -1], off: [[0.25, 0.0], [-0.25, 0.0], [0.25, 0.0], [0.0, 0.0]] },
    'farmer-back-walk': { r7: 7, order: [0, 3, 2, 1], stand: 1, dy: [0, 1, 0, 1], verdict: 'Use after finishing', off: [[1.0, 0.5], [0.0, 0.0], [-1.25, -0.25], [0.25, -0.25]] },
    'farmer-front-carry': { order: [0, 1, 2, 3], stand: 1, dy: [0, -1, 0, -1], off: [[0.5, 0.0], [-0.25, 0.0], [0.25, 0.0], [-0.5, 0.0]] },
    'farmer-back-carry': { r7: 8, order: [0, 3, 2, 1], stand: 1, dy: [0, 1, 0, 1], verdict: 'Use after finishing', off: [[1.0, 0.5], [0.0, 0.0], [-1.25, -0.25], [0.25, -0.25]] },
    'pump-hand-front-walk': { order: [0, 1, 2, 3], stand: 1, dy: [0, -1, 0, -1], off: [[0.25, 0.0], [-0.25, 0.0], [0.25, 0.0], [0.0, 0.0]] },
    'pump-hand-back-walk': { r7: 0, order: [0, 3, 2, 1], stand: 1, dy: [0, 1, 0, 1], verdict: 'Use after finishing', off: [[1.0, 0.5], [-0.25, -0.25], [-1.0, 0.0], [0.25, -0.25]] },
    'pump-hand-front-carry': { r7: 1, order: [0, 3, 2, 3], stand: 3, dy: [0, -1, 0, -1], verdict: 'Use after finishing', off: [[0.0, 0.0], [0.0, 0.0], [0.0, 0.0], [0.0, 0.0]] },
    'pump-hand-back-carry': { r7: 2, order: [0, 3, 2, 1], stand: 1, dy: [0, 1, 0, 1], verdict: 'Use after finishing', off: [[1.0, 0.5], [-0.25, -0.25], [-1.0, 0.0], [0.25, -0.25]] },
    'railway-worker-front-walk': { order: [0, 1, 2, 3], stand: 1, dy: [0, -1, 0, -1], off: [[0.25, 0.0], [0.0, 0.0], [0.0, 0.0], [-0.25, 0.0]] },
    'railway-worker-back-walk': { order: [0, 3, 2, 3], stand: 0, dy: [0, 1, 0, 1], gm: 1.1, off: [[0.0, 0.0], [0.0, 0.0], [0.25, 0.0], [-0.25, 0.0]] },
    'passenger-variant-01-front-walk': { order: [0, 1, 2, 3], stand: 1, dy: [0, -1, 0, -1], off: [[0.0, 0.0], [-0.5, 0.0], [0.25, 0.0], [0.25, 0.0]] },
    'passenger-variant-01-back-walk': { order: [0, 0, 3, 3], stand: 0, dy: [0, 1, 0, 1], off: [[-0.5, 0.5], [0.5, -0.5], [-0.25, 0.25], [0.25, -0.5]] },
    'passenger-variant-02-front-walk': { order: [0, 1, 2, 3], stand: 1, dy: [0, -1, 0, -1], off: [[0.0, 0.0], [-0.25, 0.0], [0.5, 0.0], [-0.25, 0.0]] },
    'passenger-variant-02-back-walk': { order: [0, 0, 3, 3], stand: 0, dy: [0, 1, 0, 1], off: [[-0.75, 0.75], [0.0, -0.25], [0.75, -0.25], [0.0, -0.25]] },
    'passenger-variant-03-front-walk': { order: [0, 1, 2, 3], stand: 1, dy: [0, -1, 0, -1], off: [[0.25, 0.0], [0.5, 0.25], [-0.75, -0.25], [0.0, 0.0]] },
    'passenger-variant-03-back-walk': { order: [0, 1, 2, 3], stand: 1, dy: [0, 1, 0, 1], off: [[0.25, 0.25], [-0.25, -0.25], [0.25, 0.25], [-0.5, -0.25]] },
    'passenger-variant-04-front-walk': { order: [0, 1, 2, 3], stand: 1, dy: [0, -1, 0, -1], off: [[-0.5, -0.5], [0.5, 0.5], [-0.5, -0.5], [0.25, 0.5]] },
    'passenger-variant-04-back-walk': { order: [0, 0, 3, 3], stand: 0, dy: [0, 1, 0, 1], off: [[0.75, 0.25], [0.0, -0.25], [-0.75, 0.5], [0.0, -0.25]] },
  };
  // Codex's R7 strips, prepared for the demo the way people.png's were (per frame: the ground under the hips at the
  // anchor, the body scaled to 9 px): a row per strip, its four zoom-4 frames (40 x 48, anchor 20,44) then its four
  // zoom-2 frames (20 x 24, anchor 10,22), rows 50 px apart
  const PEOPLE_R7 = { img: null, src: 'data:image/webp;base64,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' };
  loadImg(PEOPLE_R7.src).then((im) => { PEOPLE_R7.img = im; dirty = true; }, () => {});
  let peopleMode = 'fixed';
  const peopleFixed = () => peopleMode === 'fixed';
  // a Codex key the Fixed walk draws from R7
  const peopleR7 = (key) => peopleFixed() && key.startsWith('people/') && PEOPLE_STRIPS[key.slice(7)] && PEOPLE_STRIPS[key.slice(7)].r7 != null;
  // what the tooltip says of an R7 strip with the Fixed walk on (the C5 picture's verdict stays in the legend)
  function peopleEntry(key) {
    if (!peopleR7(key)) return null;
    const p = PEOPLE_STRIPS[key.slice(7)];
    return { ...CX[key], status: 'ready', verdict: p.verdict || 'Use after finishing' };
  }
  function walkerAtFixed(w, t) {
    const pk = peopleK(), gait = (PEOPLE_GAIT[w.who] || 0.03) * pk, speed = gait / PEOPLE_FRAME_S; // (v9.2, People larger: the stride grows with the person, the cadence stays)
    const Lo = w.out.L, Lb = w.back.L, cyc = (Lo + Lb) / speed + 2 * PAUSE;
    const u = (((t + (w.phase || 0) * cyc) % cyc) + cyc) % cyc;
    let back = false, dist, path;
    if (u < Lo / speed) { path = w.out; dist = u * speed; }
    else if (u < Lo / speed + PAUSE) { path = w.out; dist = Lo; }
    else if (u < (Lo + Lb) / speed + PAUSE) { path = w.back; back = true; dist = (u - Lo / speed - PAUSE) * speed; }
    else { path = w.back; back = true; dist = Lb; }
    const moving = dist > 0 && dist < path.L;
    const p = along(path, Math.max(1e-4, Math.min(path.L - 1e-4, dist)));
    // the screen direction of travel: down the screen is toward the camera (front view), left is mirrored
    const sx = (p.dx - p.dy) * 32, sy = (p.dx + p.dy) * 16;
    const front = sy > 0.01 * Math.abs(sx) || (Math.abs(sy) <= 0.01 * Math.abs(sx) && w.lastFrontF !== false);
    w.lastFrontF = front;
    const carry = back ? w.carry === 'back' : w.carry === 'out';
    let name = `${w.who}-${front ? 'front' : 'back'}-${carry ? 'carry' : 'walk'}`;
    if (!PEOPLE_STRIPS[name]) name = `${w.who}-${front ? 'front' : 'back'}-walk`;
    const key = `people/${name}`, e = CX[key], cfg = PEOPLE_STRIPS[name];
    const hidden = (e.status === 'flagged-extra' && !state.extras) || (e.status === 'flagged-redo' && cfg.r7 == null && !state.redo);
    // the distance walked over the whole round sets the pose (a pose every gait x gm of it)
    const walked = (back ? Lo : 0) + dist, step = gait * (cfg.gm || 1), k = Math.floor(walked / step);
    const pos = k % cfg.order.length;
    const frame = moving ? cfg.order[pos] : cfg.stand;
    const bob = moving ? cfg.dy[pos] * 16 * gait : 0;
    // (fix round of v9) the planted foot locked: while a pose shows, the person stands where the pose began, and each
    // pose's picture is moved by its offset (off, world px, measured on the painted feet: fix/people/fit.py), so the
    // foot it stands on is put down where the last pose's foot was, and the body steps forward between poses
    let tx = p.x, ty = p.y, ox = 0, oy = 0;
    if (moving) {
      const dq = Math.max(1e-4, Math.min(path.L - 1e-4, k * step - (back ? Lo : 0)));
      const q = along(path, dq); tx = q.x; ty = q.y;
      if (cfg.off) { ox = cfg.off[pos][0] * pk; oy = cfg.off[pos][1] * pk; }
    }
    return { tx, ty, key, e, flip: sx < 0, moving, hidden, frame, fixed: true, cfg, bob, ox, oy };
  }
  function drawWalkerFixed(g, s) {
    const z = heightAt(s.tx, s.ty), wx = (s.tx - s.ty) * 32 + (s.flip ? -s.ox : s.ox), wy = (s.tx + s.ty) * 16 - z + s.bob + s.oy;
    const e = s.e, r7 = s.cfg.r7 != null && !!PEOPLE_R7.img; // (until the R7 picture is in, v8's frames)
    const big = cam.z * dpr >= 2.5 && (r7 || e.z4);
    const [ax, ay] = big ? [20, 44] : [10, 22];
    const fw = big ? 40 : 20, fh = big ? 48 : 24, sc = big ? 0.25 : 0.5;
    const img = r7 ? PEOPLE_R7.img : IMG.people;
    const x0 = r7 ? (big ? 0 : 162) : big ? e.z4[0] : e.x, y0 = r7 ? s.cfg.r7 * 50 : big ? e.z4[1] : e.y;
    g.save(); g.translate(wx, wy); const pk = peopleK(); if (pk !== 1) g.scale(pk, pk); if (s.flip) g.scale(-1, 1);
    g.drawImage(img, x0 + s.frame * fw, y0, fw, fh, -ax * sc, -ay * sc, fw * sc, fh * sc);
    g.restore();
  }
  function peopleHint() { return peopleFixed() ? 'People: fixed walk (default)' : 'People: as in v8'; }
  function setPeople(mode) {
    if (mode !== 'v8' && mode !== 'fixed') return peopleMode;
    peopleMode = mode;
    for (const b of document.querySelectorAll('[data-people]')) b.setAttribute('aria-pressed', String(b.dataset.people === peopleMode));
    for (const w of WORLD.walkers) { w.lastFront = undefined; w.lastFrontF = undefined; }
    rebuild().then(() => { hint.textContent = hintText(); });
    return peopleMode;
  }
  for (const b of document.querySelectorAll('[data-people]')) b.addEventListener('click', () => setPeople(b.dataset.people));
  // ---------- Building scale (v9, the author's note of 16 October, item 9: "the buildings' size does not necessarily
  // scale properly to the people; some look bigger than they should be"). A person is 9 px tall at zoom 1 (people.png's
  // strips: 18 px at half scale), so 9 px is 1.75 m. Every building picture was measured in its own pixels (its door,
  // a storey or its eave, its ridge or top) against a real building of its kind (scale-table.md holds the table).
  // True to people draws each picture scaled about its anchor by one factor (never one axis alone): the geometric mean of
  // what its door and its walls ask, rounded to tenths below 1 and quarters above, and no larger than its tile holds. The
  // town hall asks 1.5 and the goods shed 1.25: neither fits its one tile, so both stay as they are (a bigger footprint
  // is the game's to decide). Its footprint, tile and yard stay where they were; the walls' contact shadow, occlusion,
  // plinth and weeds follow the drawn picture, and a door path still reaches the same ground. As before (v8): v8's sizes.
  const BSCALE_TRUE = {
    'structures/water_tower': 1.75, // a 2 m tank on 2.2 m piers, 4.7 m in all: a railway water tank stands 8 to 12 m
    'structures/farm_2': 0.9, // its door 2.84 m (eave 3.9 m and gable 7.1 m are true)
    'structures/windmill': 0.9, // its door 2.5 m (the tower, 8 m to the cap, is true)
    'structures/pump_1': 0.9, // its door 2.43 m, eave 4.1 m
    'structures/quarry_2': 0.8, // the stone skip 2.4 m tall, the hoist hut's eave 3.2 m
    'building/fuel_pump-a1-r0': 0.8, // its door 2.9 m, the brick house 4.9 m to its eave, 13 m in all (each view alike)
    'building/fuel_pump-a1-r1': 0.8,
    'building/fuel_pump-a1-r2': 0.8,
    'building/fuel_pump-a1-r3': 0.8,
  };
  // (v9.2, the author's third note of 17 October: "True to people is still not right") Smaller: every picture measured again
  // from scratch against a 9 px, 1.75 m person (scale-table.md, demo-v92) and read strictly: a door 2.0 to 2.2 m (2.1), a
  // storey about 3 m. One factor a picture (never one axis), the geometric mean of what its door asks and what its walls ask
  // (a measure already inside its range asks 1), rounded to 0.05, and not limited to its tile: a town hall whose door is
  // 1.8 m and whose storeys are 2.5 and 2.0 m grows, a farm door of 2.8 m and a Fuel Pump door of 2.9 m shrink. The
  // picture scales about its anchor, its yard and ground fit follow as True v9's do.
  const BSCALE_SMALL = {
    'structures/townhouse': 0.95, 'structures/townhouse_2': 0.95, 'structures/townhouse_3': 0.95, // door 2.30 m, eave 3.02 m
    'structures/townhouse_s0': 0.95, 'structures/townhouse_s1': 0.95, 'structures/townhouse_s2': 0.95, // the same house, other colours
    'structures/town_2': 1.2, 'structures/town_3': 1.2, // door 1.78 m on 0.8 m of steps (2.14 m at 1.2), storeys 2.5 and 2.0 m
    'structures/station_2': 0.9, // gable door 2.5 m, platform door 2.2 m: no one factor gives both 2.0 to 2.2 (0.9: 2.25 and 1.99 m), eave 4.0 m
    'structures/warehouse_1': 0.95, // goods door 2.2 m, eave 3.2 m
    'structures/water_tower': 1.85, // tank floor 2.2 m (a tender needs 4.5 m), spout end 1.3 m, 4.7 m in all (8 to 12 m)
    'structures/lumber_2': 0.8, // saw shed eave 3.7 m
    'structures/quarry_2': 0.75, // the stone skip 2.4 m (1.4 m), the hoist hut's eave 3.2 m
    'structures/farm_2': 0.75, // door 2.84 m, eave 3.9 m
    'structures/windmill': 0.85, // door 2.5 m (2.13 m at 0.85), the tower is 6.7 m to the cap
    'structures/pump_1': 0.85, // door 2.48 m (2.11 m at 0.85), eave 4.1 m
    'building/fuel_pump-a1-r0': 0.7, // door 2.92 m (2.04 m at 0.7), the brick house 4.8 m to its eave (each view alike)
    'building/fuel_pump-a1-r1': 0.7, 'building/fuel_pump-a1-r2': 0.7, 'building/fuel_pump-a1-r3': 0.7,
  }; // (structures/fuel_stop: the bunker floor 4.0 m clears a tender, true: 1)
  // People larger (v9.2): the v8 buildings and the people drawn 1.25 times larger, their walk speed and stride with them
  const PEOPLE_BIG = 1.25;
  let bscaleMode = 'smaller', bsFigures = false, smokeMode = 'tall';
  const peopleK = () => (bscaleMode === 'people' ? PEOPLE_BIG : 1);
  // the factor a building picture is drawn at now (1 with As before and People larger, and for every picture that is already true)
  const bsTable = (m = bscaleMode) => (m === 'true' ? BSCALE_TRUE : m === 'smaller' ? BSCALE_SMALL : null);
  const bScale = (key) => {
    const t = bsTable();
    return (t && t[key.replace(/^codex:/, '').replace(/#life$/, '')]) || 1; // (#life: Building life's windmill without its sails)
  };
  const bsTag = (key) => (bScale(key) === 1 ? '' : `x${bScale(key)}`);
  // its footprint (tiles from the tile centre) drawn at that factor: the anchor is the tile centre, so it scales about 0
  function bsFoot(f, key) { const k = bScale(key); return k === 1 ? f : f.map((v) => v * k); }
  // the yard keeps the ground it had (a building drawn larger widens it to its walls)
  function bsYardBox(fp, F) {
    const y = fp.yf || fp.f;
    return F === fp.f ? y : [Math.min(y[0], F[0]), Math.max(y[1], F[1]), Math.min(y[2], F[2]), Math.max(y[3], F[3])];
  }
  // how much farther a door path runs from a wall drawn nearer the centre, so it still ends where it did
  const bsPathMore = (fp, F, face) => (face === 'y' ? fp.f[3] - F[3] : fp.f[1] - F[1]);
  function bsNote(key) { const k = bScale(key); return k === 1 ? '' : ` (drawn at ${k} of its size: Building scale, ${bscaleMode === 'true' ? 'True v9' : 'Smaller'})`; }
  function bscaleHint() {
    return { smaller: 'Building scale: smaller, each building at the size a 1.75 m person asks (default)', true: 'Building scale: True v9', v8: 'Building scale: as before (v8)',
      people: 'Building scale: people larger, the v8 buildings and the people 1.25 times larger' }[bscaleMode] + (bsFigures ? ', a person standing at each door' : '');
  }
  // for the shots (__demo.scaleFigures): a standing passenger at each building's doors, 0.06 tile out, at the people's scale
  function bsFigureSprites(b, c, sprites) {
    if (!bsFigures) return;
    const fp = GF_FOOT[b.key.replace(/^codex:/, '')], e = CX['people/passenger-front-walk'];
    if (!fp || !e) return;
    const F = bsFoot(fp.f, b.key), doors = fp.doors.length ? fp.doors : [['y', 0.5, 0]];
    for (const [face, u] of doors) {
      const px = face === 'y' ? F[0] + u * (F[1] - F[0]) : F[1] + 0.06, py = face === 'y' ? F[3] + 0.06 : F[3] - u * (F[3] - F[2]);
      const tx = c.x + px, ty = c.y + py, wx = (tx - ty) * 32, wy = (tx + ty) * 16 - heightAt(tx, ty);
      const pk = peopleK();
      sprites.push({ img: IMG.people, sx: e.x + e.frames.w, sy: e.y, sw: e.frames.w, sh: e.frames.h, x: wx - (e.anchor[0] / 2) * pk, y: wy - (e.anchor[1] / 2) * pk, w: (e.frames.w / 2) * pk, h: (e.frames.h / 2) * pk, depth: (tx + ty) * 100 + 30, key: 'people/passenger-front-walk' });
    }
  }
  function setBuildingScale(mode) {
    if (mode !== 'v8' && mode !== 'true' && mode !== 'smaller' && mode !== 'people') return bscaleMode;
    const same = bsTable() === bsTable(mode); // As before and People larger draw the same buildings
    bscaleMode = mode;
    for (const b of document.querySelectorAll('[data-bscale]')) b.setAttribute('aria-pressed', String(b.dataset.bscale === bscaleMode));
    if (same && !bsFigures) { dirty = true; hint.textContent = hintText(); return bscaleMode; }
    rebuild().then(() => { hint.textContent = hintText(); });
    return bscaleMode;
  }
  for (const b of document.querySelectorAll('[data-bscale]')) b.addEventListener('click', () => setBuildingScale(b.dataset.bscale));
  // the standing figures at the doors (v9.2: a button; v9's __demo.scaleFigures for the shots): off is v9.1's page
  function setFigures(on) {
    bsFigures = !!on;
    for (const b of document.querySelectorAll('[data-bsfig]')) b.setAttribute('aria-pressed', String((b.dataset.bsfig === 'on') === bsFigures));
    return rebuild().then(() => { hint.textContent = hintText(); });
  }
  for (const b of document.querySelectorAll('[data-bsfig]')) b.addEventListener('click', () => setFigures(b.dataset.bsfig === 'on'));

  // ---------- Sleepers (v9, the author's note of 16 October, item 7: "on the narrow rail the sleepers are still a little
  // shifted at the joins"). The demo's track frames were exported from the game before #405 (PR #413, sleeperLayout in
  // src/art/trackIllustrated.ts): each piece laid its sleepers from step / 2.5 after its start, so two narrow pieces met
  // with 70% of the pitch between their end sleepers (the bridge carries the same straight frame, so the line stepping
  // onto it and off it did too) and a curve's joins 74 to 83%. Even (the default) draws the narrow straights and curves
  // the game's develop generator draws now (afc4bb1, run in the browser and packed here losslessly): every piece holds a
  // whole number of equal pitches with its end sleepers half a pitch in, so every join leaves one pitch. v8: as before.
  const SLEEPERS_EVEN = {
    img: null,
    // key: [x, y, w, h, ax, ay] in the picture below (4 texels per world px, as track.png)
    tab: { 'track/straight_narrow_0': [0,  0,  158,  81,  79,  41], 'track/straight_narrow_1': [159,  0,  158,  80,  79,  40], 'track/curve_narrow_0': [0,  82,  69,  80,  -12,  40], 'track/curve_narrow_1': [70,  82,  154,  35,  77,  -5], 'track/curve_narrow_2': [225,  82,  69,  79,  81,  39], 'track/curve_narrow_3': [0,  163,  154,  36,  77,  42] },
    src: 'data:image/webp;base64,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',
  };
  let sleeperMode = 'even';
  loadImg(SLEEPERS_EVEN.src).then((im) => { SLEEPERS_EVEN.img = im; if (sleeperMode === 'even') enqueue(async () => { buildScene(false); dirty = true; }); }, () => {});
  // a narrow track sprite from gs(), drawn from the develop frames when Even is on (and the picture is in)
  function sleeperPic(spr, key, wx, wy) {
    const t = sleeperMode === 'even' && SLEEPERS_EVEN.img && SLEEPERS_EVEN.tab[key];
    if (!t) return spr;
    const s = 1 / 4;
    return { ...spr, img: SLEEPERS_EVEN.img, sx: t[0], sy: t[1], sw: t[2], sh: t[3], x: wx - t[4] * s, y: wy - t[5] * s, w: t[2] * s, h: t[3] * s };
  }
  const sleeperNote = (key) => (sleeperMode === 'even' && SLEEPERS_EVEN.tab[key] ? ' (Sleepers Even: the game’s develop frame, one pitch across every join)' : '');
  function sleeperHint() { return sleeperMode === 'even' ? 'Sleepers: even across the joins (default)' : 'Sleepers: as in v8'; }
  function setSleepers(mode) {
    if (mode !== 'v8' && mode !== 'even') return sleeperMode;
    sleeperMode = mode;
    for (const b of document.querySelectorAll('[data-sleepers]')) b.setAttribute('aria-pressed', String(b.dataset.sleepers === sleeperMode));
    rebuild().then(() => { hint.textContent = hintText(); });
    return sleeperMode;
  }
  for (const b of document.querySelectorAll('[data-sleepers]')) b.addEventListener('click', () => setSleepers(b.dataset.sleepers));
  function diamond(g, x, y, lift = 0) {
    const [cx, cy] = twc(x, y, lift);
    g.beginPath(); g.moveTo(cx, cy - 16); g.lineTo(cx + 32, cy); g.lineTo(cx, cy + 16); g.lineTo(cx - 32, cy); g.closePath();
  }
  // ---------- town borders (v8, the author's idea of 2026-10-14): hovering over a town hall shows its town's border;
  // a click pins it, a second click on that town hall or Escape lets it go. The game's rule (src/sim/towns.ts): a town
  // reaches TOWN_RADIUS (Chebyshev 7) round its town hall, the nearest town hall where reaches overlap. Its border takes
  // every building of the town (the town hall, and every house, station, works and warehouse in its reach), every tile
  // of their footprints grown by three tiles (Chebyshev) as one region; where two towns' regions meet, each tile goes to
  // the nearer town hall, so borders never overlap. Only the region's outline is drawn: a thin line in the town's colour
  // at reduced strength, its corners rounded (the outline of the region's tiles blurred by a third of a tile and taken a
  // little inside its edge, so where two towns meet their lines run side by side), lying on the ground (each point at
  // the ground's height, left out where a rise in front of it hides it), under the buildings, trees and trains and over
  // the ground and the roads.
  const TB = { pinned: new Set(), hover: -1, regions: null, lines: [], key: '', alpha: {} };
  let TB_VER = 0; // the painted ground's version (heights and what hides what): paint() moves it on
  const TB_R = 4, TB_GW = (W + 3) * TB_R, TB_GH = (H + 3) * TB_R; // field samples per tile, and the field's size
  const townHex = (t) => `#${TOWN_COLORS[t.color].toString(16).padStart(6, '0')}`;
  function townRegions() {
    const towns = WORLD.towns, owner = new Int16Array(N).fill(-1), best = new Float64Array(N).fill(Infinity);
    // a building's town: the town hall it belongs to, or the nearest town hall whose reach covers it (Chebyshev, the
    // game's measure; the straight distance breaks a tie)
    const near = (x, y) => { let k = -1, bd = Infinity; for (const t of towns) { const d = Math.max(Math.abs(t.x - x), Math.abs(t.y - y)); if (d > TOWN_RADIUS) continue; const e = d * 1000 + (t.x - x) ** 2 + (t.y - y) ** 2; if (e < bd) { bd = e; k = t.k; } } return k; };
    const members = towns.map(() => []);
    for (const b of WORLD.buildings) {
      if ((b.redo && !state.redo) || b.name === 'Ground fit test placement') continue;
      const k = b.town != null ? b.town : near(b.x, b.y);
      if (k >= 0) members[k].push(b);
    }
    for (const t of towns) for (const b of members[t.k]) {
      const fp = GF_FOOT[b.key.replace(/^codex:/, '')], f = fp ? fp.f : [-0.45, 0.45, -0.45, 0.45];
      const x0 = Math.round(b.x + f[0]), x1 = Math.round(b.x + f[1]), y0 = Math.round(b.y + f[2]), y1 = Math.round(b.y + f[3]);
      for (let y = y0 - 3; y <= y1 + 3; y++) for (let x = x0 - 3; x <= x1 + 3; x++) {
        if (!inb(x, y)) continue;
        const i = idx(x, y), d = (t.x - x) ** 2 + (t.y - y) ** 2;
        if (d < best[i] || (d === best[i] && t.k < owner[i])) { best[i] = d; owner[i] = t.k; }
      }
    }
    return { owner, members };
  }
  // a town's outline: the region's tiles as a field (4 samples a tile), blurred (sigma 0.3 tile), its contour at 0.56
  // by marching squares, the pieces joined into loops and rounded once more (Chaikin); then each point lifted onto the
  // ground and marked hidden where the painted ground in front of it covers it
  function townOutline(k) {
    const { owner } = TB.regions, gw = TB_GW, gh = TB_GH, F = new Float32Array(gw * gh), G = new Float32Array(gw * gh);
    const at = (i) => (i + 0.5) / TB_R - 1.5; // a sample's tile coordinate
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const x = Math.round(at(i)), y = Math.round(at(j));
      F[j * gw + i] = inb(x, y) && owner[idx(x, y)] === k ? 1 : 0;
    }
    const sg = 0.3 * TB_R, R = 4, ker = [];
    let ks = 0; for (let d = -R; d <= R; d++) { const w = Math.exp(-(d * d) / (2 * sg * sg)); ker.push(w); ks += w; }
    for (let d = 0; d < ker.length; d++) ker[d] /= ks;
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { let s = 0; for (let d = -R; d <= R; d++) { const ii = i + d; if (ii >= 0 && ii < gw) s += F[j * gw + ii] * ker[d + R]; } G[j * gw + i] = s; }
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { let s = 0; for (let d = -R; d <= R; d++) { const jj = j + d; if (jj >= 0 && jj < gh) s += G[jj * gw + i] * ker[d + R]; } F[j * gw + i] = s; }
    const LVL = 0.56, segs = new Map(); // edge id -> [the other end's edge id, its point] (two at most)
    const pt = (e) => { const h = e & 1, c = e >> 1, i = c % gw, j = (c / gw) | 0; const a = F[c], b = h ? F[c + gw] : F[c + 1], f = (LVL - a) / (b - a); return h ? [at(i), at(j) + f / TB_R] : [at(i) + f / TB_R, at(j)]; };
    const link = (e1, e2) => { (segs.get(e1) || segs.set(e1, []).get(e1)).push(e2); (segs.get(e2) || segs.set(e2, []).get(e2)).push(e1); };
    for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
      const c = j * gw + i, a = F[c] > LVL, b = F[c + 1] > LVL, d = F[c + gw + 1] > LVL, e = F[c + gw] > LVL;
      const code = (a ? 1 : 0) | (b ? 2 : 0) | (d ? 4 : 0) | (e ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const top = c * 2, bot = (c + gw) * 2, lef = c * 2 + 1, rig = (c + 1) * 2 + 1;
      const centre = (F[c] + F[c + 1] + F[c + gw] + F[c + gw + 1]) / 4 > LVL;
      switch (code) {
        case 1: case 14: link(top, lef); break;
        case 2: case 13: link(top, rig); break;
        case 4: case 11: link(rig, bot); break;
        case 8: case 7: link(bot, lef); break;
        case 3: case 12: link(lef, rig); break;
        case 6: case 9: link(top, bot); break;
        case 5: if (centre) { link(top, rig); link(bot, lef); } else { link(top, lef); link(rig, bot); } break;
        case 10: if (centre) { link(top, lef); link(rig, bot); } else { link(top, rig); link(bot, lef); } break;
      }
    }
    const loops = [], used = new Set();
    for (const e0 of segs.keys()) {
      if (used.has(e0)) continue;
      const loop = []; let prev = -1, e = e0;
      while (e !== undefined && !used.has(e)) { used.add(e); loop.push(pt(e)); const nx = segs.get(e).find((q) => q !== prev && !used.has(q)); prev = e; e = nx; }
      if (loop.length > 3) loops.push(loop);
    }
    // round once more, then lift each point onto the ground
    return loops.map((L0) => {
      let L = L0;
      for (let it = 0; it < 2; it++) { const o = []; for (let q = 0; q < L.length; q++) { const a = L[q], b = L[(q + 1) % L.length]; o.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); } L = o; }
      const P = new Float64Array(L.length * 3);
      for (let q = 0; q < L.length; q++) {
        const u = Math.max(-0.5, Math.min(W - 0.5, L[q][0])), v = Math.max(-0.5, Math.min(H - 0.5, L[q][1])), z = heightAt(u, v);
        const sx = (u - v) * 32, sy = (u + v) * 16 - z;
        // hidden: the ground painted at that pixel lies in front of the point (the painter's depth, tx + ty)
        const gx = Math.round((sx - GX0) * SCALE), gy = Math.round((sy - GY0) * SCALE);
        let vis = 1;
        if (gx >= 0 && gy >= 0 && gx < GW && gy < GH) { const dv = DEP[gy * GW + gx]; if (dv && (dv >> 2) / 100 - 1 > u + v + 0.15) vis = 0; }
        P[q * 3] = sx; P[q * 3 + 1] = sy; P[q * 3 + 2] = vis;
      }
      return P;
    });
  }
  function townLines() {
    const key = `${state.redo}|${TB_VER}`;
    if (key !== TB.key) { TB.key = key; TB.regions = townRegions(); TB.lines = []; }
    return TB.lines;
  }
  function drawTownBorders(g) {
    const shown = new Set(TB.pinned); if (TB.hover >= 0) shown.add(TB.hover);
    if (!shown.size) return;
    const lines = townLines();
    const sw = 1.25 * Math.sqrt(cam.z); // screen px: 1.25 at zoom 1, 1.8 at zoom 2, 2.5 at zoom 4
    g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
    for (const k of shown) {
      const t = WORLD.towns[k];
      if (!lines[k]) lines[k] = townOutline(k);
      const path = new Path2D();
      for (const P of lines[k]) {
        const n = P.length / 3;
        let on = false;
        for (let q = 0; q <= n; q++) {
          const o = (q % n) * 3;
          if (!P[o + 2]) { on = false; continue; }
          if (on) path.lineTo(P[o], P[o + 1]); else { path.moveTo(P[o], P[o + 1]); on = true; }
        }
      }
      // a faint dark edge under it keeps it readable on light ground; the line itself in the town's colour, softened
      g.strokeStyle = 'rgba(16,22,14,0.26)'; g.lineWidth = (sw + 1.3) / cam.z; g.stroke(path);
      g.strokeStyle = townHex(t); g.globalAlpha = TB.pinned.has(k) ? 0.85 : 0.75; g.lineWidth = sw / cam.z; g.stroke(path);
      g.globalAlpha = 1;
    }
    g.restore();
  }
  // which town hall is under a point of the view: its picture where it is opaque, or its own tile
  function townHallAt(sx, sy, c) {
    const [wx, wy] = toWorld(sx, sy);
    for (const t of WORLD.towns) {
      const h = t.hall;
      if (c && c.x === h.x && c.y === h.y) return t.k;
      const f = GAME[h.key], s = (f.k / f.res) * bScale(h.key), [cx, cy] = twc(h.x, h.y), x0 = cx - f.ax * s, y0 = cy - f.ay * s;
      const px = Math.floor((wx - x0) / s), py = Math.floor((wy - y0) / s);
      if (px < 0 || py < 0 || px >= f.w || py >= f.h) continue;
      let A = TB.alpha[h.key];
      if (!A) { const cv = document.createElement('canvas'); cv.width = f.w; cv.height = f.h; const x = cv.getContext('2d'); x.drawImage(IMG[f.s], f.x, f.y, f.w, f.h, 0, 0, f.w, f.h); A = TB.alpha[h.key] = x.getImageData(0, 0, f.w, f.h).data; }
      if (A[(py * f.w + px) * 4 + 3] > 100) return t.k;
    }
    return -1;
  }
  function setTownHover(k) {
    if (k === TB.hover) return;
    TB.hover = k; view.style.cursor = k >= 0 ? 'pointer' : ''; dirty = true; hint.textContent = hintText();
  }
  function toggleTownPin(k) {
    if (TB.pinned.has(k)) TB.pinned.delete(k); else TB.pinned.add(k);
    dirty = true; hint.textContent = hintText();
  }
  function townHint() {
    const shown = [...new Set([...TB.pinned, ...(TB.hover >= 0 ? [TB.hover] : [])])];
    if (!shown.length) return '';
    return `Town border: ${shown.map((k) => WORLD.towns[k].name + (TB.pinned.has(k) ? ' (pinned)' : '')).join(', ')}${TB.pinned.size ? '; click a pinned town hall again or press Escape to let go' : '; click the town hall to pin it'}`;
  }
  const BIOME_COL = {};
  // ---------- v9, lane L: life in the wind, and Building life (the author's notes of 2026-10-16, items 1 and 2). It
  // reads WIND and windGust (Base's contract) and the animation clock and changes neither. With Calm nothing here moves
  // in the wind: every tree is drawn as v8 drew it, and no tumbleweed or sand blows. The Building life switch (On by
  // default; Off gives v8's buildings) turns the windmill's sails (at the wind's speed; they slow to a stop in a calm),
  // lets smoke rise from the chimneys and bend downwind, and swings the quarry crane's load on its rope in the wind.
  // lifeFrame runs once at the top of every draw (the frame's clock and view); lifeDress runs when the scene is built
  // again (a new SPRITES): it hands the trees and those buildings their own draw and adds the slots the tumbleweeds,
  // the smoke and the drifting sand are drawn in, at their depths. Slots draw nothing in a calm or with Building life
  // Off, and the trees and buildings then make v8's own drawImage call: each frame asks the canvas for exactly what
  // v8's did, in the same order.
  const LIFE = { on: true };
  const LF = { t: 0, dt: 0, k: 1, E: 0, F: 0, vx0: 0, vy0: 0, vx1: 0, vy1: 0, wx: 1, wy: 0 };
  let lifeFor = null;
  function lifeFrame(t, k, vx0, vy0, vx1, vy1) {
    LF.dt = Math.max(0, Math.min(0.1, t - LF.t)); LF.t = t; LF.k = k;
    LF.E = view.width / 2 - cam.x * k; LF.F = view.height / 2 - cam.y * k;
    LF.vx0 = vx0; LF.vy0 = vy0; LF.vx1 = vx1; LF.vy1 = vy1;
    // a move downwind on the ground as the screen shows it, per unit of its length across the screen: across the
    // screen it keeps its length, toward or away from the camera it is half as long (the 2:1 view)
    const a = Math.hypot(WIND.to.sx, 2 * WIND.to.sy) || 1;
    LF.wx = WIND.to.sx / a; LF.wy = WIND.to.sy / a;
    if (lifeFor !== SPRITES) lifeDress();
    millStep();
  }
  const lifeBack = (g) => g.setTransform(LF.k, 0, 0, LF.k, LF.E, LF.F); // the view's own transform again
  const offView = (x, y, w, h) => x > LF.vx1 || y > LF.vy1 || x + w < LF.vx0 || y + h < LF.vy0;
  function lifeDress() {
    lifeFor = SPRITES;
    const add = [];
    for (const s of SPRITES) {
      if (!s.img || s.draw || s.gfOver) continue;
      const m = TREE_RE.exec(s.key);
      if (m && !s.flip) { dressTree(s, m[1]); continue; }
      // (merge) the game's reeds by the lakes and rivers sway as the swamp's do (L2's reed sway), not only in the swamp
      if (!s.flip && /^props\/reeds_/.test(s.key)) { swSway(s, 'reeds', 4647); s.draw = swayTree; continue; }
      if (s.key === 'structures/windmill') { s.draw = millDraw; const sc = s.w / s.sw; MILL.hx = s.x + MILL_HUB[0] * sc; MILL.hy = s.y + MILL_HUB[1] * sc; MILL.spr = s; MILL.alt = null; }
      if (s.key === 'structures/quarry_2') s.draw = craneDraw;
      const ch = CHIMNEYS[s.key];
      if (ch) add.push({ depth: s.depth + 0.002, key: 'life-smoke', draw: smokeDraw, b: s, plumes: ch.map(([px, py, work], i) => plumeOf(s, px, py, work, i)).filter((p) => p), cands: ch.map(([px, py, work], i) => plumeCand(s, px, py, work, i)) });
    }
    smokePick(add);
    millGround();
    desertPlan();
    // the tumbleweeds' slots: five a tile row, so one rolling past a cactus or a fuel pump is drawn in its right place
    for (const q of DESERT.slots) add.push({ depth: q, key: 'life-tumbleweed', draw: tumbleDraw, d0: q - 20 });
    if (add.length) { SPRITES.push(...add); SPRITES.sort((a, b) => a.depth - b.depth); }
    // the drifting sand lies over the ground and the track, under everything that stands up
    FLAT.push({ flat: true, depth: 2e7, key: 'life-sand', draw: sandDraw });
  }

  // ---- trees: each bends from the foot of its picture (the trunk's base and roots stay put), more toward its top, its
  // crown going downwind and back. The picture is drawn in up to three bands (the trunk, the lower crown, the top),
  // each sheared so the band's bottom edge sits on the band below: the bend is a curve x(h) = D (h / H)^p through the
  // bands' edges, which are snapped to the screen's pixel rows so no seam opens or doubles between them. A push toward
  // the camera (or away) squashes the picture (stretches it) a little about its foot, since the top then comes down
  // (goes up) the screen. Nothing else moves with it: the ground under a tree is the ground painter's.
  const TREE_RE = /^props\/(oak|tree|birch|pine|spruce|palm|deadtree)_/;
  // per kind: how far the top goes (a share of the picture's height, scaling the lean below), how fast it swings (Hz)
  // and how the bend grows up the trunk (the exponent; higher keeps the trunk stiffer and bends the top). Conifers are
  // stiff and quick, birches the loosest, the broadleaves between them, a palm loose and slow; a dead tree barely moves
  const SWAY = { oak: [0.8, 0.42, 1.7], tree: [0.9, 0.48, 1.7], birch: [1.15, 0.58, 1.5], pine: [0.7, 0.66, 2.1], spruce: [0.62, 0.72, 2.3], palm: [1.0, 0.36, 1.4], deadtree: [0.25, 0.9, 2] };
  function dressTree(s, kind) {
    const [amp, hz, p] = SWAY[kind], fx = s.x + s.w / 2, fy = s.y + s.h, ix = Math.round(fx * 4), iy = Math.round(fy * 4);
    s.sway = { fx, fy, H: s.h, amp: amp * (0.85 + 0.3 * hash2(ix, iy, 461)), om: 2 * Math.PI * hz * (0.88 + 0.24 * hash2(ix, iy, 462)), ph: 6.2832 * hash2(ix, iy, 463), p };
    s.draw = swayTree;
  }
  // how far a tree's top leans downwind now, a share of its height: a steady lean that grows in a gust, and the tree's
  // own swing about it (two partials, so it never repeats exactly), wider in a gust. A breeze moves the top about a
  // world pixel either way, a storm leans it about a tenth of its height in the strongest gusts
  function treeLean(q, S, t) {
    const gu = windGust(q.fx, q.fy - q.H * 0.7, t);
    const osc = Math.sin(t * q.om + q.ph) + 0.3 * Math.sin(t * q.om * 1.83 + q.ph * 1.7);
    return q.amp * (S * (0.025 + 0.045 * gu) + (0.011 + 0.026 * S) * (0.4 + 0.6 * gu) * osc);
  }
  // the bands' edges, shares of the height: one band while the top moves under 0.6 screen px (a straight shear is then
  // within a tenth of a pixel of the curve), two up to 2.5 px, three beyond; fewer draws where nothing would show
  const SWAY_CUTS = [[0, 1], [0, 0.5, 1], [0, 0.32, 0.64, 1]];
  // the bands are cut from the ground fit's own decoded copy of the props picture (gfSource), never from the page's
  // image itself: an image drawn sheared or in strips changes how the browser scales it afterwards (see GF_COPY), and
  // the trees in a calm are drawn from the image exactly as v8 drew them. Until the copy is ready (a few ms) a tree
  // stands still
  function swaySource(img) { const c = GF_COPY.get(img); return c && c !== 'loading' ? c : gfSource(img); }
  function swayTree(g) {
    const s = this;
    if (offView(s.x, s.y, s.w, s.h)) return;
    const S = WIND.strength, src = S ? swaySource(s.img) : null;
    if (!src) { g.drawImage(s.img, s.sx, s.sy, s.sw, s.sh, s.x, s.y, s.w, s.h); return; } // v8's own call
    const q = s.sway, H = q.H, fy = q.fy, lean = treeLean(q, S, LF.t);
    const D = lean * H * LF.wx, sq = 1 - lean * LF.wy;
    const k = LF.k, E = LF.E, F = LF.F, sc = s.h / s.sh, top = s.y, bot = fy, lift = fy * (1 - sq);
    const snap = (y) => ((Math.round(k * (sq * y + lift) + F) - F) / k - lift) / sq;
    const mv = Math.abs(D) * k + Math.abs(1 - sq) * H * k, cuts = SWAY_CUTS[mv < 0.6 ? 0 : mv < 2.5 ? 1 : 2], n = cuts.length - 1;
    // the edges from the foot up, each but the first and the last on a screen row; the bend through them
    const ys = cuts.map((u, i) => (i === 0 ? bot : i === n ? top : snap(fy - u * H)));
    const hk = ys.map((y, i) => (i === n ? H : fy - y)), dk = hk.map((h) => D * Math.pow(Math.max(0, h) / H, q.p));
    for (let i = 0; i < n; i++) {
      const ya = Math.max(top, ys[i + 1]), yb = Math.min(bot, ys[i]);
      if (yb - ya < 1e-3) continue;
      const m = (dk[i + 1] - dk[i]) / Math.max(1e-6, hk[i + 1] - hk[i]), c = dk[i] + m * (fy - hk[i]);
      g.setTransform(k, 0, -k * m, k * sq, k * c + E, k * lift + F);
      const r0 = (ya - top) / sc, r1 = (yb - top) / sc;
      g.drawImage(src, s.sx, s.sy + r0, s.sw, r1 - r0, s.x, ya, s.w, yb - ya);
    }
    lifeBack(g);
  }

  // ---- the windmill's sails. They are painted into the game's picture (#461 asks Codex for the body without them),
  // so the demo takes them out of it: the sails (their timber, by colour, and the iron of the hub and the spars) are
  // lifted into a picture of their own, and the cap and the tower under them are rebuilt from the picture's own slate
  // and stone, each copied along its own lines (the cap's along the lines to its peak, its eave along the eave, the
  // tower's along its sides two courses up or down, the band under the eave along it), where nothing of the sails
  // touched it; outside the cap and the tower the sails' place goes transparent. The sails' picture then turns about
  // the hub in the sails' own plane, an ellipse measured on the painted X (its two arms' half-diameters, MILL_E1 and
  // MILL_E2), at a speed that follows the wind and the gust at the hub; it slows to a stop in a calm. At rest it lies
  // exactly where the painted sails were.
  const MILL = { body: null, sails: null, failed: false, phi: 0, om: 0, rm: 0, gf: 1, hx: 0, hy: 0 };
  // MILL_E1 and MILL_E2 are the painted X's two arms' half-diameters in the picture's own pixels, which is how the picture's
  // sails lie at rest. MILL_N1 and MILL_N2 are the same two arms as they stand in the game's camera (v9.1): the picture's sails
  // face the viewer (the painted X is nearly a circle, 0.85 minor to major), but the cap, the windshaft and the door face the
  // lower left (+y, SW, the face the game gives its doors), so the wheel's plane holds the tile's x axis and the vertical, and
  // the 2:1 camera (30 degrees down) draws a vertical circle in it as an ellipse 0.61 minor to major. Each arm is the wheel's
  // radius at 45 degrees to the vertical, (x axis +- vertical) over root two, in the picture's pixels; the wheel's radius is
  // the painted sails' (the same height above and below the hub, so its lowest sail clears the ground as theirs did). The turn is A = N R E^-1: at rest the painted sails are laid into that plane (an affine map, which is exactly
  // how a flat sail projects), and they turn in it.
  const MILL_HUB = [102.7, 104], MILL_E1 = [99, 99], MILL_E2 = [98.2, -78.1];
  const MILL_N = (() => {
    const hx = 32, hy = 16, vy = -39.19, ext0 = Math.hypot(MILL_E1[1], MILL_E2[1]); // the painted sails' height above and below the hub
    const n1 = [hx, hy - vy], n2 = [hx, hy + vy], k = ext0 / Math.hypot(n1[1], n2[1]);
    return [[n1[0] * k, n1[1] * k], [n2[0] * k, n2[1] * k]];
  })();
  let millPlane = 'sw'; // 'sw' (v9.1, the cap's face) or 'painted' (v9's plane): the __demo hook only
  // turns a second at the wind's strength (v9.1: continuous in WIND.strength, through v9's three means: 0.1 in a Breeze, 0.17 in
  // Windy, 0.24 in a Storm), times the gust at the hub: 0.65 in a deep lull to 1.35 in the strongest gust
  const MILL_REV = [[0, 0], [0.35, 0.1], [0.7, 0.17], [1, 0.24]];
  const millRev = (s) => { for (let i = 1; i < MILL_REV.length; i++) if (s <= MILL_REV[i][0]) { const a = MILL_REV[i - 1], b = MILL_REV[i]; return a[1] + ((b[1] - a[1]) * (s - a[0])) / (b[0] - a[0]); } return MILL_REV[MILL_REV.length - 1][1]; };
  const millGust = (t) => 0.65 + 0.7 * windGust(MILL.hx, MILL.hy, t);
  // the picture's shapes under the sails, in its own pixels (226 x 240): the eave, the cap's sides, the tower's sides
  const MILL_EAVE = [[70, 101], [92, 112], [100, 113.3], [145, 113.3], [168, 105.3], [171, 104]];
  // the windmill's ground fit (its contact shadow, and the occlusion over its foot) was worked out from the picture
  // with its sails, whose tips come down to the ground: with Building life On it is worked out again, the same way,
  // from the picture without them (millAlt), so no shadow is left under a sail that has turned away
  function millGround() {
    const own = (q) => q.key === 'structures/windmill';
    for (const q of FLAT) if (q.gfShadow && own(q) && !q.life) { const v8 = q.draw; q.life = true; q.draw = function (g) { if (LIFE.on && MILL.alt && !MILL.alt.v8) { if (MILL.alt.shadow) MILL.alt.shadow.draw(g); } else v8.call(this, g); }; }
    for (const q of SPRITES) if (q.gfOver && own(q) && !q.draw) q.draw = function (g) {
      if (LIFE.on && MILL.alt && !MILL.alt.v8) { const o = MILL.alt.over; if (o) g.drawImage(o.img, o.sx, o.sy, o.sw, o.sh, o.x, o.y, o.w, o.h); return; }
      if (offView(this.x, this.y, this.w, this.h)) return;
      g.drawImage(this.img, this.sx, this.sy, this.sw, this.sh, this.x, this.y, this.w, this.h); // v8's own call
    };
  }
  function millAlt(s) {
    const b = WORLD.buildings.find((q) => q.key === 'structures/windmill' && !q.codex);
    if (!b || !GF_FOOT['structures/windmill']) return { v8: true };
    const k2 = 'structures/windmill#life', c = T(b.x, b.y), tmp = [];
    GF_FOOT[k2] = GF_FOOT['structures/windmill']; GF_COPY.set(MILL.body, MILL.body);
    const fake = { img: MILL.body, sx: 0, sy: 0, sw: s.sw, sh: s.sh, x: s.x, y: s.y, w: s.w, h: s.h, depth: s.depth, key: k2 };
    // gfDress also lists the windmill's yard on the tiles it reaches (the painter has painted it already): the lists
    // are put back as they were, so the yard is not listed twice; its colour still sets the seam at the walls' foot
    const live = gfLive, lens = YARDS.map((q) => q.length), sig = YSIG.slice();
    gfLive = true;
    try { gfDress({ ...b, key: k2 }, c, fake, tmp); } finally { gfLive = live; for (let i = 0; i < N; i++) { YARDS[i].length = lens[i]; YSIG[i] = sig[i]; } }
    if (fake.y !== s.y) return { v8: true }; // a plinth under it (not on this map): v8's own fit is kept
    return { shadow: tmp.find((q) => q.gfShadow) || null, over: tmp.find((q) => q.gfOver) || null };
  }
  function millStep() {
    const dt = LF.dt;
    if (!dt) return;
    // (v9.1) the wind's strength eases in over a few seconds as before (a change of weather, and a calm coasting to a stop); the
    // gust at the hub follows quicker (a quarter of a second), so a gust speeds the sails up and a lull slows them
    const want = LIFE.on ? millRev(WIND.strength) : 0;
    MILL.rm += (want - MILL.rm) * (1 - Math.exp(-dt / 1.8));
    MILL.gf += (millGust(LF.t) - MILL.gf) * (1 - Math.exp(-dt / 0.25));
    if (MILL.rm < 1e-4 && !want) MILL.rm = 0;
    MILL.om = 2 * Math.PI * MILL.rm * MILL.gf;
    MILL.phi = (MILL.phi + MILL.om * dt) % (2 * Math.PI);
  }
  function millDraw(g) {
    const s = this;
    if (offView(s.x - s.w * 0.3, s.y - s.h * 0.3, s.w * 1.6, s.h * 1.6)) return;
    if (!LIFE.on || !millCut(s)) { g.drawImage(s.img, s.sx, s.sy, s.sw, s.sh, s.x, s.y, s.w, s.h); return; } // v8's own call
    if (!MILL.alt) MILL.alt = millAlt(s);
    g.drawImage(MILL.body, 0, 0, s.sw, s.sh, s.x, s.y, s.w, s.h);
    // a turn by phi in the sails' plane: A = M R M^-1, M's columns the two half-diameters
    const [ax, ay] = MILL_E1, [bx, by] = MILL_E2, det = ax * by - bx * ay, c = Math.cos(MILL.phi), n = Math.sin(MILL.phi);
    const [px, py] = millPlane === 'sw' ? MILL_N[0] : MILL_E1, [qx, qy] = millPlane === 'sw' ? MILL_N[1] : MILL_E2; // the plane's arms
    const P00 = px * c + qx * n, P01 = -px * n + qx * c, P10 = py * c + qy * n, P11 = -py * n + qy * c; // N R
    const A00 = (P00 * by - P01 * ay) / det, A01 = (-P00 * bx + P01 * ax) / det, A10 = (P10 * by - P11 * ay) / det, A11 = (-P10 * bx + P11 * ax) / det; // N R E^-1
    const [hx, hy] = MILL_HUB, sc = s.w / s.sw, k = LF.k;
    g.setTransform(k * sc * A00, k * sc * A10, k * sc * A01, k * sc * A11, k * (s.x + sc * (hx - A00 * hx - A01 * hy)) + LF.E, k * (s.y + sc * (hy - A10 * hx - A11 * hy)) + LF.F);
    g.drawImage(MILL.sails, 0, 0);
    lifeBack(g);
  }
  function millCut(s) {
    if (MILL.body) return true;
    if (MILL.failed) return false;
    if (s.sw !== 226 || s.sh !== 240) { MILL.failed = true; return false; } // another picture: drawn as it is
    const src = gfSource(s.img);
    if (!src) return false;
    const W0 = s.sw, H0 = s.sh, n = W0 * H0, [HX, HY] = MILL_HUB;
    const cv = document.createElement('canvas'); cv.width = W0; cv.height = H0;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(src, s.sx, s.sy, W0, H0, 0, 0, W0, H0);
    const im = cx.getImageData(0, 0, W0, H0), d = im.data;
    const wood = new Uint8Array(n), V = new Float32Array(n), brown = new Uint8Array(n), iron = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      const r = d[p * 4], gg = d[p * 4 + 1], b = d[p * 4 + 2], a = d[p * 4 + 3], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      V[p] = mx / 255;
      wood[p] = a > 10 && r > gg && gg >= b - 4 && mx && (mx - mn) / mx > 0.38 && mx > 38 ? 1 : 0;
      brown[p] = r > b + 6 ? 1 : 0;
      iron[p] = V[p] < 0.45 && r >= b - 3 ? 1 : 0;
    }
    const dil = (m, times) => {
      let o = m;
      for (let q = 0; q < times; q++) {
        const o2 = o.slice();
        for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) { const i = y * W0 + x; if (!o[i] && ((x > 0 && o[i - 1]) || (x < W0 - 1 && o[i + 1]) || (y > 0 && o[i - W0]) || (y < H0 - 1 && o[i + W0]))) o2[i] = 1; }
        o = o2;
      }
      return o;
    };
    const w1 = dil(wood, 1), w2 = dil(w1, 1), w3 = dil(w2, 1), w4 = dil(w3, 1);
    const eaveY = (x) => {
      const E = MILL_EAVE;
      if (x <= E[0][0]) return E[0][1];
      for (let i = 1; i < E.length; i++) if (x <= E[i][0]) return E[i - 1][1] + ((E[i][1] - E[i - 1][1]) * (x - E[i - 1][0])) / (E[i][0] - E[i - 1][0]);
      return E[E.length - 1][1];
    };
    const roofL = (y) => 108 - (37 * (y - 57)) / 43, roofR = (y) => 124 + (45 * (y - 57)) / 47;
    const xl = (y) => 67 - 0.19 * (y - 188), xr = (y) => 166 + 0.2 * (y - 120);
    const inRoof = (x, y) => y >= 57 && y <= eaveY(x) + 0.5 && x >= roofL(y) - 1.5 && x <= roofR(y) + 1.5;
    const inTower = (x, y) => y > eaveY(x) && y <= 234 && x >= xl(y) - 1.5 && x <= xr(y) + 1.5;
    const shaft = (x, y) => x >= 115 && x <= 125 && y >= 96 && y <= 114; // the windshaft's housing beside the hub stays
    // what the sails cover: their timber and its rim, the iron near them (not the shaft) and the hub; on the cap
    // anything browner than slate next to them, on the tower anything darker than stone next to them
    const mask = new Uint8Array(n);
    for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) {
      const p = y * W0 + x;
      if (!d[p * 4 + 3]) continue;
      const hd = Math.hypot(x - HX, y - HY), hub = Math.hypot(x - HX, (y - HY) * 0.8) < 13;
      // (fix round of v9: the windshaft's housing beside the hub is rebuilt as slate too; kept, its iron and the sails'
      // spars left dark specks on the cap once the sails turned away)
      let m = w1[p] || hub || (V[p] < 0.42 && w4[p] && hd < 48) || (shaft(x, y) && (V[p] < 0.45 || brown[p]));
      if (!m && inRoof(x, y)) m = brown[p] && w3[p];
      else if (!m && inTower(x, y)) m = w2[p] || (V[p] < 0.55 && w3[p]) || (V[p] < 0.4 && hd < 34);
      mask[p] = m ? 1 : 0;
    }
    // (fix round of v9) on the cap and the tower the mask grown by a pixel: the sails' soft rim and shadow on the slate
    // and the stone, left in place, drew their old outline on the rebuilt body
    {
      const g1 = dil(mask, 1);
      for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) { const p = y * W0 + x; if (g1[p] && !mask[p] && d[p * 4 + 3] && (inRoof(x, y) || inTower(x, y)) && !(x >= 94 && x <= 112 && y >= 134 && y <= 167)) mask[p] = 1; }
    }
    // the sails' own picture: the timber and the iron on it, in the picture's colours
    const sl = new ImageData(W0, H0), sd = sl.data;
    for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) {
      const p = y * W0 + x, hub = Math.hypot(x - HX, (y - HY) * 0.8) < 13;
      if (d[p * 4 + 3] && (wood[p] || (iron[p] && !shaft(x, y) && (w2[p] || hub)))) for (let q = 0; q < 4; q++) sd[p * 4 + q] = d[p * 4 + q];
    }
    // the body: every covered pixel rebuilt from an uncovered one of the same surface, or cleared
    const out = new ImageData(new Uint8ClampedArray(d), W0, H0), od = out.data, miss = new Uint8Array(n);
    // (fix round of v9: a donor is opaque, but at the tower's sides, whose edge pixels are copied as they are)
    let edge = false;
    const take = (x, y, roof) => {
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= W0 || yi >= H0) return -1;
      const p = yi * W0 + xi;
      return mask[p] || (roof && brown[p]) || (!edge && d[p * 4 + 3] < 250) ? -1 : p;
    };
    // (fix round of v9) each surface copied coherently: a pixel first tries the offset its left neighbour used, so a run
    // of pixels copies one stretch of courses whole and the stone and slate never tear into a patchwork; the shadow band
    // under the eave looks only a little way along the eave, and where it finds nothing there it takes stone from the
    // tower darkened as the band is
    const EAVE_T = [6, -6, 10, -10, 14, -14, 20, -20, 26, -26, 32, -32, 40, -40];
    const ROOF_T = [8, -8, 12, -12, 16, -16, 20, -20, 24, -24];
    const BAND_T = [8, -8, 14, -14];
    const TOWER_T = [17, -17, 9, -9, 26, -26, 34, -34, 43, -43, 52, -52, 60, -60, 69, -69, 77, -77];
    // the tower's donors keep 2 px clear of the sails (their shadow on the stone) and off the window
    const near = dil(mask, 2), win = (x, y) => x >= 94 && x <= 112 && y >= 134 && y <= 167, tmap = new Int8Array(n);
    const first = (last, list) => (last !== null ? [last, ...list] : list);
    const shade = new Float32Array(n).fill(1);
    for (let y = 0; y < H0; y++) {
      let lE = null, lR = null, lB = null, lT = null;
      for (let x = 0; x < W0; x++) {
      const p = y * W0 + x;
      if (!mask[p]) { lE = lR = lB = lT = null; continue; }
      let src = -1;
      if (inRoof(x, y)) {
        const ey = eaveY(x);
        if (ey - y < 2.5) { // the eave's rim: along the eave, as far below it
          const dd = ey - y;
          for (const t of first(lE, EAVE_T)) { const q = take(x + t, eaveY(x + t) - dd, true); if (q >= 0 && inRoof(x + t, eaveY(x + t) - dd)) { src = q; lE = t; break; } }
        }
        if (src < 0) { // along the line to the cap's peak, a few courses of slate nearer it or further
          const dx = x - 116, dy = y - 55, rho = Math.hypot(dx, dy);
          for (const t of first(lR, ROOF_T)) {
            const f = (rho + t) / rho, sx = 116 + dx * f, sy = 55 + dy * f;
            if (!inRoof(sx, sy) || eaveY(sx) - sy <= 2.5) continue;
            const q = take(sx, sy, true); if (q >= 0) { src = q; lR = t; break; }
          }
        }
      } else if (inTower(x, y)) {
        const ey = eaveY(x);
        if (y - ey < 7) { // the shadow band under the eave: along it
          const dd = y - ey;
          for (const t of first(lB, BAND_T)) { const q = take(x + t, eaveY(x + t) + dd, false); if (q >= 0 && inTower(x + t, eaveY(x + t) + dd)) { src = q; lB = t; break; } }
          if (src < 0) shade[p] = 0.74 + 0.26 * sstep(dd / 7);
        }
        if (src < 0) { // up or down the tower along its sides, one or more courses (8.6 px), the same offset as the pixel
          // to its left or above it where that works, so a block is copied whole
          const u = (x - xl(y)) / (xr(y) - xl(y)), up = y > 0 ? tmap[p - W0] : 0;
          edge = x < xl(y) + 2 || x > xr(y) - 2;
          const cand = up && up !== lT ? [up, ...first(lT, TOWER_T)] : first(lT, TOWER_T);
          for (const t of cand) {
            const y2 = y + t; if (y2 > 234) continue;
            const x2 = xl(y2) + u * (xr(y2) - xl(y2));
            if (y2 - eaveY(x2) < 7 || win(x2, y2)) continue;
            const q = take(x2, y2, false); if (q < 0 || near[q]) continue;
            src = q; lT = t; tmap[p] = t; break;
          }
          edge = false;
        }
      } else { od[p * 4 + 3] = 0; continue; } // outside the cap and the tower: nothing was behind the sails
      if (src >= 0) { const f = shade[p]; for (let q = 0; q < 3; q++) od[p * 4 + q] = d[src * 4 + q] * f; od[p * 4 + 3] = d[src * 4 + 3]; }
      else miss[p] = 1;
      }
    }
    // the sails' last rim pixels outside the cap and the tower (their faint outline, too dark or grey for the timber's
    // colour): cleared, as nothing was behind them there
    for (let y = 60; y < H0; y++) for (let x = 0; x < W0; x++) {
      const p = y * W0 + x;
      if (od[p * 4 + 3] && !inRoof(x, y) && !inTower(x, y) && w4[p]) od[p * 4 + 3] = 0;
    }
    // the last few pixels nothing matched: the mean of their rebuilt neighbours
    for (let pass = 0; pass < 4; pass++) for (let p = 0; p < n; p++) {
      if (!miss[p]) continue;
      const x = p % W0; let k = 0; const acc = [0, 0, 0, 0];
      for (const q of [p - 1, p + 1, p - W0, p + W0]) if (q >= 0 && q < n && !miss[q] && Math.abs((q % W0) - x) <= 1) { for (let c = 0; c < 4; c++) acc[c] += od[q * 4 + c]; k++; }
      if (k) { for (let c = 0; c < 4; c++) od[p * 4 + c] = acc[c] / k; miss[p] = 0; }
    }
    const bc = document.createElement('canvas'); bc.width = W0; bc.height = H0; bc.getContext('2d').putImageData(out, 0, 0);
    const sc2 = document.createElement('canvas'); sc2.width = W0; sc2.height = H0; sc2.getContext('2d').putImageData(sl, 0, 0);
    MILL.body = bc; MILL.sails = sc2;
    return true;
  }

  // ---- the quarry crane's load (structures/quarry_2, 271 x 346): its crate of stone, the slings, the hook and the
  // rope hang free of everything else in the picture, so they are lifted out whole (the sky behind them is empty) and
  // swing from the pulley: downwind, more in a gust, and back, a slow pendulum. Still in a calm.
  const CRANE = { body: null, load: null, failed: false, pivot: [44.5, 41] };
  const craneIn = (x, y) => (y >= 42 && y < 88 && x >= 40 && x <= 49) || (y >= 88 && y <= 169 && x >= 15 && x <= 78);
  function craneCut(s) {
    if (CRANE.body) return true;
    if (CRANE.failed) return false;
    if (s.sw !== 271 || s.sh !== 346) { CRANE.failed = true; return false; }
    const src = gfSource(s.img);
    if (!src) return false;
    const W0 = s.sw, H0 = s.sh;
    const cv = document.createElement('canvas'); cv.width = W0; cv.height = H0;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(src, s.sx, s.sy, W0, H0, 0, 0, W0, H0);
    const body = cx.getImageData(0, 0, W0, H0), load = new ImageData(W0, H0);
    for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) if (craneIn(x, y)) {
      const p = (y * W0 + x) * 4;
      for (let q = 0; q < 4; q++) { load.data[p + q] = body.data[p + q]; body.data[p + q] = 0; }
    }
    const bc = document.createElement('canvas'); bc.width = W0; bc.height = H0; bc.getContext('2d').putImageData(body, 0, 0);
    const lc = document.createElement('canvas'); lc.width = W0; lc.height = H0; lc.getContext('2d').putImageData(load, 0, 0);
    CRANE.body = bc; CRANE.load = lc;
    return true;
  }
  function craneDraw(g) {
    const s = this;
    if (offView(s.x, s.y, s.w, s.h)) return;
    const S = WIND.strength;
    if (!LIFE.on || !S || !craneCut(s)) { g.drawImage(s.img, s.sx, s.sy, s.sw, s.sh, s.x, s.y, s.w, s.h); return; } // v8's own call
    g.drawImage(CRANE.body, 0, 0, s.sw, s.sh, s.x, s.y, s.w, s.h);
    const sc = s.w / s.sw, [px, py] = CRANE.pivot, wx = s.x + px * sc, wy = s.y + py * sc, t = LF.t;
    const gu = windGust(wx, wy + 25, t);
    // the swing across the screen (a push toward or away from the camera barely shows): a lean downwind, a gust's
    // push and the pendulum's own swing (about 2.6 s)
    const sw = LF.wx * S * (0.05 + 0.07 * gu) + S * (0.02 + 0.03 * gu) * Math.sin(t * 2.42 + 0.7);
    const a = -sw, c = Math.cos(a), n = Math.sin(a), k = LF.k;
    g.setTransform(k * sc * c, k * sc * n, -k * sc * n, k * sc * c, k * (wx - sc * (c * px - n * py)) + LF.E, k * (wy - sc * (n * px + c * py)) + LF.F);
    g.drawImage(CRANE.load, 0, 0);
    lifeBack(g);
  }

  // ---- chimney smoke: from the chimney pots of the houses, the town halls, the station, the warehouse, the farm, the
  // sawmill and the pump house (their tops measured on the pictures, in their pixels; 1 marks a works chimney, which
  // always smokes and more thickly; of the houses' about two in three are lit). Each plume is a train of soft puffs,
  // lit from the upper left, rising and spreading; the wind bends it downwind, more in a gust, and a storm tears it
  // flat and short. In a calm it rises straight up. Off with Building life.
  const CHIMNEYS = {
    'structures/town_2': [[54.5, 24], [231, 95]], 'structures/town_3': [[54.1, 23], [228, 94]],
    'structures/townhouse': [[175.5, 6]], 'structures/townhouse_2': [[175.5, 6]], 'structures/townhouse_3': [[175.5, 6]],
    'structures/townhouse_s0': [[121.5, 4]], 'structures/townhouse_s1': [[142.4, 5]], 'structures/townhouse_s2': [[142.4, 5]],
    'structures/station_2': [[64, 3], [135, 24], [200, 50]], 'structures/warehouse_1': [[37, 3], [138, 43]],
    'structures/lumber_2': [[52.5, 4, 1]], 'structures/farm_2': [[192.3, 6]], 'structures/pump_1': [[120.3, 6, 1]],
  };
  function plumeOf(s, px, py, work, i) {
    const sc = s.w / s.sw, x = s.x + px * sc, y = s.y + (py + 1) * sc, h = hash2(Math.round(x * 3), Math.round(y * 3), 470 + i);
    if (!work && h > 0.68) return null; // a cold chimney
    return { x, y, work: !!work, seed: h * 97.3, rate: 0.85 + 0.3 * hash2(Math.round(x), Math.round(y), 471) };
  }
  // (v9.2, Smoke: Tall) the plumes of the tall smoke: every chimney with its hash (the same one plumeOf draws its lots from),
  // then about one house chimney in three lit, the ones with the lowest hash; the works chimneys always smoke
  function plumeCand(s, px, py, work, i) {
    const sc = s.w / s.sw, x = s.x + px * sc, y = s.y + (py + 1) * sc, h = hash2(Math.round(x * 3), Math.round(y * 3), 470 + i);
    return { x, y, work: !!work, h, seed: h * 97.3, rate: 0.85 + 0.3 * hash2(Math.round(x), Math.round(y), 471) };
  }
  const SMOKE_LIT = 1 / 3;
  function smokePick(add) {
    const hs = [];
    for (const a of add) if (a.cands) for (const c of a.cands) if (!c.work) hs.push(c.h);
    hs.sort((p, q) => p - q);
    const thr = hs.length ? hs[Math.max(0, Math.ceil(hs.length * SMOKE_LIT) - 1)] : -1;
    for (const a of add) if (a.cands) a.plumesT = a.cands.filter((c) => c.work || c.h <= thr);
    SMOKE_INFO.houses = hs.length; SMOKE_INFO.litV91 = 0; SMOKE_INFO.litTall = 0; SMOKE_INFO.works = 0;
    for (const a of add) if (a.cands) { for (const c of a.cands) { if (c.work) SMOKE_INFO.works++; else if (c.h <= 0.68) SMOKE_INFO.litV91++; } SMOKE_INFO.litTall += a.plumesT.filter((c) => !c.work).length; }
  }
  const SMOKE_INFO = { houses: 0, litV91: 0, litTall: 0, works: 0 };
  const SMOKE_NT = 16;
  // Smoke: Tall (v9.2, the author: "it does not rise high enough, and it could be sparser"). A plume climbs about 2.7 storeys
  // (42 px, a storey 15.4 px at 9 px for 1.75 m; a works chimney 48 px) above its pot, still in a calm, 0.9 of that in a
  // breeze, 0.66 when windy and 0.3 in a storm, where it lies down torn and short as before. Fewer chimneys are lit and the
  // plume is thin, but it is one column: sixteen puffs that grow and overlap, the youngest on top, with one puff pinned at the
  // pot's mouth (fix round: no air between the pot and the plume; each new puff fades in over the pinned one), each spreading
  // and fading as it climbs; the wind bends the plume downwind more with height (drift grows as the 1.7th power of the age),
  // more in a gust, and in a hard wind the puffs are drawn out along it into a streak that runs on, not discs.
  function smokeDrawTall(g) {
    const S = WIND.strength, t = LF.t, ang = Math.atan2(LF.wy, LF.wx), K = 1 - 0.7 * S * S, N = SMOKE_NT;
    const ages = new Array(N + 1), idx = new Array(N + 1);
    for (const P of this.plumesT) {
      if (offView(P.x - 80, P.y - 75, 160, 90)) continue;
      const H = (P.work ? 48 : 42) * K, life = (P.work ? 8.5 : 9.5) * (1 - 0.3 * S) / P.rate, A = (P.work ? 0.95 : 0.88) * 0.8;
      for (let j = 0; j < N; j++) { ages[j] = (((t / life + j / N + P.seed) % 1) + 1) % 1; idx[j] = j; }
      ages[N] = 0; idx[N] = N; // the pinned puff at the mouth
      idx.sort((p, q) => ages[q] - ages[p]); // oldest first, the youngest over it
      for (let n = 0; n <= N; n++) {
        const j = idx[n], age = ages[j], pin = j === N;
        const gu = windGust(P.x, P.y - 20, t - age * life * 0.5);
        const rise = pin ? 0 : H * (0.8 * age + 0.2 * (1 - (1 - age) * (1 - age))) * (1 + 0.07 * Math.sin(j * 5.3 + P.seed));
        const drift = S * (12 + 38 * S) * (0.7 + 0.6 * gu) * Math.pow(age, 1.7);
        const wob = Math.sin(t * 0.9 + j * 2.1 + P.seed) * 1.8 * Math.pow(age, 0.7) * (1 - 0.6 * S);
        const x = P.x + drift * LF.wx + wob, y = P.y - rise + drift * LF.wy;
        const r = ((P.work ? 1.7 : 1.5) + (P.work ? 4.6 : 4.2) * Math.pow(age, 0.7) * (1 + 0.4 * S)) * (0.88 + 0.24 * hash2(j, Math.round(P.x), 472));
        const a = (pin ? A * 0.9 : Math.min(1, A * Math.min(1, age * N) * Math.pow(1 - age, 0.85))) * (1 - 0.1 * S);
        if (a < 0.01) continue;
        const el = 1 + 1.7 * S * S * Math.min(1, age * 3), rx = r * el, ry = r * (1 - 0.3 * S);
        // a puff is a cluster of three lobes drawn as one shape (a union, so no seams show in it), its lit body over a shade on its lower right
        const q = hash2(j, Math.round(P.y), 473) * 6.2832, c1 = Math.cos(q), s1 = Math.sin(q), c2 = Math.cos(q + 2.3), s2 = Math.sin(q + 2.3);
        // a soft rim first (so the puffs melt into each other), the shade, then the lit body
        g.globalAlpha = a * 0.3; g.fillStyle = P.work ? '#a8a49e' : '#c4c0b9';
        smokeBlob(g, x, y, rx * 1.28, ry * 1.28, ang, r * 1.28, c1, s1, c2, s2, 1.28); g.fill();
        g.globalAlpha = a * 0.5; g.fillStyle = P.work ? '#8f8c88' : '#a9a6a1';
        smokeBlob(g, x + r * 0.22, y + r * 0.2, rx, ry, ang, r, c1, s1, c2, s2, 1); g.fill();
        g.globalAlpha = a; g.fillStyle = P.work ? '#c9c5bd' : '#e2ded6';
        smokeBlob(g, x - r * 0.12, y - r * 0.12, rx * 0.82, ry * 0.82, ang, r * 0.82, c1, s1, c2, s2, 0.82); g.fill();
      }
    }
    g.globalAlpha = 1;
  }
  function smokeBlob(g, x, y, rx, ry, ang, r, c1, s1, c2, s2, k) {
    g.beginPath();
    g.moveTo(x + rx * Math.cos(ang), y + rx * Math.sin(ang)); g.ellipse(x, y, rx, ry, ang, 0, 6.2832);
    const ax = x + r * 0.55 * c1, ay = y + r * 0.45 * s1, bx = x + r * 0.5 * c2, by = y + r * 0.4 * s2, ra = rx * 0.66, rb = rx * 0.58, rya = ry * 0.66, ryb = ry * 0.58;
    g.moveTo(ax + ra * Math.cos(ang), ay + ra * Math.sin(ang)); g.ellipse(ax, ay, ra, rya, ang, 0, 6.2832);
    g.moveTo(bx + rb * Math.cos(ang), by + rb * Math.sin(ang)); g.ellipse(bx, by, rb, ryb, ang, 0, 6.2832);
  }
  const SMOKE_N = 14;
  function smokeDraw(g) {
    if (!LIFE.on) return;
    if (smokeMode === 'tall') { smokeDrawTall.call(this, g); return; }
    const S = WIND.strength, t = LF.t, ang = Math.atan2(LF.wy, LF.wx);
    for (const P of this.plumes) {
      if (offView(P.x - 70, P.y - 60, 140, 70)) continue;
      const life = (P.work ? 4.2 : 4.8) * (1 - 0.35 * S) / P.rate, A = P.work ? 0.5 : 0.4;
      for (let j = SMOKE_N - 1; j >= 0; j--) {
        const age = (((t / life + j / SMOKE_N + P.seed) % 1) + 1) % 1;
        // where this puff is: it rises, slowing, and drifts downwind, more as it climbs; a gust bends it further
        const gu = windGust(P.x, P.y - 10, t - age * life * 0.5);
        const rise = (P.work ? 18 : 15) * (1 - 0.6 * S) * (0.35 * age + 0.65 * (1 - Math.pow(1 - age, 1.6)));
        const drift = S * (6 + 30 * S) * (0.7 + 0.6 * gu) * Math.pow(age, 1.35);
        const wob = Math.sin(t * 1.3 + j * 1.7 + P.seed) * 0.8 * age * (1 - 0.6 * S);
        const x = P.x + drift * LF.wx + wob, y = P.y - rise + drift * LF.wy;
        const r = (P.work ? 1.3 : 1.0) + (P.work ? 3.6 : 3.0) * age * (1 + 0.4 * S);
        // it shows from the pot's mouth (no gap above the chimney) and thins away as it spreads; a hard wind draws
        // each puff out along it, so the plume lies down in a torn streak rather than vanishing
        const a = A * Math.min(1, age * 9) * Math.pow(1 - age, 1.3) * (1 - 0.1 * S);
        if (a < 0.01) continue;
        const rx = r * (1 + 1.1 * S * Math.min(1, age * 3)), ry = r * (1 - 0.25 * S);
        // a shade on its lower right, the lit body over it toward the upper left
        g.globalAlpha = a * 0.7; g.fillStyle = P.work ? '#8f8c88' : '#a9a6a1';
        g.beginPath(); g.ellipse(x + r * 0.22, y + r * 0.2, rx, ry, ang, 0, 6.2832); g.fill();
        g.globalAlpha = a; g.fillStyle = P.work ? '#c9c5bd' : '#e2ded6';
        g.beginPath(); g.ellipse(x - r * 0.12, y - r * 0.12, rx * 0.82, ry * 0.82, ang, 0, 6.2832); g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  // ---- the desert: tumbleweeds and drifting sand. Desert ground is the desert's sand tiles (not a beach); a building,
  // water and rock are never desert, so neither tumbleweeds nor sand cross them (track and roads across the sand are
  // crossed). The tumbleweeds roll along lanes downwind, each lane a run of desert at least 0.2 tile from anything else
  // that is not desert; each enters at its run's upwind end and leaves at the downwind end, bouncing and spinning,
  // with a small shadow on the ground under it: one now and then in a breeze, a few when windy, many in a storm. Low
  // over the sand, soft streaks of it drift downwind in the gusts, more and stronger with the wind.
  const DESERT = { mask: null, lanes: null, from: '', slots: [], obst: [], tw: null };
  function desertPlan() {
    if (!DESERT.mask) {
      const m = new Uint8Array(N);
      for (const c of map) m[c.i] = c.kind === 'land' && c.terrain === 'sand' && c.biome !== 'beach' && c.climate === 'desert' && !c.building && !c.pond && !c.cove ? 1 : 0;
      DESERT.mask = m;
      // the slots: depths from the desert's nearest tile row to its furthest, five a row
      let lo = Infinity, hi = -Infinity;
      for (const c of map) if (m[c.i]) { lo = Math.min(lo, c.x + c.y); hi = Math.max(hi, c.x + c.y); }
      DESERT.slots = [];
      if (lo <= hi) for (let d = (lo - 1) * 100; d <= (hi + 1) * 100 + 99; d += 20) DESERT.slots.push(d + 19.9);
      // what stands on the sand (the cacti, the dead trees, a palm): a tumbleweed keeps clear of its foot, so it never
      // rolls through one. Each foot back in tile coordinates from its picture's anchor (the level's lift taken off)
      DESERT.obst = [];
      for (const q of SPRITES) {
        const mm = q.img && q.key ? /^props\/(cactus|deadtree|palm)_/.exec(q.key) : null;
        if (!mm) continue;
        const f = GAME[q.key], sc = q.w / q.sw, wx = q.x + f.ax * sc, wy = q.y + f.ay * sc, u = wx / 32;
        let v = wy / 16;
        for (let it = 0; it < 3; it++) v = (wy + heightAt((v + u) / 2, (v - u) / 2)) / 16;
        const tx = (v + u) / 2, ty = (v - u) / 2;
        if (desertAt(tx, ty)) DESERT.obst.push([tx, ty, mm[1] === 'cactus' ? 0.2 : 0.28]);
      }
    }
  }
  const desertAt = (tx, ty) => { const x = Math.round(tx), y = Math.round(ty); return inb(x, y) && DESERT.mask[idx(x, y)] === 1; };
  // how much desert is round a point (0..1), blended between tile centres: the sand streaks fade out at its edges
  function desertness(tx, ty) {
    const x0 = Math.floor(tx), y0 = Math.floor(ty), fx = tx - x0, fy = ty - y0, m = DESERT.mask;
    const at = (x, y) => (inb(x, y) ? m[idx(x, y)] : 0);
    return sstep((at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy - 0.25) / 0.5);
  }
  // a point of a lane, s tiles along it: on its line, stepped aside round whatever stands in its way (a smooth detour
  // that passes each cactus or dead tree at its keep-clear distance)
  function lanePos(L, s) {
    let dev = 0;
    for (const q of L.dt) { const a = Math.abs(s - q.s) / q.w; if (a < 1) dev += q.d * (1 + Math.cos(Math.PI * a)) / 2; }
    return [L.ox + L.ux * s + L.px * dev, L.oy + L.uy * s + L.py * dev];
  }
  function desertLanes() {
    if (DESERT.from === WIND.from && DESERT.lanes) return DESERT.lanes;
    const u = WIND.toTile, px = -u.y, py = u.x, lanes = [];
    const clear = (x, y) => desertAt(x, y) && desertAt(x + 0.2, y) && desertAt(x - 0.2, y) && desertAt(x, y + 0.2) && desertAt(x, y - 0.2);
    // lanes across the whole map, 0.3 tile apart, sampled every 0.08 tile along the wind; a run ends where the desert
    // does (its detours included), so a tumbleweed never leaves the sand
    const R = Math.hypot(W, H);
    for (let c = -R; c <= R; c += 0.3) {
      const ox = W / 2 + px * c, oy = H / 2 + py * c, dt = [];
      for (const [qx, qy, r] of DESERT.obst) {
        const e = (qx - ox) * px + (qy - oy) * py;
        if (Math.abs(e) < r) dt.push({ s: (qx - ox) * u.x + (qy - oy) * u.y, d: e >= 0 ? e - r : e + r, w: r + 0.35 });
      }
      const L0 = { ox, oy, ux: u.x, uy: u.y, px, py, dt };
      let run = null;
      for (let s = -R; s <= R; s += 0.08) {
        const [x, y] = lanePos(L0, s);
        if (clear(x, y)) { if (!run) run = { ...L0, s0: s, s1: s }; else run.s1 = s; }
        else if (run) { if (run.s1 - run.s0 > 1.2) lanes.push(run); run = null; }
      }
      if (run && run.s1 - run.s0 > 1.2) lanes.push(run);
    }
    DESERT.lanes = lanes; DESERT.from = WIND.from;
    return lanes;
  }
  // how many tumbleweeds may be out at once, by weather, how fast they go (tiles a second) and the rest between two
  const TUMBLE = { calm: [0, 0, 0], breeze: [1, 0.5, 9], windy: [5, 0.95, 3], storm: [14, 1.5, 1.2] };
  let TW_FRAME = -1, TW_LIST = [];
  function tumbleweeds() {
    if (TW_FRAME === LF.t && TW_LIST.frameFor === WIND.level + WIND.from) return TW_LIST;
    TW_FRAME = LF.t; TW_LIST = []; TW_LIST.frameFor = WIND.level + WIND.from;
    const [n, v0, rest] = TUMBLE[WIND.level], S = WIND.strength;
    if (!n) return TW_LIST;
    const lanes = desertLanes();
    if (!lanes.length) return TW_LIST;
    const t = LF.t;
    let longest = 0; for (const l of lanes) longest = Math.max(longest, l.s1 - l.s0);
    for (let j = 0; j < n; j++) {
      const v = v0 * (0.75 + 0.5 * hash2(j, 7, 480)), period = longest / v + rest * (0.6 + 0.8 * hash2(j, 8, 480));
      const T = t + period * hash2(j, 9, 480), cyc = Math.floor(T / period), tau = T - cyc * period;
      const lane = lanes[Math.floor(hash2(j, cyc, 481) * lanes.length)], d = tau * v, len = lane.s1 - lane.s0;
      if (d > len) continue; // this one is out of the desert until its next turn
      const [tx, ty] = lanePos(lane, lane.s0 + d);
      const r = 2.2 + 1.0 * hash2(j, cyc, 482); // world px: a big one is about half a person's height
      // in and out at the run's ends: it fades in from and out into the desert's edge over 0.35 tile
      const edge = sstep(Math.min(d, len - d) / 0.35);
      const hop = 0.55 + 0.5 * hash2(j, cyc, 483), gu = windGust((tx - ty) * 32, (tx + ty) * 16, t);
      const bounce = (1.2 + 3.2 * S * (0.4 + 0.6 * gu)) * Math.abs(Math.sin((Math.PI * d) / hop + hash2(j, cyc, 484) * 3));
      TW_LIST.push({ tx, ty, depth: (tx + ty) * 100 + 15, r: r * (0.8 + 0.2 * edge), a: edge, bounce, spin: (d * 45) / r, kind: (j + cyc) % 3, dir: LF.wx < 0 ? -1 : 1 });
    }
    return TW_LIST;
  }
  // three tumbleweeds, drawn once at 8 picture px a world px: an open, airy ball of dry twigs, a denser tangle in its
  // middle that the ground shows through, twig ends breaking its outline. They turn as they roll; the light does not:
  // each is drawn turned to 16 angles, every one lit from the upper left and shaded on the lower right (on the twigs
  // only), into one sheet (DESERT.twSheet, a row a tumbleweed), so it is always lit from one side, no light falls on
  // the ground round it, and a frame draws each with one call from the sheet
  const TW_R = 20, TW_TURNS = 16;
  function twPictures() {
    if (DESERT.tw) return DESERT.tw;
    const size = 2 * TW_R + 8, o = TW_R + 4;
    DESERT.tw = [0, 1, 2].map((v) => {
      const cv = document.createElement('canvas'); cv.width = cv.height = size;
      const x = cv.getContext('2d'), h = (q, k) => hash2(v * 97 + q, k, 490);
      // the tangle in the middle: see-through, densest at the centre
      const gr = x.createRadialGradient(o, o, 0, o, o, TW_R * 0.82);
      gr.addColorStop(0, 'rgba(104,80,52,0.62)'); gr.addColorStop(0.65, 'rgba(120,94,62,0.36)'); gr.addColorStop(1, 'rgba(120,94,62,0)');
      x.fillStyle = gr; x.beginPath(); x.arc(o, o, TW_R * 0.82, 0, 6.2832); x.fill();
      // the twigs: arcs over the ball, in three dry tones, a few long enough to stick out of it
      x.lineCap = 'round';
      for (let q = 0; q < 64; q++) {
        const a = h(q, 1) * 6.2832, d = TW_R * 0.5 * Math.sqrt(h(q, 2)), cx = o + Math.cos(a) * d, cy = o + Math.sin(a) * d;
        const rr = TW_R * (0.3 + 0.45 * h(q, 3)), a0 = h(q, 4) * 6.2832, sw = 0.6 + 1.2 * h(q, 5), tone = h(q, 6);
        x.strokeStyle = tone < 0.3 ? 'rgb(106,82,54)' : tone < 0.78 ? 'rgb(158,130,90)' : 'rgb(192,168,124)';
        x.lineWidth = 1.3 + 1.3 * h(q, 7);
        x.beginPath(); x.arc(cx, cy, rr, a0, a0 + sw); x.stroke();
      }
      // its outline: round, soft over the last few picture pixels, so only the odd twig end shows past it
      x.globalCompositeOperation = 'destination-in';
      const cut = x.createRadialGradient(o, o, TW_R * 0.9, o, o, TW_R * 1.12);
      cut.addColorStop(0, 'rgba(0,0,0,1)'); cut.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = cut; x.fillRect(0, 0, size, size);
      x.globalCompositeOperation = 'source-over';
      return cv;
    });
    const lc = document.createElement('canvas'); lc.width = lc.height = size;
    const x = lc.getContext('2d'), gr = x.createRadialGradient(o - TW_R * 0.4, o - TW_R * 0.45, 0, o - TW_R * 0.4, o - TW_R * 0.45, TW_R * 1.7);
    gr.addColorStop(0, 'rgba(244,228,186,0.55)'); gr.addColorStop(0.3, 'rgba(244,228,186,0.12)'); gr.addColorStop(0.5, 'rgba(58,44,30,0)'); gr.addColorStop(0.85, 'rgba(58,44,30,0.5)');
    x.fillStyle = gr; x.fillRect(0, 0, size, size);
    const sh = document.createElement('canvas'); sh.width = size * TW_TURNS; sh.height = size * 3;
    const sx = sh.getContext('2d'), one = document.createElement('canvas'); one.width = one.height = size;
    const cx = one.getContext('2d');
    for (let v = 0; v < 3; v++) for (let a = 0; a < TW_TURNS; a++) {
      cx.setTransform(1, 0, 0, 1, 0, 0); cx.globalCompositeOperation = 'source-over'; cx.clearRect(0, 0, size, size);
      cx.translate(o, o); cx.rotate((a * 2 * Math.PI) / TW_TURNS); cx.drawImage(DESERT.tw[v], -o, -o);
      cx.setTransform(1, 0, 0, 1, 0, 0); cx.globalCompositeOperation = 'source-atop'; cx.drawImage(lc, 0, 0);
      sx.drawImage(one, a * size, v * size);
    }
    DESERT.twSheet = sh;
    return DESERT.tw;
  }
  function tumbleDraw(g) {
    if (!WIND.strength) return;
    const list = tumbleweeds();
    if (!list.length) return;
    twPictures();
    const size = 2 * TW_R + 8, step = (2 * Math.PI) / TW_TURNS;
    for (const w of list) {
      if (w.depth <= this.d0 || w.depth > this.depth) continue;
      const z = heightAt(w.tx, w.ty), wx = (w.tx - w.ty) * 32, wy = (w.tx + w.ty) * 16 - z;
      if (offView(wx - 10, wy - 20, 20, 30)) continue;
      // its shadow on the ground, smaller and fainter the higher it bounces
      const lift = w.bounce, sh = Math.max(0.35, 1 - lift / 7);
      g.globalAlpha = 0.26 * w.a * sh; g.fillStyle = 'rgb(26,30,33)';
      g.beginPath(); g.ellipse(wx + 0.6, wy + 0.2, w.r * 1.05 * sh, w.r * 0.42 * sh, 0, 0, 6.2832); g.fill();
      // the ball at its turn (the nearest of the sheet's), lit where it stands
      const turn = (((Math.round((w.spin * w.dir) / step) % TW_TURNS) + TW_TURNS) % TW_TURNS), sz = (w.r * size) / TW_R;
      g.globalAlpha = w.a;
      g.drawImage(DESERT.twSheet, turn * size, w.kind * size, size, size, wx - sz / 2, wy - lift - w.r * 0.95 - sz / 2, sz, sz);
    }
    g.globalAlpha = 1;
  }
  // the sand streaks: each lives a few seconds over a desert tile it picked, drifting downwind with the gust bands,
  // fading in and out, and fading where the desert ends. Each is a soft wisp of pale sand, a main strand on a gentle
  // wave with a fainter one under it, its ends and edges feathered (no grain: one smooth wash), its upper edge a little
  // lighter as the light comes from above; it lengthens as it drifts
  const SAND = { calm: 0, breeze: 12, windy: 30, storm: 56 };
  let SAND_PIC = null;
  function sandPictures() {
    const Wp = 96, Hp = 16;
    return [0, 1, 2].map((v) => {
      const cv = document.createElement('canvas'); cv.width = Wp; cv.height = Hp;
      const x = cv.getContext('2d'), im = x.createImageData(Wp, Hp), d = im.data;
      const ph = hash2(v, 1, 498) * 6.2832, ph2 = hash2(v, 2, 498) * 6.2832, f1 = 0.8 + 0.6 * hash2(v, 3, 498);
      for (let i = 0; i < Wp; i++) {
        const u = (i + 0.5) / Wp, env = Math.pow(Math.sin(Math.PI * u), 0.9) * (0.8 + 0.2 * Math.sin(Math.PI * u * 2 + ph2));
        const c1 = 8 + 1.8 * Math.sin(2 * Math.PI * u * f1 + ph) - 1.2 * u, w1 = 0.9 + 1.5 * Math.sin(Math.PI * u);
        const c2 = c1 + 3.3 + 0.8 * Math.sin(2 * Math.PI * u * 1.7 + ph2), w2 = 0.6 + 0.7 * Math.sin(Math.PI * u), e2 = 0.42 * sstep((u - 0.12) / 0.2) * sstep((0.86 - u) / 0.2);
        for (let j = 0; j < Hp; j++) {
          const y1 = (j + 0.5 - c1) / w1, a1 = Math.exp(-y1 * y1), y2 = (j + 0.5 - c2) / w2, a2 = e2 * Math.exp(-y2 * y2);
          const a = Math.min(1, a1 + a2) * env, l = sstep(0.5 - y1 * 0.5), p = (j * Wp + i) * 4;
          d[p] = 238 + 15 * l; d[p + 1] = 222 + 21 * l; d[p + 2] = 180 + 34 * l; d[p + 3] = Math.round(255 * a);
        }
      }
      x.putImageData(im, 0, 0);
      return cv;
    });
  }
  function sandDraw(g) {
    const S = WIND.strength, n = SAND[WIND.level];
    if (!S || !n) return;
    desertPlan();
    const lanes = desertLanes();
    if (!lanes.length) return;
    if (!SAND_PIC) SAND_PIC = sandPictures();
    const t = LF.t, k = LF.k, ang = Math.atan2(LF.wy, LF.wx), ca = Math.cos(ang), sa = Math.sin(ang);
    const sp = Math.hypot(LF.wx, LF.wy); // how much of the ground speed shows on screen
    for (let j = 0; j < n; j++) {
      const life = 1.1 + 1.1 * hash2(j, 1, 495), T = t + life * hash2(j, 2, 495), cyc = Math.floor(T / life), tau = (T - cyc * life) / life;
      // on one of the tumbleweeds' lanes (runs of desert downwind), so its whole drift stays over the sand: the sand moves
      // on the ground slower than the gust bands over it, about 1 to 2 tiles a second
      const lane = lanes[Math.floor(hash2(j, cyc, 496) * lanes.length)], len = lane.s1 - lane.s0;
      const travel = life * (0.5 + 1.3 * S) * (0.8 + 0.4 * hash2(j, 3, 495));
      const s = lane.s0 + (len > travel ? hash2(j, cyc, 497) * (len - travel) : (len - travel) / 2) + tau * travel;
      const [tx, ty] = lanePos(lane, s);
      const de = desertness(tx, ty);
      if (de <= 0.01) continue;
      const wx = (tx - ty) * 32, wy = (tx + ty) * 16 - heightAt(tx, ty) - 0.8;
      if (offView(wx - 30, wy - 10, 60, 20)) continue;
      const gu = windGust(wx, wy, t);
      const a = (0.22 + 0.42 * S) * (0.25 + 0.75 * gu) * Math.sin(Math.PI * tau) * de;
      if (a < 0.008) continue;
      const sl = (18 + 36 * S) * (0.6 + 0.6 * hash2(j, cyc, 499)) * (0.35 + 0.65 * sp) * (0.75 + 0.5 * tau), th = (2.0 + 2.6 * S * hash2(j, cyc, 500)) / 5;
      g.globalAlpha = a;
      g.setTransform(k * ca * sl / 96, k * sa * sl / 96, -k * sa * th, k * ca * th, k * wx + LF.E, k * wy + LF.F);
      g.drawImage(SAND_PIC[(j + cyc) % 3], -48, -8);
    }
    g.globalAlpha = 1;
    lifeBack(g);
  }
  // ---------- v9, lane L2: a swamp coast (the author's notes of 2026-10-16, item 4: "the forest biome by the sea ...
  // sometimes it could become a mangrove or swamp biome, and we would put these trees there, directly on the waterfront").
  // On the peninsula west of the bay, where the forest meets the sea, the Coast switch (Swamp by default; Forest gives
  // v8's sandy coast) turns the beach and the forest's edge into a mangrove swamp: dark wet earth and moss in broad
  // clusters, pools that hold the sky's light, a ragged muddy waterline instead of the beach and murky shallows along
  // it; mangroves on arched prop roots at the waterline and in the shallows, weeping willows on the banks behind them,
  // reeds and cattails in clumps, a dead snag or two, and the forest's own trees where the ground rises away from the
  // water. The mangroves and willows are the demo's procedural placeholders until Codex delivers #460 (their tooltips
  // say so). They sway in the wind as L1's trees do; the willows' hanging curtains swing more, and later than the crown.
  // The water at their roots is the sea's own, painted and animated by the water code. The swamp stops short of the
  // approved views (the hill's at x + y >= 29); with Forest nothing here runs, so the ground and the trees are L1's.
  const SWAMP = { on: true };
  // per tile: the swamp's part (SWZ: 0 none, 1 swamp ground where the beach was, 2 the forest's edge by it, 3 the
  // shallows, 4 the forest further in), its weight at the tile's centre (SWF, blended between centres, so nothing ends on
  // a tile edge), how wet its ground is (SWW), the tiles the painter asks swampAt about (SWN), land or water (SWLP)
  const SWZ = new Uint8Array(N), SWF = new Float32Array(N), SWW = new Float32Array(N), SWN = new Uint8Array(N), SWLP = new Uint8Array(N);
  const SW_TILES = [];
  const SWO = new Float64Array(4), SWC = new Float64Array(3), SWM = new Float64Array(2);
  let SW_HIT = false, SW_FL = 0, SW_FM = 1;
  function swampPlan() {
    for (const c of map) SWLP[c.i] = c.kind === 'ocean' || c.kind === 'lake' ? 0 : 1;
    // the peninsula and the bay's corner beside it: their beach where the climate is forest or taiga
    const box = (c) => c.x >= 4 && c.x <= 11 && c.y >= 11 && c.y <= 19 && c.x + c.y <= 28;
    for (const c of map) if (box(c) && c.kind === 'land' && c.biome === 'beach' && (c.climate === 'forest' || c.climate === 'taiga')) SWZ[c.i] = 1;
    const near = (c, f) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const o = tileAt(c.x + dx, c.y + dy); if (o && o !== c && f(o)) return true; } return false; };
    for (const c of map) {
      if (SWZ[c.i]) continue;
      if (c.kind === 'ocean' && near(c, (o) => SWZ[o.i] === 1)) SWZ[c.i] = 3;
      else if (box(c) && c.kind === 'land' && c.terrain === 'forest') SWZ[c.i] = near(c, (o) => SWZ[o.i] === 1 || o.kind === 'ocean') ? 2 : 4;
    }
    for (const c of map) {
      const z = SWZ[c.i];
      SWF[c.i] = z === 1 || z === 3 ? 1 : z === 2 ? 0.95 : z === 4 ? 0.8 : 0;
      SWW[c.i] = z === 1 || z === 3 ? 1 : z === 2 ? 0.5 : z === 4 ? 0.2 : 0;
    }
    for (const c of map) if (SWF[c.i] > 0) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inb(c.x + dx, c.y + dy)) SWN[idx(c.x + dx, c.y + dy)] = 1;
    for (let i = 0; i < N; i++) if (SWN[i]) SW_TILES.push(i);
    // the forest floor's mean light, so its texture's clusters keep their light and shade on the swamp's colours
    let s = 0, n = 0;
    for (let y = 150; y <= 436; y += 2) for (let x = 24; x <= 486; x += 2) { const o = ((M.FOREST * 512 + y) * 512 + x) * 4, v = SUR[o] + SUR[o + 1] + SUR[o + 2]; if (v > 30) { s += v; n++; } }
    SW_FM = n ? s / n : 200;
  }
  swampPlan();
  const swLand = (i, j) => SWLP[(j < 0 ? 0 : j > H - 1 ? H - 1 : j) * W + (i < 0 ? 0 : i > W - 1 ? W - 1 : i)];
  // the old waterline: how far a point of the material blend (its warped place, as shadeAt finds it) is from the nearest
  // tile edge between land and water, + on land, - on water, at most half a tile. Asked of every edge round the point's
  // tile, so it is continuous everywhere (it changes sign only on the line) and the swamp's line can grow out of it
  function swEdge(mx, my) {
    const i0 = Math.round(mx), j0 = Math.round(my), own = swLand(i0, j0);
    let d = 0.5;
    for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0; i++) {
      if (swLand(i, j) === swLand(i + 1, j)) continue;
      const dx = Math.abs(mx - i - 0.5), ey = Math.abs(my - j) - 0.5, dd = ey > 0 ? Math.sqrt(dx * dx + ey * ey) : dx;
      if (dd < d) d = dd;
    }
    for (let j = j0 - 1; j <= j0; j++) for (let i = i0 - 1; i <= i0 + 1; i++) {
      if (swLand(i, j) === swLand(i, j + 1)) continue;
      const dy = Math.abs(my - j - 0.5), ex = Math.abs(mx - i) - 0.5, dd = ex > 0 ? Math.sqrt(dy * dy + ex * ex) : dy;
      if (dd < d) d = dd;
    }
    return own ? d : -d;
  }
  // the warped point of the material blend, as shadeAt finds it (off the mountain, where no level edge locks it)
  function swWarp(tx, ty) {
    VN_IN[0] = tx * 3.1; VN_IN[1] = ty * 3.1; VN_IN[2] = tx * 3.1 + 71; VN_IN[3] = ty * 3.1 + 13; VN_IN[4] = tx * 10 + 5; VN_IN[5] = ty * 10; VN_IN[6] = tx * 10; VN_IN[7] = ty * 10 + 5;
    vnoiseN(4);
    const ck = coastAt(tx, ty), a1 = 0.58 - 0.18 * ck, a2 = 0.22 - 0.12 * ck;
    const mx = tx + (VN_OUT[0] - 0.5) * a1 + (VN_OUT[2] - 0.5) * a2, my = ty + (VN_OUT[1] - 0.5) * a1 + (VN_OUT[3] - 0.5) * a2;
    SWM[0] = mx < -0.499 ? -0.499 : mx > W - 0.501 ? W - 0.501 : mx; SWM[1] = my < -0.499 ? -0.499 : my > H - 0.501 ? H - 0.501 : my;
  }
  // the swamp's waterline wanders off the old one in lobes of mud, inlets and the odd hummock (tiles; a little seaward)
  function swRag(tx, ty) {
    VN_IN[0] = tx * 2.3 + 37; VN_IN[1] = ty * 2.3 + 11; VN_IN[2] = tx * 5.9 + 3; VN_IN[3] = ty * 5.9 + 61; VN_IN[4] = tx * 13.7 + 23; VN_IN[5] = ty * 13.7 + 7;
    vnoiseN(3);
    return (VN_OUT[0] - 0.5) * 0.46 + (VN_OUT[1] - 0.5) * 0.24 + (VN_OUT[2] - 0.5) * 0.09 + 0.06;
  }
  // the swamp's waterline at a point (tiles, + on land): the old line moved by the swamp's wander
  function swShore(tx, ty) { swWarp(tx, ty); const e = swEdge(SWM[0], SWM[1]), sw = bil(SWF, tx, ty); return sw > 0 ? e + sw * swRag(tx, ty) : e; }
  // the swamp's ground at a point of land, unlit (the painter lights and tints it as any ground): peat in two shades,
  // moss cushions lit on their upper left (more as the ground dries away from the water), mud in the wet hollows and
  // along the water, wettest right at it, and pools that hold the sky: a quiet teal, lighter where they reflect the sky,
  // a dark lip on their upper-left side (the bank turned from the light) and a wet light one on their lower right.
  // The forest floor's own texture gives every cluster its grain. SW_FL: the grass pass's flag (no tufts in mud or pools)
  const SW_PEAT = [68, 70, 42], SW_PEAT2 = [82, 86, 48], SW_MOSS = [94, 104, 50], SW_MOSSL = [114, 122, 60], SW_MOSSD = [70, 80, 40];
  const SW_MUD = [66, 55, 39], SW_MUDW = [47, 42, 33], SW_POOL = [80, 122, 124], SW_SKY = [112, 152, 152], SW_POOLD = [50, 74, 70], SW_MURK = [62, 94, 84];
  const swMix = (c, k) => { SWC[0] += (c[0] - SWC[0]) * k; SWC[1] += (c[1] - SWC[1]) * k; SWC[2] += (c[2] - SWC[2]) * k; };
  function swGround(tx, ty, wx, wyg, s, wet) {
    sampleMat(M.FOREST, tx, ty, wx, wyg);
    let tm = 1 + 0.6 * ((V[0] + V[1] + V[2]) / SW_FM - 1); tm = tm < 0.72 ? 0.72 : tm > 1.3 ? 1.3 : tm;
    // (away from the light: about +x, a little +y, in tile terms)
    const lx = 0.06, ly = 0.022;
    VN_IN[0] = tx * 1.9 + 5; VN_IN[1] = ty * 1.9 + 71; VN_IN[2] = tx * 4.7 + 19; VN_IN[3] = ty * 4.7 + 3;
    VN_IN[4] = (tx + lx) * 1.9 + 5; VN_IN[5] = (ty + ly) * 1.9 + 71; VN_IN[6] = (tx + lx) * 4.7 + 19; VN_IN[7] = (ty + ly) * 4.7 + 3;
    VN_IN[8] = tx * 1.2 + 31; VN_IN[9] = ty * 1.2 + 17; VN_IN[10] = tx * 2.6 + 61; VN_IN[11] = ty * 2.6 + 43;
    vnoiseN(6);
    const mo = 0.65 * VN_OUT[0] + 0.35 * VN_OUT[1], mo2 = 0.65 * VN_OUT[2] + 0.35 * VN_OUT[3], pn = VN_OUT[4], mn = VN_OUT[5];
    SWC[0] = SW_PEAT[0]; SWC[1] = SW_PEAT[1]; SWC[2] = SW_PEAT[2];
    swMix(SW_PEAT2, sstep((pn - 0.45) / 0.2));
    // moss
    const mk = sstep((mo - (0.6 - 0.16 * (1 - wet))) / 0.05) * sstep((s - 0.1) / 0.12);
    if (mk > 0) {
      const lit = (mo2 - mo) * 40; // its rise away from the light: + on the side the light falls on
      const r0 = SWC[0], g0 = SWC[1], b0 = SWC[2];
      SWC[0] = SW_MOSS[0]; SWC[1] = SW_MOSS[1]; SWC[2] = SW_MOSS[2];
      if (lit > 0) swMix(SW_MOSSL, lit > 1 ? 1 : lit); else swMix(SW_MOSSD, lit < -1 ? 1 : -lit);
      SWC[0] = r0 + (SWC[0] - r0) * mk; SWC[1] = g0 + (SWC[1] - g0) * mk; SWC[2] = b0 + (SWC[2] - b0) * mk;
    }
    // mud: the wet hollows, and a band along the water that wanders with the mud field
    const hollow = sstep((mn - (0.6 - 0.24 * wet)) / 0.06) * (1 - mk);
    const band = 1 - sstep((s - 0.06 - 0.16 * mn) / 0.12);
    const dk = hollow > band ? hollow : band;
    if (dk > 0) swMix(SW_MUD, dk);
    const wk = 1 - sstep((s - 0.012 - 0.05 * mn) / 0.045);
    if (wk > 0) swMix(SW_MUDW, wk);
    SWC[0] *= tm; SWC[1] *= tm; SWC[2] *= tm;
    SW_FL = dk > 0.5 || wk > 0.3 ? 0 : 3;
    // pools: on the swamp ground, never right at the water (a pool there would read as the sea's)
    if (wet < 0.3 || s < 0.12) return;
    VN_IN[0] = tx * 3.1 + 43; VN_IN[1] = ty * 3.1 + 17; VN_IN[2] = tx * 7.3 + 9; VN_IN[3] = ty * 7.3 + 29;
    VN_IN[4] = (tx + lx) * 3.1 + 43; VN_IN[5] = (ty + ly) * 3.1 + 17; VN_IN[6] = (tx + lx) * 7.3 + 9; VN_IN[7] = (ty + ly) * 7.3 + 29;
    vnoiseN(4);
    const pu = 0.7 * VN_OUT[0] + 0.3 * VN_OUT[1], pu2 = 0.7 * VN_OUT[2] + 0.3 * VN_OUT[3];
    const thr = 0.69 + 0.1 * (1 - wet), pk = sstep((pu - thr) / 0.012) * sstep((s - 0.16) / 0.06);
    // a wet ring round each pool
    const ring = sstep((pu - thr + 0.045) / 0.02) * (1 - pk);
    if (ring > 0) { SWC[0] *= 1 - 0.18 * ring; SWC[1] *= 1 - 0.16 * ring; SWC[2] *= 1 - 0.1 * ring; SW_FL = 0; }
    if (pk <= 0) return;
    const r0 = SWC[0], g0 = SWC[1], b0 = SWC[2];
    SWC[0] = SW_POOL[0]; SWC[1] = SW_POOL[1]; SWC[2] = SW_POOL[2];
    swMix(SW_SKY, 0.35 + 0.65 * sstep((pu - thr - 0.01) / 0.05));
    const edge = 1 - sstep((pu - thr - 0.004) / 0.022), gr = (pu2 - pu) * 40;
    if (gr > 0) swMix(SW_POOLD, edge * (gr > 1 ? 1 : gr)); else swMix(SW_SKY, 0.5 * edge * (gr < -1 ? 1 : -gr));
    SWC[0] = r0 + (SWC[0] - r0) * pk; SWC[1] = g0 + (SWC[1] - g0) * pk; SWC[2] = b0 + (SWC[2] - b0) * pk;
    if (pk > 0.3) SW_FL = 0;
  }
  // the painter's point (shadeAt, after its material blend: r, g, b and land are that blend; mx, my its warped place):
  // false where the swamp does not reach. Otherwise SWO holds its colour and land share, and SW_HIT says whether the
  // swamp's own grass flag (SW_FL) replaces the painter's
  function swampAt(tx, ty, wx, wyg, mx, my, r, g, b, land) {
    SW_HIT = false;
    const sw = bil(SWF, tx, ty);
    if (sw <= 0.002) return false;
    const wet = bil(SWW, tx, ty), s = swEdge(mx, my) + sw * swRag(tx, ty);
    const L = sstep((s + 0.02) / 0.04);
    let oR = 0, oG = 0, oB = 0;
    if (L > 0) {
      // the ground the point had (a beach's sand or the forest floor) and the swamp's, met along a ragged line
      let lr = r, lg = g, lb = b;
      if (land < 0.999) { sampleMat(M.BEACH, tx, ty, wx, wyg); lr = V[0]; lg = V[1]; lb = V[2]; }
      const cn = vnoise(tx * 1.3 + 7, ty * 1.3 + 53) * 0.6 + vnoise(tx * 3.4 + 1, ty * 3.4 + 9) * 0.3 + vnoise(tx * 8.1 + 5, ty * 8.1 + 2) * 0.1;
      const k = sstep((sw - 0.5 + 0.62 * (cn - 0.5)) / 0.1);
      if (k > 0) { swGround(tx, ty, wx, wyg, s, wet); lr += (SWC[0] - lr) * k; lg += (SWC[1] - lg) * k; lb += (SWC[2] - lb) * k; SW_HIT = k > 0.5; }
      oR = lr * L; oG = lg * L; oB = lb * L;
    }
    if (L < 1) {
      let wr = r, wg = g, wb = b;
      if (land > 0.001) { sampleMat(M.WATER, tx, ty, wx, wyg); wr = V[0]; wg = V[1]; wb = V[2]; }
      // murky shallows along the mud (still blue-green enough for the water's animation to run over them)
      const m = 0.7 * sw * (1 - sstep((-s - 0.03) / 0.32)) * (0.55 + 0.45 * vnoise(tx * 3.7 + 21, ty * 3.7 + 5));
      wr += (SW_MURK[0] - wr) * m; wg += (SW_MURK[1] - wg) * m; wb += (SW_MURK[2] - wb) * m;
      // and the mud's wet shadow on the water right at its edge
      const e = 1 - 0.14 * sw * (1 - sstep(-s / 0.05));
      oR += wr * e * (1 - L); oG += wg * e * (1 - L); oB += wb * e * (1 - L);
    }
    const kk = sstep(sw / 0.2);
    SWO[0] = r + (oR - r) * kk; SWO[1] = g + (oG - g) * kk; SWO[2] = b + (oB - b) * kk; SWO[3] = land + (L - land) * kk;
    if (kk < 0.5) SW_HIT = false;
    return true;
  }

  // ---- the switch: the swamp's columns are painted again, and the scene built again (its trees and the forest's)
  const syncCoast = () => { for (const b of document.querySelectorAll('[data-coast]')) press(b, (b.dataset.coast === 'swamp') === SWAMP.on); };
  function setCoast(name) {
    if (name !== 'swamp' && name !== 'forest') return Promise.reject(new Error(`no coast ${name}`));
    if ((name === 'swamp') === SWAMP.on) return jobs;
    SWAMP.on = name === 'swamp'; syncCoast();
    return enqueue(async () => { closeFrom(0); last = null; buildScene(false); hint.textContent = 'Repainting the ground…'; await swRepaint(); });
  }
  // the swamp's columns painted again exactly as the first paint painted them: in the same chunks of 240 columns, each
  // chunk's grass tufts drawn while the columns past its end had no ground yet (the first paint drew a chunk's tufts
  // before it painted the next chunk, so no tuft standing there leaned into it; a later repaint finds their ground and
  // draws them, a pixel or two at every chunk's edge). So Forest after Swamp is the first paint's ground, pixel for pixel
  async function swRepaint() {
    const cols = columnsFor(SW_TILES), a = Math.floor(cols[0][0] / 240) * 240, b = Math.min(GW, Math.ceil(cols[cols.length - 1][1] / 240) * 240);
    const keep = new Uint16Array(8 * GH);
    for (let c = a; c < b; c += 240) {
      const e = Math.min(b, c + 240);
      paintColumns(c, e);
      gctx.putImageData(gimg, 0, 0, c, 0, e - c, GH);
      const n = Math.min(8, GW - e);
      for (let y = 0; y < GH; y++) for (let q = 0; q < n; q++) { const p = y * GW + e + q; keep[y * 8 + q] = DEP[p]; DEP[p] = 0; }
      drawDetails(c, e);
      for (let y = 0; y < GH; y++) for (let q = 0; q < n; q++) DEP[y * GW + e + q] = keep[y * 8 + q];
      await new Promise((r) => setTimeout(r, 0));
    }
    maskDirty = true; WHEAT_VER++; TB_VER++; warmFrames();
  }
  for (const b of document.querySelectorAll('[data-coast]')) b.addEventListener('click', () => setCoast(b.dataset.coast));
  const coastHint = () => (SWAMP.on ? 'Coast: swamp (default; its mangroves and willows are placeholders until Codex #460)' : 'Coast: forest, the sandy coast as in v8');

  // ---- what stands in the swamp: the demo's placeholders, drawn once into pictures at the game's trees' own scale
  // (0.375 world px a texel), in the house style: broad clusters of three or four shades lit from the upper left, a dark
  // rim only along their lower and right edges, hard edges (no coloured fringe) and a soft ground shadow that touches
  // the foot, cast a little to the lower right. Sized against the game's trees and its people (a person is about 9 px):
  // a mangrove 24 to 42 px tall on roots spread 19 to 34 px wide (the game's trees are 39 to 65), a willow 36 to 54 px,
  // reeds 11 to 20 px; each placed one a little larger or smaller than its picture.
  const SW_TS = 0.375;
  const SW_LIGHT = (() => { const l = [-0.5, -0.62, 0.6], n = Math.hypot(...l); return l.map((v) => v / n); })();
  function swPic(w, h) {
    const cv = document.createElement('canvas'); cv.width = Math.ceil(w); cv.height = Math.ceil(h);
    return { cv, w: cv.width, h: cv.height, d: new Uint8ClampedArray(cv.width * cv.height * 4) };
  }
  function swPut(P, x, y, c, a = 1) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= P.w || y >= P.h || a <= 0) return;
    const o = (y * P.w + x) * 4, d = P.d, da = d[o + 3] / 255, na = a + da * (1 - a);
    for (let q = 0; q < 3; q++) d[o + q] = (c[q] * a + d[o + q] * da * (1 - a)) / na;
    d[o + 3] = na * 255;
  }
  const swDone = (P) => { const x = P.cv.getContext('2d'); const id = x.createImageData(P.w, P.h); id.data.set(P.d); x.putImageData(id, 0, 0); return P.cv; };
  // a soft shadow on the ground or the water, an ellipse a little to the lower right of the foot
  function swShadow(P, cx, cy, rx, ry, a, col) {
    for (let y = Math.floor(cy - ry - 2); y <= cy + ry + 2; y++) for (let x = Math.floor(cx - rx - 2); x <= cx + rx + 2; x++) {
      const e = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
      const k = 1 - sstep((e - 0.72) / 0.28);
      if (k > 0) swPut(P, x, y, col, a * k);
    }
  }
  // a stroke of bark or stem along a cubic, stamped as discs lit on their upper left; rad(t) its radius in texels
  function swStroke(P, p0, p1, p2, p3, rad, pal, dark = 1, wetFrom = 2, wetCol = null) {
    const len = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) + Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
    const n = Math.max(8, Math.ceil(len * 1.6));
    for (let q = 0; q <= n; q++) {
      const t = q / n, u = 1 - t;
      const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
      const y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
      const r = rad(t), R = Math.ceil(r);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const px = Math.floor(x) + dx, py = Math.floor(y) + dy, ox = px + 0.5 - x, oy = py + 0.5 - y;
        if (ox * ox + oy * oy > r * r) continue;
        const lit = -(0.62 * ox + 0.78 * oy) / Math.max(0.6, r);
        let c = lit > 0.35 ? pal[2] : lit > -0.35 ? pal[1] : pal[0];
        if (t >= wetFrom && wetCol) c = lit > 0.35 ? pal[1] : wetCol;
        swPut(P, px, py, dark === 1 ? c : [c[0] * dark, c[1] * dark, c[2] * dark]);
      }
    }
  }
  // a crown: clumps of leaves packed into its envelope (ellipses), the upper ones first, each with a lobed outline, lit
  // as a ball from the upper left, bent toward the crown's own roundness and darker toward its underside; four shades,
  // a few small clusters of leaves a shade lighter on each clump's lit side and a shade darker on its shaded side, and a
  // dark rim only where the crown ends below or to the right. droop stretches the clumps downward (a willow's)
  function swCrown(P, env, pal, rnd, n, r0, r1, droop = 1) {
    const E = env[0], cl = [], area = env.map((e) => e[2] * e[3]), tot = area.reduce((a, b) => a + b, 0);
    for (let k = 0; k < n; k++) {
      let u = rnd() * tot, e = env[0];
      for (let q = 0; q < env.length; q++) { if (u < area[q]) { e = env[q]; break; } u -= area[q]; }
      let x, y, tries = 0;
      do { x = e[0] + (rnd() * 2 - 1) * e[2]; y = e[1] + (rnd() * 2 - 1) * e[3]; tries++; } while (((x - e[0]) / e[2]) ** 2 + ((y - e[1]) / e[3]) ** 2 > 1 && tries < 20);
      cl.push({ x, y, r: r0 + rnd() * r1, p1: rnd() * 6.28, p2: rnd() * 6.28 });
    }
    cl.sort((a, b) => a.y - b.y);
    const NP = P.w * P.h, lab = new Float32Array(NP).fill(NaN), id = new Int16Array(NP).fill(-1), sh = new Int8Array(NP).fill(-1);
    cl.forEach((c, k) => {
      const R = c.r * 1.25;
      for (let y = Math.floor(c.y - R * droop - 1); y <= c.y + R * droop + 1; y++) for (let x = Math.floor(c.x - R - 1); x <= c.x + R + 1; x++) {
        if (x < 0 || y < 0 || x >= P.w || y >= P.h) continue;
        const dx = x + 0.5 - c.x, dy = (y + 0.5 - c.y) / droop, a = Math.atan2(dy, dx);
        const rr = c.r * (1 + 0.08 * Math.sin(5 * a + c.p1) + 0.05 * Math.sin(8 * a + c.p2));
        const nx = dx / rr, ny = dy / rr, q = nx * nx + ny * ny;
        if (q > 1) continue;
        const ex = (x + 0.5 - E[0]) / (E[2] * 1.15), ey = (y + 0.5 - E[1]) / (E[3] * 1.15), eq = Math.min(0.95, ex * ex + ey * ey);
        let Nx = 0.6 * nx + 0.4 * ex, Ny = 0.6 * ny + 0.4 * ey, Nz = 0.6 * Math.sqrt(1 - q) + 0.4 * Math.sqrt(1 - eq);
        const l = Math.hypot(Nx, Ny, Nz); Nx /= l; Ny /= l; Nz /= l;
        const o = y * P.w + x;
        lab[o] = Nx * SW_LIGHT[0] + Ny * SW_LIGHT[1] + Nz * SW_LIGHT[2] - 0.38 * sstep(((y + 0.5) - (E[1] + 0.1 * E[3])) / (0.9 * E[3]));
        id[o] = k;
      }
    });
    for (let o = 0; o < NP; o++) { const lit = lab[o]; if (lit === lit) sh[o] = lit < 0.05 ? 0 : lit < 0.34 ? 1 : lit < 0.62 ? 2 : 3; }
    cl.forEach((c, k) => {
      const m = 3 + Math.floor(rnd() * 3);
      for (let q = 0; q < m; q++) {
        const a = rnd() * 6.28, d = rnd() * c.r * 0.75, bx = c.x + Math.cos(a) * d, by = c.y + Math.sin(a) * d * droop, br = 1.2 + rnd() * 1.3;
        const o0 = Math.floor(by) * P.w + Math.floor(bx);
        if (o0 < 0 || o0 >= NP || id[o0] !== k) continue;
        const dir = lab[o0] > 0.36 ? 1 : lab[o0] < 0.12 ? -1 : 0;
        if (!dir) continue;
        for (let y = Math.floor(by - br); y <= by + br; y++) for (let x = Math.floor(bx - br); x <= bx + br; x++) {
          if (x < 0 || y < 0 || x >= P.w || y >= P.h) continue;
          const o = y * P.w + x;
          if (id[o] !== k || (x + 0.5 - bx) ** 2 + (y + 0.5 - by) ** 2 > br * br) continue;
          sh[o] = Math.max(0, Math.min(3, sh[o] + dir));
        }
      }
    });
    for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) {
      const o = y * P.w + x;
      let s = sh[o];
      if (s < 0) continue;
      const below = y + 1 >= P.h || sh[o + P.w] < 0, right = x + 1 >= P.w || sh[o + 1] < 0;
      if (below) s = 0; else if (right && s > 0) s--;
      swPut(P, x, y, pal[s]);
    }
  }
  const SW_LEAF_M = [[26, 44, 36], [38, 62, 42], [54, 82, 44], [84, 110, 52]]; // mangrove: dark glossy leaves
  const SW_LEAF_W = [[42, 62, 40], [64, 86, 44], [92, 112, 52], [126, 140, 66]]; // willow: lighter, yellower
  const SW_BARK_M = [[52, 43, 35], [86, 72, 57], [120, 102, 80]], SW_BARK_W = [[56, 46, 37], [88, 76, 60], [124, 108, 84]];
  const SW_WETROOT = [40, 36, 31];
  // a mangrove: a dome of dark glossy leaves on a short trunk standing on arched prop roots that reach out and down into
  // the water all round, a few aerial roots hanging from the crown; its shadow lies on the water
  function swMangrove(seed) {
    const rnd = makeRng(seed);
    const Ht = (28 + 9 * rnd()) / SW_TS, rx = (11 + 4 * rnd()) / SW_TS, ry = rx / 2, cw = (13 + 4 * rnd()) / SW_TS, ch = (7 + 2 * rnd()) / SW_TS, rh = (7 + 3 * rnd()) / SW_TS;
    const P = swPic(2 * Math.max(rx, cw * 1.3) + 16, Ht + ry + 12), fx = P.w / 2, fy = P.h - ry - 6;
    swShadow(P, fx + 0.2 * rx, fy + 0.16 * ry, rx * 1.05, ry * 1.1, 0.3, [12, 32, 36]);
    const nR = 9 + Math.floor(rnd() * 5), roots = [];
    for (let i = 0; i < nR; i++) roots.push(((i + 0.2 + 0.6 * rnd()) / nR) * 2 * Math.PI);
    const root = (a) => {
      const sp = 0.7 + 0.3 * rnd(), wpx = fx + rx * Math.cos(a) * sp, wpy = fy + ry * Math.sin(a) * sp;
      const jx = fx + (rnd() - 0.5) * 5, jy = fy - rh - rnd() * 4;
      const back = Math.sin(a) < 0;
      swStroke(P, [jx, jy], [jx + Math.cos(a) * rx * 0.5, jy - rh * 0.3 + Math.sin(a) * ry * 0.3], [wpx + Math.cos(a) * rx * 0.08, wpy - rh * 0.95], [wpx, wpy],
        (t) => 1.9 - 0.7 * t, SW_BARK_M, back ? 0.78 : Math.cos(a) < -0.3 ? 1.08 : 1, 0.84, SW_WETROOT);
      // where it enters the water: a faint ring
      if (!back) for (let q = -3; q <= 3; q++) swPut(P, wpx + q, wpy + 1 + (Math.abs(q) > 1 ? -1 : 0), [176, 204, 198], 0.22);
    };
    for (const a of roots) if (Math.sin(a) < 0) root(a);
    // the trunk, or two stems, from the roots up into the crown
    const top = fy - Ht + ch * 1.4, stems = rnd() < 0.5 ? 1 : 2;
    for (let s = 0; s < stems; s++) {
      const bx = fx + (stems === 2 ? (s ? 2.5 : -2.5) : 0), tx = bx + (rnd() - 0.5) * 10;
      swStroke(P, [bx, fy - rh + 1], [bx, fy - rh - 8], [tx, top + 10], [tx, top], (t) => 2.6 - 0.8 * t, SW_BARK_M);
    }
    for (const a of roots) if (Math.sin(a) >= 0) root(a);
    // aerial roots hanging straight down from the crown's underside
    const nd = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < nd; i++) {
      const x = fx + (rnd() * 2 - 1) * cw * 0.8, y0 = fy - Ht + ch * 1.6, y1 = fy + (rnd() - 0.4) * ry * 0.6;
      swStroke(P, [x, y0], [x, y0 + 4], [x + 1, y1 - 4], [x + 1, y1], () => 0.7, SW_BARK_M, 0.9, 0.85, SW_WETROOT);
    }
    const cy = fy - Ht + ch;
    swCrown(P, [[fx, cy, cw * 0.85, ch * 0.85], [fx - cw * 0.5, cy + ch * 0.3, cw * 0.5, ch * 0.6], [fx + cw * 0.5, cy + ch * 0.25, cw * 0.5, ch * 0.6]], SW_LEAF_M, rnd, 34 + Math.floor(rnd() * 8), 5, 3);
    return { cv: swDone(P), ax: fx, ay: fy };
  }
  // a weeping willow: a stout trunk forking into a rounded crown whose sides fall as curtains of hanging strands almost
  // to the ground or the water all round, with a gap here and there where the trunk shows. Three pictures of one size:
  // the curtain behind the trunk, the trunk and the crown, the curtain in front; ha is where the curtains hang from
  // (world px above the foot)
  function swWillow(seed) {
    const rnd = makeRng(seed);
    const Ht = (41 + 8 * rnd()) / SW_TS, cw = (18 + 4 * rnd()) / SW_TS, ch = Ht * (0.25 + 0.04 * rnd());
    const w = 2 * cw * 1.2 + 14, h = Ht + 0.6 * cw + 8, fx = w / 2, fy = h - 0.5 * cw - 4;
    const back = swPic(w, h), core = swPic(w, h), front = swPic(w, h);
    swShadow(core, fx + 0.12 * cw, fy + 0.07 * cw, cw * 1.04, cw * 0.48, 0.32, [20, 30, 18]);
    const cy = fy - Ht + ch, hang = cy;
    // the trunk: one stout stem leaning a little, forking into two or three limbs that reach up into the crown
    const lean = (rnd() - 0.5) * 12, fork = fy - Ht * (0.4 + 0.08 * rnd());
    swStroke(core, [fx, fy], [fx, fy - 12], [fx + lean, fork + 10], [fx + lean, fork], (t) => 3.2 - 1 * t, SW_BARK_W);
    const nl = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < nl; i++) {
      const a = (i / (nl - 1) - 0.5) * 1.6 + (rnd() - 0.5) * 0.3, ex = fx + lean + Math.sin(a) * cw * 0.55, ey = cy + ch * 0.1 + Math.abs(Math.sin(a)) * ch * 0.4;
      swStroke(core, [fx + lean, fork + 2], [fx + lean + Math.sin(a) * 6, fork - 10], [ex, ey + 10], [ex, ey], (t) => 2.2 - 0.9 * t, SW_BARK_W);
    }
    // the curtain: a bell of hanging strands two or three texels wide, from the crown's middle down to a little above the
    // ground, flaring a little; lit on its left as a round body is, darker to its right and toward the bottom, a darker
    // crevice down each strand's right side, drooping flecks of leaves a shade lighter at each strand's own rhythm, its
    // end ragged by its own length; a few gaps low down where the trunk and the dark inside show. The back curtain is
    // that inside: two shades darker, unbroken
    const skirt = (P, dark, gapP, wide) => {
      const x0 = Math.floor(fx - cw * wide * 1.06), x1 = Math.ceil(fx + cw * wide * 1.06);
      let next = x0, len = 0, ssh = 0, gap = false, edge = 0, ph = 0, per = 9, top = 0, ux = 0, g0 = 0;
      for (let x = x0; x <= x1; x++) {
        const u = (x + 0.5 - fx) / (cw * wide);
        if (x >= next) {
          ux = u;
          const sw = 2 + Math.floor(rnd() * 2); next = x + sw; edge = next - 1;
          len = (1 + 2.6 * rnd() + (Math.abs(u) < 0.16 ? 6 : 0)) / SW_TS; ssh = rnd() < 0.22 ? 1 : rnd() < 0.22 ? -1 : 0; gap = rnd() < gapP; g0 = 0.22 + 0.3 * rnd();
          ph = Math.floor(rnd() * 16); per = 11 + Math.floor(rnd() * 7);
          top = cy - ch * 0.15 + ch * 0.9 * (1 - Math.sqrt(Math.max(0, 1 - u * u)));
        }
        if (Math.abs(u) > 1.04) continue;
        const yBot = fy - len - (7 * ux * ux) / SW_TS;
        for (let y = Math.floor(top); y <= yBot; y++) {
          const t = (y - top) / Math.max(1, yBot - top);
          if (gap && t > g0) continue;
          const xs = x + Math.round(ux * (Math.sin(Math.PI * Math.min(1, t * 1.25)) * 5 + t * 2)), lit = -0.6 * u + 0.3 - 0.36 * t;
          let s = lit < -0.25 ? 0 : lit < 0.1 ? 1 : lit < 0.45 ? 2 : 3;
          s += ssh; if (x === edge) s--;
          if ((y + ph) % per < 4 && x !== edge) s++;
          s -= dark;
          swPut(P, xs, y, SW_LEAF_W[s < 0 ? 0 : s > 3 ? 3 : s]);
        }
      }
    };
    skirt(back, 2, 0, 0.92);
    skirt(front, 0, 0.2, 0.94);
    // the crown's top over the curtain's head: drooping clumps
    swCrown(front, [[fx, cy, cw * 0.86, ch * 0.78], [fx - cw * 0.45, cy + ch * 0.25, cw * 0.48, ch * 0.5], [fx + cw * 0.45, cy + ch * 0.3, cw * 0.48, ch * 0.5]], SW_LEAF_W, rnd, 34 + Math.floor(rnd() * 8), 5.5, 3, 1.3);
    return { back: swDone(back), core: swDone(core), front: swDone(front), ax: fx, ay: fy, ha: (fy - hang) * SW_TS };
  }
  // reeds and cattails: a clump of stems and blades from a wet dark base, some with brown cattail heads lit on the left
  const SW_STEM = [[38, 54, 32], [56, 72, 40], [86, 96, 48]], SW_CAT = [[48, 26, 18], [96, 50, 32], [142, 82, 50]];
  function swReeds(seed, cats) {
    const rnd = makeRng(seed);
    const P = swPic(44, 62), fx = 22, fy = 56;
    swShadow(P, fx + 2, fy + 1, 9, 3.6, 0.38, [30, 30, 22]);
    const n = 7 + Math.floor(rnd() * 6);
    for (let i = 0; i < n; i++) {
      const bx = fx + (rnd() - 0.5) * 12, hgt = 28 + rnd() * 24, bend = (rnd() - 0.5) * 10, blade = rnd() < 0.35;
      const tip = [bx + bend * (blade ? 1.8 : 1), fy - hgt * (blade ? 0.75 : 1)];
      swStroke(P, [bx, fy], [bx, fy - hgt * 0.4], [tip[0] - bend * 0.3, tip[1] + hgt * 0.2], tip, (t) => (blade ? 1.3 - 0.9 * t : 0.85), SW_STEM, 0.85 + 0.3 * rnd());
      if (cats && !blade && rnd() < 0.45) {
        const hx = tip[0] - bend * 0.08, hy = tip[1] + 5;
        swStroke(P, [hx, hy], [hx, hy + 2], [hx, hy + 5], [hx, hy + 7], () => 1.5, SW_CAT);
      }
    }
    return { cv: swDone(P), ax: fx, ay: fy };
  }
  let SW_PICS = null;
  function swPictures() {
    if (SW_PICS) return SW_PICS;
    SW_PICS = {
      mangrove: [11, 23, 37, 41, 53, 67].map((s) => swMangrove(4600 + s)),
      willow: [5, 17, 29, 43].map((s) => swWillow(4610 + s)),
      reeds: [3, 8, 13, 21].map((s, i) => swReeds(4620 + s, i !== 1)),
    };
    for (const k of ['mangrove', 'reeds']) for (const p of SW_PICS[k]) GF_COPY.set(p.cv, p.cv); // (swayTree's own source)
    return SW_PICS;
  }
  // where everything stands: worked out once (it is the same every time the scene is built)
  let SW_ITEMS = null;
  function swPlace() {
    if (SW_ITEMS) return SW_ITEMS;
    const items = [], at = (tx, ty, d, kinds) => items.some((q) => kinds.includes(q.kind) && Math.hypot(q.tx - tx, q.ty - ty) < d);
    const cand = [];
    for (let j = 0; j < 55; j++) for (let i = 0; i < 50; i++) {
      const tx = 2.6 + (i + hash2(i, j, 4631)) * 0.2, ty = 9.6 + (j + hash2(i, j, 4632)) * 0.2;
      if (bil(SWF, tx, ty) < 0.85) continue;
      cand.push({ tx, ty, s: swShore(tx, ty), r: hash2(i, j, 4633), g: vnoise(tx * 1.1 + 3, ty * 1.1 + 7) });
    }
    cand.sort((a, b) => a.r - b.r);
    // mangroves: at the waterline and out in the shallows, thinning with the depth, in stands with gaps between them
    for (const c of cand) {
      if (c.s > 0.03 || c.s < -0.36 || c.g < 0.4 || (c.s < -0.2 && c.r > 0.5)) continue;
      if (at(c.tx, c.ty, c.g > 0.62 ? 0.4 : 0.52, ['m'])) continue;
      items.push({ kind: 'm', tx: c.tx, ty: c.ty, v: Math.floor(hash2(Math.round(c.tx * 9), Math.round(c.ty * 9), 4634) * 6), k: 0.84 + 0.3 * hash2(Math.round(c.tx * 9), Math.round(c.ty * 9), 4639) });
    }
    // willows: on the banks behind them
    for (const c of cand) {
      if (c.s < 0.22 || c.s > 0.6 || c.g < 0.35) continue;
      if (at(c.tx, c.ty, 1.7, ['w']) || at(c.tx, c.ty, 0.5, ['m'])) continue;
      items.push({ kind: 'w', tx: c.tx, ty: c.ty, v: Math.floor(hash2(Math.round(c.tx * 9), Math.round(c.ty * 9), 4635) * 4), k: 0.88 + 0.22 * hash2(Math.round(c.tx * 9), Math.round(c.ty * 9), 4643) });
    }
    // reeds and cattails in clumps along the water's edge and on the wet ground
    for (const c of cand) {
      if (c.s < -0.1 || c.s > 0.3) continue;
      if (at(c.tx, c.ty, 0.8, ['rc']) || at(c.tx, c.ty, 0.26, ['m', 'w'])) continue;
      items.push({ kind: 'rc', tx: c.tx, ty: c.ty });
      const n = 2 + Math.floor(c.r * 4);
      for (let k = 0; k < n; k++) {
        const a = hash2(k, Math.round(c.tx * 13), 4636) * 6.283, d = 0.05 + 0.13 * hash2(k, Math.round(c.ty * 13), 4637);
        const tx = c.tx + Math.cos(a) * d, ty = c.ty + Math.sin(a) * d;
        if (swShore(tx, ty) < -0.12) continue;
        items.push({ kind: 'r', tx, ty, v: Math.floor(hash2(k, Math.round(c.tx * 7 + c.ty * 5), 4638) * 6) });
      }
    }
    // a dead snag or two on the wet ground
    let nd = 0;
    for (const c of cand) {
      if (nd >= 2 || c.s < 0.08 || c.s > 0.3 || c.r > 0.2) continue;
      if (at(c.tx, c.ty, 0.45, ['m', 'w', 'd']) || at(c.tx, c.ty, 0.2, ['r'])) continue;
      items.push({ kind: 'd', tx: c.tx, ty: c.ty, v: nd }); nd++;
    }
    SW_ITEMS = items.filter((q) => q.kind !== 'rc');
    return SW_ITEMS;
  }
  // per tile: what the swamp put there, for its tooltip
  const SW_ON_TILE = new Map();
  const SW_SWAY = { mangrove: [0.62, 0.6, 2.3], willow: [0.85, 0.42, 1.7], reeds: [2.2, 0.95, 1.25] };
  function swSway(s, kind, seed) {
    const [amp, hz, p] = SW_SWAY[kind], fx = s.x + s.w / 2, fy = s.y + s.h, ix = Math.round(fx * 4), iy = Math.round(fy * 4);
    s.sway = { fx, fy, H: s.h, amp: amp * (0.85 + 0.3 * hash2(ix, iy, seed)), om: 2 * Math.PI * hz * (0.88 + 0.24 * hash2(ix, iy, seed + 1)), ph: 6.2832 * hash2(ix, iy, seed + 2), p };
  }
  // the scene (buildScene, after the props): the forest's trees too near the water go, a share of those on the forest's
  // edge give way to the willows, and the swamp's own placeholders and reeds come in, each at its depth like a prop
  function swampDress(sprites, built) {
    SW_ON_TILE.clear();
    if (!SWAMP.on) return;
    const TR = /^props\/(oak|tree|birch|pine|spruce)_/;
    const drop = new Set(), kept = [];
    for (const s of sprites) {
      if (!s.img || s.flat || !TR.test(s.key || '')) continue;
      const f = GAME[s.key], sc = s.w / f.w, wx = s.x + f.ax * sc, wy = s.y + f.ay * sc, tx = (wx / 32 + wy / 16) / 2, ty = (wy / 16 - wx / 32) / 2;
      const ti = Math.round(tx), tj = Math.round(ty);
      if (!inb(ti, tj)) continue;
      const z = SWZ[tj * W + ti];
      if (z !== 2 && z !== 4) continue;
      const sh = swShore(tx, ty);
      const hs = hash2(Math.round(wx), Math.round(wy), 4640);
      if (z === 2 ? sh < 0.48 || hs < 0.55 : hs < 0.3) drop.add(s); else kept.push([tx, ty]);
    }
    if (drop.size) for (let k = sprites.length - 1; k >= 0; k--) if (drop.has(sprites[k])) sprites.splice(k, 1);
    const pics = swPictures(), items = swPlace();
    const note = (tx, ty, what) => { const i = idx(Math.max(0, Math.min(W - 1, Math.round(tx))), Math.max(0, Math.min(H - 1, Math.round(ty)))); const o = SW_ON_TILE.get(i) || {}; o[what] = (o[what] || 0) + 1; SW_ON_TILE.set(i, o); };
    const mk = (pic, img, tx, ty, key, k = 1) => {
      const z = heightAt(tx, ty), wx = Math.round((tx - ty) * 32), wy = Math.round((tx + ty) * 16 - z), sc = SW_TS * k;
      return { img, sx: 0, sy: 0, sw: img.width, sh: img.height, x: wx - pic.ax * sc, y: wy - pic.ay * sc, w: img.width * sc, h: img.height * sc, depth: (tx + ty) * 100 + 10, key };
    };
    for (const q of items) {
      if (q.kind === 'w' && kept.some(([x, y]) => Math.hypot(x - q.tx, y - q.ty) < 0.38)) continue;
      if (q.kind === 'm') { const p = pics.mangrove[q.v], s = mk(p, p.cv, q.tx, q.ty, `swamp/mangrove-${q.v}`, q.k); swSway(s, 'mangrove', 4641); s.draw = swayTree; sprites.push(s); note(q.tx, q.ty, 'm'); }
      else if (q.kind === 'w') { const p = pics.willow[q.v], s = mk(p, p.core, q.tx, q.ty, `swamp/willow-${q.v}`, q.k); swSway(s, 'willow', 4644); s.layers = [p.back, p.core, p.front]; s.ha = p.ha * q.k; s.draw = willowDraw; sprites.push(s); note(q.tx, q.ty, 'w'); }
      else if (q.kind === 'r') {
        if (q.v >= 4) { const key = `props/reeds_${q.v - 4}`, f = GAME[key]; if (!f) continue; const sc = f.k / f.res, z = heightAt(q.tx, q.ty), wx = Math.round((q.tx - q.ty) * 32), wy = Math.round((q.tx + q.ty) * 16 - z); const s = { img: IMG[f.s], sx: f.x, sy: f.y, sw: f.w, sh: f.h, x: wx - f.ax * sc, y: wy - f.ay * sc, w: f.w * sc, h: f.h * sc, depth: (q.tx + q.ty) * 100 + 10, key }; swSway(s, 'reeds', 4647); s.draw = swayTree; sprites.push(s); }
        else { const p = pics.reeds[q.v], s = mk(p, p.cv, q.tx, q.ty, `swamp/reeds-${q.v}`); swSway(s, 'reeds', 4647); s.draw = swayTree; sprites.push(s); }
        note(q.tx, q.ty, 'r');
      } else if (q.kind === 'd') {
        const key = `props/deadtree_${q.v}`, f = GAME[key]; if (!f) continue;
        const sc = f.k / f.res, z = heightAt(q.tx, q.ty), wx = Math.round((q.tx - q.ty) * 32), wy = Math.round((q.tx + q.ty) * 16 - z);
        sprites.push({ img: IMG[f.s], sx: f.x, sy: f.y, sw: f.w, sh: f.h, x: wx - f.ax * sc, y: wy - f.ay * sc, w: f.w * sc, h: f.h * sc, depth: (q.tx + q.ty) * 100 + 10, flip: false, key });
        note(q.tx, q.ty, 'd');
      }
    }
    // the tiles whose trees went: their Game art line names what is left
    const left = new Map();
    for (const s of sprites) if (s.img && TR.test(s.key || '')) { const f = GAME[s.key], sc = s.w / f.w, wx = s.x + f.ax * sc, wy = s.y + f.ay * sc, i = idx(Math.max(0, Math.min(W - 1, Math.round((wx / 32 + wy / 16) / 2))), Math.max(0, Math.min(H - 1, Math.round((wy / 16 - wx / 32) / 2)))); (left.get(i) || left.set(i, new Set()).get(i)).add(s.key.slice(6).replace(/_\d$/, '')); }
    for (const c of map) if (SWZ[c.i] === 2 || SWZ[c.i] === 4) { built[c.i] = built[c.i].filter((t) => !/^game (oak|tree|birch|pine|spruce)/.test(t)); const l = left.get(c.i); if (l) built[c.i].push(`game ${[...l].join(', ')}`); }
  }
  // a willow: its trunk and crown bend as a tree's do (treeLean, L1); its curtains hang from the crown and swing as
  // pendulums, wider and slower than the crown, more in a gust, the swing growing toward their ends
  function willowDraw(g) {
    const s = this;
    if (offView(s.x, s.y, s.w, s.h)) return;
    const S = WIND.strength;
    if (!S) { for (const cv of s.layers) g.drawImage(cv, s.sx, s.sy, s.sw, s.sh, s.x, s.y, s.w, s.h); return; }
    const q = s.sway, H = q.H, lean = treeLean(q, S, LF.t), D = lean * H * LF.wx, sq = 1 - lean * LF.wy;
    const gu = windGust(q.fx, q.fy - H * 0.4, LF.t), t = LF.t, om = q.om * 0.62;
    const cl = q.amp * (S * (0.05 + 0.08 * gu) + (0.022 + 0.05 * S) * (0.4 + 0.6 * gu) * (Math.sin(t * om + q.ph + 0.9) + 0.35 * Math.sin(t * om * 1.71 + q.ph * 1.3)));
    const ha = s.ha, C = cl * ha * 2.2 * LF.wx;
    const crown = (h) => D * Math.pow(Math.max(0, h) / H, q.p);
    const hangs = (h) => (h >= ha ? crown(h) : crown(ha) + C * Math.pow((ha - h) / ha, 1.2));
    const mv = (Math.abs(D) + Math.abs(C)) * LF.k + Math.abs(1 - sq) * H * LF.k;
    const cutsC = SWAY_CUTS[mv < 0.6 ? 0 : mv < 2.5 ? 1 : 2];
    const cutsH = mv < 0.6 ? [0, 1] : [0, 0.12, 0.24, 0.36, 0.48, 0.6, 0.8, 1];
    swBands(g, s, s.layers[0], hangs, cutsH, sq);
    swBands(g, s, s.layers[1], crown, cutsC, sq);
    swBands(g, s, s.layers[2], hangs, cutsH, sq);
    lifeBack(g);
  }
  // L1's banded bend (swayTree) for any bend f(h) (world px across, h world px above the foot), its band edges on rows
  function swBands(g, s, src, f, cuts, sq) {
    const k = LF.k, E = LF.E, F = LF.F, sc = s.h / s.sh, top = s.y, fy = s.y + s.h, H = s.h, lift = fy * (1 - sq), n = cuts.length - 1;
    const snap = (y) => ((Math.round(k * (sq * y + lift) + F) - F) / k - lift) / sq;
    const ys = cuts.map((u, i) => (i === 0 ? fy : i === n ? top : snap(fy - u * H)));
    const hk = ys.map((y, i) => (i === n ? H : fy - y)), dk = hk.map(f);
    for (let i = 0; i < n; i++) {
      const ya = Math.max(top, ys[i + 1]), yb = Math.min(fy, ys[i]);
      if (yb - ya < 1e-3) continue;
      const m = (dk[i + 1] - dk[i]) / Math.max(1e-6, hk[i + 1] - hk[i]), c = dk[i] + m * (fy - hk[i]);
      g.setTransform(k, 0, -k * m, k * sq, k * c + E, k * lift + F);
      const r0 = (ya - top) / sc, r1 = (yb - top) / sc;
      g.drawImage(src, s.sx, s.sy + r0, s.sw, r1 - r0, s.x, ya, s.w, yb - ya);
    }
  }
  // the tooltip of a swamp tile: its biome and ground, and the placeholders on it
  const SWAMP_BIOME = { name: 'Swamp', desc: 'Wet lowland. Pumps overflow; track needs an embankment and trains crawl.', production: { pump: 1.4, farm: 0.8 }, track: 2, water: 1, speed: 0.8, color: '#5f6a38' };
  const swBiome = (c) => (SWAMP.on && (SWZ[c.i] === 1 || SWZ[c.i] === 2) ? 'swamp' : c.biome);
  function swampTip(c, out) {
    if (!SWAMP.on || !SWZ[c.i]) return;
    const z = SWZ[c.i];
    if (z === 1) out[0].textContent = 'Swamp';
    if (z === 1 || z === 2) out[1] = row('Biome', biomeTerm('swamp'));
    const sec = out.findIndex((e) => e.classList && e.classList.contains('sec'));
    if (sec > 0 && z !== 4 && out[sec + 1]) out[sec + 1] = row('Ground', z === 3 ? 'Water <span class="dim">game swatch, murky along the swamp’s mud (drawn by the demo)</span>' : 'Swamp <span class="dim">dark wet earth, moss and pools, a ragged muddy waterline (drawn by the demo)</span>');
    if (z === 1) out[out.length - 1] = el('div', 'dim', 'Wet ground: track needs an embankment here and trains crawl over it.');
    const o = SW_ON_TILE.get(c.i);
    if (!o) return;
    const at = out.length - 1, add = [el('div', 'sec', 'Swamp placeholders')];
    if (o.m) add.push(row(`Mangrove${o.m > 1 ? ` ×${o.m}` : ''}`, '<span class="dim">placeholder until Codex (#460)</span>'));
    if (o.w) add.push(row(`Weeping willow${o.w > 1 ? ` ×${o.w}` : ''}`, '<span class="dim">placeholder until Codex (#460)</span>'));
    if (o.r) add.push(row('Reeds and cattails', '<span class="dim">the demo’s and the game’s</span>'));
    if (o.d) add.push(row('Dead snag', '<span class="dim">game deadtree</span>'));
    out.splice(at, 0, ...add);
  }

  // ---------- Storm effects and Fog (v9.2, the author: "in Storm there could be more weather effects too, for example lightning,
  // rain, fog and so on"). Both are drawn over the scene each frame from the clock, so nothing is repainted. With Weather
  // Storm and Storm effects On (the default): an overcast (the whole view darker, cooler and a little greyer), the ground a
  // little darker and wetter, rain (fine light streaks slanted by the wind, fewer at low zoom), rings on the water (with
  // Animated water) and lightning now and then. Storm effects Off is v9.1's Storm. Fog is a switch of its own, at every
  // weather: Off (the default, v9.1), Valley mist or Thick. A change of level fades the storm in or out over a couple of
  // seconds. Calm, Breeze and Windy are v9.1's whatever the Storm effects switch says.
  const STORM = { on: true };
  let fogMode = 'off'; // 'off' | 'mist' | 'thick'
  let stormK = 0, stormNow = 0; // how much of the storm shows now, 0 to 1 (eased), and the clock of the last frame
  let lightningForce = null; // a test hook: true shows the lightning even where the system asks for reduced motion
  const lightningOk = () => (lightningForce != null ? lightningForce : !still);
  const stormTarget = () => (STORM.on && WIND.level === 'storm' ? 1 : 0);
  function stormStep(now) {
    const target = stormTarget();
    if (freezeT != null) stormK = target;
    else {
      const dt = Math.min(0.2, Math.max(0, (now - stormNow) / 1000));
      stormK += (target - stormK) * (1 - Math.exp(-dt / 1.1));
      if (Math.abs(target - stormK) < 0.004) stormK = target;
    }
    stormNow = now;
    return stormK;
  }
  // the lightning's clock: a flash every 6.5 to 14.5 s, never closer, the same on every run
  const FLASH_T = [];
  function flashAt(t) {
    while (!FLASH_T.length || FLASH_T[FLASH_T.length - 1] < t + 30) { const k = FLASH_T.length; FLASH_T.push((k ? FLASH_T[k - 1] : 0) + 6.5 + 8 * hash2(k, 77, 4242)); }
    let lo = 0, hi = FLASH_T.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (FLASH_T[m] <= t) lo = m; else hi = m; }
    const k = FLASH_T[hi] <= t ? hi : FLASH_T[lo] <= t ? lo : -1;
    return k < 0 ? null : { k, u: t - FLASH_T[k] };
  }
  const FLASH_LEN = 0.38, BOLT_LEN = 0.16;
  // the brightening: up in 0.06 s, then a fade over about 0.3 s; one peak, no flicker
  const flashLevel = (u) => (u < 0 || u >= FLASH_LEN ? 0 : u < 0.06 ? u / 0.06 : (1 - (u - 0.06) / (FLASH_LEN - 0.06)) ** 2);
  // the wet ground and the overcast: multiplied over the ground, then over the whole view
  function stormGround(g, k) {
    g.save(); g.globalCompositeOperation = 'multiply';
    g.fillStyle = `rgb(${Math.round(255 - 36 * k)},${Math.round(255 - 30 * k)},${Math.round(255 - 22 * k)})`;
    g.fillRect(GX0, GY0, GW / SCALE, GH / SCALE);
    g.restore();
  }
  function stormOvercast(g, k) {
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = `rgb(${Math.round(255 - 52 * k)},${Math.round(255 - 40 * k)},${Math.round(255 - 24 * k)})`;
    g.fillRect(0, 0, view.width, view.height);
    g.globalCompositeOperation = 'saturation'; g.globalAlpha = 0.22 * k; g.fillStyle = '#808080';
    g.fillRect(0, 0, view.width, view.height);
    g.restore();
  }
  // rings on the water: each slot starts a ring somewhere over the view, now and then, and keeps it if that spot is water
  function stormRings(g, t, k, vx0, vy0, vx1, vy1) {
    const area = (vx1 - vx0) * (vy1 - vy0), n = Math.max(40, Math.min(300, Math.round(7.5e-4 * area)));
    const rr = 3.4 / Math.min(1, Math.sqrt(cam.z));
    const B = [[], [], [], []];
    for (let i = 0; i < n; i++) {
      const P = 0.9 + 0.6 * hash2(i, 3, 501), ph = t / P + hash2(i, 4, 502), c = Math.floor(ph), u = ph - c;
      const x = vx0 + hash2(i, c, 503) * (vx1 - vx0), y = vy0 + hash2(i, c, 504) * (vy1 - vy0);
      const wm = wmAt(x, y); if (wm !== 1 && wm !== 2) continue;
      const fade = (1 - u) * (1 - u) * (0.6 + 0.4 * hash2(i, c, 505));
      B[Math.min(3, Math.floor(fade * 4))].push(x, y, rr * (0.3 + 0.7 * Math.sqrt(u)));
    }
    g.save(); g.lineWidth = Math.max(0.45, 0.8 / Math.sqrt(cam.z));
    for (let q = 0; q < 4; q++) {
      const L = B[q]; if (!L.length) continue;
      g.strokeStyle = `rgba(228,239,243,${(0.1 + 0.11 * q) * k})`;
      g.beginPath();
      for (let j = 0; j < L.length; j += 3) { g.moveTo(L[j] + L[j + 2], L[j + 1]); g.ellipse(L[j], L[j + 1], L[j + 2], L[j + 2] * 0.5, 0, 0, Math.PI * 2); }
      g.stroke();
    }
    g.restore();
  }
  // rain: streaks in the screen's own pixels, slanted by the wind, in three strengths; their number falls with the zoom
  function stormRain(g, t, k) {
    const W = view.width, H = view.height, zf = cam.z;
    const css = (W * H) / (dpr * dpr), n = Math.round(Math.max(60, Math.min(340, 60 + 100 * zf)) * (css / 640000) * k);
    const len = Math.max(10, Math.min(26, 11 + 5 * zf)) * dpr, sp = (600 + 150 * zf) * dpr;
    const gust = 0.85 + 0.3 * windGust(cam.x, cam.y, t), sl = 0.5 * WIND.to.sx * (0.6 + 0.4 * WIND.strength) * gust;
    const Hp = H + len * 2, Wp = W + Math.abs(sl) * Hp;
    const B = [[], [], []];
    for (let i = 0; i < n; i++) {
      const sv = 0.85 + 0.3 * hash2(i, 1, 601), ph = hash2(i, 2, 602) + (sp * sv * t) / Hp, c = Math.floor(ph), yy = (ph - c) * Hp;
      const X0 = hash2(i, c, 603) * Wp - (sl > 0 ? sl * Hp : 0);
      B[Math.min(2, Math.floor(hash2(i, 5, 604) * 3))].push(X0 + sl * yy, yy - len);
    }
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.lineWidth = 1.05 * dpr; g.lineCap = 'round';
    for (let q = 0; q < 3; q++) {
      const L = B[q]; if (!L.length) continue;
      g.strokeStyle = `rgba(222,233,244,${(0.22 + 0.12 * q) * Math.min(1, k * 1.2)})`;
      g.beginPath();
      for (let j = 0; j < L.length; j += 2) { g.moveTo(L[j], L[j + 1]); g.lineTo(L[j] - sl * len, L[j + 1] - len); }
      g.stroke();
    }
    g.restore();
  }
  // a bolt far off at the map's far edge (the two upper sides): thin, there for 0.16 s as the flash begins. If its foot is
  // not in view it is drawn smaller in the sky at the top of the screen instead
  function stormBolt(g, f) {
    const k = f.k, a = 1 - f.u / BOLT_LEN; if (a <= 0) return;
    const s = 0.12 + 0.76 * hash2(k, 8, 701), nw = hash2(k, 9, 702) < 0.5;
    const bx = (nw ? -s * 35 * 32 : s * 35 * 32) + (nw ? -26 : 26), by = s * 35 * 16 - 16;
    const W = view.width, H = view.height, kz = cam.z * dpr;
    let sx = (bx - cam.x) * kz + W / 2, sy = (by - cam.y) * kz + H / 2, sc = kz;
    if (sx < 0.04 * W || sx > 0.96 * W || sy < 170 * sc * 0.4 || sy > 0.8 * H) {
      sx = (0.1 + 0.8 * hash2(k, 10, 703)) * W; sy = (0.12 + 0.1 * hash2(k, 11, 704)) * H + 60 * dpr; sc = Math.max(0.35, Math.min(1, H / dpr / 640)) * dpr;
    }
    const n = 9, hh = 170 * sc, pts = [];
    for (let j = 0; j <= n; j++) pts.push([sx + (j === n ? 0 : (hash2(k, j, 705) - 0.5) * 36 * sc * (1 - (0.4 * j) / n)), sy - hh * (1 - j / n)]);
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.lineJoin = 'round'; g.lineCap = 'round';
    const trace = (lw, col) => {
      g.lineWidth = lw; g.strokeStyle = col; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (let j = 1; j < pts.length; j++) g.lineTo(pts[j][0], pts[j][1]);
      const [fx, fy] = pts[3]; g.moveTo(fx, fy); g.lineTo(fx + 12 * sc, fy + 14 * sc); g.lineTo(fx + 8 * sc, fy + 30 * sc); g.lineTo(fx + 18 * sc, fy + 46 * sc);
      g.stroke();
    };
    trace(4 * dpr, `rgba(190,208,255,${0.16 * a})`);
    trace(1.3 * dpr, `rgba(246,249,255,${0.9 * a})`);
    g.restore();
  }
  function stormFlash(g, f, k) {
    const l = flashLevel(f.u) * k; if (l <= 0) return;
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'screen';
    g.fillStyle = `rgb(${Math.round(44 * l)},${Math.round(50 * l)},${Math.round(66 * l)})`;
    g.fillRect(0, 0, view.width, view.height);
    g.restore();
  }
  // fog: a mask over the map (how deep the mist lies: on the water, in the valleys, thinning with height) and two drifting
  // cloud textures that give it its patches; each frame the two are laid over the view at a quarter of its size, cut by
  // the mask and drawn up over the scene
  const FOG_SCALE = 4;
  let FOG = null;
  function cloudTex(seed, n) {
    const lat = [4, 8, 16].map((p, o) => Array.from({ length: p * p }, (_, i) => hash2(i, p, seed + o)));
    const at = (o, u, v) => {
      const p = 4 << o, x = u * p, y = v * p, x0 = Math.floor(x), y0 = Math.floor(y), fx = sstep(x - x0), fy = sstep(y - y0), L = lat[o];
      const a = L[(y0 % p) * p + (x0 % p)], b = L[(y0 % p) * p + ((x0 + 1) % p)], c = L[((y0 + 1) % p) * p + (x0 % p)], d = L[((y0 + 1) % p) * p + ((x0 + 1) % p)];
      return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    };
    const cv = document.createElement('canvas'); cv.width = cv.height = n;
    const cx = cv.getContext('2d'), id = cx.createImageData(n, n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const u = i / n, v = j / n, d = 0.55 * at(0, u, v) + 0.3 * at(1, u, v) + 0.15 * at(2, u, v);
      const a = sstep((d - 0.34) / 0.34), o = (j * n + i) * 4;
      id.data[o] = 218; id.data[o + 1] = 227; id.data[o + 2] = 232; id.data[o + 3] = Math.round(255 * (0.12 + 0.88 * a));
    }
    cx.putImageData(id, 0, 0);
    return cv;
  }
  function fogSetup() {
    if (FOG) return FOG;
    // the depth of mist by tile: water 1 (a river 0.8), land by how near it lies to water and how far below its
    // surroundings (a valley floor), all thinned with the level: none from level 3.5 up
    const D = new Float32Array(N);
    for (const c of map) {
      const lvl = Lv[c.i];
      let near = 0, sum = 0, cnt = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const o = tileAt(c.x + dx, c.y + dy); if (!o) continue;
        sum += Lv[o.i]; cnt++;
        if (o.kind === 'ocean' || o.kind === 'lake' || o.kind === 'river') near = Math.max(near, Math.exp(-Math.hypot(dx, dy) / 1.6) * (o.kind === 'river' ? 0.7 : 1));
      }
      const valley = Math.max(0, Math.min(1, (sum / cnt - lvl) / 1.1));
      let d = c.kind === 'ocean' || c.kind === 'lake' ? 0.8 : c.kind === 'river' ? 0.8 : Math.max(near * 0.8, valley * 0.75);
      if (isGlacier(c)) d = 0;
      D[c.i] = d * (1 - sstep((lvl - 0.6) / 3));
    }
    const mw = Math.ceil(GW / SCALE / FOG_SCALE), mh = Math.ceil(GH / SCALE / FOG_SCALE);
    const mk = (base) => {
      const cv = document.createElement('canvas'); cv.width = mw; cv.height = mh;
      const cx = cv.getContext('2d'), id = cx.createImageData(mw, mh), P = id.data;
      for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
        const wx = GX0 + i * FOG_SCALE, wy = GY0 + j * FOG_SCALE;
        let tx = wx / 64 + wy / 32, ty = wy / 32 - wx / 64;
        tx += (vnoise(tx * 0.8 + 11, ty * 0.8 + 5) - 0.5) * 1.4; ty += (vnoise(tx * 0.8 + 41, ty * 0.8 + 29) - 0.5) * 1.4;
        let v = 0;
        if (tx > -0.5 && ty > -0.5 && tx < W - 0.5 && ty < H - 0.5) {
          const x0 = Math.max(0, Math.min(W - 2, Math.floor(tx))), y0 = Math.max(0, Math.min(H - 2, Math.floor(ty))), fx = Math.max(0, Math.min(1, tx - x0)), fy = Math.max(0, Math.min(1, ty - y0));
          v = (D[y0 * W + x0] * (1 - fx) + D[y0 * W + x0 + 1] * fx) * (1 - fy) + (D[(y0 + 1) * W + x0] * (1 - fx) + D[(y0 + 1) * W + x0 + 1] * fx) * fy;
          v = base + (1 - base) * v;
        }
        const o = (j * mw + i) * 4; P[o] = P[o + 1] = P[o + 2] = 255; P[o + 3] = Math.round(255 * Math.max(0, Math.min(1, v)));
      }
      cx.putImageData(id, 0, 0);
      return cv;
    };
    const lay = document.createElement('canvas'), lx = lay.getContext('2d');
    FOG = { mist: mk(0), thick: mk(0.4), tex: [cloudTex(901, 160), cloudTex(917, 160)], lay, lx, pat: null, drift: [0, 0], now: 0 };
    FOG.pat = FOG.tex.map((tx) => lx.createPattern(tx, 'repeat'));
    return FOG;
  }
  function fogDraw(g, t, now, vx0, vy0, vx1, vy1) {
    const F = fogSetup(), VW_ = view.width, VH_ = view.height, kz = cam.z * dpr, thick = fogMode === 'thick';
    // drifting slowly downwind: 3 world px a second in a calm, 12 in a storm
    const sp = 3 + 9 * WIND.strength;
    if (freezeT != null) { F.drift[0] = WIND.to.sx * sp * t; F.drift[1] = WIND.to.sy * sp * t; }
    else { const dt = Math.min(0.2, Math.max(0, (now - F.now) / 1000)); F.drift[0] += WIND.to.sx * sp * dt; F.drift[1] += WIND.to.sy * sp * dt; }
    F.now = now;
    const lw = Math.max(8, Math.ceil(VW_ / 4)), lh = Math.max(8, Math.ceil(VH_ / 4));
    if (F.lay.width !== lw || F.lay.height !== lh) { F.lay.width = lw; F.lay.height = lh; }
    const lx = F.lx, s = kz / 4;
    lx.setTransform(1, 0, 0, 1, 0, 0); lx.globalCompositeOperation = 'source-over'; lx.globalAlpha = 1; lx.clearRect(0, 0, lw, lh);
    lx.setTransform(s, 0, 0, s, (VW_ / 2 - cam.x * kz) / 4, (VH_ / 2 - cam.y * kz) / 4);
    for (let q = 0; q < 2; q++) {
      const sc = q ? 2.3 : 3.4, dr = q ? 1.5 : 1;
      F.pat[q].setTransform(new DOMMatrix([sc, 0, 0, sc, F.drift[0] * dr + q * 53, F.drift[1] * dr + q * 31]));
      lx.globalAlpha = q ? 0.55 : 1; lx.fillStyle = F.pat[q]; lx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
    }
    lx.globalAlpha = 1; lx.globalCompositeOperation = 'destination-in';
    lx.drawImage(thick ? F.thick : F.mist, GX0, GY0, GW / SCALE, GH / SCALE);
    if (thick) {
      // the haze, laid behind the clouds, inside the map's outline: a veil over the nearest ground, a wall of it far up the
      // screen (alpha by world distance from the view's foot)
      lx.setTransform(1, 0, 0, 1, 0, 0); lx.globalCompositeOperation = 'destination-over';
      const gr = lx.createLinearGradient(0, 0, 0, lh);
      for (let q = 0; q <= 8; q++) { const yy = q / 8, d = ((1 - yy) * VH_) / kz; gr.addColorStop(yy, `rgba(214,223,228,${(0.2 + 0.6 * (1 - Math.exp(-d / 260))).toFixed(3)})`); }
      lx.setTransform(s, 0, 0, s, (VW_ / 2 - cam.x * kz) / 4, (VH_ / 2 - cam.y * kz) / 4);
      lx.beginPath(); lx.moveTo(0, -30); lx.lineTo(1156, 556); lx.lineTo(1156, 584); lx.lineTo(0, 1166); lx.lineTo(-1156, 584); lx.lineTo(-1156, 556); lx.closePath();
      lx.save(); lx.clip(); lx.setTransform(1, 0, 0, 1, 0, 0); lx.fillStyle = gr; lx.fillRect(0, 0, lw, lh); lx.restore();
    }
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = thick ? 0.92 : 0.9; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'low';
    g.drawImage(F.lay, 0, 0, lw, lh, 0, 0, VW_, VH_);
    g.restore();
  }
  function setStormFx(on) {
    STORM.on = !!on;
    for (const b of document.querySelectorAll('[data-stormfx]')) press(b, (b.dataset.stormfx === 'on') === STORM.on);
    dirty = true; hint.textContent = hintText();
    return STORM.on;
  }
  function setFog(mode) {
    if (mode !== 'off' && mode !== 'mist' && mode !== 'thick') throw new Error(`no fog ${mode}`);
    fogMode = mode;
    for (const b of document.querySelectorAll('[data-fog]')) press(b, b.dataset.fog === fogMode);
    dirty = true; hint.textContent = hintText();
    return fogMode;
  }
  const stormHint = () => (STORM.on ? 'Storm effects: on (default), they show with Weather Storm' : 'Storm effects: off, Storm as in v9.1');
  const fogHint = () => (fogMode === 'off' ? 'Fog: off (default)' : fogMode === 'mist' ? 'Fog: valley mist' : 'Fog: thick');
  for (const b of document.querySelectorAll('[data-stormfx]')) b.addEventListener('click', () => setStormFx(b.dataset.stormfx === 'on'));
  for (const b of document.querySelectorAll('[data-fog]')) b.addEventListener('click', () => setFog(b.dataset.fog));

  function draw(now) {
    const t = freezeT != null ? freezeT : (now - t0) / 1000;
    clockT = t;
    const g = vctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0b110c'; g.fillRect(0, 0, view.width, view.height);
    const k = cam.z * dpr;
    g.setTransform(k, 0, 0, k, view.width / 2 - cam.x * k, view.height / 2 - cam.y * k);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(ground, GX0, GY0, GW / SCALE, GH / SCALE);
    const sk = stormStep(now); // (v9.2: Storm effects) how much of the storm shows: 0 in every weather but a Storm with them On
    if (sk > 0) stormGround(g, sk);
    const [vx0, vy0] = toWorld(-60, -60), [vx1, vy1] = toWorld(VW + 60, VH + 120);
    lifeFrame(t, k, vx0, vy0, vx1, vy1); // v9: the wind's clock and view for the trees, the desert and Building life
    if (state.anim) drawWaterMotion(g, t, k, vx0, vy0, vx1, vy1);
    // ripples on open water (the game's own), only with Animate all water: the author's default is still water
    // (fix round of v9: not while a Waves treatment moves the still water in the wind; they always drifted the same way)
    if (state.anim && !wavesOn()) {
      g.lineWidth = 0.6;
      for (const c of map) {
        if ((c.kind !== 'ocean' && c.kind !== 'lake') || c.h > 0.28) continue;
        const [cx, cy] = twc(c.x, c.y); if (cx < vx0 || cx > vx1 || cy < vy0 || cy > vy1) continue;
        const ph = (t * 0.35 + c.h * 7) % 1, a = Math.sin(ph * Math.PI) * 0.16;
        g.strokeStyle = `rgba(183,209,190,${a.toFixed(3)})`; g.beginPath(); g.moveTo(cx - 9 + ph * 6, cy + 2 - ph * 3); g.lineTo(cx - 1 + ph * 6, cy + 2 - ph * 3); g.stroke();
      }
    }
    if (sk > 0 && state.anim) stormRings(g, t, sk, vx0, vy0, vx1, vy1);
    drawTownBorders(g);
    if (state.biome) {
      g.globalAlpha = 0.55;
      for (const c of map) { diamond(g, c.x, c.y); g.fillStyle = BIOMES[swBiome(c)].color; g.fill(); }
      g.globalAlpha = 1;
    }
    // flat things first (track, level crossings, bridges), then what stands up, faces and walkers in depth order
    for (const s of FLAT) {
      if (s.draw) { s.draw(g); continue; }
      if (s.x > vx1 || s.y > vy1 || s.x + s.w < vx0 || s.y + s.h < vy0) continue;
      g.drawImage(s.img, s.sx, s.sy, s.sw, s.sh, s.x, s.y, s.w, s.h);
    }
    const items = [];
    for (const f of FACES) items.push({ depth: f.depth, face: f });
    for (const w of WALKERS) { const s = walkerAt(w, t); if (s.hidden) continue; items.push({ depth: (s.tx + s.ty) * 100 + 16, walker: s }); }
    items.sort((a, b) => a.depth - b.depth);
    let q = 0;
    const flush = (upto) => { while (q < items.length && items[q].depth <= upto) { const it = items[q++]; if (it.face) drawFace(g, it.face, t); else drawWalker(g, it.walker); } };
    for (const s of SPRITES) {
      flush(s.depth);
      if (s.draw) { s.draw(g); continue; }
      if (s.x > vx1 || s.y > vy1 || s.x + s.w < vx0 || s.y + s.h < vy0) continue;
      if (s.flip) { g.save(); g.translate(s.x + s.w, s.y); g.scale(-1, 1); g.drawImage(s.img, s.sx, s.sy, s.sw, s.sh, 0, 0, s.w, s.h); g.restore(); }
      else g.drawImage(s.img, s.sx, s.sy, s.sw, s.sh, s.x, s.y, s.w, s.h);
    }
    flush(Infinity);
    // (v9.2) Fog, then the storm over everything: the overcast, the rain, the lightning
    if (fogMode !== 'off') fogDraw(g, t, now, vx0, vy0, vx1, vy1);
    if (sk > 0) {
      stormOvercast(g, sk); stormRain(g, t, sk);
      if (lightningOk()) { const f = flashAt(t); if (f && f.u < FLASH_LEN) { stormFlash(g, f, sk); stormBolt(g, f); } }
    }
    if (hover) { diamond(g, hover.x, hover.y); g.strokeStyle = '#ece4d0'; g.lineWidth = 1.6 / cam.z; g.stroke(); }
    if (flash && now < flash.until) {
      const a = 0.5 + 0.5 * Math.sin(now / 120);
      for (const p of flash.tiles) { diamond(g, p.x, p.y); g.strokeStyle = `rgba(232,170,72,${a.toFixed(2)})`; g.lineWidth = 2.5 / cam.z; g.stroke(); }
    }
  }
  let lastFrame = 0;
  const overlayEl = $('start');
  function loop(now) {
    // the map is hidden while the loading screen covers it: skip the drawing and let the painter run
    if (!overlayEl.hidden) { dirty = true; requestAnimationFrame(loop); return; }
    if (now - lastFrame > 33 || dirty) { draw(now); lastFrame = now; dirty = false; }
    requestAnimationFrame(loop);
  }

  // ---------- data for tooltips (from the approved demo)
  const ICONS = {
    wheat: '<svg viewBox="0 0 12 12"><path d="M6 11V3" stroke="#d9b24a" stroke-width="1.2"/><g fill="#e8c35c"><ellipse cx="4.6" cy="4" rx="1.2" ry="2" transform="rotate(-25 4.6 4)"/><ellipse cx="7.4" cy="4" rx="1.2" ry="2" transform="rotate(25 7.4 4)"/><ellipse cx="4.6" cy="7" rx="1.2" ry="2" transform="rotate(-25 4.6 7)"/><ellipse cx="7.4" cy="7" rx="1.2" ry="2" transform="rotate(25 7.4 7)"/></g></svg>',
    wood: '<svg viewBox="0 0 12 12"><rect x="1" y="4" width="10" height="5" rx="2.5" fill="#8a5a2f"/><circle cx="9" cy="6.5" r="2.2" fill="#c99a62"/><circle cx="9" cy="6.5" r="1" fill="none" stroke="#8a5a2f" stroke-width=".7"/></svg>',
    stone: '<svg viewBox="0 0 12 12"><path d="M2 9l1.5-5 4-1.5 3 3L9.5 10z" fill="#a6a39a"/><path d="M3.5 4l4-1.5 3 3" fill="none" stroke="#d8d5cc" stroke-width=".8"/></svg>',
    water: '<svg viewBox="0 0 12 12"><path d="M6 1.5C4 4.5 3 6 3 7.5a3 3 0 0 0 6 0C9 6 8 4.5 6 1.5z" fill="#5fb3d0"/></svg>',
  };
  const res = (k) => `<span class="res">${ICONS[k]}<u>${k}</u></span>`;
  const b = (n) => `<b>${n}</b>`;
  const TN = { grass: 'Grass', forest: 'Forest', sand: 'Sand', rock: 'Rock', hill: 'Hill', water: 'Water', ice: 'Ice' };
  const BIOMES = {
    plains: { name: 'Plains', desc: 'Open grassland. Farms thrive.', production: { farm: 1.25 }, track: 1, water: 1, speed: 1, color: '#9cba5a' },
    forest: { name: 'Forest', desc: 'Dense woodland. Lumber yards cut more; track costs extra clearing.', production: { lumber: 1.3 }, track: 1.2, water: 1, speed: 1, color: '#4e7a3a' },
    desert: { name: 'Desert', desc: 'Hot and dry. Quarries dig more, pumps find little water, steam engines drink more.', production: { quarry: 1.3, pump: 0.5, farm: 0.5 }, track: 1, water: 1.5, speed: 1, color: '#d8c07a' },
    taiga: { name: 'Taiga', desc: 'Cold conifer country. Lumber and pumps do well, farms poorly; trains run a little slower.', production: { lumber: 1.15, pump: 1.1, farm: 0.7 }, track: 1.1, water: 1, speed: 0.9, color: '#6e8f86' },
    ocean: { name: 'Ocean', desc: 'Open sea along the map edge. Pumps draw plenty.', production: { pump: 1.3 }, track: 1, water: 1, speed: 1, color: '#2f5f7a' },
    lake: { name: 'Lake', desc: 'Still water filling a basin. Pumps draw well; bridges only.', production: { pump: 1.3 }, track: 1, water: 1, speed: 1, color: '#4f8fa8', proposed: true },
    river: { name: 'River', desc: 'Running water from the hills to a lake or the sea. Pumps draw well; bridges cross it.', production: { pump: 1.2 }, track: 1, water: 1, speed: 1, color: '#6fb6cf', proposed: true },
    mountain: { name: 'Mountain', desc: 'Bare rock, snow and glacier ice high up. Quarries dig more; track costs more and trains climb slower; pumps find little.', production: { quarry: 1.3, pump: 0.6 }, track: 1.5, water: 1, speed: 0.9, color: '#a9a6a0', proposed: true },
    beach: { name: 'Beach', desc: 'Sand on the sea shore. Quarries find little; pumps get salt water.', production: { quarry: 0.8, pump: 0.6 }, track: 1, water: 1, speed: 1, color: '#efe0a8', proposed: true },
  };
  BIOMES.swamp = SWAMP_BIOME; // v9, lane L2 (the game's swamp biome, src/data/biomes.json)
  const STATIONS = {
    farm: { name: 'Farm', makes: 'wheat', wantName: 'grass tiles' },
    lumber: { name: 'Lumber yard', makes: 'wood', wantName: 'forest tiles' },
    quarry: { name: 'Quarry', makes: 'stone', wantName: 'rock and hill tiles' },
    pump: { name: 'Water pump', makes: 'water', wantName: 'water tiles' },
  };
  const TERRAIN_INFO = {
    grass: 'Open ground. Most buildings and all track can go here.',
    forest: 'Trees. Lumber yards count it; track costs extra clearing.',
    sand: 'Loose sand. Track and buildings can go here.',
    rock: 'Bare rock. Quarries count it; nothing is built on it.',
    hill: 'Rising ground. Quarries count it; track keeps to the elevation rules.',
    water: 'Bridges only; pumps draw from it.',
    ice: 'Glacier ice. Nothing is built on it; its melt starts a river below.',
  };

  // ---------- tooltips: a stack; each locks after HOLD_MS of rest, then the pointer may enter it
  const stack = [];
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  const RR = 5, CC = 2 * Math.PI * RR;
  function openTip(level, anchor, build) {
    closeFrom(level);
    const tip = el('div', 'tt panel'); tip.append(...build());
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('class', 'ring'); ring.setAttribute('viewBox', '0 0 14 14');
    ring.innerHTML = `<circle class="bg" cx="7" cy="7" r="${RR}"/><circle class="fg" cx="7" cy="7" r="${RR}" stroke-dasharray="${CC}" stroke-dashoffset="${CC}"/>`;
    tip.append(ring); document.body.append(tip); placeTip(tip, anchor);
    const rec = { tip, level, locked: false, start: performance.now(), raf: 0, leaveTimer: 0 };
    const fg = ring.querySelector('.fg');
    const tick = (now) => { const p = Math.min(1, (now - rec.start) / HOLD_MS); fg.setAttribute('stroke-dashoffset', String(CC * (1 - p))); if (p >= 1) { rec.locked = true; tip.classList.add('locked'); ring.style.opacity = '0.55'; return; } rec.raf = requestAnimationFrame(tick); };
    rec.raf = requestAnimationFrame(tick);
    tip.addEventListener('mouseenter', () => { clearTimeout(rec.leaveTimer); rec.leaveTimer = 0; for (const s of stack) if (s.level < level) { clearTimeout(s.leaveTimer); s.leaveTimer = 0; } });
    tip.addEventListener('mouseleave', (e) => { const to = e.relatedTarget; if (to && stack.some((s) => s.level > level && s.tip.contains(to))) return; rec.leaveTimer = setTimeout(() => closeFrom(level), GRACE_MS); });
    wireTerms(tip, level); stack.push(rec); return rec;
  }
  function closeFrom(level) { while (stack.length && stack[stack.length - 1].level >= level) { const s = stack.pop(); cancelAnimationFrame(s.raf); clearTimeout(s.leaveTimer); s.tip.remove(); } }
  function placeTip(tip, a) { const w = tip.offsetWidth, h = tip.offsetHeight; tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, a.x + 14))}px`; tip.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, a.y + 14))}px`; }
  function wireTerms(tip, level) {
    for (const t of tip.querySelectorAll('.term')) {
      let timer = 0;
      t.addEventListener('mouseenter', () => { const rec = stack.find((s) => s.level === level); if (!rec || !rec.locked) return; timer = setTimeout(() => { const r = t.getBoundingClientRect(); openTip(level + 1, { x: r.right - 6, y: r.bottom - 10 }, () => termContent(t.dataset.kind, t.dataset.id)); }, SHOW_MS); });
      t.addEventListener('mouseleave', (e) => { clearTimeout(timer); const child = stack.find((s) => s.level === level + 1); if (child && !child.locked && !(e.relatedTarget && child.tip.contains(e.relatedTarget))) closeFrom(level + 1); });
    }
  }
  const row = (a, v, cls = '') => el('div', `row ${cls}`, `<span>${a}</span><span>${v}</span>`);
  const pct = (m) => (m === 1 ? '—' : b(`${m > 1 ? '+' : '−'}${Math.round(Math.abs(m - 1) * 100)}%`));
  const biomeTerm = (id) => `<span class="term" data-kind="biome" data-id="${id}">${BIOMES[id].name}</span>`;
  function termContent(kind, id) {
    if (kind === 'biome') {
      const bm = BIOMES[id], out = [el('div', 'tt-title', `${bm.name} biome`), el('div', 'dim', bm.desc)];
      for (const [k, m] of Object.entries(bm.production)) out.push(row(`${res(STATIONS[k].makes)} from <span class="term" data-kind="station" data-id="${k}">${STATIONS[k].name.toLowerCase()}s</span>`, pct(m), m > 1 ? 'good' : 'bad'));
      if (bm.track !== 1) out.push(row('Track cost', pct(bm.track), bm.track > 1 ? 'bad' : 'good'));
      if (bm.water !== 1) out.push(row(`Steam engines' ${res('water')} use`, pct(bm.water), bm.water > 1 ? 'bad' : 'good'));
      if (bm.speed !== 1) out.push(row('Train speed', pct(bm.speed), bm.speed < 1 ? 'bad' : 'good'));
      if (bm.proposed) out.push(el('div', 'hint', 'New biome: values are a proposal.'));
      return out;
    }
    if (kind === 'station') { const s = STATIONS[id]; return [el('div', 'tt-title', s.name), el('div', '', `Makes ${res(s.makes)}: ${b(30)} a week at level ${b(1)}, more with ${s.wantName} within ${b(4)} tiles (nearer ones count more) and in a biome that suits it.`)]; }
    if (kind === 'fall') return [el('div', 'tt-title', 'Waterfall'), el('div', '', `A river falls ${b(id)} level${id === '1' ? '' : 's'} here, from 1 to 4. Track crosses it on a bridge at the upper level; nothing is built on it.`)];
    return [];
  }
  const shortKey = (k) => k.replace(/^road\/[^/]+\//, '').replace(/^[a-z]+\//, '');
  function verdict(e) {
    if (e.status === 'flagged-redo') return { cls: 'v-redo', label: 'Redo' };
    if (e.status === 'flagged-extra') return { cls: 'v-extra', label: 'Extra' };
    return e.verdict === 'Use' ? { cls: 'v-use', label: 'Use' } : { cls: 'v-after', label: 'Use after finishing' };
  }
  const chip = (e) => { const v = verdict(e); return `<span class="chip ${v.cls}">${v.label}</span>`; };
  function picRow(key, note) {
    const e = peopleEntry(key) || CX[key], v = key.startsWith('road/w') ? ` <span class="dim">(${key.split('/')[1]})</span>` : '';
    return el('div', 'pic', `<code>${shortKey(key)}${v}</code>${chip(e)}${note ? `<small>${note}</small>` : ''}`);
  }
  function groundRow(c) {
    const m = MAT[c.i];
    if (m === M.ROCKMIX) return [picRow('swatch/mountain-rock-high', 'ground: stone islands of a Rock tile'), picRow('swatch/alpine-ground', 'ground between the stones')];
    if (SWATCH[m]) return [picRow(SWATCH[m], c.pond ? 'ground under the pond ring' : c.kind === 'river' ? 'the bank at the water’s edge, fading into the ground beside it' : 'ground swatch')];
    if (m === M.CITY && pavingName !== 'v2') return [row('Ground', `City paving <span class="dim">small setts drawn by the demo (Paving: ${PAVINGS[pavingName].label.split(':')[0]})</span>`)];
    if (MTNF[c.i]) return [row('Ground', `${GAME_MAT[m]} <span class="dim">game swatch, painted on the mountain as Codex’s alpine ground and rock (relief ${RELIEFS[reliefName].label.split(':')[0]})</span>`)];
    return [row('Ground', `${GAME_MAT[m]} <span class="dim">game swatch</span>`)];
  }
  function tileContent(c) {
    const snow = SNOWT[c.i] > 0;
    const title = c.fall ? 'Waterfall' : c.headwater ? 'Headwater' : isGlacier(c) ? 'Glacier' : c.kind === 'land' ? TN[c.terrain] + (snow ? ', snow' : '') : 'Water';
    const out = [el('div', 'tt-title', title)];
    out.push(row('Biome', biomeTerm(isGlacier(c) ? 'mountain' : c.biome)));
    out.push(row('Elevation', `level ${b(c.level)}`));
    if (c.fall) out.push(row('Drop', `<span class="term" data-kind="fall" data-id="${c.fall}">${b(c.fall)} level${c.fall > 1 ? 's' : ''}</span>`));
    if (c.headwater) out.push(row('Source', c.headwater === 'melt' ? 'melt below a glacier' : 'a spring on high ground'));
    if (snow) out.push(row('Snow line', `above level ${b(3)}`));
    if (c.kind === 'river') out.push(row('Flow', `gathers ${b(Math.round(c.acc))} tiles of rain`));
    const bld = WORLD.buildings.find((q) => q.x === c.x && q.y === c.y && (!q.redo || state.redo));
    if (bld && bld.makes) out.push(row(bld.name, `${res(bld.makes)} ${b(30)} a week`));
    if (bld && bld.town != null) { const t = WORLD.towns[bld.town]; out.push(row('Town hall', `<span style="color:${townHex(t)}">■</span> ${b(t.name)}`)); out.push(el('div', 'hint', 'Its town’s border shows while the pointer is on the town hall; a click pins it.')); }
    if (c.field !== undefined) out.push(row('Wheat field', `for the ${res('wheat')} of the farm`));
    const pics = PICS[c.i].filter((p) => p.key);
    const seen = new Set();
    out.push(el('div', 'sec', 'Codex picture and review'));
    for (const r of groundRow(c)) out.push(r);
    for (const p of pics) { if (seen.has(p.key)) continue; seen.add(p.key); out.push(picRow(p.key, p.note)); if (seen.size >= 5) break; }
    for (const p of PICS[c.i]) if (!p.key) out.push(el('div', 'hint', p.note));
    if (BUILT[c.i].length) { out.push(el('div', 'sec', 'Game art')); for (const t of BUILT[c.i].slice(0, 4)) out.push(el('div', 'dim', t)); }
    out.push(el('div', 'dim', c.kind === 'land' && !isGlacier(c) ? TERRAIN_INFO[c.terrain] : isGlacier(c) ? TERRAIN_INFO.ice : c.headwater ? 'Where a river starts. Bridges cross it; pumps draw from it.' : TERRAIN_INFO.water));
    swampTip(c, out); // v9, lane L2: a swamp tile's biome, ground and placeholders
    return out;
  }

  // ---------- picking: the tile whose painted surface shows at the point, found the way the painter
  // finds it (marching the view ray front to back), so banks between levels pick a tile too
  function pick(sx, sy) {
    const [wx, wy] = toWorld(sx, sy);
    const d = wx / 32, sLo = Math.max(-1 - d, d - 1), sHi = Math.min(2 * W - 1 - d, 2 * H - 1 + d);
    if (sLo > sHi) return null;
    for (let s = sHi; s >= sLo; s -= 1 / 32) {
      const tx = (s + d) / 2, ty = (s - d) / 2;
      if (16 * s - heightAt(tx, ty) <= wy) {
        if (s === sHi && 16 * s - heightAt(tx, ty) < wy - 1) return null; // below the map's front edge
        return map[idx(Math.max(0, Math.min(W - 1, Math.round(tx))), Math.max(0, Math.min(H - 1, Math.round(ty))))];
      }
    }
    return null;
  }

  // ---------- input: drag to pan, wheel to zoom, hover for tooltips
  let drag = null, last = null;
  view.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false, id: e.pointerId }; });
  window.addEventListener('pointerup', (e) => {
    // a click on a town hall pins its town's border; a second click lets it go (Escape lets every pinned border go)
    if (drag && !drag.moved && e.target === view) { const r = view.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, k = townHallAt(sx, sy, pick(sx, sy)); if (k >= 0) toggleTownPin(k); }
    if (drag && !drag.moved && e.pointerType === 'touch' && e.target === view) {
      const r = view.getBoundingClientRect(), c = pick(e.clientX - r.left, e.clientY - r.top);
      if (c) { hover = c; last = c; dirty = true; openTip(0, { x: e.clientX, y: e.clientY }, () => tileContent(c)); }
    } else if (drag && !drag.moved && e.pointerType === 'touch') closeFrom(0);
    if (drag && drag.moved) view.classList.remove('drag');
    drag = null;
  });
  let lastPt = { x: 0, y: 0 };
  view.addEventListener('pointermove', (e) => {
    const r = view.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; view.classList.add('drag'); closeFrom(0); hover = null; last = null; try { view.setPointerCapture(drag.id); } catch (_) { /* ignore */ } }
      if (drag.moved) { cam.x = drag.cx - dx / cam.z; cam.y = drag.cy - dy / cam.z; clampCam(); dirty = true; return; }
    }
    if (e.pointerType === 'touch') return;
    const c = pick(sx, sy), top = stack[0];
    setTownHover(townHallAt(sx, sy, c));
    if (top && top.locked) { if (!top.leaveTimer) top.leaveTimer = setTimeout(() => { closeFrom(0); last = null; }, GRACE_MS * 2); hover = c; dirty = true; return; }
    lastPt = { x: e.clientX, y: e.clientY };
    if (!c) { clearTimeout(rootTimer); hover = null; last = null; closeFrom(0); dirty = true; return; }
    if (c !== last) {
      last = c; hover = c; dirty = true; clearTimeout(rootTimer); closeFrom(0);
      rootTimer = setTimeout(() => { if (last === c) openTip(0, lastPt, () => tileContent(c)); }, ROOT_DELAY_MS);
    } else if (stack[0]) placeTip(stack[0].tip, lastPt);
  });
  view.addEventListener('pointerleave', (e) => {
    clearTimeout(rootTimer);
    const top = stack[0];
    if (top && top.locked && e.relatedTarget && top.tip.contains(e.relatedTarget)) return;
    if (top && top.locked) { if (!top.leaveTimer) top.leaveTimer = setTimeout(() => { closeFrom(0); last = null; hover = null; dirty = true; }, GRACE_MS * 2); return; }
    closeFrom(0); hover = null; last = null; dirty = true; setTownHover(-1);
  });
  view.addEventListener('wheel', (e) => { e.preventDefault(); closeFrom(0); last = null; const r = view.getBoundingClientRect(); setZoom(cam.z * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  $('z-in').addEventListener('click', () => { closeFrom(0); setZoom(cam.z * 1.5); });
  $('z-out').addEventListener('click', () => { closeFrom(0); setZoom(cam.z / 1.5); });
  $('z-fit').addEventListener('click', () => { closeFrom(0); cam.x = (W - H) * 16; cam.y = (W + H) * 8 - 12; setZoom(Math.min(VW / ((W + H) * 32 + 40), VH / ((W + H) * 16 + 80))); });
  window.addEventListener('scroll', () => closeFrom(0), { passive: true });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && TB.pinned.size) { TB.pinned.clear(); dirty = true; hint.textContent = hintText(); } });
  window.addEventListener('resize', () => { resize(); });
  if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(stage);

  // ---------- toggles. Every change goes through one queue, so two repaints never interleave, and a failure is
  // reported in the hint line and leaves the queue free (v1: one road choice Codex never drew threw inside the
  // repaint, its busy flag stayed set, and every later toggle was dropped).
  const hint = $('hintline');
  let jobs = Promise.resolve(), queued = 0, lastError = '';
  function enqueue(fn) {
    queued++;
    jobs = jobs.then(() => { lastError = ''; return fn(); }).catch((e) => { lastError = e && e.message ? e.message : String(e); console.error(e); }).finally(() => { queued--; dirty = true; hint.textContent = hintText(); });
    return jobs;
  }
  function rebuild() {
    return enqueue(async () => {
      const before = signature();
      buildScene(false); CHAINS = null; // (the redo pieces can change a river's course)
      const after = signature();
      const changed = [];
      for (let i = 0; i < N; i++) if (before[i] !== after[i]) changed.push(i);
      dirty = true; closeFrom(0); last = null;
      if (changed.length) { hint.textContent = 'Repainting the ground…'; await paint(columnsFor(changed)); }
    });
  }
  // the relief or the glacier option: the whole ground is repainted
  function applyModes() {
    RM = RELIEFS[reliefName]; GM = GLACIERS[glacierName]; GWARP = glacierName === 'demo' ? 0 : 0.3;
    levelPlan(); PH.fill(NaN); buildDetails(); CHAINS = null;
  }
  function setModes(relief, glacier) {
    if (relief != null && !RELIEFS[relief]) return Promise.reject(new Error(`no relief ${relief}`));
    if (glacier != null && !GLACIERS[glacier]) return Promise.reject(new Error(`no glacier ${glacier}`));
    // the option already shown: nothing to repaint (v2 repainted the whole map for 4 to 5 s)
    if ((relief == null || relief === reliefName) && (glacier == null || glacier === glacierName)) return jobs;
    if (relief != null) reliefName = relief;
    if (glacier != null) glacierName = glacier;
    syncButtons();
    return enqueue(async () => {
      applyModes(); closeFrom(0); last = null;
      hint.textContent = 'Repainting the ground…';
      buildScene(false);
      warmPainter(); // (each option has branches the painter has not met yet: see warmPainter)
      await paint([[0, GW]]);
    });
  }
  const setRelief = (name) => setModes(name, null), setGlacier = (name) => setModes(null, name);
  let resetNote = '';
  function hintText() {
    const v = variant();
    // (v9) in the toolbar's order: the weather, the water, the land, buildings and people, track and roads; what each
    // switch does is in its buttons' tooltips
    const bits = [WIND.level === 'calm' ? 'Weather: calm, nothing moves in the wind' : `Weather: ${WIND.level}, wind from ${WIND_NAMES[WIND.from]}${WIND.level === 'breeze' && WIND.from === 'W' ? ' (default)' : ''}`];
    bits.push(stormHint());
    bits.push(fogHint());
    bits.push(state.anim ? 'Water: animated (default)' : `Water: still, as in v7${still ? ' (reduced motion)' : ''}`);
    bits.push(state.anim ? wavesHint() : `${wavesHint()}, with Animated water`);
    bits.push(`Relief: ${RELIEFS[reliefName].label.split(':')[0]}`);
    bits.push(`Glacier: ${GLACIERS[glacierName].label.split(':')[0]}`);
    bits.push(coastHint()); // v9, lane L2
    bits.push(LIFE.on ? 'Building life: on (default)' : 'Building life: off, as in v8');
    bits.push(smokeHint());
    bits.push(bscaleHint());
    bits.push(peopleHint());
    bits.push(`Ground fit: ${GF_LABEL[gfStep].split(':')[0]}`);
    bits.push(`Paving: ${PAVINGS[pavingName].label.split(':')[0]}`);
    bits.push(sleeperHint());
    bits.push(v === 'organic' ? 'Roads: organic (default)' : `Roads: measured ${v}`);
    bits.push(state.rbridges === 'on' ? 'Road bridges: on (default), the creek bridge by the farm and the wider bridge by the pump' : 'Road bridges: off, as v9.1');
    if (resetNote) bits.push(resetNote);
    if (state.redo) bits.push('redo pieces shown (red chips in the tooltips)');
    if (state.redo && glacierName === 'channel') bits.push('the side arm (glacier-strip-x) shows with Glacier: As now');
    if (state.extras) bits.push('the four extra passengers walk the town');
    if (state.raw) bits.push('the raw #319 strips lie on the farm lane and the main street');
    if (state.deck === 'stone') bits.push('stone bridge decks on both bridges (the town bridge’s, along x, is a redo: red chip in its tooltip)');
    const tb = townHint(); if (tb) bits.push(tb);
    if (lastError) bits.push(`Error: ${lastError}`);
    return bits.join(' · ');
  }
  const press = (btn, on) => btn.setAttribute('aria-pressed', String(on));
  function syncButtons() {
    press($('t-redo'), state.redo); press($('t-extra'), state.extras); press($('t-biome'), state.biome); press($('t-raw'), state.raw);
    for (const b of document.querySelectorAll('[data-water]')) press(b, (b.dataset.water === 'anim') === state.anim);
    for (const b of document.querySelectorAll('[data-weather]')) press(b, b.dataset.weather === WIND.level);
    for (const b of document.querySelectorAll('[data-wind]')) press(b, b.dataset.wind === WIND.from);
    for (const b of document.querySelectorAll('[data-life]')) press(b, (b.dataset.life === 'on') === LIFE.on);
    for (const b of document.querySelectorAll('[data-rbridge]')) press(b, b.dataset.rbridge === state.rbridges);
    for (const gEl of document.querySelectorAll('[data-set]')) {
      // with the organic set shown, width, edge and crossing show its own values (0.32, B, stone) and stay live: a
      // click picks the measured set with that value (v2 dimmed them, and they looked switched off)
      const key = gEl.dataset.set;
      for (const btn of gEl.querySelectorAll('.btn')) press(btn, state[key] === btn.dataset.v);
    }
    for (const b of document.querySelectorAll('[data-relief]')) press(b, b.dataset.relief === reliefName);
    for (const b of document.querySelectorAll('[data-glacier]')) press(b, b.dataset.glacier === glacierName);
  }
  $('t-redo').addEventListener('click', () => { state.redo = !state.redo; syncButtons(); rebuild(); });
  $('t-extra').addEventListener('click', () => { state.extras = !state.extras; syncButtons(); rebuild(); });
  $('t-biome').addEventListener('click', () => { state.biome = !state.biome; syncButtons(); dirty = true; hint.textContent = hintText(); });
  $('t-raw').addEventListener('click', () => { state.raw = !state.raw; syncButtons(); rebuild(); });
  for (const b of document.querySelectorAll('[data-water]')) b.addEventListener('click', () => { state.anim = b.dataset.water === 'anim'; syncButtons(); dirty = true; hint.textContent = hintText(); warmFrames(); });
  // Weather and Wind from (v9): they set WIND and repaint nothing; what moves in the wind is drawn every frame
  function setWeather(level, from) { setWind(level, from); syncButtons(); dirty = true; hint.textContent = hintText(); return WIND; }
  for (const b of document.querySelectorAll('[data-weather]')) b.addEventListener('click', () => setWeather(b.dataset.weather, null));
  for (const b of document.querySelectorAll('[data-wind]')) b.addEventListener('click', () => setWeather(null, b.dataset.wind));
  // Building life (v9): the windmill's sails, the chimneys' smoke and the crane's load; Off gives v8's buildings
  function setLife(on) { LIFE.on = !!on; syncButtons(); dirty = true; hint.textContent = hintText(); return LIFE.on; }
  for (const b of document.querySelectorAll('[data-life]')) b.addEventListener('click', () => setLife(b.dataset.life === 'on'));
  // Smoke (v9.2): Tall (the default) or v9.1's chimney smoke; it is drawn every frame, so nothing is rebuilt
  function setSmoke(mode) {
    if (mode !== 'tall' && mode !== 'v91') throw new Error(`no smoke ${mode}`);
    smokeMode = mode;
    for (const b of document.querySelectorAll('[data-smoke]')) press(b, b.dataset.smoke === smokeMode);
    dirty = true; hint.textContent = hintText();
    return smokeMode;
  }
  for (const b of document.querySelectorAll('[data-smoke]')) b.addEventListener('click', () => setSmoke(b.dataset.smoke));
  // Road bridges (v9.2): the two bridges, their roads and their walkers; the ground under the new roads is repainted
  function setRoadBridges(mode) {
    if (mode !== 'on' && mode !== 'off') throw new Error(`no road bridges ${mode}`);
    if (state.rbridges === mode) return jobs;
    state.rbridges = mode; syncButtons();
    return rebuild();
  }
  for (const b of document.querySelectorAll('[data-rbridge]')) b.addEventListener('click', () => setRoadBridges(b.dataset.rbridge));
  function smokeHint() {
    return (smokeMode === 'tall' ? 'Smoke: tall, about one house chimney in three, a thin plume two to three storeys high (default)' : 'Smoke: as v9.1') + (LIFE.on ? '' : ', shows with Building life On');
  }
  for (const b of document.querySelectorAll('[data-relief]')) b.addEventListener('click', () => setRelief(b.dataset.relief));
  for (const b of document.querySelectorAll('[data-glacier]')) b.addEventListener('click', () => setGlacier(b.dataset.glacier));
  for (const b of document.querySelectorAll('[data-gfit]')) b.addEventListener('click', () => setGroundFit(b.dataset.gfit));
  // a road choice: Codex varied one thing at a time from the timber default, so a choice it never drew keeps the
  // new value and puts the other two back to that default
  function pickRoad(key, v) {
    resetNote = '';
    if (key === 'roads') { state.roads = v; if (v === 'organic') Object.assign(state, ORGANIC_LOOK); return; }
    if (state.roads === 'organic') resetNote = 'switched from the organic set, which is drawn at width 0.32, edge B and stone crossings only';
    state.roads = 'measured'; state[key] = v;
    if (!VARIANTS.includes(measured())) {
      for (const k of ['width', 'edge', 'crossing']) if (k !== key) state[k] = MEASURED_BASE[k];
      resetNote = (resetNote ? resetNote + '; ' : '') + 'Codex varied one road choice at a time from the timber default, so the other two went back to it';
    }
  }
  for (const gEl of document.querySelectorAll('[data-set]')) {
    for (const btn of gEl.querySelectorAll('.btn')) btn.addEventListener('click', () => {
      const key = gEl.dataset.set;
      if (key === 'deck') { state.deck = btn.dataset.v; resetNote = ''; } else pickRoad(key, btn.dataset.v);
      syncButtons(); rebuild();
    });
  }
  function applyState(s) { let ch = false; for (const [k, v] of Object.entries(s)) if (state[k] !== v) { state[k] = v; ch = true; } if (ch) syncButtons(); return ch; }
  // the town paving: only the paved tiles' columns are repainted
  const PAVED = map.filter((c) => c.paved).map((c) => c.i);
  const syncPaving = () => { for (const b of document.querySelectorAll('[data-paving]')) press(b, b.dataset.paving === pavingName); };
  function setPaving(name) {
    if (!PAVINGS[name]) return Promise.reject(new Error(`no paving ${name}`));
    if (name === pavingName) return jobs;
    pavingName = name; syncPaving();
    // (the roads across the square are the paving's own lane, except under the old paving: the scene is rebuilt)
    return enqueue(async () => { closeFrom(0); last = null; buildScene(false); hint.textContent = 'Repainting the ground…'; await paint(columnsFor(PAVED)); });
  }
  for (const b of document.querySelectorAll('[data-paving]')) b.addEventListener('click', () => setPaving(b.dataset.paving));
  syncPaving();

  // ---------- legend: every Codex picture, its verdict and where it is
  const NOT_PLACED = [
    [/^water\/cliff-/, 'Not used since v3: each fall lies on its own slope, between the river picture’s banks, and the relief has no other cliffs.'],
    [/^water\/plunge-foam-/, 'Not used since the v3 fix round: laid at the foot of a fall it read as a straight plank across the river; the foam where the water lands is painted, fanning out down the river.'],
    [/^water\/face-cliff-rock-/, 'Not used since the v3 fix round: each fall lies on its own slope, and beside the ice front the step is the moraine’s rubble (this tan rock read as a brown column against the moraine bank).'],
    [/^water\/(lake|beach)-ring$/, 'Not used: the author did not ask for rings; lakes and coasts are the game’s own generation.'],
    [/^swatch\/lake-water$/, 'Not used: all still water looks alike, so lakes take the game’s water, as the sea does (the author’s choice).'],
    [/^water\/river-mouth-nw-attempt-2$/, 'Not used: its wide stony banks end square on the land and cannot fade into it like the other river banks, so every mouth is the channel opening into the still water.'],
    [/^road\/organic\//, 'Not on this map: no tile of this kind picks this variant.'],
    [/^water\/waterfall-/, 'Not drawn since v3: this cascade is a vertical face, and the author found the vertical falls 2D. Each fall now lies along its slope, painted with this cascade’s own material (face-fall-sheet).'],
    [/^mountain\/(ice-front|ice-portal)-sw$/, 'Not used: the ice front is painted into the step at the glacier’s end from the face-ice-cliff material; laid on the bank, this piece read as a grey arch on a stone ramp (the author, 2026-10-12).'],
    [/^mountain\/face-ice-portal-lit$/, 'Only the Ice channel’s cave uses its dark inside; As now and the Ice tongue paint their cave (its symmetric round arch read as a culvert).'],
    [/^mountain\/(ice-front|ice-portal)-se$/, 'This map’s glacier ends over a SW edge, so the SE front has no place.'],
    [/^mountain\/face-ice-(cliff|portal)-shade$/, 'Material of the SE ice front and cave, which have no place on this map.'],
    [/^screen\//, 'On the start screen and the thumbnail at the top of this panel.'],
  ];
  const needs = (key) => {
    const e = CX[key], s = {};
    if (key.startsWith('road/w')) { const [w, ed, cr] = key.split('/')[1].slice(1).split('-'); Object.assign(s, { roads: 'measured', width: w, edge: ed, crossing: cr }); }
    if (key.startsWith('road/organic/')) Object.assign(s, { roads: 'organic', ...ORGANIC_LOOK });
    if (key.startsWith('road/material/road-strip')) s.raw = true;
    if (key.startsWith('road/material/crossing')) Object.assign(s, { roads: 'measured', width: '0.32', edge: 'B', crossing: 'stone' });
    if (key.startsWith('bridge/stone')) s.deck = 'stone';
    if (key.startsWith('bridge/wood')) s.deck = 'wood';
    if ((e.status === 'flagged-redo' && !key.startsWith('bridge/') && !peopleR7(key)) || key === 'swatch/wet-sand' || key === 'swatch/glacier-ice') s.redo = true;
    if (e.status === 'flagged-extra') s.extras = true;
    return s;
  };
  const CENSUS = {};
  const CENSUS_GL = {}; // v3: the glacier option each picture was first found under
  function census() {
    const keep = { ...state };
    const states = [{}, { redo: true, extras: true, raw: true, deck: 'stone' }, ...VARIANTS.map((v) => { const [w, ed, cr] = v.slice(1).split('-'); return { roads: 'measured', width: w, edge: ed, crossing: cr }; })];
    // v3: the Ice channel paints its own ice, so Codex's glacier pieces are found (and shown) with Glacier: As now
    const g0 = glacierName;
    for (const gl of g0 === 'demo' ? ['demo'] : [g0, 'demo']) {
      glacierName = gl; applyModes();
      for (const s of states) { Object.assign(state, keep, s); const p = buildScene(true); for (const [k, v] of Object.entries(p)) if (!CENSUS[k]) { CENSUS[k] = v; CENSUS_GL[k] = gl; } }
    }
    glacierName = g0; applyModes();
    Object.assign(state, keep);
  }
  const GROUPS = [
    ['Ground swatches', (k) => k.startsWith('swatch/')],
    ['Lakes, beaches, rivers', (k) => k.startsWith('water/') && !/^water\/(waterfall|cliff|plunge|face-)/.test(k)],
    ['Waterfalls', (k) => /^water\/(waterfall|cliff|plunge|face-)/.test(k)],
    ['Glacier, mountain, springs', (k) => k.startsWith('mountain/')],
    ['Roads organic (default)', (k) => k.startsWith('road/organic/')],
    ...VARIANTS.map((v) => [`Roads measured ${v}`, (k) => k.startsWith(`road/${v}/`)]),
    ['#319 road materials', (k) => k.startsWith('road/material/')],
    ['Narrow bridge decks', (k) => k.startsWith('bridge/')],
    ['People', (k) => k.startsWith('people/')],
    ['Fuel Pump and wheat', (k) => k.startsWith('building/') || k.startsWith('prop/')],
    ['Loading screens', (k) => k.startsWith('screen/')],
  ];
  function buildLegend() {
    const box = $('legend');
    const c = { ready: 0, redo: 0, extra: 0 };
    for (const e of DATA.codex) c[e.status === 'flagged-redo' ? 'redo' : e.status === 'flagged-extra' ? 'extra' : 'ready']++;
    $('counts').innerHTML = `${b(DATA.codex.length)} pictures: ${b(c.ready)} ready, <span class="v-redo">${b(c.redo)} redo</span>, <span class="v-extra">${b(c.extra)} extra</span>. Redo and extra pictures appear when their switch is on; <i>Show me</i> turns it on for you.`;
    for (const [name, test] of GROUPS) {
      const keys = DATA.codex.filter((e) => test(e.key));
      if (!keys.length) continue;
      const det = el('details'); if (name.startsWith('Ground')) det.open = true;
      const sum = el('summary', '', `<span class="t">${name}</span><span class="c">${keys.length}</span>`);
      const rows = el('div', 'rows');
      for (const e of keys) {
        const r = el('div', 'r');
        const placed = CENSUS[e.key];
        const np = NOT_PLACED.find(([re]) => re.test(e.key));
        const label = shortKey(e.key);
        r.innerHTML = `<span class="k">${label}</span>${chip(e)}`;
        const btn = el('button', 'show', placed || e.key.startsWith('screen/') ? 'Show me' : '—');
        btn.disabled = !(placed || e.key.startsWith('screen/'));
        if (!btn.disabled) btn.addEventListener('click', () => showMe(e.key));
        r.append(btn);
        if (!placed && np) r.append(el('div', 'why', np[1]));
        else if (!placed && !e.key.startsWith('screen/')) r.append(el('div', 'why', 'Not on this map.'));
        rows.append(r);
      }
      det.append(sum, rows); box.append(det);
    }
    // game art
    const gbox = $('legend-game');
    const GAME_ROWS = [
      ['Grass, Forest, Taiga swatches', () => [T(30, 20), T(26, 17)]],
      ['Desert and Sand swatches', () => [T(29, 33), T(24, 18)]],
      ['Water swatch (the sea and the lakes)', () => [T(10, 6), T(21, 20)]],
      ['Rock swatch on the banks (off the mountain; on the mountain both reliefs use Codex’s mountain rock)', () => [T(16, 23)]],
      ['City paving (Paving v2; the others are the demo’s own)', () => [T(31, 27)]],
      ['Trees: oak, tree, birch, pine, spruce', () => [T(31, 17)]],
      ['Bushes, flowers, rocks, reeds, cactus', () => [T(24, 26), T(27, 32)]],
      ['Track: regular and narrow, curves', () => [T(31, 30), T(33, 25)]],
      ['Town hall, houses, station, warehouse', () => [T(31, 27)]],
      ['Farm, lumber yard, quarry, water pump, windmill', () => [T(21, 28), T(29, 21)]],
      ['Water tower and coaling stage', () => [T(27, 29)]],
      ['Town borders (v8): hover a town hall to see its town’s border, click it to pin; here two small towns meet', () => { TB.pinned.clear(); TB.pinned.add(1); TB.pinned.add(2); dirty = true; hint.textContent = hintText(); return [T(3, 3), T(2, 8), T(3, 6)]; }],
      ['Ground fit test: the station and the town hall beside a drop (placed when asked; compare the Ground fit steps here)', () => gfTestSites()],
    ];
    // v9: the new places, the relief first, then in the toolbar's order. A row whose place shows nothing at the page's
    // settings switches them on and says so (the trees, the desert and the shore want some wind, the windmill and the
    // smoke Building life, the shore Animated water and waves, the swamp its Coast); the rest leave every switch as it
    // is, so v8's setting can be compared at the same place. The third entry is the zoom the row flies to
    const WLV = ['calm', 'breeze', 'windy', 'storm'];
    const windAtLeast = (lv) => { if (WLV.indexOf(WIND.level) < WLV.indexOf(lv)) setWeather(lv, null); };
    GAME_ROWS.push(
      ['The mountain’s right side (v9 relief): each level step a ledge on the faces turned to the lower right and the upper right; compare Game v2 and Smooth v2, then look at the left side, which is v8’s', () => [T(34, 8), T(30, 2)], 2],
      ['Windy forest (v9): every tree sways, gusts rolling over the forest downwind (Show me sets Windy if it is calmer); try Storm and another Wind from', () => { windAtLeast('windy'); return [T(30, 17), T(31, 16)]; }, 2],
      ['Desert (v9): tumbleweeds roll and sand drifts downwind by the windmill, more as it blows harder (Show me sets Windy if it is calmer)', () => { windAtLeast('windy'); return [T(29, 33), T(31, 33)]; }, 2],
      ['Windmill (v9, Building life): its sails turn with the wind and coast to a stop in a calm; cut out of its picture by the demo until Codex paints them apart (#461). Show me turns Building life on and sets Breeze if it is off or calm', () => { if (!LIFE.on) setLife(true); windAtLeast('breeze'); return [T(34, 32)]; }, 3],
      ['Chimney smoke and the quarry crane (v9, Building life; Smoke, v9.2): a thin plume two to three storeys high, fewer chimneys lit, bending downwind more as it rises; a storm tears it flat and short; compare Smoke Tall and v9.1. The crane’s crate swings on its rope (Show me turns Building life on if it is off)', () => { if (!LIFE.on) setLife(true); return [T(31, 27), T(26, 22)]; }, 2],
      ['Waves on the shore (v9): Swell rolling into the bay and breaking on its beach; with the wind from the west they run up the bay’s east beach (Show me sets Animated water, Swell and Windy if they are off)', () => { if (!state.anim) { state.anim = true; syncButtons(); warmFrames(); } if (wavesName === 'v8') setWaves('swell'); windAtLeast('windy'); dirty = true; hint.textContent = hintText(); return [T(17, 10), T(18, 13)]; }, 3],
      ['Swamp coast (v9): mangroves on arched roots in the shallows, weeping willows on the banks, reeds, moss and pools on dark wet ground; the mangroves and willows are placeholders until Codex (#460). Show me sets Coast Swamp if it is Forest; try Windy', () => { if (!SWAMP.on) setCoast('swamp'); return [T(8, 14), T(9, 17)]; }, 2],
      ['People walking (v9): the main street, close up; compare People v8 and Fixed walk', () => [T(30, 25), T(30, 26)], 4],
      ['Building scale (v9, four settings in v9.2): a person standing at each door of the town (hall, houses, station, warehouse) and of the farm; compare As before, True v9, Smaller and People larger (Show me turns Figures on)', () => { if (!bsFigures) setFigures(true); return [T(31, 27), T(29, 29), T(21, 28)]; }, 2],
      ['Road bridge on its own (v9.2): the creek into the lake, crossed by a road on a bridge of its own, its road leading to it on both banks, a loop off the farm lane, and people walking over it; Bridge deck picks wood or stone (Show me turns Road bridges On if they are Off)', () => { if (state.rbridges !== 'on') setRoadBridges('on'); return [T(23, 26)]; }, 3],
      ['Road bridge beside the rail bridge (v9.2): the narrow line’s bridge over the river by the pump with a road bridge right beside it, one wider deck across both tiles, its piers and the parapets on the two outer edges only, the rail on one half and the road on the other, the road’s gravel running up to the deck at both banks; people cross it (Show me turns Road bridges On if they are Off)', () => { if (state.rbridges !== 'on') setRoadBridges('on'); return [T(33, 22), T(34, 22)]; }, 3],
      ['Storm (v9.2, Storm effects): rain in fine streaks slanted by the wind, rings on the water, an overcast and a darker, wetter ground, and a thin bolt far off with a short, gentle brightening now and then (none with reduced motion). Show me sets Weather Storm, Storm effects On and Animated water if they are off; compare Storm effects Off, which is v9.1’s Storm', () => { if (!STORM.on) setStormFx(true); if (WIND.level !== 'storm') setWeather('storm', null); if (!state.anim) { state.anim = true; syncButtons(); warmFrames(); } dirty = true; hint.textContent = hintText(); return [T(28, 27), T(24, 23)]; }, 2],
      ['Fog (v9.2): low mist pooling over the lake and the sea and in the valleys, thinning with height, drifting slowly with the wind; try Thick, which softens most of the map and fades the buildings and trees up the screen (Show me sets Valley mist if Fog is Off)', () => { if (fogMode === 'off') setFog('mist'); return [T(24, 23), T(20, 21)]; }, 1.5],
      ['Narrow line sleepers (v9): the narrow line by the lake, onto its bridge and round its curve (compare Sleepers v8 and Even, at zoom 2 and 4)', () => [T(28, 25), T(33, 25)], 2],
    );
    const rows = el('div', 'rows');
    for (const [label, f, z] of GAME_ROWS) {
      const r = el('div', 'r'); r.innerHTML = `<span class="k">${label}</span><span class="chip v-game">game</span>`;
      const btn = el('button', 'show', 'Show me'); btn.addEventListener('click', () => { const ts = f(); flyTo(ts, z || 2); }); r.append(btn); rows.append(r);
    }
    gbox.append(rows);
    // notes
    const notes = [
      'The ground follows <i>ground.md</i>: one material per tile with warped borders, patches against repetition, bank light, rims, rock on stacked banks, snow and the spring tint.',
      'One level is 10 game px here, the step Codex built its faces at (open point 2/3); the game’s painter uses 9.8.',
      'Waterfalls (v3, the author’s feedback of 12 October, afternoon: the vertical boxes looked 2D): each fall lies along its own slope, as steep as the relief’s banks, and a drop of two levels is one longer slope. Down it runs Codex’s falling-water material, its streaks along the fall line: at the brink it is the river’s own smooth, dark water, then it breaks into soft white streaks. The fix round: the sheet is exactly as wide as the river’s water, its sides wander and are wet, darker rock with spray drifting over them; where the water lands, painted white foam fans out down the river in tongues over darker pool water, with a few broken rings of ripples (Codex’s plunge-foam strip read as a plank). A fall over a far edge, whose drop looks away (fix round 1): its lip curves back upstream toward both banks, the water darkens and speeds up in streaks before it and bends over it in a soft glassy light, then breaks into white water; past the lip mist rises and the river below starts paler, churned white, with foam. Fix round 2: a near fall lands in a plunge pool a little wider than the river, its deep water dark under the foam, with a broken rim of foam, and spray billows off both sides of the drop in puffs; a far fall’s churned water is a crescent pool of foam on the river below it, with spray over the lip and over the bank in front, and its white thins out before a lip in front can cut it on a ruled line (no ripple rings there: they read as tick marks). The banks of those falls, and the step between two river tiles with no fall, are wet: rounded dark boulders glinting on top in dark moss over the bank’s rock, blended between the tiles so the wet fades out into the ground with no straight edge, and round every fall the taiga and forest floor turn to mossy alpine ground. No tree stands in front of a fall.',
      'Water (v8, the author’s ask: animate everything, keep the still version): <i>Animated</i> is the default. The sea and the lakes carry the game’s short ripple strokes in loose clusters, two layers drifting slowly two ways, so glints come and go in patches; each river runs downstream along its own line, light streaks born and fading over a short run each (no loop to jump), across tile edges, slowing and fading out past its mouth into the still water; the meltwater runs out of the ice front’s cave; each fall’s sheet slides down its slope (16 frames a loop, each laid over the one before by the clock, so it slides instead of stepping) and its foam drifts off. Stones, foam, wet rock, ice, banks and bridge piers stay still. <i>Still</i> is v7’s still water; a system that asks for reduced motion starts with it.',
      'Waves (v9, the author’s notes of 16 October: more waves on still water, and waves breaking on the shore by the wind’s direction): with Animated water the <i>Waves</i> switch picks how the sea and the lakes move in the wind. Every treatment lays its crests across the wind and moves them downwind, larger and faster as it blows harder, and shows the gusts as darker patches of rougher water running downwind. <i>Ripples</i>: fine crests in two layers drifting at two paces, kept to the gusts (cat’s paws over glassy water between them). <i>Swell</i> (the default): a few long, slow crests lit on their windward side, shaded on their lee; the waves are a travel time over the water, slower in the shallows, so near the shore their crests bunch up, turn to meet it and bend round headlands, and they grow with the open water upwind of them (the fetch), so a lee and the lakes have smaller ones. <i>Chop</i>: short broken crests in two layers crossing at an angle, and from Windy up small white caps that form, drift and fade. On every shore the wind blows toward, each wave breaks into a line of lacy foam that runs up the beach or the bank and draws back in the waves’ rhythm, a film of water under it, and leaves the sand behind it wet, the wet strip drying from the top down before the next wave; the swash follows the waterline the painter drew, reaches furthest on sand and least on rock and paving, stays out of river mouths, and is smaller on the lakes and almost nothing where the wind blows off the shore. All of it is worked out from the clock and the map’s own lines, so it never loops back with a jump and never shows a tile edge. With Calm, or <i>v8</i> picked, the still water is v8’s exactly. (Fix round: the swell’s crests are soft, continuous bands with no joints, and below zoom 1.6 they keep their width on screen, broad and soft, their fine top line fading out; no swash where the sea runs off the board’s edge; the wet sand and the water film lie on the land only, the wet sand a warmer, darker sand under a light sheen of water; v8’s ripple dashes rest while a treatment moves the water, as they always drifted the same way; and where the swamp’s mud meets a beach its damping and fainter foam ease in over about a tile.) (v9.1, the author: the open water was a little too strong: <i>Wave strength</i>, next to Waves, is <i>Gentle</i> by default, the open water’s crests about half as strong and two thirds the size at every weather level (Storm is still rougher than a Breeze), the chop’s white caps from Windy and fewer and smaller; <i>v9</i> is the open water as v9 drew it. The waves on the shores, the wet sand and the wind’s other effects are the same in both.)',
      'Wind and weather (v9, the author’s notes of 16 October: trees in the wind, tumbleweeds and blowing sand in the desert, building parts that move, waves by the wind’s direction): <b>Weather</b> (<i>Calm</i>, <i>Breeze</i> the default, <i>Windy</i>, <i>Storm</i>) and <b>Wind from</b> (eight directions, north at the top of the screen; <i>W</i> the default) set one wind for everything that moves in it: its strength, its direction and its gusts, soft bands that roll across the map downwind, faster as it blows harder, the same bands for the trees, the desert, the smoke, the windmill and the water. <i>Calm</i> stills all of it; the water then keeps v8’s own motion.',
      'Trees in the wind (v9): every tree bends from the foot of its picture, so its roots stay put, and more toward its top: a steady lean downwind that grows in a gust, and the tree’s own swing about it, wider in a gust. Broadleaves move most and birches the loosest of them, pines and spruces are stiffer and quicker, a dead tree barely moves. In a Breeze the top of a broadleaf moves about a pixel either way; in a Storm it leans about a tenth of its height in the strongest gusts. The gusts roll over the forest downwind, so one stand bends after another. With the wind from the north or the south a crown moves toward or away from the camera, so its top dips or rises on screen (the 2:1 view). The reeds by the lakes and the rivers sway too, looser and quicker; the swamp’s mangroves sway the same way, stiffly, and a willow’s hanging curtains swing wider and later than its crown.',
      'The desert (v9): on its sand (east of the lake and by the windmill) tumbleweeds roll downwind, airy balls of dry twigs lit from the upper left, bouncing between hops and spinning as they roll, their shadow shrinking as they rise. They step round the cacti and dead trees and never cross water, rock or a building. One now and then in a Breeze, up to 5 at a time when Windy, up to 14 in a Storm; soft wisps of pale sand drift low over the ground in the gusts. Nothing moves there in a Calm. (v9.1: a fifth as many dead trees stand among the cacti.)',
      'Building life (v9, the author: the windmill’s wheel should turn). <i>On</i>, the default: the windmill’s sails turn at a speed that follows the wind (0.1, 0.17 and 0.24 turns a second in a Breeze, Windy and a Storm, and in between at the other strengths) and coast to a stop over a few seconds in a Calm; (v9.1) the gust at the hub speeds them up and a lull slows them, by up to a third of the level’s mean. Smoke rises from the chimneys (about two in three of the houses’, the town halls’, the station’s, the warehouse’s and the farm’s; the sawmill’s and the pump house’s work chimneys always smoke, and more thickly), bends downwind and lies down as a torn streak in a storm (v9.2: <i>Smoke</i> <i>Tall</i>, the default, lights about one house chimney in three, the works chimneys always, and draws a thin plume of sixteen overlapping puffs, one pinned at the pot’s mouth (a storm draws them out into a streak), that climbs about 2.7 storeys, 42 px (48 at the works), above its pot, 0.9 of that in a breeze, 0.66 when windy and 0.3 in a storm, bending downwind more with height and fading as it spreads; <i>v9.1</i> is v9.1’s smoke, 11 to 17 px high with two chimneys in three lit). The quarry crane’s crate swings on its rope, downwind and back. The sails are painted into the game’s picture, so the demo lifts them out by their colour, rebuilds the cap and the tower under them from the picture’s own slate and stone, and turns them about the hub in the plane of the face the cap points along, the lower left (v9.1; v9 turned them in the plane they were painted in, which faces the viewer): a placeholder until Codex delivers the windmill without its sails and the sails as their own picture (#461). (Fix round: the cap and the tower are rebuilt course by course, each run of pixels copying one stretch of slate or stone whole and keeping clear of the sails’ shadow, and the windshaft’s housing beside the hub is slate too, so no dark specks or torn patches show where the sails have turned away.) With Building scale <i>True to people</i> the sails, the smoke and the crate sit on the picture as it is drawn (the windmill at 0.9, the farm, the pump house and the quarry at their sizes). <i>Off</i>: v8’s buildings exactly.',
      'Swamp coast (v9, the author: the forest by the sea could sometimes be a mangrove or swamp biome, its trees right on the waterfront). <i>Coast: Swamp</i>, the default: on the peninsula west of the bay, where the forest meets the sea, the beach becomes dark wet peat with moss cushions, pools holding the sky and mud in the hollows, and a ragged muddy waterline with murky shallows along it. Mangroves stand on arched prop roots at the waterline and out in the shallows, weeping willows on the banks behind them, reeds and cattails in clumps, a dead snag or two, and the forest’s own trees stay where the ground rises. The water between the roots is the sea’s own and moves with it; the waves come in low there and run only a short way up the mud. The mangroves and willows are the demo’s procedural placeholders until Codex delivers them (#460); their tooltips say so, and a swamp tile names the game’s Swamp biome. <i>Forest</i>: v8’s sandy coast, pixel for pixel.',
      'Lakes and the sea share the game’s water (its broad light levelled, so open water has no regular bands). Where a river opens onto a lake or the sea, its banks end in a ragged point and its own water runs on and fades out; a river side along still water has no bank. The lake and beach rings are gone.',
      'River turns are the straight pieces bent round the corner by the demo; ends and junctions are put together from the round end, the pool, the lobe and half straights. All of them are placeholders: Codex delivered no curves.',
      'Each bridge is one piece: Codex’s deck surface at rail level under the rails, its edge, railings and supports in the water drawn by the demo. <i>Bridge deck</i> sets both bridges; the stone deck along x is a redo and shows with its red chip. Codex still has to finish the decks: the wood is lighter and more orange than the game’s timber, and neither has piers of its own.',
      'Roads default to the organic set: three variants of every piece, any of which joins any other, built from the #319 road strips at the author’s width (0.32), gravel tone (165) and crossings. Straights wander up to 0.1 tile, turns vary their radius (about 0.23 to 0.43 tile), and the edge is darker, worn soil. <i>Measured</i> brings back the five measured variants; width, edge and crossing pick among them.',
      'People walk smooth paths a little right of the road’s own centre (found in the road picture, so they follow the organic roads), at 0.4 tile a second, step with the distance they walk, face where they walk and are drawn with the trees and buildings, after the track.',
      'People (v9, the author’s note of 16 October: the walk looked odd). <i>Fixed walk</i>, the default: v8’s people skated, a pose every 0.0825 tile while a painted planted foot moves about 0.031 tile a pose; now each person moves as far as its painted feet do (0.026 to 0.034 tile a pose, a pose every 1/8 s, so 0.21 to 0.27 tile a second), each strip plays its poses in walking order, a person standing at a leg’s end stands still, and a small bob (about half a pixel) keeps the planted foot on the ground. Codex’s R7 repaints of the back strips and the pump hand’s carry strips (art/331-people) replace the C5 strips v8 hid, played backwards (their planted foot slides forward played forwards); back strips whose poses repeat hold each support for a step. (Fix round: the planted foot is locked. While a pose shows, the person stands where that pose began, and each pose’s picture is moved by up to 1.5 px, measured on its painted feet, so the foot it stands on comes down where the last pose’s foot was; the body steps on between poses. The passenger’s front walk skips its frame 2, which jumped, and its back walk and the railway worker’s play 0, 3, 2, 3. Measured as the planted foot’s move per pose against the body’s, 0 planted and 1 sliding with the body, the strips shown now measure 0.06 to 0.37, but these still slide until Codex repaints them: the pump hand’s back walk (0.55) and back carry (0.53), the farmer’s back carry (0.46), and of the extra passengers the third’s front walk (0.52) and back walk (1.00) and the fourth’s back walk (0.43).) (v9.1: the walk is unchanged; the back strips’ painted leg poses are listed for Codex’s repaint.) <i>v8</i> shows the walk as before.',
      'Building scale (v9, the author’s note of 16 October: some buildings looked bigger than they should be). A person is 9 px tall at zoom 1, so 9 px is 1.75 m; every building picture was measured against that (its door, a storey or its eave, its top) and against a real building of its kind. <i>True to people</i>, the default, draws a picture scaled about its anchor where it was not true: the farm, the windmill and the water pump at 0.9 (their doors are 2.4 to 2.8 m), the quarry at 0.8 (its stone skip stands 2.4 m), the Fuel Pump at 0.8 (a 2.9 m door, 13 m in all) and the water tower at 1.75 (a 2 m tank on 2.2 m piers). The houses, the station, the lumber yard and the coaling stage are true and stay; the town hall (its door 1.75 m, its storeys 2.1 and 2.5 m) and the goods shed would need 1.5 and 1.25 and more ground than their one tile, so they stay too. Footprints and yards keep their ground; shadows, plinths and door paths follow the drawn walls. <i>As before</i>: v8’s sizes. (v9.1: checked on the built page, True to people changes the water tower, windmill, farm, water pump, quarry and Fuel Pump and nothing else; the town hall and the goods shed are still small beside a person.) v9.2 (the author: True to people is still not right): <i>Building scale</i> has four settings now. Every picture was measured again from scratch against a 9 px, 1.75 m person (its door, its eave or storey, its top, in metres) and <i>Smaller</i>, the default, reads that strictly: a door 2.0 to 2.2 m, a storey about 3 m, not limited to its tile, each picture scaled about its anchor by one factor, the geometric mean of what its door and its walls ask, to 0.05. The houses (a 2.30 m door, a 3.0 m eave) at 0.95, the warehouse 0.95, the station 0.9 (its gable door 2.25 m and its platform door 2.0 m: one factor cannot give both 2.0 to 2.2), the water pump 0.85, the lumber yard 0.8, the farm and the quarry 0.75, the windmill 0.85, the Fuel Pump 0.7; the town hall (a 1.8 m door on steps, storeys of 2.5 and 2.0 m) grows to 1.2 and the water tower to 1.85, the coaling stage stays at 1. (v9.2 fix round: every door now reads 2.0 to 2.25 m by the table, the Fuel Pump 2.04, the pump house 2.11, the windmill 2.13, the town hall 2.14.) <i>True v9</i> and <i>As before</i> are v9’s and v8’s; <i>People larger</i> keeps v8’s buildings and draws the people 1.25 times larger, their speed (0.5 tile a second in v8’s walk) and stride with them at the same cadence. <i>Figures</i> stands a passenger at each door, at the people’s size in the current setting.',
      'Road bridges (v9.2, the author: a road bridge for people and roads, and widened where it is next to a plain bridge). A road may cross water on a bridge platform without rail, and people cross on it; the demo has two. One lies over the creek into the lake, on a loop off the farm lane (its roads reach it on both banks); the other over the river by the pump, right beside the narrow line’s bridge, where the two become one wider bridge: one deck over both tiles (Codex’s deck surface repeated across, so its planks or flags run along the bridge), one set of piers or trestles under all of it and parapets only on its two outer edges, the rail on its half and the road on the other; at the banks the road’s gravel runs up to the deck. <i>Bridge deck</i> picks wood or stone for every bridge. The demo’s rules, until the author says otherwise: wood and stone as for rail, one tile holds rail or road (side by side they merge), no footbridges away from roads. People cross both bridges. The views these change (with Road bridges On): the farm and its lane (a loop of road north of the fields), the river by the pump (the line’s bridge, the lane’s end and a road going north), the whole map; Off is v9.1’s scene exactly.',
      'Storm effects and Fog (v9.2, the author: more weather in a Storm, for example lightning, rain and fog). With Weather <i>Storm</i> and Storm effects <i>On</i> (the default): rain in fine light streaks slanted by the wind and falling about 600 to 750 screen px a second, in fewer streaks at low zoom so the map is not grey; small rings on the water with Animated water; an overcast that darkens and cools the whole view; the ground a little darker and wetter; and lightning, a thin bolt far off at the map’s edge with a short, gentle brightening (a rise in 0.06 s, a fade over about 0.3 s), never closer than 6.5 s to the last and never further than 14.5 s, none at all when the system asks for reduced motion. The storm fades in and out over a couple of seconds when the weather changes; Storm effects <i>Off</i> is v9.1’s Storm, and Calm, Breeze and Windy are v9.1’s either way. <b>Fog</b> is a switch of its own, at every weather: <i>Off</i> (the default), <i>Valley mist</i> (low mist over the water and in the valleys, thinning with height, in drifting patches) and <i>Thick</i> (a haze over most of the map that grows toward the top of the screen, so buildings and trees fade with distance); it drifts downwind at 3 world px a second in a calm and 12 in a storm. Every effect is drawn over the scene from the clock, so nothing is repainted and a pinned clock pins them too.',
      'Sleepers (v9, the author’s note of 16 October: the narrow line’s sleepers were shifted at the joins). The demo’s track was exported before the game’s fix (#405): two narrow pieces met with 70% of the pitch between their end sleepers, and the bridge, which carries the same straight, too. <i>Even</i>, the default, draws the narrow straights and curves the game draws now, from its develop generator: every join leaves one pitch (100 ± 1%). <i>v8</i>: as before.',
      'Wheat fields stand a little above the ground (stalks 2.6 to 3.5 px tall, shaded at their front, shorter and ragged at the field’s edge) with the warped, feathered borders of the demo; Codex’s pictures have straight tile edges. The stalks are drawn in depth order with the buildings: wheat in front of a building stands over its foot. A field on a building’s left (its NW or SW side, where the farm halt has its dock, ramp and steps) runs right up to it, and along the building’s foot that field’s stalks stand up to 1.8 px taller, so at the farm halt they hide the foot of the steps and the ramp and the plinth’s corner; on its right the yard and the door path stay as the Ground fit has them.',
      'Relief: <i>Game v2</i> (the default) and <i>Smooth v2</i>, the two the author chose on 16 October; the rest are gone. Game v2 is the game’s relief with rock on every bank (the 27 September preview), Smooth v2 what the game draws today (Smooth, v1). Off the mountain a bank that looks away from the view keeps only a soft lip that fades into the grass on both sides, and Game v2’s dressed stone keeps to each bank’s steep middle and breaks into rubble and grass toward its ends instead of stopping in a square cut. On the mountain (level 3 and up, and the stacks that climb to it) the stacked levels are one slope painted as ground: a clear value step darker than the plateau facing SE, half a step facing SW or NE, darkening toward its foot; the plateau’s snow lies opaque on the rock in white and pale-blue clusters, the rock poking through it as separate outcrops with dark lower and side rims and a short blue shadow; it ends at an irregular drift line just under its edge, with wind-blown tongues reaching down the flank, each edge a lit top turning over into a blue-grey lip with its shadow on the rock right below it; a slope that looks away keeps no snow, and the wind scours the lip of a drop that looks away, so no thin white sliver runs along a level edge; outcrops of Codex’s mountain rock along the slope with dark lower rims, and a scree fan over a contact shadow at its foot. Game v2’s flank is rocky, Smooth v2’s alpine with a few outcrops; where the flank begins wanders, and its rock’s texture runs on across a lip, so no straight seam follows a level edge.',
      'Relief, v9 (the author: the mountain’s right side, its faces turned to the lower right and the upper right of the screen, still ran together, its steps could not be told): on those faces each level step is painted as a ledge at the level edge it belongs to, where the stacked slope is steepest: its riser a value step darker and a little cooler, its top edge lit, a soft shadow at its foot, and the tread between two risers lit back toward the plateau’s light, as a top face is. Game v2’s ledges are crisp and of its rock: the flank’s crag rock fills each riser and stops at its lit edge, the tread just above it is grass, and here and there the rock thins out along the edge into rubble and grass. Smooth v2’s are soft lips over shaded grassy risers with a few outcrops. The ledges wander a little along the slope, their height varies, and they turn round the mountain’s north-east corner and fade out where a face turns toward the bottom or the top of the screen; a crag on a riser takes its shade and breaks the shadow at its foot. The snow, the Ice channel and its banks, the outcrops, the scree and the falls stay as they were. The faces turned left and everything off the mountain are v8’s Game v2 and Smooth v2 pixel for pixel. To compare, look at the snow plateau in the north-east at zoom 1, 1.3 and 2: first its right side (the faces toward the map’s right corner), then its left side, which does not change.',
      'Glacier: <i>Ice channel</i> (the author’s choice, the default), an ice tongue stepping down, or as now; the first two re-level the valley around x = 28, their ice edges wander and the slopes beside the ice are moraine. As now and the Ice tongue end in an ice front painted from Codex’s ice-cliff material (drawn toward the glacier’s blue-white): the ice swells a little toward it, its lip is a jagged row of broken ice blocks over blue shadows, crevasses run over the lip and down the face, a dirty band runs along its foot, and the melt runs out of a low, lop-sided, deep-blue cave as a lighter, milky tongue between piles of moraine rubble. A finished Codex painting of an ice snout with its cave would still read better (see the report).',
      'The Ice channel, as approved in the v3b preview: its moraine banks are rubble that climbs the slope beside them in ragged tongues and thins into the rock and snow; each drop is one clean step of ice (Codex’s ice-cliff material, read for its cracks only and coloured as ice, lit from the upper left); where it ends over the melt, its own ice front with the meltwater cave at its foot (the dark inside of Codex’s face-ice-portal material, without its grey frame) and the stream running from it into the river. The side arm (the redo glacier-strip-x picture, a raised tongue) has no place in the channel: <i>As now</i> shows it and Codex’s other glacier pieces, and their Show me switches to it.',
      'Town paving (v3): small setts about a tenth of a tile, drawn by the demo in warm sandstone greys a value step below the house walls and close to one another, so the square reads as one colour, each lit from the upper left. <i>Fan</i> (the default) lays them in arcs, <i>Setts</i> in straight courses, <i>Flags</i> is the game’s flagstones at a fifth of their size, <i>Old (v2)</i> the game’s painted cell. The paving follows the paved tiles (corners rounded, a gentle wobble) plus a doorstep before each house’s door; over its last quarter tile grass gets into the joints and setts go missing, then a fringe of packed earth fades into the grass or the sand. The roads stop at its edge and cross the square as a dustier lane.',
      'River banks (v3): no rim of stones and no dark line round the water. The water’s edge wanders (its two banks are never parallel) and is soft like the shore’s; past it a margin of the ground beside the river, damp and darker, from a hairline to about 0.13 tile wide, with gravel and a few stones, fades into the grass, sand or forest floor; reeds stand on a few banks, and the rest of a river tile is its neighbours’ ground. Near a mouth the river’s water turns toward the still water’s colour and fades out along a wandering line. Water lies flat: it takes only a quarter of the relief’s slope light, so rivers on the falls’ slopes keep their colour.',
      'Town borders (v8, the author’s idea): hover over a town hall and its town’s border shows; a click pins it, a second click on it or Escape lets it go. As in the game, a town reaches 7 tiles (Chebyshev) round its town hall, the nearest town hall where reaches overlap; its border takes the footprints of all its buildings (town hall, houses, station, works, warehouse) grown by 3 tiles, each tile going to the nearer town hall where two towns meet, and only the outline is drawn: a thin line in the town’s colour, given when the world is made from the game’s TOWN_COLORS, its corners rounded, lying on the ground under the buildings and trees. Two small towns stand in the north-west for this, their borders meeting.',
      'Grass tufts and pebbles are drawn over the ground as the game does (<i>ground.md</i>). Snow and ice stay below the game’s cursor white.',
      'Rivers and glaciers stay about 0.38 and 0.4 tile wide (open point 19; a river’s waterline wanders 0.3 to 0.4); the narrow bridge decks follow the author’s yes to narrow decks.',
      'Turned game buildings are procedural placeholders, so only their unturned pictures are used.',
      'Ground fit (the author’s point 12): every building gets a soft contact shadow cast a little to the lower right and occlusion where its walls meet the ground (drawn over the picture’s foot only; the picture itself is untouched); a worn yard painted into the ground round its footprint (earth at the farm and the mill, gravel with a kerbed platform edge at the station and the warehouse, gravel in town, grey-brown cinder round the coaling stage’s and water tower’s legs and at the Fuel Pump, grit at the quarry, packed sand on the shore) with a worn path from each door, on to the road where one is next door; weeds and pebbles over the front of its base; and a stone plinth wherever the ground under it is not level. <i>Ground fit</i> steps through them; Full is the default. No building of this map stands where the ground drops away and no picture has ground baked into it, so on the map Full adds only the weeds: <i>Show me</i> on <i>Ground fit test</i> places the station and the town hall beside a drop, where the plinths show.',
      ...DATA.notPrepared.slice(0, 3).map((n) => `Codex did not deliver: ${n.what}.`),
    ];
    $('notes').innerHTML = notes.map((n) => `<li>${n}</li>`).join('');
  }
  // Show me: the camera frames every place it shows (v2 flew to their midpoint at zoom 2, which left two far-apart
  // places at the very edges of the view). Places too far apart to frame at zoom 0.9 or more: the first one.
  function flyTo(tiles, z = 2) {
    if (!tiles.length) return;
    const pos = tiles.map((t) => [(t.x - t.y) * 32, (t.x + t.y) * 16 - t.level * LEVEL]);
    const box = (ps) => [Math.min(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1])), Math.max(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[1]))];
    // a tile with what stands on it: 40 world px either side, 60 above and 30 below its centre
    const fit = (b) => Math.min(VW / (b[2] - b[0] + 80 + 40), VH / (b[3] - b[1] + 90 + 40));
    let b = box(pos), zf = fit(b);
    if (zf < 0.9) { b = box(pos.slice(0, 1)); zf = fit(b); }
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2 - 15;
    closeFrom(0); last = null;
    const from = { x: cam.x, y: cam.y, z: cam.z }, to = { x: cx, y: cy, z: Math.max(ZMIN, Math.min(ZMAX, Math.max(cam.z, z), zf)) };
    const start = performance.now(), dur = still ? 0 : 450;
    const step = (now) => { const p = dur ? Math.min(1, (now - start) / dur) : 1, e = p * p * (3 - 2 * p); cam.x = from.x + (to.x - from.x) * e; cam.y = from.y + (to.y - from.y) * e; cam.z = from.z + (to.z - from.z) * e; $('z-val').textContent = `${cam.z.toFixed(1)}×`; dirty = true; if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
    flash = { tiles, until: performance.now() + 2600 };
  }
  async function showMe(key) {
    if (key.startsWith('screen/')) { openScreen(Number(key.slice(-1))); return; }
    const ch = applyState(needs(key));
    if (ch) await rebuild();
    if (!(PLACES[key] || []).length && CENSUS_GL[key] && CENSUS_GL[key] !== glacierName) await setGlacier(CENSUS_GL[key]);
    const p = PLACES[key];
    if (!p || !p.length) { hint.textContent = `${shortKey(key)} is not on the map with these switches.`; return; }
    const tiles = p.slice(0, 4).map((q) => T(q.x, q.y));
    flyTo(tiles, key.startsWith('people/') ? 3 : 2);
    hint.textContent = `${shortKey(key)}${key.startsWith('road/w') ? ` (${key.split('/')[1]})` : ''}: ${verdict(CX[key]).label}. ${hintText()}`;
  }

  // ---------- loading screens: start screen and corner thumbnail
  const SCREENS = [1, 2, 3].map((n) => ({ n, e: CX[`screen/loading-${n}`], src: `assets/screen-${n}.jpg` }));
  let thumbN = 0;
  function setThumb(k) {
    thumbN = k; const s = SCREENS[k], v = verdict(s.e);
    $('thumb-img').src = s.src; $('thumb-t').textContent = `Loading screen ${s.n}`;
    const tv = $('thumb-v'); tv.className = `chip ${v.cls}`; tv.textContent = v.label;
  }
  function openScreen(n) {
    const s = SCREENS[n - 1], v = verdict(s.e), ov = $('start');
    $('start-img').src = s.src;
    $('start-cap').innerHTML = `Loading screen ${n} · <span class="chip ${v.cls}">${v.label}</span>${s.e.status === 'flagged-redo' ? ' <span class="dim">the water tower spout and chute miss the track</span>' : ''}`;
    $('tip').textContent = 'Click anywhere to go back to the map.';
    goBtn.hidden = true; barEl.parentElement.hidden = true; ov.hidden = false;
    const close = () => { ov.hidden = true; ov.removeEventListener('click', close); };
    setTimeout(() => ov.addEventListener('click', close), 0);
  }
  $('thumb').addEventListener('click', () => openScreen(SCREENS[thumbN].n));
  setThumb(0);
  setInterval(() => { if (!document.hidden) setThumb((thumbN + 1) % 3); }, 5000);

  // ---------- go
  resize();
  census();
  buildScene(false);
  $('redo-n').textContent = String(DATA.codex.filter((e) => e.status === 'flagged-redo').length);
  buildLegend();
  syncButtons();
  hint.textContent = hintText();
  requestAnimationFrame(loop);
  const TIPS = ['Tip: keep still on a tile for 2 seconds and its tooltip stays.', 'Tip: every tooltip names the Codex picture on its tile and its review verdict.', 'Tip: Show me in the side panel flies to each picture.'];
  tipEl.textContent = 'Painting the ground from the game’s swatches and Codex’s…';
  const tStart = performance.now();
  warmPainter();
  window.__warmMs = Math.round(performance.now() - tStart);
  await paint([[0, GW]], (f) => { setBar(0.15 + 0.85 * f); tipEl.textContent = `${TIPS[Math.floor(f * 2.99)]}`; });
  window.__paintMs = Math.round(performance.now() - tStart);
  dirty = true;
  tipEl.textContent = 'The map is ready.';
  goBtn.disabled = false; goBtn.focus({ preventScroll: true });
  goBtn.addEventListener('click', (e) => { e.stopPropagation(); $('start').hidden = true; });
  window.__demo = { setRelief, setGlacier, RELIEFS, GLACIERS, state, cam, setZoom, flyTo, showMe, PLACES: () => PLACES, CENSUS, pick, tileAt, rebuild, dirtyNow: () => { dirty = true; }, map,
    busy: () => queued > 0, decals: (x, y) => DECALS[idx(x, y)].map((d) => `${d.key}${d.clip ? ' clip' + d.clip : ''}${d.fade ? ' fade' + d.fade : ''}${d.mouths ? ' mouths' + d.mouths.length : ''}${d.run ? ' run' : ''}${d.mouthPic ? ' mouthPic' : ''}`), freeze: (t) => { freezeT = t; dirty = true; }, modes: () => ({ relief: reliefName, glacier: glacierName }), FALLS: () => FALLS, toScreen: (tx, ty) => { const [wx, wy] = twc(tx, ty); return [(wx - cam.x) * cam.z + VW / 2, (wy - cam.y) * cam.z + VH / 2]; } };
  window.__demo.setPaving = setPaving; window.__demo.PAVINGS = PAVINGS;
  // the Waves switch (v9): setWaves('v8' | 'ripples' | 'swell' | 'chop'), as its buttons do; wavesInfo() the fields' sizes and build times
  Object.assign(window.__demo, { setWaves, waves: () => wavesName, setWaveStrength, waveStrength: () => waveStr, wavesInfo: () => WVF && { lines: WVF.lines.length, points: WVF.lines.reduce((a, l) => a + l.n, 0), caps: WVF.caps.length / 3, ms: WVF.ms, dirs: Object.fromEntries(Object.entries(WVF.dirs).map(([k, d]) => [k, d.ms])) } });
  window.__demo.probe = (tx, ty) => ({ z: heightAt(tx, ty), gx: (heightAt(tx + 0.05, ty) - heightAt(tx - 0.05, ty)) * 10, gy: (heightAt(tx, ty + 0.05) - heightAt(tx, ty - 0.05)) * 10, mtn: mtnAt(tx, ty), lv: Lv[idx(Math.round(tx), Math.round(ty))], icet: ICET[idx(Math.round(tx), Math.round(ty))], fronts: ICE_FRONTS.map((f) => `${f.c.x},${f.c.y}>${f.n.x},${f.n.y}`).join(' '), own: ownerAt(tx, ty) });
  // the People switch (v9): setPeople('v8' | 'fixed') as its buttons do; people() the mode
  Object.assign(window.__demo, { setPeople, people: () => peopleMode });
  // the Building scale and Sleepers switches (v9): setBuildingScale('v8' | 'true'), setSleepers('v8' | 'even') as their
  // buttons do; bScale(key) the factor a picture is drawn at; scaleFigures(on) stands a passenger at every door (shots)
  Object.assign(window.__demo, { setBuildingScale, buildingScale: () => bscaleMode, bScale, setSleepers, sleepers: () => sleeperMode,
    scaleFigures: setFigures, figures: () => bsFigures, peopleK });
  // ground fit: the step switch, the footprints and their outlines (gfDebug), and a test placement (gfTry([[key, x, y]]))
  Object.assign(window.__demo, { setGroundFit, gfDebug: (on) => { gfDebug = !!on; dirty = true; }, GF_FOOT, heightAt,
    gfTry: gfPlace, gfTestSites });
  // the wind (v9): setWeather('calm' | 'breeze' | 'windy' | 'storm'), setWind('N' ... 'NW'), as the switches do; wind() a
  // copy of WIND; WIND itself and windGust(px, py, t) for probes
  Object.assign(window.__demo, { setWeather: (level) => setWeather(level, null), setWind: (from) => setWeather(null, from),
    wind: () => ({ ...WIND, to: { ...WIND.to }, toTile: { ...WIND.toTile } }), WIND, windGust });
  // life in the wind and Building life (v9, lane L): setLife(true | false) as the switch does, life() whether it is on;
  // tumbleweeds() the ones out now (tile, radius, bounce), mill() the sails' turn (radians) and speed (radians a second)
  Object.assign(window.__demo, { setStormFx, stormFx: () => STORM.on, setFog, fog: () => fogMode, stormInfo: () => ({ k: stormK, flashes: FLASH_T.slice(0, 12) }), lightning: (v) => { lightningForce = v; dirty = true; }, setRoadBridges, roadBridges: () => state.rbridges, setSmoke, smoke: () => smokeMode, smokeInfo: () => ({ ...SMOKE_INFO }), setLife, life: () => LIFE.on, tumbleweeds: () => tumbleweeds().map((w) => ({ tx: w.tx, ty: w.ty, r: w.r, bounce: w.bounce })),
    mill: () => ({ phi: MILL.phi, om: MILL.om, cut: !!MILL.body }), setMillPlane: (v) => { millPlane = v; dirty = true; return millPlane; }, millN: () => MILL_N, crane: () => !!CRANE.body });
  // the swamp coast (v9, lane L2): setCoast('swamp' | 'forest') as the switch does, coast() which is shown, swamp() what
  // stands in it (counts by kind) and swShore(tx, ty) its waterline (tiles, + on land)
  Object.assign(window.__demo, { setCoast, coast: () => (SWAMP.on ? 'swamp' : 'forest'), swShore,
    swamp: () => { const n = {}; for (const q of swPlace()) n[q.kind] = (n[q.kind] || 0) + 1; return n; } });
})();

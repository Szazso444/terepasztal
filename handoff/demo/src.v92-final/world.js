// ==== world: the approved tile tooltip demo's generator (seed 355, 36 x 36), then the demo scene
const W = 36, H = 36, SEED = 355, LEVEL = 10;
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// edge naming as Codex uses it: +x is SE, -x NW, +y SW, -y NE
const DIRS = [
  { dx: 1, dy: 0, bit: 1, edge: 'se' },
  { dx: -1, dy: 0, bit: 2, edge: 'nw' },
  { dx: 0, dy: 1, bit: 4, edge: 'sw' },
  { dx: 0, dy: -1, bit: 8, edge: 'ne' },
];
const dirOf = (dx, dy) => DIRS.find((d) => d.dx === dx && d.dy === dy);
const idx = (x, y) => y * W + x;
const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

// the game's town palette and name parts (src/sim/towns.ts) and its hash (src/engine/rng.ts)
const TOWN_COLORS = [0x5ec8dc, 0xe0a83a, 0x8fd06a, 0xd86a8a, 0xb08cf0, 0xf0d060, 0x60c0a0, 0xe8804c];
const TOWN_RADIUS = 7;
const TOWN_FIRST = ['Kis', 'Nagy', 'Új', 'Ó', 'Al', 'Fel', 'Szent', 'Vas', 'Kő', 'Ér', 'Sár', 'Fény', 'Hév', 'Bükk', 'Tölgy', 'Nyír', 'Cser', 'Szil', 'Hárs', 'Mező'];
const TOWN_LAST = ['falva', 'vár', 'hely', 'laka', 'háza', 'telek', 'kút', 'rét', 'halom', 'szeg', 'völgy', 'patak', 'liget', 'fő', 'berek', 'domb', 'sziget', 'hida'];
function hashW(x, y, seed = 0) { let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function makeRng(s) { return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); }
function genNoise(rnd, cell) {
  const gw = Math.ceil(W / cell) + 2, gh = Math.ceil(H / cell) + 2, g = [];
  for (let i = 0; i < gw * gh; i++) g.push(rnd());
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = s(gx - x0), fy = s(gy - y0);
    const v = (i, j) => g[j * gw + i];
    const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * fx, c = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * fx;
    return a + (c - a) * fy;
  };
}

// The approved demo's generator, unchanged apart from the map size and seed.
function generate(seed) {
  const map = [];
  const rnd = makeRng(seed);
  const n1 = genNoise(rnd, 7), n2 = genNoise(rnd, 3.5), mN = genNoise(rnd, 6), tN = genNoise(rnd, 9);
  const mx = W * (0.6 + rnd() * 0.3), my = H * (0.05 + rnd() * 0.25);
  const e = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - mx, y - my) / W;
    const mountain = Math.max(0, 0.55 - d * 1.15);
    const coast = Math.max(0, (y - x * 0.35 - H * 0.55) / H) * 1.1;
    e[idx(x, y)] = 0.45 * n1(x, y) + 0.18 * n2(x, y) + mountain - coast;
  }
  const SEA = 0.24;
  const ocean = new Uint8Array(W * H), q = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x === 0 || y === 0 || x === W - 1 || y === H - 1) && e[idx(x, y)] < SEA) { ocean[idx(x, y)] = 1; q.push(idx(x, y)); }
  while (q.length) { const i = q.pop(), x = i % W, y = (i / W) | 0; for (const [dx, dy] of N4) { const nx = x + dx, ny = y + dy; if (inb(nx, ny) && !ocean[idx(nx, ny)] && e[idx(nx, ny)] < SEA) { ocean[idx(nx, ny)] = 1; q.push(idx(nx, ny)); } } }
  const filled = new Float32Array(W * H).fill(Infinity), down = new Int32Array(W * H).fill(-1), order = [];
  const heap = [];
  const push = (i, h) => { heap.push([h, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = idx(x, y); if (ocean[i] || x === 0 || y === 0 || x === W - 1 || y === H - 1) { filled[i] = ocean[i] ? SEA : e[i]; push(i, filled[i]); } }
  const seen = new Uint8Array(W * H);
  while (heap.length) {
    const [h, i] = pop(); if (seen[i]) continue; seen[i] = 1; order.push(i);
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy; if (!inb(nx, ny)) continue; const j = idx(nx, ny); if (seen[j]) continue;
      const fh = Math.max(e[j], h + 1e-4);
      if (fh < filled[j]) { filled[j] = fh; down[j] = i; push(j, fh); }
    }
  }
  const lake = new Uint8Array(W * H);
  const lvl = (v) => Math.floor((v - SEA) / 0.11);
  const nearHigh = (i) => { const x = i % W, y = (i / W) | 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inb(x + dx, y + dy) && lvl(e[idx(x + dx, y + dy)]) >= 2) return true; return false; };
  for (let i = 0; i < W * H; i++) if (!ocean[i] && filled[i] - e[i] > 0.015 && lvl(filled[i]) <= 0 && !nearHigh(i)) lake[i] = 1;
  const lakeId = new Int32Array(W * H).fill(-1); let lid = 0; const lakeTiles = [];
  for (let i = 0; i < W * H; i++) if (lake[i] && lakeId[i] < 0) {
    const st = [i], members = []; lakeId[i] = lid;
    while (st.length) { const k = st.pop(); members.push(k); const x = k % W, y = (k / W) | 0; for (const [dx, dy] of N4) { const nx = x + dx, ny = y + dy; if (!inb(nx, ny)) continue; const j = idx(nx, ny); if (lake[j] && lakeId[j] < 0) { lakeId[j] = lid; st.push(j); } } }
    if (members.length < 3) for (const k of members) { lake[k] = 0; lakeId[k] = -1; } else lakeTiles.push(members);
    lid++;
  }
  const acc = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) acc[i] = 1 + 2 * Math.max(0, e[i] - 0.55);
  for (let k = order.length - 1; k >= 0; k--) { const i = order[k]; if (down[i] >= 0) acc[down[i]] += acc[i]; }
  const RIVER = 15, SNOW_E = 0.74;
  const snow = (i) => e[i] > SNOW_E;
  const levelOf = (v) => Math.max(0, Math.min(4, Math.floor((v - SEA) / 0.11)));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y), m = mN(x, y), t = tN(x, y) - (1 - y / H) * 0.15;
    let kind = 'land', level = levelOf(e[i]);
    if (ocean[i]) { kind = 'ocean'; level = 0; }
    else if (lake[i]) { kind = 'lake'; level = levelOf(filled[i]); }
    else if (acc[i] >= (levelOf(e[i]) >= 2 ? RIVER * 2.2 : RIVER)) kind = 'river';
    let biome = t < 0.36 ? 'taiga' : m < 0.32 && t > 0.5 ? 'desert' : m > 0.6 ? 'forest' : 'plains';
    let terrain = 'grass';
    if (kind !== 'land') { terrain = 'water'; biome = kind; }
    else if (level >= 4 || e[i] > 0.86) terrain = 'rock';
    else if (level >= 3) terrain = 'hill';
    else if (biome === 'forest' || (biome === 'taiga' && m > 0.45)) terrain = 'forest';
    else if (biome === 'desert') terrain = 'sand';
    if (kind === 'land' && (terrain === 'rock' || snow(i))) biome = 'mountain';
    map.push({ x, y, i, kind, terrain, biome, climate: t < 0.36 ? 'taiga' : m < 0.32 && t > 0.5 ? 'desert' : m > 0.6 ? 'forest' : 'plains', level, down: down[i], acc: acc[i], fall: 0, snow: kind === 'land' && snow(i), headwater: '', h: ((x * 73 + y * 151) % 97) / 97 });
  }
  const up = map.map(() => []); for (const c of map) if (c.down >= 0) up[c.down].push(c);
  const sources = map.filter((c) => c.kind === 'river' && !up[c.i].some((u) => u.kind === 'river' || u.kind === 'lake'));
  for (const src of sources) {
    const path = []; let cur = src;
    for (let step = 0; step < 10; step++) {
      const cand = up[cur.i].filter((u) => u.kind === 'land'); if (!cand.length) break;
      cur = cand.reduce((a, c2) => (c2.acc > a.acc ? c2 : a)); path.push(cur);
      if (snow(cur.i)) break;
    }
    if (!path.length || !snow(path[path.length - 1].i)) { if (src.level >= 2) src.headwater = 'spring'; continue; }
    for (const c of path) { c.kind = 'river'; c.terrain = 'water'; c.biome = 'river'; c.snow = false; }
    let top = path[path.length - 1];
    top.kind = 'glacier'; top.terrain = 'ice'; top.biome = 'mountain';
    for (let k = 0; k < 4; k++) {
      const cand = up[top.i].filter((u) => u.kind === 'land' && snow(u.i)); if (!cand.length) break;
      top = cand.reduce((a, c2) => (c2.acc > a.acc ? c2 : a));
      top.kind = 'glacier'; top.terrain = 'ice'; top.biome = 'mountain'; top.snow = false;
    }
    const melt = path.filter((c) => c.kind === 'river'); (melt[melt.length - 1] || src).headwater = 'melt';
  }
  const upAll = map.map(() => []); for (const c of map) if (c.down >= 0) upAll[c.down].push(c);
  for (let k = 0; k < order.length; k++) {
    const c = map[order[k]]; if (c.kind !== 'river' || c.down < 0) continue;
    const n = map[c.down];
    const prune = () => { c.kind = 'land'; c.terrain = c.level >= 3 ? 'hill' : 'grass'; c.biome = 'plains'; c.pruned = true; };
    if (n.pruned) { prune(); continue; }
    if (n.kind !== 'river') continue;
    const main = upAll[n.i].reduce((a, u) => (u.acc > a.acc ? u : a));
    if (main !== c && c.acc < RIVER * 1.8) prune();
  }
  for (const members of lakeTiles) { const lv = Math.min(...members.map((k) => map[k].level)); for (const k of members) map[k].level = lv; }
  for (const c of map) if (c.kind === 'land' && c.level <= 1 && N4.some(([dx, dy]) => inb(c.x + dx, c.y + dy) && map[idx(c.x + dx, c.y + dy)].kind === 'ocean')) { c.terrain = 'sand'; c.biome = 'beach'; c.level = 0; }
  return map;
}

// ---- the demo scene: a few edits so every Codex picture has its place, and a town with track
function buildWorld() {
  const map = generate(SEED);
  const T = (x, y) => map[idx(x, y)];
  const isWater = (c) => c && (c.kind === 'river' || c.kind === 'lake' || c.kind === 'ocean');
  const toLand = (c, terrain = 'grass', biome) => {
    c.kind = 'land'; c.terrain = terrain; c.biome = biome || (terrain === 'rock' ? 'mountain' : c.climate === 'desert' && terrain === 'sand' ? 'desert' : c.climate);
    c.headwater = ''; c.fall = 0; c.pruned = false;
  };
  const toRiver = (c, downTile, acc = 16) => { c.kind = 'river'; c.terrain = 'water'; c.biome = 'river'; c.snow = false; c.down = downTile.i; c.acc = acc; c.headwater = ''; };
  const rect = (x0, y0, x1, y1, f) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inb(x, y)) f(T(x, y)); };
  // the builder clears and levels the ground: trees and rocks go, the tile becomes open grass (or desert sand)
  const clearLand = (c, level = 0) => { if (c.kind !== 'land') return; c.level = level; if (c.terrain === 'forest' || c.terrain === 'hill' || c.terrain === 'rock') c.terrain = c.biome === 'desert' ? 'sand' : 'grass'; if (c.biome === 'mountain' || c.biome === 'forest' || c.biome === 'taiga') c.biome = 'plains'; c.snow = false; };
  const notes = [];

  // Glacier: one clean tongue down tile y at x = 28 (rows 3 to 10), its melt one level lower at (28, 11).
  for (const c of map) if (c.kind === 'glacier') toLand(c, 'rock', 'mountain'), (c.snow = true);
  for (let y = 3; y <= 10; y++) { const c = T(28, y); c.kind = 'glacier'; c.terrain = 'ice'; c.biome = 'mountain'; c.snow = false; c.level = 4; c.down = T(28, y + 1).i; }
  const melt = T(28, 11); melt.level = 3; melt.headwater = 'melt';
  const m2 = T(29, 11); if (m2.kind === 'river') { toLand(m2, 'rock', 'mountain'); m2.level = 4; }
  T(27, 11).level = 3;
  // the glacier's side arm along tile x, shown only with the redo pieces (glacier-strip-x is a redo)
  for (const x of [29, 30, 31, 32]) { const c = T(x, 5); c.arm = true; c.level = 4; if (c.kind !== 'land') toLand(c, 'rock', 'mountain'); c.snow = true; }
  // firn above the glacier head: glacier-ice swatch with the redo pieces
  rect(27, 2, 29, 3, (c) => { if (c.kind === 'land') { c.firn = true; c.level = 4; } });

  // Bigger drops, for the longer cascades: a 2-level fall over a SW edge and one over a SE edge.
  for (const [x, y] of [[21, 4], [21, 3], [22, 3]]) T(x, y).level = 3;
  rect(20, 2, 22, 4, (c) => { if (c.kind === 'land') c.level = Math.max(c.level, 3); });
  for (const [x, y] of [[34, 17], [34, 18]]) T(x, y).level = 0;
  rect(34, 16, 35, 19, (c) => { if (c.kind === 'land') c.level = Math.min(c.level, 1); });
  T(35, 17).level = 0; T(35, 19).level = 0;

  // Below that fall the river runs straight on for a third tile (the river-strip-y picture's place).
  { const a = T(21, 6), b = T(21, 7), c = T(20, 6); if (c.kind === 'river') toLand(c, 'grass'); toRiver(b, T(20, 7), 60); b.level = 1; a.down = b.i; }
  // The south river at x = 28 starts a tile later, so the farm road passes below its source.
  const s28 = T(28, 28); if (s28.kind === 'river') toLand(s28, 'grass');
  const s26 = T(26, 23); if (s26.kind === 'river') { s26.kind = 'lake'; s26.biome = 'lake'; }
  // A stream into the lake from the south (its mouth opens to the NE) and a creek into the sea (SW).
  toRiver(T(23, 27), T(23, 26), 15); toRiver(T(23, 26), T(23, 25), 16); T(23, 26).level = 0; T(23, 27).level = 0;
  toRiver(T(19, 31), T(19, 32), 15); toRiver(T(19, 32), T(19, 33), 16); T(19, 31).level = 0; T(19, 32).level = 0;

  // Flat ground for the town, the two lines and the farms (the game's builder flattens too).
  rect(17, 26, 35, 35, (c) => clearLand(c, 0));
  rect(29, 19, 35, 25, (c) => clearLand(c, 0));
  rect(24, 21, 28, 24, (c) => clearLand(c, 0));
  rect(19, 26, 22, 29, (c) => { if (c.kind === 'land') c.terrain = 'grass'; });

  // Four springs on high ground, one for each exit edge, each feeding a river at its own level.
  const siteOk = (c, d, taken) => {
    if (c.kind !== 'land' || c.level < 2 || c.firn || c.arm || taken.has(c.i)) return null;
    const n = inb(c.x + d.dx, c.y + d.dy) && T(c.x + d.dx, c.y + d.dy);
    if (!n || n.kind !== 'river' || n.level !== c.level || n.fall || n.headwater) return null;
    for (const [dx, dy] of N4) {
      if (dx === d.dx && dy === d.dy) continue;
      const o = inb(c.x + dx, c.y + dy) && T(c.x + dx, c.y + dy);
      if (o && (o.kind === 'lake' || o.kind === 'ocean' || (o.kind === 'river' && o.down === c.i) || taken.has(o.i))) return null;
    }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const o = inb(c.x + dx, c.y + dy) && T(c.x + dx, c.y + dy); if (o && (o.kind === 'glacier' || o.firn || o.arm)) return null; }
    return n;
  };
  const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((v, k) => perms([...a.slice(0, k), ...a.slice(k + 1)]).map((p) => [v, ...p])));
  let plan = null;
  for (const order of perms(DIRS)) {
    const taken = new Set(), got = [];
    for (const d of order) {
      let best = null;
      for (const c of map) {
        const n = siteOk(c, d, taken); if (!n) continue;
        const score = c.level * 2 + (c.terrain === 'hill' ? 1 : 0) - Math.abs(c.x - 27) * 0.08 - Math.abs(c.y - 10) * 0.05;
        if (!best || score > best.score) best = { c, n, d, score };
      }
      if (!best) break;
      got.push(best); taken.add(best.c.i);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inb(best.c.x + dx, best.c.y + dy)) taken.add(idx(best.c.x + dx, best.c.y + dy));
    }
    if (got.length === 4) { plan = got; break; }
    if (!plan || got.length > plan.length) plan = got;
  }
  for (const { c, n, d } of plan) { toRiver(c, n, 8); c.headwater = 'spring'; c.springExit = d.edge; }
  if (plan.length < 4) notes.push('only ' + plan.length + ' spring sites');

  // Border tiles sit at level 1 or below, as in the game (tileLevels), so the map edge never shows a cut.
  for (const c of map) if ((c.x === 0 || c.y === 0 || c.x === W - 1 || c.y === H - 1) && c.level > 1) c.level = 1;
  // The land keeps the game's one-step rule: neighbours differ by at most one level. Only water drops more.
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const c of map) {
      if (c.kind !== 'land') continue;
      let lo = 9, hiWater = -9;
      for (const [dx, dy] of N4) { const o = inb(c.x + dx, c.y + dy) && T(c.x + dx, c.y + dy); if (!o) continue; lo = Math.min(lo, o.level); if (o.kind !== 'land') hiWater = Math.max(hiWater, o.level); }
      if (c.level > lo + 1) { c.level = lo + 1; changed = true; }
      if (c.level < hiWater - 1) { c.level = hiWater - 1; changed = true; }
    }
    if (!changed) break;
  }
  for (const c of map) if (c.kind === 'land' && c.terrain === 'hill' && c.level < 3) c.terrain = 'grass';

  // Falls: a river (or a lake's outlet) whose next tile downstream sits lower keeps the drop.
  for (const c of map) {
    c.fall = 0;
    if ((c.kind === 'river' || c.kind === 'lake') && c.down >= 0) { const n = map[c.down]; if (isWater(n) && c.level > n.level) c.fall = c.level - n.level; }
  }

  // ---- infrastructure
  const track = [], roads = new Map(), buildings = [], fields = [];
  const tr = (x, y, cls, kind, rot, member) => { const c = T(x, y); track.push({ x, y, cls, kind, rot, member }); c.track = cls; };
  for (let x = 17; x <= 30; x++) tr(x, 30, 'regular', 'straight', 1);
  for (const [m, dx, dy] of [[0, 0, 0], [1, 1, 0], [2, 0, 1], [3, 1, 1]]) tr(31 + dx, 30 + dy, 'regular', 'curve', 2, m);
  for (let y = 32; y <= 35; y++) tr(32, y, 'regular', 'straight', 0);
  for (let x = 25; x <= 32; x++) tr(x, 25, 'narrow', 'straight', 1);
  tr(33, 25, 'narrow', 'curve', 3);
  for (let y = 20; y <= 24; y++) tr(33, y, 'narrow', 'straight', 0);
  T(28, 25).bridge = 'x'; T(33, 22).bridge = 'y';

  const road = (pts) => { for (let k = 0; k < pts.length; k++) { const [x, y] = pts[k]; if (!roads.has(idx(x, y))) roads.set(idx(x, y), 0); for (const o of [pts[k - 1], pts[k + 1]]) if (o) roads.set(idx(x, y), roads.get(idx(x, y)) | dirOf(o[0] - x, o[1] - y).bit); } };
  const line = (x0, y0, x1, y1) => { const out = []; const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let k = 0; k <= n; k++) out.push([x0 + Math.sign(x1 - x0) * k, y0 + Math.sign(y1 - y0) * k]); return out; };
  road([...line(30, 21, 30, 33), ...line(31, 33, 34, 33)]); // main street, north to south, then east to the windmill
  road(line(27, 23, 34, 23)); // the quarry lane, east to the water pump
  road(line(22, 28, 30, 28)); // the farm lane
  road([...line(26, 31, 29, 31), ...line(29, 32, 29, 33), ...line(28, 33, 26, 33), [26, 32], [26, 31]]); // a loop south of the line
  road(line(28, 28, 28, 31)); // from the farm lane over the line to the loop
  road(line(29, 32, 30, 32)); // the loop to the main street
  road(line(25, 28, 25, 29)); // a spur to the Fuel Pump
  for (const [i, bits] of roads) { const c = map[i]; c.road = bits; clearLand(c, c.level); }

  const bld = (key, x, y, extra = {}) => { const c = T(x, y); buildings.push({ key, x, y, ...extra }); c.building = key; clearLand(c, c.level); c.paved = c.paved || false; };
  rect(29, 26, 32, 28, (c) => { c.paved = true; clearLand(c, 0); });
  bld('structures/town_2', 31, 27, { name: 'Town hall' });
  const houses = ['structures/townhouse', 'structures/townhouse_s1', 'structures/townhouse_s0', 'structures/townhouse_s2'];
  [[32, 26], [32, 28], [29, 27]].forEach(([x, y], k) => bld(houses[k], x, y, { name: 'House' }));
  bld('structures/station_2', 29, 29, { name: 'Town station' });
  bld('structures/warehouse_1', 31, 29, { name: 'Warehouse' });
  bld('structures/water_tower', 27, 29, { name: 'Water tower' });
  bld('structures/fuel_stop', 26, 29, { name: 'Coaling stage' });
  bld('structures/lumber_2', 29, 21, { name: 'Lumber yard', makes: 'wood' });
  bld('structures/quarry_2', 26, 22, { name: 'Quarry', makes: 'stone' });
  bld('structures/farm_2', 21, 28, { name: 'Farm', makes: 'wheat' });
  bld('structures/windmill', 34, 32, { name: 'Windmill' });
  bld('structures/pump_1', 35, 23, { name: 'Water pump', makes: 'water' });
  bld('codex:building/fuel_pump-a1-r0', 24, 29, { name: 'Fuel Pump', codex: true });
  bld('codex:building/fuel_pump-a1-r2', 25, 31, { name: 'Fuel Pump', codex: true, redo: true });
  bld('codex:building/fuel_pump-a1-r3', 31, 35, { name: 'Fuel Pump', codex: true, redo: true });
  bld('codex:building/fuel_pump-a1-r1', 33, 35, { name: 'Fuel Pump', codex: true, redo: true });
  for (const [x, y, n] of [[21, 27, 0], [20, 28, 1], [21, 29, 2], [20, 27, 2], [34, 34, 0], [35, 33, 1], [35, 34, 2]]) { fields.push({ x, y, n }); T(x, y).field = n; clearLand(T(x, y), T(x, y).level); }
  // v8: two small towns in the north-west, on free ground away from everything approved, so the town border (the
  // author's idea of 2026-10-14) has three towns to show, two of them close enough that their borders meet. The builder
  // levels each one's ground and clears its trees; a town hall and three houses each.
  rect(2, 2, 4, 4, (c) => clearLand(c, 0));
  rect(1, 7, 3, 9, (c) => clearLand(c, 1));
  rect(0, 5, 4, 6, (c) => clearLand(c, c.level)); // a meadow between the two, where their borders meet
  bld('structures/town_3', 3, 3, { name: 'Town hall' });
  [[4, 2], [2, 4], [4, 4]].forEach(([x, y], k) => bld(['structures/townhouse_2', 'structures/townhouse_s1', 'structures/townhouse_3'][k], x, y, { name: 'House' }));
  bld('structures/town_3', 2, 8, { name: 'Town hall' });
  [[3, 7], [1, 9], [3, 9]].forEach(([x, y], k) => bld(['structures/townhouse_s0', 'structures/townhouse_2', 'structures/townhouse_s2'][k], x, y, { name: 'House' }));
  // the towns, each named and given its colour as the world is made (the game's way, src/sim/towns.ts: a name of two
  // parts and a colour from TOWN_COLORS, both seeded by the town hall's place)
  const towns = buildings.filter((b) => b.name === 'Town hall').map((b, k) => {
    const sd = idx(b.x, b.y);
    const name = TOWN_FIRST[Math.floor(hashW(sd, 1) * TOWN_FIRST.length)] + TOWN_LAST[Math.floor(hashW(sd * 3 + 11, 5) * TOWN_LAST.length)].toLowerCase();
    return { k, x: b.x, y: b.y, hall: b, name, color: (k + sd) % TOWN_COLORS.length };
  });
  for (const t of towns) { const used = new Set(towns.filter((o) => o.k < t.k).map((o) => o.color)); while (used.has(t.color)) t.color = (t.color + 1) % TOWN_COLORS.length; t.hall.town = t.k; }

  // walkers: routes along road tiles; carry legs run toward the town (front views where possible)
  const walkers = [
    { who: 'lumberjack', route: line(30, 21, 30, 27), carry: 'out' },
    { who: 'lumberjack', route: line(31, 23, 34, 23), carry: 'back', phase: 0.1 },
    { who: 'stone-mason', route: [...line(27, 23, 30, 23), ...line(30, 24, 30, 27)], carry: 'out', phase: 0.35 },
    { who: 'stone-mason', route: line(23, 28, 27, 28), carry: 'back', phase: 0.7 },
    { who: 'farmer', route: line(22, 28, 29, 28), carry: 'out', phase: 0.15 },
    { who: 'farmer', route: [...line(30, 31, 30, 33), ...line(31, 33, 34, 33)], carry: 'back', phase: 0.55 },
    { who: 'pump-hand', route: line(30, 23, 34, 23), carry: 'back', phase: 0.6 },
    { who: 'pump-hand', route: line(30, 24, 30, 27), carry: 'out', redoOnly: true, phase: 0.85 },
    { who: 'passenger', route: line(30, 29, 30, 24), phase: 0.05 },
    { who: 'passenger', route: line(29, 28, 23, 28), phase: 0.4 },
    { who: 'passenger', route: [...line(28, 29, 28, 31), ...line(27, 31, 26, 31)], phase: 0.75 },
    { who: 'railway-worker', route: [...line(26, 32, 26, 33), ...line(27, 33, 29, 33)], phase: 0.2 },
    { who: 'railway-worker', route: line(30, 32, 30, 29), phase: 0.5 },
    { who: 'passenger-variant-01', route: line(30, 26, 30, 32), extra: true },
    { who: 'passenger-variant-02', route: line(24, 28, 29, 28), extra: true, phase: 0.3 },
    { who: 'passenger-variant-03', route: line(31, 23, 33, 23), extra: true, phase: 0.6 },
    { who: 'passenger-variant-04', route: line(30, 32, 30, 26), extra: true, phase: 0.2 },
  ];
  // the first open water a river runs into shows the river-water swatch, fading out from the mouth
  for (const c of map) if (c.kind === 'river' && c.down >= 0) { const n = map[c.down]; if ((n.kind === 'lake' || n.kind === 'ocean') && !n.pond && !n.cove) n.inflow = true; }
  // v9.2 (Road bridges): the demo's two road bridges, applied by the page only while that switch is On. bits are the road
  // pieces' own (1 +x, 2 -x, 4 +y, 8 -y) added to the tile's; a bridge tile keeps its water and carries the deck.
  // One stands on its own over the creek into the lake, on a short loop off the farm lane (its roads on both banks); the
  // other lies right beside the narrow line's bridge over the river by the pump, so the two are one wider bridge.
  const rb = {
    roads: [[22, 28, 8], [22, 27, 12], [22, 26, 5], [24, 26, 3], [25, 26, 6], [25, 27, 12], [25, 28, 8], [34, 23, 8], [34, 21, 12], [34, 20, 4]],
    bridges: [{ x: 23, y: 26, axis: 'x' }, { x: 34, y: 22, axis: 'y' }],
    walkers: [
      { who: 'farmer', route: [[22, 28], [22, 27], [22, 26], [23, 26], [24, 26], [25, 26], [25, 27], [25, 28]], carry: 'out', phase: 0.1, rbr: true },
      { who: 'passenger', route: [[25, 28], [25, 27], [25, 26], [24, 26], [23, 26], [22, 26], [22, 27], [22, 28]], phase: 0.55, rbr: true },
      { who: 'lumberjack', route: [...line(31, 23, 34, 23), ...line(34, 22, 34, 20)], carry: 'back', phase: 0.3, rbr: true },
      { who: 'passenger', route: line(34, 20, 34, 23), phase: 0.75, rbr: true },
    ],
  };
  walkers.push(...rb.walkers);
  return { map, track, roads, buildings, fields, walkers, notes, towns, rb };
}

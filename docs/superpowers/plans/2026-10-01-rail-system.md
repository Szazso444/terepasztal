# Rail System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regular curves and switches at 2×2 like high speed, high speed told apart by line speed instead of an unlock, a 2×2 switch that snaps into an S shape next to a parallel track, and a new narrow gauge (1×1 pieces at half the rail spacing) with its own wagons and a 1×2 depot.

**Architecture:** Track classes stay data-driven in `src/world/track.ts` (`CLASS_N` gives each class its curve block size); a third class `narrow` with `n = 1` reuses today's 1×1 geometry. The S switch is a second geometry (`form`) of the same 2×2 unit, chosen from the neighbouring track by `TrackGraph.refreshSwitchForms`. Vehicles get a `gauge`; `compat.ts` turns it into track-class access, so pathfinding, depots and the depot screen follow without their own rules. The narrow depot is a station definition with a 1×2 footprint (`long`) and a gauge.

**Tech Stack:** TypeScript, Vite, PixiJS v8, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-01-rail-system-design.md`

## Global Constraints

- No runtime dependencies beyond PixiJS.
- Atlas contract unchanged: `public/assets/<group>.png + .json` with `{ resolution, partial, frames: { "<key>": { x, y, w, h, ax, ay } } }`; frame keys carry their prefix (`track/…`, `rolling/…`, `structures/…`).
- Narrow rails sit at half the regular spacing: ±0.08 tile (regular ±0.16).
- `CLASS_N = { regular: 2, high_speed: 2, narrow: 1 }`.
- Line speed caps (locomotive speed units, before `rules.trainSpeedMul`): regular 2.0, narrow 1.2, high speed none.
- Snap rule: a 2×2 regular or high-speed switch is `parallel` when the tile past its S exit holds joinable track opening towards the block and the turn exit has no connected track; otherwise `turn`.
- Run typecheck, lint, tests, build and `prettier --check` before every push: `npm run typecheck && npm run lint && npm test && npm run build && npx prettier --check .`
- Every visual change is shown as game renders side by side with the current look before it is locked in.

## Review Focus

- An old save with trains standing on 1×1 regular curves loads, the pieces turn narrow, the trains report no route instead of crashing (Task 9 test `migrates 1x1 regular curves and switches to narrow`).
- A switch whose form flips while a train has it on its path: the train re-paths on the next track-version check, nothing throws (Task 2 test `flips form under a path without breaking the graph`).
- Picking a narrow locomotive and a regular wagon in the depot screen refuses with a message (Task 8 test `refuses a mixed-gauge consist`).
- A narrow depot turned north–south has its gates north and south and its footprint along y (Task 8 test `puts a turned narrow depot's gates at its ends`).
- A regular train crossing a narrow line on a narrow × regular crossing uses the regular axis and is never barred by the narrow one (Task 4 test `lets each gauge use its own axis of a mixed crossing`).

---

### Task 1: Track classes: narrow, 2×2 regular, mixed crossings

**Files:**

- Modify: `src/world/track.ts` (class types, `CLASS_N`, `classCostMul`, `TRACK_ITEMS`, `classesJoin`, `pieceCost`)
- Modify: `src/data/track.json` (crossing `rotations` 1 → 2)
- Modify: `src/strings.ts` (`toolbar.trackClass`, `toolbar.trackDesc` for the new items)
- Test: `src/world/track.test.ts`; update `src/sim/traffic.test.ts` where it relies on 1×1 regular switches

**Interfaces:**

- Produces: `type TrackClass = 'regular' | 'high_speed' | 'narrow'`; `CLASS_N: Record<TrackClass, number>`; `classesJoin(a, b)` (transition never joins narrow); crossing rotation 1 swaps which axis carries `cls2`.

- [ ] **Step 1: Write the failing tests** (append to `src/world/track.test.ts`, inside a new `describe('narrow gauge and 2x2 regular track', …)`)

```ts
it('lays regular and high-speed curves and switches over 2x2, narrow ones on one tile', () => {
  expect(CLASS_N).toEqual({ regular: 2, high_speed: 2, narrow: 1 });
  for (const kind of ['curve', 'switch'] as const) {
    expect(isUnitKind(kind, 'regular')).toBe(true);
    expect(isUnitKind(kind, 'high_speed')).toBe(true);
    expect(isUnitKind(kind, 'narrow')).toBe(false);
  }
  const g = new TrackGraph(16, 16);
  expect(g.place(4, 4, 'curve', 0, 'regular')).toHaveLength(4);
  expect(g.place(10, 4, 'curve', 0, 'narrow')).toEqual([{ x: 10, y: 4 }]);
});

it('joins narrow only to narrow, never through a transition', () => {
  expect(classesJoin('narrow', 'narrow')).toBe(true);
  expect(classesJoin('narrow', 'regular')).toBe(false);
  expect(classesJoin('any', 'narrow')).toBe(false);
  expect(classesJoin('narrow', 'any')).toBe(false);
  expect(classesJoin('any', 'regular')).toBe(true);
});

it('prices narrow track below regular and keeps a crossing at its dearer axis', () => {
  const reg = pieceCost('straight', 'regular');
  const nar = pieceCost('straight', 'narrow');
  for (const k of Object.keys(reg)) expect(nar[k]).toBeLessThanOrEqual(reg[k]);
  expect(pieceCost('crossing', 'regular', 'high_speed')).toEqual(
    pieceCost('crossing', 'high_speed', 'high_speed'),
  );
  expect(pieceCost('crossing', 'narrow', 'regular')).toEqual(
    pieceCost('crossing', 'regular', 'regular'),
  );
});

it('turns a mixed crossing so either line can run either way', () => {
  expect(rotationCount('crossing')).toBe(2);
  const a = makePiece('crossing', 0, 'narrow', 'regular');
  expect(portClass(a, Dir.N)).toBe('narrow');
  expect(portClass(a, Dir.E)).toBe('regular');
  const b = makePiece('crossing', 1, 'narrow', 'regular');
  expect(portClass(b, Dir.E)).toBe('narrow');
  expect(portClass(b, Dir.N)).toBe('regular');
});

it('offers the narrow pieces and both mixed crossings in the build list', () => {
  const keys = TRACK_ITEMS.map(itemKey);
  for (const k of [
    'straight_narrow',
    'curve_narrow',
    'switch_narrow',
    'crossing_narrow_narrow',
    'crossing_narrow_regular',
  ])
    expect(keys).toContain(k);
});
```

Also add `TRACK_ITEMS` and `itemKey` to the file's import list, and change the existing `it('spreads only curves and switches over n x n tiles', …)` body to:

```ts
for (const kind of TRACK_KINDS)
  for (const cls of TRACK_CLASSES)
    expect(isUnitKind(kind, cls)).toBe(CLASS_N[cls] > 1 && (kind === 'curve' || kind === 'switch'));
```

and in `it('treats a 1x1 piece as its own unit', …)` place the curve with class `'narrow'`. In `reads exits back through whichever edge you entered by` place the switch with class `'narrow'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/world/track.test.ts`
Expected: FAIL (`CLASS_N` has no `narrow`, `isUnitKind('curve','regular')` is false, `rotationCount('crossing')` is 1).

- [ ] **Step 3: Implement**

In `src/world/track.ts`:

```ts
/** Track classes. Everything about a class derives from `n`: curve footprint n×n, radius n − 0.5. */
export type TrackClass = 'regular' | 'high_speed' | 'narrow';
export const TRACK_CLASSES: TrackClass[] = ['regular', 'high_speed', 'narrow'];
export const CLASS_N: Record<TrackClass, number> = { regular: 2, high_speed: 2, narrow: 1 };
export function classRadius(cls: TrackClass) {
  return CLASS_N[cls] - 0.5;
}
/** Cost multiplier of a class: regular 1, high speed half again per block tile, narrow 0.6. */
export function classCostMul(cls: TrackClass) {
  if (cls === 'narrow') return 0.6;
  if (cls === 'regular') return 1;
  return CLASS_N[cls] * 1.5;
}
```

Append to `TRACK_ITEMS` (after the high-speed crossings):

```ts
  { kind: 'straight', cls: 'narrow' },
  { kind: 'curve', cls: 'narrow' },
  { kind: 'switch', cls: 'narrow' },
  { kind: 'crossing', cls: 'narrow', cls2: 'narrow' },
  { kind: 'crossing', cls: 'narrow', cls2: 'regular' },
```

Replace `classesJoin`:

```ts
/** Like joins like; a transition joins regular and high speed, never narrow (another gauge). */
export function classesJoin(a: TrackClass | 'any', b: TrackClass | 'any') {
  if (a === 'any') return b !== 'narrow';
  if (b === 'any') return a !== 'narrow';
  return a === b;
}
```

In `pieceCost` pick the dearer axis by multiplier, not by `n`:

```ts
const top = cls2 && classCostMul(cls2) > classCostMul(cls) ? cls2 : cls;
```

In `src/data/track.json` set `"crossing": { …, "rotations": 2 }`. Rotation 1 rotates the base links `[[N,S],[E,W]]` by one step to `[[E,W],[S,N]]`, so the second axis (`cls2`) becomes N–S with no further code.

In `src/strings.ts` add `narrow: 'Narrow'` to `toolbar.trackClass` and descriptions to `toolbar.trackDesc`:

```ts
straight_narrow: 'Narrow-gauge straight. Only narrow trains run on it. Drag to lay a run.',
curve_narrow: 'Narrow-gauge quarter turn on one tile: for tight spaces.',
switch_narrow: 'Narrow-gauge switch on one tile. Press R to turn it.',
crossing_narrow_narrow: 'Two narrow lines cross at grade.',
crossing_narrow_regular: 'A narrow line crosses a regular line at grade. Press R to swap the axes.',
```

- [ ] **Step 4: Run the whole suite and fix 1×1 assumptions**

Run: `npm test`
Expected: track tests PASS. `src/sim/traffic.test.ts` places `g.place(5, 5, 'switch', 1)` as a one-tile switch: add the class argument `'narrow'` to those two calls (lines with `'switch', 1)`), so the traffic tests keep testing a one-tile switch. Any other failure caused by regular curves now being 2×2: pass `'narrow'` where the test means a one-tile piece. Re-run until green.

- [ ] **Step 5: Commit**

```bash
git add src/world/track.ts src/data/track.json src/strings.ts src/world/track.test.ts src/sim/traffic.test.ts
git commit -m "Track classes: narrow gauge on one tile, regular curves and switches at 2x2"
```

---

### Task 2: S-shaped switch (`parallel` form) and the snap rule

**Files:**

- Modify: `src/world/trackGeom.ts` (`unitDef` gets a `form` argument and the S route)
- Modify: `src/world/track.ts` (`TrackPiece.form`, `memberLinks`, `footprintOf`, `place`, new `switchExits`, `refreshSwitchForms`)
- Modify: `src/sim/build.ts` (call `refreshSwitchForms` after placing and removing track)
- Modify: `src/game.ts` (refresh every switch after a save or level is loaded)
- Test: `src/world/track.test.ts`

**Interfaces:**

- Consumes: Task 1 classes.
- Produces: `type SwitchForm = 'turn' | 'parallel'`; `unitDef(kind, n, rot, form = 'turn')`; `TrackPiece.form?: SwitchForm` (absent means `turn`); `TrackGraph.refreshSwitchForms(near?: { x: number; y: number }[]): { x: number; y: number }[]` (returns the tiles whose pieces changed); `pieceFrame(p)` appends `p` after the rotation for parallel switches (`track/switch_regular_1p_m0`).

- [ ] **Step 1: Write the failing tests** (new `describe('S-shaped switch', …)` in `src/world/track.test.ts`)

```ts
/** A regular switch at (4,4) rotation 1: points face east, main line along row 4, branch below. */
function yard() {
  const g = new TrackGraph(20, 20);
  g.place(4, 4, 'switch', 1, 'regular');
  return g;
}
/** The tile just past the block where the S lane leaves, and the edge it leaves by. */
function sExit(rot = 1) {
  const def = unitDef('switch', 2, rot, 'parallel');
  const last = def.members[def.routes[1].members.at(-1)!];
  const out = last.links.find((l) => l.route === 1)!.out;
  return { x: 4 + last.dx + DIR_DX[out], y: 4 + last.dy + DIR_DY[out], out };
}

it('draws the parallel lane as an S that leaves the far end of the block one track over', () => {
  const turn = unitDef('switch', 2, 0, 'turn');
  const par = unitDef('switch', 2, 0, 'parallel');
  // rotation 0: the main line runs N to S down column 0; the S lane ends going south in column 1
  const lastTurn = turn.members[turn.routes[1].members.at(-1)!];
  const lastPar = par.members[par.routes[1].members.at(-1)!];
  expect(lastTurn.links.find((l) => l.route === 1)!.out).toBe(Dir.E);
  expect(lastPar.dx).toBe(1);
  expect(lastPar.links.find((l) => l.route === 1)!.out).toBe(Dir.S);
  expect(par.routes[1].diverging).toBe(true);
  expect(par.routes[0].members).toEqual(turn.routes[0].members);
});

it('snaps to the S shape when a parallel straight lies past the block, and back when it goes', () => {
  const g = yard();
  const e = sExit();
  expect(g.get(4, 4)!.form ?? 'turn').toBe('turn');
  g.place(e.x, e.y, 'straight', 1, 'regular');
  const changed = g.refreshSwitchForms([e]);
  expect(changed.length).toBe(4);
  for (const t of g.unitTiles(4, 4)) expect(g.get(t.x, t.y)!.form).toBe('parallel');
  expect(g.connected(e.x, e.y, opposite(e.out))).toBe(true);
  g.removeAt(e.x, e.y);
  g.refreshSwitchForms([e]);
  for (const t of g.unitTiles(4, 4)) expect(g.get(t.x, t.y)!.form ?? 'turn').toBe('turn');
});

it('snaps when the switch is laid next to an existing parallel straight', () => {
  const g = new TrackGraph(20, 20);
  const e = sExit();
  g.place(e.x, e.y, 'straight', 1, 'regular');
  g.place(4, 4, 'switch', 1, 'regular');
  g.refreshSwitchForms(g.unitTiles(4, 4));
  expect(g.get(4, 4)!.form).toBe('parallel');
});

it('ignores the main line continuation and track of another class', () => {
  const g = yard();
  const e = sExit();
  g.place(e.x, e.y, 'straight', 1, 'narrow');
  g.refreshSwitchForms([e]);
  expect(g.get(4, 4)!.form ?? 'turn').toBe('turn');
});

it('stays a turn while its side exit is connected', () => {
  const g = yard();
  const turn = unitDef('switch', 2, 1, 'turn');
  const last = turn.members[turn.routes[1].members.at(-1)!];
  const out = last.links.find((l) => l.route === 1)!.out;
  const side = { x: 4 + last.dx + DIR_DX[out], y: 4 + last.dy + DIR_DY[out] };
  g.place(side.x, side.y, 'straight', out === Dir.N || out === Dir.S ? 0 : 1, 'regular');
  const e = sExit();
  g.place(e.x, e.y, 'straight', 1, 'regular');
  g.refreshSwitchForms([side, e]);
  expect(g.get(4, 4)!.form ?? 'turn').toBe('turn');
});

it('flips form under a path without breaking the graph', () => {
  const g = yard();
  const e = sExit();
  const before = g.version;
  g.place(e.x, e.y, 'straight', 1, 'regular');
  g.refreshSwitchForms([e]);
  expect(g.version).toBeGreaterThan(before);
  // every member link still pairs two edges of its tile and the units stay whole
  for (const t of g.unitTiles(4, 4))
    for (const [a, b] of g.get(t.x, t.y)!.links) expect(a).not.toBe(b);
  expect(g.unitTiles(4, 4)).toHaveLength(4);
});
```

Add `unitDef` (from `./trackGeom`) and `DIR_DX, DIR_DY` (from `../engine/iso`) to the imports.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/world/track.test.ts -t "S-shaped"`
Expected: FAIL (`unitDef` takes no form; `refreshSwitchForms` is not a function).

- [ ] **Step 3: Implement the geometry in `src/world/trackGeom.ts`**

Change the signature and cache key, and build route 1 as an S for `parallel`:

```ts
export type SwitchForm = 'turn' | 'parallel';

export function unitDef(
  kind: 'curve' | 'switch',
  n: number,
  rot: number,
  form: SwitchForm = 'turn',
): UnitDef {
  const key = `${kind}:${n}:${rot}:${form}`;
  …
  if (kind === 'switch') {
    const straight: Vec2[] = [];
    for (let i = 0; i <= SAMPLES; i++) straight.push(xf({ x: 0, y: -0.5 + n * (i / SAMPLES) }));
    routes.push({ pts: straight, radius: null, diverging: false });
    if (form === 'parallel') {
      const s = sCurve(n);
      routes.push({ pts: s.pts.map(xf), radius: s.radius, diverging: true });
    } else routes.push({ pts: arc, radius: R, diverging: true });
  } else routes.push({ pts: arc, radius: null, diverging: false });
```

Add the S builder below `unitDef`:

```ts
/**
 * An S from the anchor's north edge (0, -0.5) heading south to (1, n - 0.5) heading south: two
 * reverse arcs of equal radius meeting at the block centre, one track over in n tiles.
 */
function sCurve(n: number): { pts: Vec2[]; radius: number } {
  const half = n / 2;
  const R = (half * half + 0.25) / 1; // R(1 - cos θ) = 0.5 and R sin θ = n / 2
  const theta = Math.asin(half / R);
  const HALF = 48;
  const first: Vec2[] = [];
  for (let i = 0; i <= HALF; i++) {
    const p = theta * (i / HALF);
    first.push({ x: R - R * Math.cos(p), y: -0.5 + R * Math.sin(p) });
  }
  const mid = { x: 0.5, y: (n - 1) / 2 };
  const second = first
    .slice(0, -1)
    .reverse()
    .map((p) => ({ x: 2 * mid.x - p.x, y: 2 * mid.y - p.y }));
  return { pts: [...first, ...second], radius: R };
}
```

(`R = (n²/4 + 1/4)` follows from `R(1 − cos θ) = 0.5`, `R sin θ = n/2`; for `n = 2`, `R = 1.25`.)

- [ ] **Step 4: Implement form state and the snap rule in `src/world/track.ts`**

Import `type SwitchForm` from `./trackGeom` and export it. Add `form?: SwitchForm` to `TrackPiece` (doc: "2×2 switches: which diverging lane is laid; absent = turn"). Give `footprintOf` no change (both forms cover the block). In `place(…)`, add a last parameter `form: SwitchForm = 'turn'`, pass it to `unitDef`, and set `form` on every member piece when `form === 'parallel'`. In `memberLinks` pass `p.form ?? 'turn'` to `unitDef`. In `pieceFrame`:

```ts
const formTag = p.kind === 'switch' && p.form === 'parallel' ? 'p' : '';
const base =
  p.kind === 'crossing'
    ? `track/crossing_${p.cls}_${p.cls2 ?? p.cls}_${p.rot}`
    : `track/${p.kind}_${p.cls}_${p.rot}${formTag}`;
```

Add to `TrackGraph`:

```ts
/** Where a 2×2 switch's diverging lane leaves its block in a form: the tile beyond and the edge. */
switchExit(ax: number, ay: number, rot: number, cls: TrackClass, form: SwitchForm) {
  const def = unitDef('switch', CLASS_N[cls], rot, form);
  const last = def.members[def.routes[1].members[def.routes[1].members.length - 1]];
  const out = last.links.find((l) => l.route === 1)!.out;
  return { x: ax + last.dx + DIR_DX[out], y: ay + last.dy + DIR_DY[out], out };
}
/** Does joinable track outside this unit open onto the given edge of the block? */
private meets(ax: number, ay: number, cls: TrackClass, e: { x: number; y: number; out: Dir }) {
  const q = this.get(e.x, e.y);
  if (!q || (q.unit && q.unit.ax === ax && q.unit.ay === ay)) return false;
  if (!this.opensTo(e.x, e.y, opposite(e.out))) return false;
  return classesJoin(cls, portClass(q, opposite(e.out)));
}
/**
 * Re-choose the form of every 2×2 switch whose block touches one of `near` (all switches when
 * omitted): `parallel` when joinable track lies past the S exit and nothing meets the turn exit.
 * Rewrites the members of the switches that change and returns their tiles.
 */
refreshSwitchForms(near?: { x: number; y: number }[]): { x: number; y: number }[] {
  const anchors = new Map<number, { x: number; y: number; piece: TrackPiece }>();
  for (const t of this.anchors())
    if (t.piece.kind === 'switch' && t.piece.unit) {
      if (near) {
        const fp = footprintOf(t.x, t.y, 'switch', t.piece.rot, t.piece.cls);
        const touches = near.some((n) =>
          fp.some((f) => Math.abs(f.x - n.x) + Math.abs(f.y - n.y) <= 1),
        );
        if (!touches) continue;
      }
      anchors.set(this.key(t.x, t.y), t);
    }
  const changed: { x: number; y: number }[] = [];
  for (const { x, y, piece } of anchors.values()) {
    const par = this.meets(x, y, piece.cls, this.switchExit(x, y, piece.rot, piece.cls, 'parallel'));
    const side = this.meets(x, y, piece.cls, this.switchExit(x, y, piece.rot, piece.cls, 'turn'));
    const want: SwitchForm = par && !side ? 'parallel' : 'turn';
    if ((piece.form ?? 'turn') === want) continue;
    changed.push(...this.place(x, y, 'switch', piece.rot, piece.cls, undefined, want));
  }
  return changed;
}
```

`anchors()` yields member 0 of each unit; `place` rewrites every member and bumps `version`.

- [ ] **Step 5: Call it where track changes**

In `src/sim/build.ts`, at the end of `placeTrack` (after the `onTrackChanged` loop) and of `removeTrack` (after its `onTrackChanged` loop):

```ts
for (const t of this.track.refreshSwitchForms(tiles)) this.onTrackChanged?.(t.x, t.y);
```

In `src/game.ts`, after the loop that places `level.track` (around line 436) and after the loop that places `j.track` in `applySave` (around line 1090):

```ts
for (const t of this.track.refreshSwitchForms()) this.onTrackChanged(t.x, t.y);
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/world/track.test.ts`
Expected: PASS. Then `npm test`: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/world/trackGeom.ts src/world/track.ts src/sim/build.ts src/game.ts src/world/track.test.ts
git commit -m "S-shaped switch: a 2x2 switch snaps to a parallel lane beside a parallel track"
```

---

### Task 3: Track art: seamless 2×2 pieces, narrow gauge, S switch

**Files:**

- Modify: `src/art/trackIllustrated.ts`
- Test: `src/art/frames.test.ts` (frame names only; drawing needs a canvas)

**Interfaces:**

- Consumes: Task 1 classes, Task 2 `unitDef(…, form)` and `pieceFrame` names.
- Produces: frames `track/<item>_<rot>` (toolbar preview), `track/<item>_<rot>[p]_m<i>` (members), for every class and both switch forms.

- [ ] **Step 1: Write the failing test** (append to `src/art/frames.test.ts`)

```ts
import { pieceFrame, makePiece, TrackGraph } from '../world/track';

it('names the members of a parallel switch apart from a turning one', () => {
  const g = new TrackGraph(20, 20);
  g.place(4, 4, 'switch', 1, 'regular', undefined, 'parallel');
  expect(pieceFrame(g.get(4, 4)!)).toBe('track/switch_regular_1p_m0');
  g.place(10, 4, 'switch', 1, 'regular');
  expect(pieceFrame(g.get(10, 4)!)).toBe('track/switch_regular_1_m0');
  expect(pieceFrame(makePiece('curve', 2, 'narrow'))).toBe('track/curve_narrow_2');
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/art/frames.test.ts`
Expected: PASS once Task 2 is in (this pins the naming the atlas must follow).

- [ ] **Step 3: Implement the drawing**

In `src/art/trackIllustrated.ts` replace the per-class literals in `draw` with one style table:

```ts
/** Per class: rail offset from the centre line, half sleeper length, sleeper spacing, ballast
 *  shoulder, sleeper colour and highlight. Narrow gauge is half the regular rail spacing. */
const STYLE: Record<
  TrackClass,
  { rail: number; sleeper: number; step: number; shoulder: number; tie: string; tieHi: string }
> = {
  regular: {
    rail: 0.16,
    sleeper: 0.235,
    step: 0.14,
    shoulder: 0.29,
    tie: '#725039',
    tieHi: '#a17c52',
  },
  high_speed: {
    rail: 0.16,
    sleeper: 0.235,
    step: 0.14,
    shoulder: 0.34,
    tie: '#b9b3a0',
    tieHi: '#d1cbb7',
  },
  narrow: {
    rail: 0.08,
    sleeper: 0.13,
    step: 0.12,
    shoulder: 0.18,
    tie: '#6a4a33',
    tieHi: '#94714b',
  },
};
```

Use `STYLE[cls].shoulder` in the ballast loop, `STYLE[cls].sleeper` for the sleeper corners (replacing `0.235`), `STYLE[cls].step` for `next += …` (replacing `0.14`), `tie`/`tieHi` for the sleeper colours, and `[-STYLE[cls].rail, STYLE[cls].rail]` for the rail and fastener loops (replacing `[-0.16, 0.16]`). Narrow rails draw thinner: when `cls === 'narrow'` pass widths `1.0 / 0.75 / 0.32` to the three `line(rail, …)` calls instead of `1.25 / 0.95 / 0.4`.

Replace the member drawing in `generateIllustratedTrackAtlas` so every member draws the whole piece clipped to its tile, for each switch form:

```ts
const forms: SwitchForm[] = it.kind === 'switch' ? ['turn', 'parallel'] : ['turn'];
for (const form of forms) {
  const def = unitDef(it.kind as 'curve' | 'switch', CLASS_N[it.cls], rotation, form);
  const tag = form === 'parallel' ? 'p' : '';
  const member = (index: number) => {
    const own = def.members[index];
    return draw(
      def.members.flatMap((m) =>
        m.links.map((l) => ({
          points: l.pts.map((p) => ({ x: p.x + m.dx - own.dx, y: p.y + m.dy - own.dy })),
          cls: it.cls,
        })),
      ),
      rotation * 13,
    );
  };
  def.members.forEach((_, i) => ab.add(`${key}${tag}_m${i}`, member(i), OX * R, OY * R));
  if (form === 'turn') ab.add(key, member(1), OX * R, OY * R);
}
```

(`key` is `track/${itemKey(it)}_${rotation}`; the `apron` argument and the gravel fill go away for members.)

- [ ] **Step 4: Render and compare**

Start the dev server (`narrow` entry, Task 10 Step 0), build Task 10's scene early (`scratchpad/rails/yard/`) and capture every piece against `origin/main` (dev server on 5174). Check by eye: rails continuous across member tiles, no gravel squares, narrow rails half the regular spacing, the S lane continuous through the block centre.

- [ ] **Step 5: Commit**

```bash
git add src/art/trackIllustrated.ts src/art/frames.test.ts
git commit -m "Track art: whole-piece 2x2 members, half-gauge narrow track, S switch frames"
```

---

### Task 4: Gauge on vehicles and track access

**Files:**

- Modify: `src/data/content.ts` (`Gauge`, `gauge` on `LocoDef`/`WagonDef`, `VehicleSize` gets `'tiny'`)
- Modify: `src/sim/body.ts` (`SIZE_LEN.tiny = 0.5`)
- Modify: `src/sim/compat.ts` (gauge access, drop the large-stock rule, `consistGauge`)
- Modify: `src/gacha/crafting.ts` (`craftSize` maps `tiny` to `small`)
- Modify: `src/data/locomotives.json` (Rocket and Mk48 `"gauge": "narrow"`; starter flags as decided in the v5 database: John Bull starter, Rocket not)
- Modify: `src/data/wagons.json` (four narrow wagons)
- Modify: `src/strings.ts` (`compat.wrongGauge`, `fleet.mixedGauge`, roster size label for `tiny`)
- Test: create `src/sim/compat.test.ts`

**Interfaces:**

- Produces: `type Gauge = 'regular' | 'narrow'`; `gaugeOf(def: { gauge?: Gauge }): Gauge`; `consistGauge(defs): Gauge | 'mixed' | null` (null for an empty list); `vehicleAccess(def, cls)` returns a reason for the wrong gauge.

- [ ] **Step 1: Write the failing tests** (`src/sim/compat.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { content } from '../data/content';
import { vehicleAccess, consistAccess, consistGauge, gaugeOf, pieceClassFor } from './compat';
import { makePiece } from '../world/track';
import { Dir } from '../engine/iso';

const loco = (id: string) => content.locomotives.find((d) => d.id === id)!;
const wagon = (id: string) => content.wagons.find((d) => d.id === id)!;

describe('gauge access', () => {
  it('keeps narrow stock on narrow track and regular stock off it', () => {
    expect(gaugeOf(loco('mk48'))).toBe('narrow');
    expect(vehicleAccess(loco('mk48'), 'narrow')).toBeNull();
    expect(vehicleAccess(loco('mk48'), 'regular')).not.toBeNull();
    expect(vehicleAccess(loco('f7'), 'narrow')).not.toBeNull();
    expect(vehicleAccess(wagon('mine_tub'), 'narrow')).toBeNull();
    expect(vehicleAccess(wagon('boxcar'), 'narrow')).not.toBeNull();
  });

  it('no longer bars large stock from regular track', () => {
    const large = content.locomotives.find((d) => d.size === 'large')!;
    expect(vehicleAccess(large, 'regular')).toBeNull();
  });

  it('names a consist of two gauges as mixed', () => {
    expect(consistGauge([loco('mk48'), wagon('mine_tub')])).toBe('narrow');
    expect(consistGauge([loco('f7'), wagon('boxcar')])).toBe('regular');
    expect(consistGauge([loco('mk48'), wagon('boxcar')])).toBe('mixed');
    expect(consistGauge([])).toBeNull();
    expect(consistAccess([loco('mk48'), wagon('boxcar')]).classes.size).toBe(0);
  });

  it('lets each gauge use its own axis of a mixed crossing', () => {
    const x = makePiece('crossing', 0, 'narrow', 'regular');
    expect(pieceClassFor(x, Dir.N)).toBe('narrow');
    expect(pieceClassFor(x, Dir.E)).toBe('regular');
    expect(consistAccess([loco('f7')]).classes.has(pieceClassFor(x, Dir.E))).toBe(true);
    expect(consistAccess([loco('f7')]).classes.has(pieceClassFor(x, Dir.N))).toBe(false);
  });

  it('gives every narrow wagon a cargo class and a length of at most one tile', () => {
    for (const id of ['mine_tub', 'narrow_tank', 'narrow_box', 'narrow_coach']) {
      const w = wagon(id);
      expect(w.gauge).toBe('narrow');
      expect(['tiny', 'small']).toContain(w.size ?? 'small');
    }
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/sim/compat.test.ts`
Expected: FAIL (`gaugeOf` not exported, `mine_tub` unknown).

- [ ] **Step 3: Implement**

`src/data/content.ts`: `export type Gauge = 'regular' | 'narrow';`, `export type VehicleSize = 'tiny' | 'small' | 'medium' | 'large';`, add `/** track gauge (default regular) */ gauge?: Gauge;` to `LocoDef` and `WagonDef`.

`src/sim/body.ts`: `VehicleSize` gains `'tiny'`, `SIZE_LEN = { tiny: 0.5, small: 1, medium: 2, large: 3 }`, and `if (size === 'small' || size === 'tiny') plan = 'rigid';`.

`src/sim/compat.ts`:

```ts
import type { Gauge } from '../data/content';

export function gaugeOf(def: { gauge?: Gauge }): Gauge {
  return def.gauge ?? 'regular';
}
/** The gauge every vehicle shares, 'mixed' when they differ, null for none. */
export function consistGauge(defs: { gauge?: Gauge }[]): Gauge | 'mixed' | null {
  let g: Gauge | null = null;
  for (const d of defs) {
    const own = gaugeOf(d);
    if (g && own !== g) return 'mixed';
    g = own;
  }
  return g;
}
export function vehicleAccess(def: LocoDef | WagonDef, cls: TrackClass): string | null {
  const narrowTrack = cls === 'narrow';
  if ((gaugeOf(def) === 'narrow') !== narrowTrack) return STR.compat.wrongGauge(narrowTrack);
  const v = verdictOf(def, cls);
  return v.ok ? null : v.reason;
}
```

Delete the `largeBarred` line and string; update the file's header comment ("On top of the geometry sits one rule about gauge").

`src/gacha/crafting.ts`:

```ts
export function craftSize(defId: string): VehicleSize {
  const s = itemDef(defId).size ?? 'small';
  return s === 'tiny' ? 'small' : s;
}
```

`src/data/wagons.json`, append:

```json
{ "id": "mine_tub", "name": "Mine Tub", "rarity": "N", "era": "A steel tub on four small wheels, tipped by hand.", "body": "hopper", "paint": "iron", "carries": "mineral", "capacity": 10, "weight": 3, "starter": true, "tier": 0, "size": "tiny", "gauge": "narrow" },
{ "id": "narrow_tank", "name": "Narrow Tank Wagon", "rarity": "N", "era": "A short barrel tank for the narrow gauge.", "body": "tank", "paint": "wood", "carries": "liquid", "capacity": 8, "weight": 2, "starter": true, "tier": 0, "size": "small", "gauge": "narrow" },
{ "id": "narrow_box", "name": "Narrow Box Wagon", "rarity": "N", "era": "A covered wagon for grain and goods on the narrow gauge.", "body": "box", "paint": "wood", "carries": "bulk", "capacity": 9, "weight": 3, "starter": true, "tier": 0, "size": "small", "gauge": "narrow" },
{ "id": "narrow_coach", "name": "Narrow Coach", "rarity": "N", "era": "Open-platform coach with wooden benches.", "body": "coach", "paint": "green", "carries": "people", "capacity": 10, "weight": 3, "starter": true, "tier": 0, "size": "small", "gauge": "narrow" }
```

`src/data/locomotives.json`: add `"gauge": "narrow"` to `rocket` and `mk48`; remove `"starter": true` from `rocket`, add `"starter": true` to `john_bull`.

`src/strings.ts`: `compat.wrongGauge: (narrowTrack: boolean) => narrowTrack ? 'Regular gauge: cannot run on narrow track' : 'Narrow gauge: runs on narrow track only'`, `fleet.mixedGauge: 'A train cannot mix narrow and regular gauge.'`, and `roster.size.tiny: 'Tiny (½ tile)'` (the size map is indexed by `VehicleSize`).

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: PASS. `src/sim/body.test.ts` may assert large stock failing regular track or iterate `['small','medium','large']`: update those expectations to the new rule (large passes regular) and add `'tiny'` where the test enumerates sizes. `validateContent` must stay clean (`npx vitest run src/sim/expansion.test.ts -t content`).

- [ ] **Step 5: Commit**

```bash
git add src/data src/sim/body.ts src/sim/compat.ts src/sim/compat.test.ts src/gacha/crafting.ts src/strings.ts src/sim/body.test.ts
git commit -m "Gauge on vehicles: narrow stock on narrow track only, four narrow wagons"
```

---

### Task 5: Narrow rolling-stock art

**Files:**

- Modify: `src/art/rolling.ts` (`Frame` gets `narrow`; wheel and bogie widths; variant keys)
- Modify: `src/art/frames.ts` (narrow keys for wagons, locos and bogies)
- Modify: `src/render/trainRenderer.ts` (pass the vehicle's gauge to `bogieFrame`)
- Modify: `src/ui/trainSide.ts:218` (wagon preview key through `wagonFrame`)
- Test: `src/art/frames.test.ts`

**Interfaces:**

- Consumes: Task 4 `gaugeOf`.
- Produces: frame keys `rolling/wagon_<body>_<size>_n_<paint>_f<k>`, `rolling/loco_<body>_<size>_n_<paint>_<part>_f<k>`, `rolling/bogie_<kind>_n_f<k>`; `bogieFrame(atlas, style, kind, f, narrow = false)`.

- [ ] **Step 1: Write the failing test** (append to `src/art/frames.test.ts`)

```ts
it('looks narrow stock up under its own frames', () => {
  const tub = content.wagons.find((w) => w.id === 'mine_tub')!;
  const key = `rolling/wagon_hopper_tiny_n_iron_f2`;
  expect(wagonFrame(atlas(key), tub, 2)).toBe(key);
  expect(bogieFrame(atlas('rolling/bogie_bogie_n_f2'), undefined, 'bogie', 2, true)).toBe(
    'rolling/bogie_bogie_n_f2',
  );
});
```

(`atlas(...keys)` is the file's existing fake-atlas helper.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/art/frames.test.ts`
Expected: FAIL (keys without `_n`).

- [ ] **Step 3: Implement**

`src/art/frames.ts`: in `locoFrame` and `wagonFrame` compute `const g = gaugeOf(def) === 'narrow' ? '_n' : '';` and use `${size}${g}` wherever `${size}` appears in a key; `bogieFrame(atlas, style, kind, f, narrow = false)` tries `rolling/bogie_${kind}${narrow ? '_n' : ''}_f${f}` before the regular key.

`src/art/rolling.ts`:

```ts
class Frame {
  …
  constructor(readonly L: number, readonly a: number, readonly seed: number, readonly narrow = false) { … }
  along(l: number, w: number) {
    w *= DRAWN_WIDTH * (this.narrow ? NARROW_BODY : 1);
    …
  }
  /** a wheel's offset across the body for this frame's gauge */
  gw(w: number) {
    return this.narrow ? (w * NARROW_GAUGE) / NARROW_BODY : w;
  }
}
/** narrow stock: bodies three quarters as wide, wheels on rails half as far apart */
const NARROW_BODY = 0.75;
const NARROW_GAUGE = 0.5;
```

Route every wheel offset through `f.gw(…)`: in `wheelFrame` (`[-0.105, 0.105]` → `[f.gw(-0.105), f.gw(0.105)]`) and the two body drawers that place wheels at `±0.16` (lines with `for (const w of [-0.16, 0.16])`). `locoVariants` and `wagonVariants` include `gaugeOf(d)` in their dedupe key and pass `narrow` into `new Frame(…)`; the frame keys get the same `_n` as `frames.ts`. In the bogie loop draw each kind twice, the second time with `new Frame(1, facingAngle(fi), 600 + fi, true)` under `rolling/bogie_${k}_n_f${fi}`.

`src/render/trainRenderer.ts`: `bogieFrame(this.atlas, style, b.kind, f, gaugeOf(isLoco ? t.locos[i].def : t.wagons[i - t.locos.length].def) === 'narrow')`.

`src/ui/trainSide.ts`: build the wagon preview with `wagonFrame(atlas, w.def, 0)` instead of the hand-made key.

- [ ] **Step 4: Run tests and render**

Run: `npm test` → PASS. Render the four narrow wagons and the Rocket and Mk48 on narrow track beside a regular boxcar (Task 10 scene) and check the wheels sit on the narrow rails.

- [ ] **Step 5: Commit**

```bash
git add src/art src/render/trainRenderer.ts src/ui/trainSide.ts
git commit -m "Narrow rolling stock: narrower bodies, wheels and trucks on the half gauge"
```

---

### Task 6: Line speed caps

**Files:**

- Create: `src/sim/lineSpeed.ts`
- Modify: `src/sim/rules.ts` (`lineSpeedRegular`, `lineSpeedNarrow`, defaults, tuning entries)
- Modify: `src/sim/trains.ts` (apply caps ahead of the head)
- Test: create `src/sim/lineSpeed.test.ts`

**Interfaces:**

- Consumes: Task 1 classes, `pieceClassFor` from `compat.ts`.
- Produces: `lineSpeedCap(cls: TrackClass): number` (Infinity for high speed); `approachCap(limit: number, distance: number, decel: number): number`.

- [ ] **Step 1: Write the failing test** (`src/sim/lineSpeed.test.ts`)

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { lineSpeedCap, approachCap } from './lineSpeed';
import { rules, DEFAULT_RULES } from './rules';

beforeEach(() => Object.assign(rules, DEFAULT_RULES));

describe('line speed', () => {
  it('caps regular and narrow track, never high speed', () => {
    expect(lineSpeedCap('high_speed')).toBe(Infinity);
    expect(lineSpeedCap('regular')).toBeCloseTo(2.0 * rules.trainSpeedMul);
    expect(lineSpeedCap('narrow')).toBeCloseTo(1.2 * rules.trainSpeedMul);
    expect(lineSpeedCap('narrow')).toBeLessThan(lineSpeedCap('regular'));
  });

  it('brakes towards a lower cap ahead and holds it once there', () => {
    expect(approachCap(1, 0, 1.5)).toBe(1);
    expect(approachCap(1, -0.3, 1.5)).toBe(1);
    const far = approachCap(1, 5, 1.5);
    expect(far).toBeGreaterThan(1);
    expect(approachCap(1, 2, 1.5)).toBeLessThan(far);
  });

  it('follows the tuning values', () => {
    rules.lineSpeedRegular = 3;
    expect(lineSpeedCap('regular')).toBeCloseTo(3 * rules.trainSpeedMul);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/sim/lineSpeed.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/sim/rules.ts`: add to `Rules`

```ts
/** top speed on regular track, locomotive speed units (high speed has no cap) */
lineSpeedRegular: number;
/** top speed on narrow track, locomotive speed units */
lineSpeedNarrow: number;
```

defaults `lineSpeedRegular: 2, lineSpeedNarrow: 1.2`, and two tuning entries in the `Trains` group (`min 0.5, max 5, step 0.1`, labels 'Regular line speed' and 'Narrow line speed').

`src/sim/lineSpeed.ts`:

```ts
import type { TrackClass } from '../world/track';
import { rules } from './rules';

/** Highest speed a class allows, in the units of `Train.maxSpeed`. */
export function lineSpeedCap(cls: TrackClass): number {
  if (cls === 'high_speed') return Infinity;
  const v = cls === 'narrow' ? rules.lineSpeedNarrow : rules.lineSpeedRegular;
  return v * rules.trainSpeedMul;
}
/** Speed allowed `distance` tiles before a stretch capped at `limit`, braking at `decel`. */
export function approachCap(limit: number, distance: number, decel: number): number {
  if (distance <= 0) return limit;
  return Math.sqrt(limit * limit + 2 * decel * Math.max(0, distance - 0.25));
}
```

`src/sim/trains.ts`, right after the bridge braking loop (the `for (const s of this.pathAhead())` that ends before `if (cautionArc !== null)`):

```ts
// line speed: regular and narrow track cap top speed, braking ahead of a lower cap
for (const s of this.pathAhead(12)) {
  const piece = ctx.track.get(s.x, s.y);
  if (!piece) continue;
  const limit = lineSpeedCap(pieceClassFor(piece, s.in));
  if (limit === Infinity) continue;
  const d = s.arc - this.pathPos;
  if (d > 2 + (this.speed * this.speed) / (2 * DECEL)) break;
  cap = Math.min(cap, approachCap(limit, d, DECEL));
}
```

Import `lineSpeedCap, approachCap` and `pieceClassFor` (already imported from `./compat` in this file; check).

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS (traffic tests run regular locos below 2.0; if one runs faster and asserts timing, raise `rules.lineSpeedRegular` in that test's setup rather than changing the assertion).

- [ ] **Step 5: Commit**

```bash
git add src/sim/lineSpeed.ts src/sim/lineSpeed.test.ts src/sim/rules.ts src/sim/trains.ts
git commit -m "Line speed: regular and narrow track cap top speed, high speed does not"
```

---

### Task 7: High speed without its gates

**Files:**

- Modify: `src/sim/build.ts:310-317` (drop the `hsLocked` check)
- Modify: `src/ui/toolbar.ts:130-135` (no tier and no hiding for high speed and transitions)
- Modify: `src/game.ts` (drop the high-speed quest: lines around 1620, 1820, 2017)
- Modify: `src/ui/hud.ts` (drop `hsQuest`), `src/sim/ages.ts` (drop `HS_QUEST`, `hsQuestMet`, `hsQuestStatus`), `src/strings.ts` (drop `build.hsLocked`, `ages.hsUnlocked`, the quest texts)
- Test: `src/sim/expansion.test.ts` (new case)

**Interfaces:**

- Produces: nothing new; `Economy.hsUnlocked` stays as a saved field, unread.

- [ ] **Step 1: Write the failing test** (append a `describe('high speed without a quest', …)` to `src/sim/expansion.test.ts`)

```ts
it('lets a player lay high-speed track from the start', () => {
  const { builder, economy } = world();
  builder.free = false;
  economy.hsUnlocked = false;
  const c = builder.checkTrack(40, 40, { kind: 'straight', cls: 'high_speed' }, 1);
  expect(c.reason ?? '').not.toMatch(/high-speed/i);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/sim/expansion.test.ts -t "high speed without"`
Expected: FAIL (reason is the high-speed lock).

- [ ] **Step 3: Implement**

Delete the `if (!this.free && (item.cls === 'high_speed' || item.cls2 === 'high_speed') && !this.economy.hsUnlocked) return …` block in `checkTrack`. In `toolbar.ts` set `tier: 0` and remove `hidden` for track items. In `game.ts` remove the `this.hud.hsQuest = …` assignment, the `hsUnlocked` callback passed to the toolbar (pass nothing or `() => true` if the signature requires it), and the unlock block in the age tick; remove the imports of `hsQuestMet, hsQuestStatus`. Remove the quest UI in `hud.ts` and the quest exports in `ages.ts`. Remove the now unused strings; `npm run typecheck` finds every leftover.

- [ ] **Step 4: Run all checks**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/build.ts src/ui/toolbar.ts src/game.ts src/ui/hud.ts src/sim/ages.ts src/strings.ts src/sim/expansion.test.ts
git commit -m "High speed: no unlock quest, no late tier; line speed is its benefit"
```

---

### Task 8: Narrow depot

**Files:**

- Modify: `src/data/content.ts` (`StationDef.gauge`, `StationDef.long`)
- Modify: `src/data/stations.json` (`narrow_depot`)
- Modify: `src/sim/stations.ts` (`stationFootprint`, `Station.w/h`, footprint, covers, centre, `distTo`, `gateTiles`, `platforms`)
- Modify: `src/sim/build.ts` (`depotsOf`, `checkStation(x, y, defId, rot)`, per-gauge cap, footprint by rotation)
- Modify: `src/sim/fleet.ts` (depot by gauge in `create`, `previewSpawn`, `modelDeployReason`)
- Modify: `src/ui/depot.ts` (depot list and default by the consist's gauge)
- Modify: `src/ui/buildController.ts:112,350` (rotate and preview the 1×2 footprint)
- Modify: `src/game.ts` (structure placement of a long station; `fixBuiltTiles`; the age-goal depot count counts regular depots)
- Modify: `src/art/structures.ts` (`narrowDepot(rot)` sprites `structures/depot_narrow_r0|r1`)
- Modify: `src/strings.ts` (`fleet.wrongDepot`, `fleet.noNarrowDepot`)
- Test: create `src/sim/narrowDepot.test.ts`

**Interfaces:**

- Consumes: Task 4 `consistGauge`, `gaugeOf`.
- Produces: `stationFootprint(defId: string, x: number, y: number, rot: number): { x: number; y: number }[]`; `Builder.depotsOf(gauge: Gauge): Station[]`; `Builder.checkStation(x, y, defId, rot = 0)`.

- [ ] **Step 1: Write the failing tests** (`src/sim/narrowDepot.test.ts`; world setup copied from `src/sim/expansion.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Fleet } from './fleet';
import { Inventory } from '../gacha/inventory';
import { stationFootprint } from './stations';
import { locoDef } from '../gacha/items';
import { rules, DEFAULT_RULES } from './rules';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => Object.assign(rules, DEFAULT_RULES));
function world() {
  const map = emptyMap(4242, 64, 64, Terrain.Grass),
    track = new TrackGraph(64, 64),
    stock = new Stockpile(),
    economy = new Economy();
  const builder = new Builder(map, new RegionState(map), track, economy, stock);
  builder.free = true;
  const inventory = new Inventory();
  const fleet = new Fleet(track, builder, map, inventory, economy, stock);
  return { map, track, builder, fleet, inventory };
}

describe('narrow depot', () => {
  it('stands on two tiles along its axis with a gate at each end', () => {
    const { builder } = world();
    const d = builder.placeStation(20, 20, 'narrow_depot', 0)!;
    expect(d.footprint()).toEqual([
      { x: 20, y: 20 },
      { x: 21, y: 20 },
    ]);
    expect(d.gateTiles()).toEqual([
      { x: 19, y: 20 },
      { x: 22, y: 20 },
    ]);
    expect(d.platforms).toBe(1);
  });

  it("puts a turned narrow depot's gates at its ends", () => {
    const { builder } = world();
    const d = builder.placeStation(30, 30, 'narrow_depot', 1)!;
    expect(d.footprint()).toEqual([
      { x: 30, y: 30 },
      { x: 30, y: 31 },
    ]);
    expect(d.gateTiles()).toEqual([
      { x: 30, y: 29 },
      { x: 30, y: 32 },
    ]);
    expect(stationFootprint('narrow_depot', 30, 30, 1)).toEqual(d.footprint());
  });

  it('has its own cap beside the regular depots', () => {
    const { builder } = world();
    expect(builder.placeStation(10, 10, 'depot', 0)).not.toBeNull();
    builder.free = false;
    expect(builder.checkStation(20, 10, 'depot', 0).ok).toBe(false);
    expect(builder.checkStation(30, 10, 'narrow_depot', 0).ok).toBe(true);
    expect(builder.depotsOf('narrow')).toHaveLength(0);
    expect(builder.depotsOf('regular')).toHaveLength(1);
  });

  it('rolls narrow trains out of a narrow depot only', () => {
    const { builder, fleet, inventory, track } = world();
    const reg = builder.placeStation(10, 10, 'depot', 0)!;
    const nar = builder.placeStation(10, 30, 'narrow_depot', 0)!;
    const mk48 = inventory.add('mk48', 0);
    const f7 = inventory.add('f7', 0);
    expect(fleet.modelDeployReason(locoDef('mk48'), reg)).toMatch(/gauge/i);
    expect(fleet.modelDeployReason(locoDef('f7'), nar)).toMatch(/gauge/i);
    const r = fleet.create([mk48.uid], [], [], undefined, 'schedule', reg.id);
    expect(r).toMatch(/gauge/i);
    const r2 = fleet.create([f7.uid], [], [], undefined, 'schedule', nar.id);
    expect(r2).toMatch(/gauge/i);
    void track;
  });

  it('refuses a mixed-gauge consist', () => {
    const { builder, fleet, inventory } = world();
    builder.placeStation(10, 30, 'narrow_depot', 0);
    const mk48 = inventory.add('mk48', 0);
    const box = inventory.add('boxcar', 0);
    const r = fleet.create([mk48.uid], [box.uid], []);
    expect(r).toMatch(/mix/i);
  });
});
```

(The cap test places the first depot for free, then checks with costs on: the regular cap of one is reached, the narrow cap is untouched. `modelDeployReason` runs before the gate check in `create`, so both refusals name the gauge.)

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/sim/narrowDepot.test.ts`
Expected: FAIL (`unknown station narrow_depot`).

- [ ] **Step 3: Station data and footprint**

`src/data/content.ts` `StationDef`: `/** narrow-gauge depot: deploys narrow trains only */ gauge?: Gauge;` and `/** 1×2 footprint along its axis (rot 0: x, rot 1: y) */ long?: boolean;`.

`src/data/stations.json`, after `depot`:

```json
{
  "id": "narrow_depot",
  "name": "Narrow Depot",
  "flavor": "Narrow-gauge engine shed. One track through. Builds and refuels narrow trains, which turn on 1×1 curves: for tight spaces, and the mines to come.",
  "cost": {},
  "tier": 0,
  "produces": [],
  "accepts": [
    "water",
    "wheat",
    "stone",
    "wood",
    "coal",
    "oil",
    "iron",
    "iron_ore",
    "crude",
    "diesel",
    "sand",
    "copper_ore",
    "wire",
    "food"
  ],
  "art": "depot_narrow",
  "long": true,
  "gauge": "narrow",
  "pool": true,
  "depot": true,
  "fuel": true,
  "water": true,
  "contracts": false
}
```

`src/sim/stations.ts`:

```ts
/** Tiles a station of this kind covers with its corner at (x, y). */
export function stationFootprint(defId: string, x: number, y: number, rot: number) {
  const def = stationDef(defId);
  const w = def.long ? (rot % 2 === 0 ? 2 : 1) : (def.size ?? 1);
  const h = def.long ? (rot % 2 === 0 ? 1 : 2) : (def.size ?? 1);
  const out: { x: number; y: number }[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: x + dx, y: y + dy });
  return out;
}
```

In `Station`: `get w() { return this.def.long ? (this.rot % 2 === 0 ? 2 : 1) : this.size; }`, `get h() { … 1 : 2 … }`; `footprint()` returns `stationFootprint(this.def.id, this.x, this.y, this.rot)`; `covers`, `cx`, `cy` and `distTo` use `w` along x and `h` along y. `gateTiles()` gains, before the size-2 depot branch:

```ts
if (this.def.long)
  return this.rot % 2 === 0
    ? [
        { x: this.x - 1, y: this.y },
        { x: this.x + 2, y: this.y },
      ]
    : [
        { x: this.x, y: this.y - 1 },
        { x: this.x, y: this.y + 2 },
      ];
```

`get platforms()`: `if (this.def.depot) return this.def.long ? 1 : 2;`.

- [ ] **Step 4: Builder, fleet and depot screen**

`src/sim/build.ts`:

```ts
depotsOf(gauge: Gauge) {
  return this.depots().filter((s) => (s.def.gauge ?? 'regular') === gauge);
}
```

`checkStation(x, y, defId, rot = 0)` loops `stationFootprint(defId, x, y, rot)` instead of the `size` square; the depot cap counts `this.depotsOf(def.gauge ?? 'regular').length`; `placeStation` passes `rot` to `checkStation`.

`src/sim/fleet.ts`: in `create` after building `locos` and `wagons`:

```ts
const gauge = consistGauge([...locos.map((l) => l.def), ...t.wagons.map((w) => w.def)]);
if (gauge === 'mixed') return STR.fleet.mixedGauge;
const depot =
  (depotId !== null ? this.builder.stationById(depotId) : undefined) ??
  this.builder.depotsOf(gauge ?? 'regular')[0];
if (!depot || !depot.def.depot)
  return gauge === 'narrow' ? STR.fleet.noNarrowDepot : STR.fleet.noDepot;
if ((depot.def.gauge ?? 'regular') !== (gauge ?? 'regular'))
  return STR.fleet.wrongDepot(depot.name);
```

(replacing the existing depot lookup). Do the same in `previewSpawn`. `modelDeployReason` returns `STR.fleet.wrongDepot(depot.name)` when `gaugeOf(def) !== (depot.def.gauge ?? 'regular')`. Strings: `fleet.wrongDepot: (name: string) => \`${name} builds only trains of its own gauge.\``, `fleet.noNarrowDepot: 'Build a narrow depot to roll out narrow trains.'`.

`src/ui/depot.ts`: compute `const gauge = consistGauge(this.locoUids.map((u) => locoDef(this.inventory.byUid(u)!.defId)))`; list `gauge && gauge !== 'mixed' ? this.builder.depotsOf(gauge) : this.builder.depots()`; when the current `depotId` is not in that list, set it to the list's first entry. Use the same list for the default depot in the locomotive column.

`src/ui/buildController.ts`: allow rotating when `def.long || (def.size ?? 1) > 1`; the placement preview uses `stationFootprint(defId, x, y, this.rot)`.

`src/game.ts`: in `onStationChanged`, before `if (s.size === 2)`:

```ts
if (s.def.long) {
  // anchored between its two tiles, sorted with the tile nearer the camera
  const front = s.rot % 2 === 0 ? { x: s.x + 1, y: s.y } : { x: s.x, y: s.y + 1 };
  const off = s.rot % 2 === 0 ? tileToWorld(-0.5, 0) : tileToWorld(0, -0.5);
  this.world.setStructure(id, front.x, front.y, `structures/${s.def.art}_r${s.rot % 2}`, 20, off.y, off.x);
} else if (s.size === 2) {
```

`fixBuiltTiles` uses `stationFootprint(s.defId, s.x, s.y, s.rot ?? 0)`. The age snapshot's `depots:` counts `this.builder.depotsOf('regular').length`.

- [ ] **Step 5: Depot art**

`src/art/structures.ts`, beside `depot2`:

```ts
/** One-track narrow-gauge shed on two tiles, centred between them; rot 0 runs along x. */
const NW = 120,
  NH = 104,
  NOX = 60,
  NOY = 78;
function narrowDepot(rot: number): PixelBuf {
  const b = new PixelBuf(NW, NH);
  const along = rot % 2 === 0;
  const P = (tx: number, ty: number, z = 0) => proj(NOX, NOY, tx, ty, z);
  // the narrow track runs out of both ends: rails at ±0.08 tile
  for (const off of [-0.08, 0.08])
    for (const seg of [
      [-1.0, -0.82],
      [0.82, 1.0],
    ]) {
      const a0 = along ? P(seg[0], off) : P(off, seg[0]);
      const a1 = along ? P(seg[1], off) : P(off, seg[1]);
      b.line(Math.round(a0.x), Math.round(a0.y), Math.round(a1.x), Math.round(a1.y), PAL.railLight);
      b.line(
        Math.round(a0.x),
        Math.round(a0.y) + 1,
        Math.round(a1.x),
        Math.round(a1.y) + 1,
        PAL.railDark,
      );
    }
  drawPrism(b, {
    ox: NOX,
    oy: NOY,
    cx: 0,
    cy: 0,
    angle: along ? 0 : Math.PI / 2,
    len: 1.7,
    wid: 0.62,
    h: 22,
    top: PAL.roofSlate,
    side: PAL.timber.map((c) => shade(c, 0.85)),
    ridge: 8,
    roof: PAL.roofSlate,
    seed: 23,
  });
  // one arched door on the visible end
  const door = along ? P(0.85, 0, 2) : P(0, 0.85, 2);
  b.rect(Math.round(door.x) - 4, Math.round(door.y) - 12, 8, 12, PAL.iron[0]);
  b.outline(PAL.outline, 190);
  return b;
}
```

and register `for (const r of [0, 1]) ab.add(\`structures/depot_narrow_r${r}\`, narrowDepot(r).toImageData(), NOX, NOY);` beside the depot frames. (`drawPrism`'s option names follow its call in `depot2`; keep them identical.)

- [ ] **Step 6: Run tests and checks**

Run: `npx vitest run src/sim/narrowDepot.test.ts` then `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/data src/sim/stations.ts src/sim/build.ts src/sim/fleet.ts src/ui/depot.ts src/ui/buildController.ts src/game.ts src/art/structures.ts src/strings.ts src/sim/narrowDepot.test.ts
git commit -m "Narrow depot: a 1x2 one-track shed with its own cap that builds narrow trains"
```

---

### Task 9: Saves and levels

**Files:**

- Modify: `src/sim/save.ts` (`SAVE_VERSION = 13`, migration from 12)
- Modify: `src/world/level.ts` (`trackFormat?: 2`), `src/editor/editor.ts` (write `trackFormat: 2`), `src/game.ts:436` (convert a level without it)
- Test: `src/sim/save.test.ts`

**Interfaces:**

- Produces: `convertOneTileRegular(track)`: maps `curve`/`switch` entries of class regular (or none) to `narrow`, exported from `src/sim/save.ts` for the level loader.

- [ ] **Step 1: Write the failing test** (append to `src/sim/save.test.ts`, using the file's existing helpers for a minimal v12 save; the test at line 225 shows the shape)

```ts
it('migrates 1x1 regular curves and switches to narrow', () => {
  const j = readSave(
    JSON.stringify({
      ...minimalSave(12),
      track: [
        [4, 8, 'curve', 1, 'regular'],
        [6, 8, 'switch', 5],
        [8, 8, 'straight', 1, 'regular'],
        [10, 8, 'curve', 0, 'high_speed'],
      ],
    }),
  );
  expect(j.version).toBe(13);
  expect(j.track).toEqual([
    [4, 8, 'curve', 1, 'narrow', undefined],
    [6, 8, 'switch', 5, 'narrow', undefined],
    [8, 8, 'straight', 1, 'regular', undefined],
    [10, 8, 'curve', 0, 'high_speed', undefined],
  ]);
});
```

(`minimalSave(version)` is the object literal the v11 bridge test at line 225 builds, moved into a helper at the top of the describe block so both tests share it.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/sim/save.test.ts -t "1x1 regular"`
Expected: FAIL (version 12, classes unchanged).

- [ ] **Step 3: Implement**

`src/sim/save.ts`:

```ts
export const SAVE_VERSION = 13;
/** Regular curves and switches were one tile until v13; one-tile track is narrow gauge now. */
export function convertOneTileRegular(track: SaveGame['track']): SaveGame['track'] {
  return track.map(([x, y, kind, rot, cls, cls2]) =>
    (kind === 'curve' || kind === 'switch') && (cls ?? 'regular') === 'regular'
      ? [x, y, kind, rot, 'narrow', cls2]
      : [x, y, kind, rot, cls, cls2],
  );
}
```

and the migration entry

```ts
{
  from: 12,
  note: 'regular curves and switches were one tile: they became narrow gauge; lines meeting them need re-laying with 2×2 pieces',
  run: (j) => (j.track = convertOneTileRegular(j.track)),
},
```

`src/world/level.ts`: `/** 2: regular curves and switches are 2×2 (missing: older levels with one-tile regular pieces) */ trackFormat?: 2;`. `src/editor/editor.ts`: set `l.trackFormat = 2` where `l.track` is written. `src/game.ts` before placing `level.track`: `const levelTrack = level.trackFormat === 2 ? level.track : convertOneTileRegular(level.track);` and loop over `levelTrack`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS (other save tests that assert `SAVE_VERSION` read it from the constant).

- [ ] **Step 5: Commit**

```bash
git add src/sim/save.ts src/sim/save.test.ts src/world/level.ts src/editor/editor.ts src/game.ts
git commit -m "Saves v13 and old levels: one-tile regular curves and switches become narrow"
```

---

### Task 10: Proof: renders, a playable save, the review page

**Files:**

- Create: `scratchpad/rails/yard/index.html`, `scratchpad/rails/yard.js` (scene), `scratchpad/rails/shots.mjs` (capture), `scratchpad/rails/demo-save.mjs` (writes the save)
- Create: `.claude/launch.json` entry in the asset workspace (`G:\DEV\Terepasztal\.claude\launch.json`) named `narrow`, `npm --prefix C:/Users/Zso/terepasztal-narrow run dev -- --port 5176 --strictPort --host 127.0.0.1`

- [ ] **Step 0: Dev server** (done first, Task 3 uses it)

Add the `narrow` entry to `G:\DEV\Terepasztal\.claude\launch.json` and start it with the preview tool.

- [ ] **Step 1: Scene**

Base `yard.js` on `scratchpad/curve-sizes/yard.js` from branch `spike/curve-sizes` (same world setup: `emptyMap`, `Game`, decor removed, fuel and power overrides on the test trains). Lay:

1. the catalogue: every item of `TRACK_ITEMS` in every rotation (`itemRotations` = `rotationCount(kind)`), one per 5×5 cell;
2. a regular 2×2 loop with a transition onto a high-speed stretch, a regular × high-speed crossing, both hands of switch;
3. the S-switch demo: a passing loop made of two `parallel` switches facing each other with two parallel straights between them, and the same switch with its parallel straight removed (turn form);
4. a narrow loop of 1×1 curves with a narrow depot on one side, a narrow switch into a siding, a narrow × regular crossing where the narrow loop crosses the regular loop;
5. trains: Black Five + hoppers round the regular loop, F7 through the S-switch passing loop on its diverging lane, a regular train over the narrow × regular crossing, Mk48 + mine tubs + narrow box round the narrow loop, Rocket + narrow coach out of the narrow depot.

- [ ] **Step 2: Capture**

`shots.mjs` (Playwright through `scratchpad/runtime.mjs`, `BASE_URL=http://127.0.0.1:5176`): the catalogue; one close-up per piece (both switch forms); follow-cam animations of each train (60–110 frames, `qa.step(9)` per frame, zoom 2.2); the S-switch snapping (one frame before the parallel straight is laid, one after, one after it is removed); the old save before and after conversion (render the v12 demo save in the `origin/main` dev server on 5174 and in this branch).

- [ ] **Step 3: Playable save**

`demo-save.mjs` loads the scene, calls `game.snapshot()`, and writes `G:\DEV\Terepasztal\saves\rail-system-demo.json` (load it in the game through Settings → Import save).

- [ ] **Step 4: Review page**

Build the page with the existing review template style (`scratchpad/curve-sizes/review`, published track page) and publish it as an Artifact: catalogue, every piece today vs now, the S-switch snapping, every train film, the narrow depot both ways round, the old-save conversion, the link to the save file.

- [ ] **Step 5: Run every check and push**

Run: `npm run typecheck && npm run lint && npm test && npm run build && npx prettier --check .`
Expected: all PASS. Then:

```bash
git add scratchpad/rails
git commit -m "Rail system: showcase scene, captures and demo save"
git push -u origin rails/narrow-gauge
```

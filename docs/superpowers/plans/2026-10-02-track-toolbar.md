# Track Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group the track pieces by type with hotkeys, call regular track wide, and add tools that upgrade wide track to high speed and downgrade it by dragging.

**Architecture:** Pure logic first, in modules that do not touch the DOM (`src/ui/trackGroups.ts` for types and slots, `src/world/reclass.ts` for the conversion plan), each with unit tests; then thin wiring in `Builder`, `Toolbar`, `BuildController` and `Game`, checked in the running game.

**Tech Stack:** TypeScript, Vitest, PixiJS (no new dependencies).

**Spec:** `docs/superpowers/specs/2026-10-02-track-toolbar-design.md`

## Global Constraints

- No runtime dependencies beyond PixiJS.
- The class id `regular` stays in code, data and saves; only what the player reads changes to "Wide".
- Type order: Narrow, Wide, High-speed, Bridges. Slots: 1 straight, 2 curve, 3 switch, 4 crossing of its own type, 5 the joining piece (Wide: transition; Narrow and High-speed: crossing with wide).
- Keys: 1 to 5 piece, Q and E type, Tab and Shift+Tab every piece, R turn, U upgrade tool, Shift+U downgrade tool.
- Upgrade charges per piece the difference new minus old, never less than nothing; downgrade is free and refunds nothing.
- A conversion never leaves wide and high-speed track meeting without a transition.
- Run typecheck, lint, tests, build and CI's prettier scope before every push.

## Review Focus

- A drag that reaches a crossing converts only the line it runs along (Task 5 test `converts only the line the stroke runs along`).
- A curve joined straight to another curve converts both rather than breaking the joint (Task 5 test `carries on through joined curves to the next straight`).
- Converting the piece beside an old transition leaves one transition, not two (Task 5 test `moves the transition along as the line is converted`).
- A piece the player cannot pay for changes nothing and spends nothing (Task 6 test `changes nothing when the upgrade cannot be paid for`).
- Q and E from a type whose slot the next type lacks (Bridges has two pieces) land on a piece that exists (Task 2 test `falls back to the first piece when the slot is missing`).

---

### Task 1: Wide track in everything the player reads

**Files:** Modify `src/strings.ts`, `src/sim/rules.ts` (tuning label), tests that quote the old words (`src/sim/compat.test.ts`). Test: `src/strings.test.ts` (new).

- [ ] **Step 1: Failing test** `src/strings.test.ts`: `STR.toolbar.trackClass.regular` is `'Wide'`; no player-facing string under `STR.toolbar`, `STR.compat`, `STR.build`, `STR.fleet` contains the word "regular" (case-insensitive); the tuning label for `lineSpeedRegular` says "Wide line speed"; `runsOn` of a wide wagon reads `Runs on wide and high-speed track`.
- [ ] **Step 2: Run** `npx vitest run src/strings.test.ts src/sim/compat.test.ts`. Expected: FAIL on the old words.
- [ ] **Step 3: Change the strings** and the tuning label; update the old expectations in `compat.test.ts`.
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `Names: regular track is wide track in everything the player reads`.

### Task 2: Types and slots

**Files:** Create `src/ui/trackGroups.ts`, `src/ui/trackGroups.test.ts`.

**Interfaces (Produces):**

- `type TrackGroupId = 'narrow' | 'regular' | 'high_speed' | 'bridges'`; `TRACK_GROUPS: TrackGroupId[]` in display order.
- `trackGroupOf(item: TrackItem): TrackGroupId` (a crossing or transition belongs to its rarer class: narrow over high speed over regular).
- `trackSlot(item: TrackItem): number` (0 straight, 1 curve, 2 switch, 3 own crossing, 4 joining piece).
- `shortName(item: TrackItem, base: string): string` (the button label inside its type: `Straight`, `Crossing`, `Crossing × Wide`, `Transition`).
- `stepGroup<T extends { group: string }>(groups: string[], current: string, dir: 1 | -1, has: (g: string) => boolean): string`.
- `slotMate<T>(items: T[], slot: number): T | undefined` (the item in that slot, else the first).

- [ ] **Step 1: Failing tests**: every `TRACK_ITEMS` entry has a type and a slot, no two items of a type share a slot, each of the three track types fills slots 0 to 4; `steps to the next type that has pieces, both ways, wrapping`; `falls back to the first piece when the slot is missing`; short names per the spec's table.
- [ ] **Step 2: Run** `npx vitest run src/ui/trackGroups.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `Track types: every piece has a type and a numbered slot`.

### Task 3: The toolbar's type row and its keys

**Files:** Modify `src/ui/toolbar.ts`, `src/ui/style.css`, `src/game.ts` (keys), `src/strings.ts` (hint, type names). Check: `scratchpad/rails/toolbar.mjs` (shots of each type).

**Interfaces:** `Toolbar.cycleGroup(dir: 1 | -1): boolean`; `ToolItem.group?: string`, `ToolItem.slot?: number`, `ToolItem.label?: string`; `Category.groups?: { id: string; label: string }[]`; `Toolbar.selectIndex(n)` picks within the open type when the category has types.

- [ ] **Step 1:** Give track items `group`, `slot`, `label`; bridges the type `bridges`. Render a row of type buttons above the items when the category has types; list only the open type's items; number keys count within it. Q and E call `cycleGroup`. `setActive` opens the type of the tool it is given. Remember the open type per category.
- [ ] **Step 2: Run** `npm run typecheck && npx vitest run`. Expected: PASS.
- [ ] **Step 3: Look at it** in the running game: each type open in turn, a piece kept across Q and E. Save the shots under `scratchpad/rails/out/`.
- [ ] **Step 4: Commit** `Toolbar: track pieces by type, 1-5 for the piece, Q and E for the type`.

### Task 4: A transition with four turns

**Files:** Modify `src/data/track.json` (`transition.rotations: 4`), `src/world/track.ts` (the fallback count), tests in `src/world/track.test.ts`, `src/art/frames.test.ts`.

- [ ] **Step 1: Failing tests**: `rotationCount('transition')` is 4; `pieceLinks('transition', 2)` is `[[S, N]]` and turn 3 `[[W, E]]`; `transitionRot(hsEnd: Dir)` returns the turn whose second link end is that direction; old saves' turns 0 and 1 mean what they meant.
- [ ] **Step 2: Run** `npx vitest run src/world/track.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** (`transitionRot` exported from `track.ts`).
- [ ] **Step 4: Run** the whole suite. Expected: PASS.
- [ ] **Step 5: Commit** `Transition: four turns, so its high-speed half can face either way`.

### Task 5: The conversion plan

**Files:** Create `src/world/reclass.ts`, `src/world/reclass.test.ts`.

**Interfaces:**

- Consumes: `TrackGraph`, `portClass`, `classesJoin`, `pieceLinks`, `TRACK_ITEMS`, `transitionRot`.
- Produces: `type WideClass = 'regular' | 'high_speed'`; `interface PieceChange { x; y; kind; rot; cls; cls2?; form? }` (anchor tile and the piece to lay there); `planReclass(track, seeds: { x; y }[], target: WideClass, from?: { x; y }): { changes: PieceChange[]; reason?: 'narrow' | 'nothing' | 'blocked' }`.

Rules, with O the other wide class than the target T:

1. Seeds name pieces by any of their tiles. A piece of class O is wanted. A transition is wanted too (it settles in rule 4). A crossing is wanted for the line the stroke runs along (`from` is the tile the stroke came from); without `from`, for every line of class O that has a neighbour of class T or a transition, else for every line of class O. A narrow piece, or a piece already T, is not wanted; when nothing is wanted the reason is `narrow` or `nothing`.
2. For every wanted curve, switch or crossing line: at each joint that is connected today to a piece not wanted that presents O there, a straight becomes a boundary piece; anything else is wanted too (a crossing for that line only). A crossing that cannot take the new class on that line (no such crossing piece exists) blocks the plan: no changes, reason `blocked`.
3. Wanted curves and switches become class T (a switch keeps its form). A crossing gets its lines' classes and the turn that carries them.
4. Every wanted or boundary straight or transition, and every old transition beside a changed piece, settles by the joints it has today: if it meets class O after the plan it is a transition, turned so its high-speed half faces the high-speed side; otherwise it is a straight of class T. One that meets neither O nor T is left alone.
5. Pieces that end as they were are not changes.

- [ ] **Step 1: Failing tests** in `src/world/reclass.test.ts`:
  - `turns a lone straight between wide track into a transition`, `turns a run into high speed with a transition at each end` (seeds one by one and all at once give the same line), `makes a dead-end run plain high speed`.
  - `moves the transition along as the line is converted`.
  - `turns the straight beside a converted curve into the transition`, `converts a 2×2 curve and a switch whole, keeping the switch's form`.
  - `carries on through joined curves to the next straight`.
  - `converts only the line the stroke runs along`, `picks the crossing turn that carries the classes`, `stops at a crossing with a narrow line` (the straight before it ends as a transition), `blocks a curve joined straight to such a crossing`.
  - `leaves narrow track alone and says why`, `has nothing to do on track already converted`.
  - `downgrades the same way round` (a high-speed run back to wide; the frontier transitions merge away).
  - `faces each transition's high-speed half to the high-speed side`.
  - After every plan is applied, no joint that was connected before is left with wide meeting high speed (a helper checks every connected-before joint).
- [ ] **Step 2: Run** `npx vitest run src/world/reclass.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `Reclass: a plan that converts track between wide and high speed and keeps it joined`.

### Task 6: The builder applies a plan

**Files:** Modify `src/sim/build.ts`, `src/strings.ts`. Test: `src/sim/reclass.test.ts` (new).

**Interfaces:** `Builder.checkReclass(tiles, target, from?): PlacementCheck & { changes: PieceChange[] }`; `Builder.reclassTrack(tiles, target, from?): boolean`. Cost: per change `max(0, pieceCost(new) - pieceCost(old))` per resource for an upgrade, nothing for a downgrade; no refund either way.

- [ ] **Step 1: Failing tests**: `charges the difference for an upgrade` (stockpile before and after), `downgrades for nothing and returns nothing`, `changes nothing when the upgrade cannot be paid for`, `keeps what stands on the track` (a signal and a bridge capacity survive), `tells the renderer about every changed tile`, `refuses narrow track with its reason`.
- [ ] **Step 2: Run** `npx vitest run src/sim/reclass.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the whole suite. Expected: PASS.
- [ ] **Step 5: Commit** `Builder: upgrade and downgrade track for the difference in cost`.

### Task 7: The Upgrade and Downgrade tools

**Files:** Modify `src/ui/toolbar.ts` (tool kind `reclass`, two buttons), `src/ui/buildController.ts` (hover highlight, press and drag, status line), `src/game.ts` (keys U and Shift+U), `src/strings.ts`, `src/ui/style.css`.

- [ ] **Step 1:** `Tool` gains `{ kind: 'reclass'; target: WideClass }`. The controller converts the piece under the cursor on press and every new tile entered while the button is held, passing the tile it came from; the status line shows the cost of the piece under the cursor or the reason nothing would change.
- [ ] **Step 2: Run** `npm run typecheck && npx vitest run`. Expected: PASS.
- [ ] **Step 3: Look at it** in the running game: drag an upgrade along a line with a curve, a switch and a crossing, then downgrade it; film both.
- [ ] **Step 4: Commit** `Tools: upgrade and downgrade track by dragging along it`.

### Task 8: Proof

- [ ] **Step 1:** Add the toolbar shots and the two films to the review page.
- [ ] **Step 2:** Run `npm run typecheck && npm run lint && npm test && npm run build` and CI's prettier scope. Expected: all pass.
- [ ] **Step 3:** Commit and push `ui/track-toolbar`.

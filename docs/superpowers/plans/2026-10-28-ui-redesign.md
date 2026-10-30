# HUD Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the HUD the user designed in the UI workshop into the game, one pull request at a time.

**Architecture:**

- The work is split into eleven PRs into `develop`. Each ships working software on its own and keeps the method names `src/game.ts` already calls on the panels, so `game.ts` changes only where a PR says so.
- Logic goes into pure modules with Node tests: ordering, locks, history, curation, follow, key maps. DOM goes into thin panel classes that render from them.
- Tooltips use the existing pure `TipDoc` path: `src/ui/tooltipDoc.ts`, `tooltipContent.ts`, and `renderTip` / `tipBuild` in `tooltipRender.ts`. Hover terms wire through `Tooltip.bindTerms`.
- This document details PR 1. Each later PR gets its own detailed plan, written when it starts, against the code as it is then. The roadmap fixes each PR's scope, interfaces and order.

**Tech Stack:** TypeScript, Vite, PixiJS v8, Vitest under Node with no DOM, plain DOM in `src/ui`.

**Spec:** `G:\DEV\Terepasztal\specs\2026-10-27-ui-edit-mode-design.md`, sections v2–v5. The mock is `G:\DEV\Terepasztal\specs\ui-workshop\ui-workshop.html` (https://claude.ai/artifact/VpBWTnjeh2NHC3XJDn4dW5). The user's saved layout is the artifact db `layouts/lwn17qbj`, "Jelenlegi játék · v2".

## Global Constraints

- **Dependencies:** no runtime dependencies beyond PixiJS (`CLAUDE.md`).
- **Strings:** every player-facing string lives in `src/strings.ts`; `src/ui/strings.test.ts`-style checks must keep passing. The UI is English by default; Hungarian comes in PR 9.
- **Build costs:** they are materials, never money.
- **Alerts:** curated. Stuck, out of fuel, no route, storage full, works short of input, contract at risk, junction congested. Never routine news such as "arrived".
- **Speeds:** pause, ½×, 1×, 2×, 3×. The game starts at 1×. Space pauses; + and − step the speed.
- **Build bar keys:** with no category open, 1–5 open Track, Buildings, Tools, Works, Decor, and X is Demolish. With a category open, 1–9 pick an item, Q / E step the type, Tab steps the items, R turns, Esc closes, and Shift+1–5 switches category.
- **Ages:** every age has an icon: steam, diesel drop, lightning, atom, magnet, tube ring. The upgrade tool is always an up arrow.
- **Track lines:** the approved track-lines plan wins over the mock. Branch, Main and Trunk join directly, with no transition piece, and the Narrow × Branch level crossing stays (`docs/superpowers/plans/2026-10-28-track-lines.md`).
- **Saves:** a new save field needs a `SAVE_VERSION` bump with a `MIGRATIONS` step (`CLAUDE.md`). Undo history is not saved.
- **Hit testing:** every new HUD root is a direct child of `#ui-root`, because `input.ts` hit-tests with `closest('#ui-root > *')`.
- **Gates and merging:** CI runs typecheck, lint, test, build and `npm run format:check` (which covers docs too). Merge only when the user says so.

## Review Focus

- **Full production chain:** the resource bar must show sand, iron ore, copper ore, wire, crude and diesel in their groups, and hide them in the simple chain. PR 1, Task 1 test `full-chain cargo stays off the bar in the simple chain`, plus the same test with the full chain set (the implementer finds how `inSupplyMode` is switched in its own test file and adds the full-chain case).
- **Stock before the age:** a resource with stock but whose age is still locked must stay on the bar, for example oil from a contract before the Diesel Age. PR 1, Task 1 test `stock shows a locked resource`.
- **Building links:** the links in a resource tooltip must name buildings the player can actually build in this production chain. PR 1, Task 1 test `makers follow the supply mode`.
- **Bar width:** at 1280×720 (`#app`'s minimum) the bar must not overflow. Groups stay on one row and the funds keep their place. PR 1, Task 2 step 4 checks it in the browser.
- **Undo after a save load:** undo after loading a save must do nothing, because history is per session. This is PR 4's test, and its plan must keep it.

---

## Roadmap (one PR each, in this order)

| PR  | Branch (issue number added when opened) | Scope                                                                                                                                                                                                                                      | Depends on                                 |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| 1   | `ui/<n>-resource-bar`                   | Resource bar order, groups, hidden-until-unlocked, `TipDoc` tooltips with building links; funds become the bar's first cell                                                                                                                | —                                          |
| 2   | `ui/<n>-date-speed-era`                 | Date and speed widget with pause, ½×, 1×, 2×, 3× and + / −; the era widget anchored left of it, with age icons and a goals tooltip from `ageStatus` (replaces `#age-card`); `AGE_ICONS`                                                    | —                                          |
| 3   | `ui/<n>-build-bar`                      | Category row at the bottom, type row with Q / E arrows, item tiles 1–9 with icon, name, cost, key and lock; the build info panel; locked items show age icon and unlock goals; new keymap (1–5 open categories, digits stop setting speed) | 2 (age icons, speed keys)                  |
| 4   | `ui/<n>-undo`                           | Command history around `Commands` for build, remove, reclass, rename, recolour, station level; materials refunded on undo; Ctrl+Z / Ctrl+Y; buttons right of the menus                                                                     | 3                                          |
| 5   | `ui/<n>-outliner`                       | Outliner with Trains, Stations, Contracts, Works tabs, an In view filter, colour groups, cargo icons, from → to; a train colour code and name in the save (version bump); follow camera; train panel with Overview, Orders, Consist        | 4 (rename and recolour go through history) |
| 6   | `ui/<n>-alerts`                         | Curated alert bar with four severities, map pins and click-to-cycle; notification settings per type (popup, pause, pin, toast)                                                                                                             | —                                          |
| 7   | `ui/<n>-station-panel`                  | Station panel with Overview, Cargo, Trains, Expansion and Timetable tabs, from what the sim has                                                                                                                                            | 5                                          |
| 8   | `ui/<n>-menu-bar`                       | Top bar menus Game, Fleet, Economy, View, Notifications in place of the screen buttons; a first grouping only, since the menu round may change it                                                                                          | 4, 6                                       |
| 9   | `ui/<n>-hungarian`                      | A Hungarian table that mirrors `STR`, a language setting, and EN / HU in the top bar; switching reloads the UI                                                                                                                             | 8                                          |
| 10  | `ui/<n>-hud-skin`                       | The workshop skin on every HUD panel (bevels, amber serif headings, wells) and positions from the saved layout                                                                                                                             | 1–8                                        |
| 11  | `art/<n>-resource-icons`                | Pack the ChatGPT icons into `icons.png` under the same keys                                                                                                                                                                                | the user's icons                           |

Not in this plan:

- Automatic crossings, which has its own session.
- The menu system round, the sounds round, events (the sim has none yet), and counties versus chunks, which is still open.

---

## PR 1: Resource bar

**Files:**

- Create: `src/ui/resourceOrder.ts`. The bar's groups, which resources show, and who makes and uses each one. Pure.
- Create: `src/ui/resourceOrder.test.ts`.
- Modify: `src/ui/tooltipContent.ts`, adding `resourceTip`, `buildingDefTip` and their snapshots.
- Modify: `src/ui/tooltipContent.test.ts`.
- Modify: `src/ui/resourceBar.ts`. Render the groups, drop `#res-card`, make each cell a `ttTerm`.
- Modify: `src/ui/panels.ts:366-370`. Pass `tooltip` to `ResourceBar`; `hud.funds` keeps only tickets and age.
- Modify: `src/game.ts:2327`. `resourceBar.update` also takes `money` and `tier`.
- Modify: `src/strings.ts`, `STR.res`: `madeBy`, `usedBy`, `takenAt`, `funds`, `fundsHint`.
- Modify: `src/ui/style.css`, section `/* ---- resource bar ---- */`: `.res-sep`.

### Task 1: The bar's order and locks, pure

**Interfaces:**

- Produces:
  - `RESOURCE_GROUPS: readonly (readonly string[])[]`
  - `barGroups(tier: number, has: (id: string) => number): string[][]`
  - `makersOf(id: string): BuildRef[]`
  - `usersOf(id: string): BuildRef[]`
  - `takenAt(id: string): BuildRef[]`
  - `interface BuildRef { kind: 'station' | 'building' | 'decor'; id: string; name: string; tier: number }`

- [ ] **Step 1: Write the failing tests** in `src/ui/resourceOrder.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { RESOURCE_GROUPS, barGroups, makersOf, usersOf, takenAt } from './resourceOrder';

describe('resource bar order', () => {
  it('funds first, then building, fuel and power, food, people', () => {
    expect(RESOURCE_GROUPS.map((g) => g[0])).toEqual([
      'money',
      'wood',
      'coal',
      'wheat',
      'passengers',
    ]);
    expect(RESOURCE_GROUPS[1]).toEqual([
      'wood',
      'stone',
      'sand',
      'iron_ore',
      'iron',
      'copper_ore',
      'wire',
    ]);
    expect(RESOURCE_GROUPS[2]).toEqual(['coal', 'water', 'crude', 'oil', 'diesel', 'power']);
    expect(RESOURCE_GROUPS[3]).toEqual(['wheat', 'food']);
    expect(RESOURCE_GROUPS[4]).toEqual(['passengers', 'population']);
  });
  it('a resource stays off the bar until something can make it', () => {
    const flat = barGroups(0, () => 0).flat();
    expect(flat).not.toContain('oil'); // Oil Refinery is tier 1
    expect(flat).not.toContain('power'); // Power Plant is tier 1
    expect(barGroups(1, () => 0).flat()).toEqual(expect.arrayContaining(['oil', 'power']));
  });
  it('stock shows a locked resource', () => {
    expect(barGroups(0, (id) => (id === 'oil' ? 5 : 0)).flat()).toContain('oil');
  });
  it('full-chain cargo stays off the bar in the simple chain', () => {
    // with the simple chain active, full-chain ids are never listed
    expect(barGroups(2, () => 0).flat()).not.toContain('iron_ore');
  });
  it('no empty group is left', () => {
    for (const g of barGroups(0, () => 0)) expect(g.length).toBeGreaterThan(0);
  });
  it('makers and users come from the content', () => {
    expect(makersOf('wheat').map((r) => r.id)).toContain('farm');
    expect(usersOf('wheat').map((r) => r.id)).toContain('windmill');
    expect(makersOf('power').map((r) => r.id)).toEqual(
      expect.arrayContaining(['power_plant', 'hydro_plant']),
    );
    expect(takenAt('water').map((r) => r.id)).toContain('water_tower');
    expect(takenAt('coal').map((r) => r.id)).toContain('fuel_stop');
  });
  it('makers follow the supply mode', () => {
    expect(makersOf('oil').every((r) => r.kind !== 'decor')).toBe(true);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/ui/resourceOrder.test.ts`
Expected: FAIL, `Cannot find module './resourceOrder'`.

- [ ] **Step 3: Implement `src/ui/resourceOrder.ts`**
  - **Groups:** `RESOURCE_GROUPS` exactly as the first test lists it.
  - **Which ids exist:** money, passengers and population always exist. A cargo id exists only if it is in `CARGO` and `inSupplyMode(def)` holds; power exists always.
  - **When a resource shows:** a resource shows when `has(id) > 0`, or when `makersOf(id)` has an entry with `tier <= tier`. Money, passengers and population always show.
  - **`makersOf`:** reads `STATION_DEFS[].produces[].cargo` and `BUILDING_DEFS[].recipe.out` (and `altIn`'s outputs, which are the same).
  - **`usersOf`:** reads `recipe.in` and `altIn`.
  - **`takenAt`:** reads `DECOR_DEFS` entries with a `radius` that hand that cargo to trains. Today that is `water_tower` for water and `fuel_stop` for coal. Read the key it uses (`water` / `fuel` on the def); do not hardcode the ids.
  - **Filtering:** every list skips entries whose supply mode is off (`inSupplyMode`).

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run src/ui/resourceOrder.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/resourceOrder.ts src/ui/resourceOrder.test.ts
git commit -m "UI: the resource bar's order, groups and unlocks as data"
```

### Task 2: Resource tooltips with building links, and the bar that uses them

**Interfaces:**

- Consumes: Task 1's `barGroups`, `makersOf`, `usersOf`, `takenAt`, `BuildRef`.
- Produces:
  - `resourceTip(s: ResourceSnapshot): TipDoc` and `buildingDefTip(ref: BuildRef, tier: number): TipDoc`, in `tooltipContent.ts`.
  - `interface ResourceSnapshot { id: string; have: number; cap: number; produced: number; consumed: number; tier: number }`. For money, `have` is the funds and `cap` is `Infinity`. For population, `produced` and `consumed` are births and food eaten.
  - `ResourceBar.update(stock: Stockpile, cap: (id: string) => number, money: number, tier: number)`.
  - `new ResourceBar(atlas, tooltip, onClick)`.

- [ ] **Step 1: Write the failing tests** in `src/ui/tooltipContent.test.ts`. Assert with `blockText` and `termsOf` from `tooltipDoc.ts`.

```ts
it('a resource tooltip names its stock, its week and links its buildings', () => {
  const doc = resourceTip({ id: 'wheat', have: 300, cap: 1000, produced: 6, consumed: 2, tier: 0 });
  const lines = doc.map(blockText);
  expect(lines[0]).toContain(cargoName('wheat'));
  expect(lines.some((l) => l.includes('300') && l.includes('1000'))).toBe(true);
  expect(lines.some((l) => l.startsWith(STR.res.madeBy))).toBe(true);
  expect(termsOf(doc).map((t) => t.term)).toEqual(
    expect.arrayContaining(['Farm Halt', 'Windmill']),
  );
});
it('a building tooltip from a resource says what it costs and when it unlocks', () => {
  const ref = makersOf('oil')[0];
  const lines = buildingDefTip(ref, 0).map(blockText);
  expect(lines.some((l) => l.includes(STR.build.tierLocked(1)))).toBe(true);
});
it('water and coal say where trains take them', () => {
  expect(
    resourceTip({ id: 'water', have: 0, cap: 0, produced: 0, consumed: 0, tier: 0 })
      .map(blockText)
      .some((l) => l.startsWith(STR.res.takenAt)),
  ).toBe(true);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/ui/tooltipContent.test.ts`
Expected: FAIL, `resourceTip is not a function`.

- [ ] **Step 3: Implement `resourceTip` and `buildingDefTip`** in `tooltipContent.ts`, in the file's style (`title`, `row`, `num`, `res`, `term`).
  - **`resourceTip`:**
    - The title is the resource with its icon.
    - Then three rows: have / cap, produced per day, consumed per day.
    - Then one row each for `STR.res.madeBy`, `STR.res.usedBy` and `STR.res.takenAt`, each a comma list of `term(name, () => buildingDefTip(ref, s.tier))`.
    - Last, `STR.res.info[id]` as text.
  - **`buildingDefTip`:** the name, the def's `flavor`, the cost with each resource as `res`, the recipe in → out when it has one, and `STR.build.tierLocked(ref.tier)` as `bad` when `ref.tier > tier`.
  - **Strings:** add to `STR.res`:
    - `madeBy: 'Made by'`
    - `usedBy: 'Used by'`
    - `takenAt: 'Trains take it at'`
    - `funds: 'Funds'`
    - `fundsHint: 'Earned by deliveries and contracts. Pays for engines and wagons.'`

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run src/ui/tooltipContent.test.ts`
Expected: PASS.

- [ ] **Step 5: Rebuild `ResourceBar` on these.**
  - **Layout:** the constructor creates a cell for every id in `RESOURCE_GROUPS.flat()`: the icon from `icons/<id>` plus the value. Cells sit in group wrappers, with a `.res-sep` between groups.
  - **Tooltips:** each cell is wrapped as `ttTerm(cell, tipBuild(atlas, () => resourceTip(snapshot)))`, and the constructor calls `tooltip.bindTerms(root)`.
  - **Updates:** `update` hides cells and groups not in `barGroups(tier, (id) => stock.get(id))`, writes values only when the text changed (as today), and keeps the red / good / amber classes.
  - **Funds:** the funds cell shows `fmtMoney(money)`.
  - **Removed:** `#res-card`, `showCard`, `hideCard` and `renderCard`.
  - **Callers:** in `panels.ts`, move funds out of `hud.funds`; tickets and age stay there until PR 2. In `game.ts:2327`, pass `this.economy.money` and `this.economy.tier`.

- [ ] **Step 6: Check it in the game.**
  - Run `npm run dev`. On a new game the bar reads: Funds | Wood Stone Iron | Coal Water | Wheat Food | Passengers Population. Oil and Power are absent.
  - Resting on Wheat opens the tooltip after 0.4 s. After 2 s it locks, and resting on "Windmill" opens that building's tooltip.
  - At a 1280×720 window the bar fits on one row.
  - Take a screenshot of the bar and of the nested tooltip for the PR.

- [ ] **Step 7: Run all gates**

Run: `npm run typecheck && npm run lint && npm test && npm run build && npm run format:check`
Expected: all pass. If `panels.test.ts` reads the old `ResourceBar` wiring as text, update it to the new constructor call.

- [ ] **Step 8: Commit, push, open the PR**

```bash
git add -A src
git commit -m "UI: resource bar in groups, funds first, tooltips link the buildings"
git push -u origin HEAD
gh pr create --base develop --title "UI: resource bar order, unlocks and building links" --body "<summary, screenshots, test list>"
```

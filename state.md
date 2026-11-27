# Supervisor state

Last updated: 2026-11-27 (cloud run 13:31Z).

## Lock

cloud run, started 2026-11-27 21:31Z

## Links

- Requests from the author: https://github.com/Szazso444/terepasztal/issues/707
- Triage report: https://github.com/Szazso444/terepasztal/issues/597
- Daily summary page: https://claude.ai/artifact/QrD1ENRm237JVRLuL1nEik

## In progress

- #606 Maglev: develop merged in and fixed by a World agent (2026-11-25, head `ebec5292`):
  conflicts resolved, `tools/building-kit.mjs` no longer counts a station that wears another's
  art as its own family, Hungarian names and strings added. `scope:cross` added (the PR body
  argues for it). Needs a render check (temporary art: guideway painted, set and depot borrowed).
- Fuel stack #690 -> #691 -> #692: develop merged in, `scope:cross` added (fuel buildings span
  art, rendering, uiux). Root cause of a broken fuel stop after develop's measured-model change:
  `Train.runOn` read the plan from the definition; it now reads it from the body spec (#690).
  Needs a render check of the painted fuel buildings; merge bottom first.

## For the local run

**Save version collision (2026-11-25 19:36Z run):** three open stacks each bump `SAVE_VERSION`
24 -> 25 with a `from: 24` step: track wear #647, fuel #692, landmarks #711. Whichever merges
first keeps v25; each later one must renumber to the next version (step `from` the previous one,
test renamed) before it merges. Track wear #647/#693 and fuel #690-#692 also carry QA approve
comments now; #691's criterion "hint names water, coal and diesel" was not found by QA: check by eye.

QA verdicts posted this run (all approve, render check still yours): #702 (develop merged in,
`d509b5d`), #690 #691 #692, #647 #693 (develop merged into both, `26d0016` / `ef26fdf`).
#685 now targets `art/653-nature-packed` (#683, develop merged in, check and scope green); its own
diff is 8 files, still with `src/world/mapgen.test.ts` (needs your `gate:approved`). After #683
merges, retarget #685 to develop.

Cloud run 2026-11-25 left these green on `check` and `scope` (or with `scope:cross` just added
and the check re-running): each needs only the render check before merging.

- Landmarks stack #708 -> #709 -> ... -> #718 (#627 and #628 merged; #708 now targets develop).
  Formatting fixed and carried up the stack. Saves go to v25 (#711): list under Bigger
  developments when it merges. #718 is a review scene of all twelve.
- Bridge stack #661 -> #662 -> ... -> #681: develop merged up the whole stack 2026-11-26 (one
  `src/game.ts` conflict at #664: kept develop's `groundAllowsOn` ground check plus the stack's
  `builder.busy`; see the comment on #664). Top `9096680` passes typecheck, lint, format and
  vitest (only the PIL environment tests fail in the cloud). Review renders at
  https://claude.ai/artifact/TvgwxsHMvu3hH826NLsQ46 predate the merge; the merge changes the
  build rule, not the look. Merge bottom first.
- Fuel stack #690 -> #692 and Maglev #606: see In progress.
- Weather/nature: #650 (trees sway) is the base of #652, #658, #659, #673 and #684; #683 (nature
  atlas) is the base of #685 (retargeted onto it 2026-11-25). `scope:cross` added to #650 #652
  #658 #659 #673 #684 (only wiring lines in `src/game.ts`).
- #702 night flicker: clean, green.
- People #694, #695: develop merged in, the old ageTooltip failure is gone (check re-running).
- Track wear #647 (`scope:cross` added) and #693 on it. #647's check went red after the 19:36Z
  develop merge (the measured F7 made one wear test's three-car train too long for its gap);
  fixed 21:31Z with the change #693 already carried (`00c09f2`), merged up into #693
  (`47291e6`). Both green on check (and #647 on scope) again.
- #697 Tunnels step 1: check green; scope fails only for `gate:approved` (it re-blesses
  `src/world/mapgen.test.ts` for tall mountains). The charter lets you add it; tall mountains
  are the point of the change.

- QA verdicts posted 2026-11-26 (all approve, render check yours): weather stack on #650 (covers
  #652 #658 #659 #673 #684), #694, #695 (merge with or before #694), #683, #606. The triage
  still says "QA: nincs verdikt a leírásban": verdicts are comments, not in the PR bodies. Decide
  whether the triage tool should read comments, or the cloud run should edit the bodies.

- First run: read the local memory index and every memory it names that bears on open work, check
  each "open" item below against GitHub, and rewrite "Unfinished themes" with what is really
  open.
- Confirm that a `gate:approved` label added with the machine's `gh` login passes the scope check
  (its event must have no `performed_via_github_app`). If it does not pass, record it under
  "Waits on the author".

## Waits on the author

Nothing yet.

## Direction questions

None yet. Format: question, what I chose meanwhile, date asked.

## Bigger developments (for the next summary)

- 2026-11-25: Hungarian names the Depot Pályaudvar and the Narrow Depot Keskeny pályaudvar (#705).
- 2026-11-25: AGENTS.md now says the game is English and Hungarian, with no gacha (#629).

## Unfinished themes

Seeded from the author's local memory index on 2026-11-24. These are notes, some weeks old:
verify each against GitHub before acting.

- Tunnels: step 1 #697 green but for `gate:approved` (mapgen goldens); see For the local run.
- Track lines: Maglev pull request #606 open; lines-fit-the-ground trial was uncommitted locally.
- Windmill and building life: stack #650 #652 #658 #659 #673, nature set #683 #684 #685 (all
  checks green 2026-11-25; render check and merge are the local run's).
- Fuel buildings: #690 #691 #692, merge in order (see In progress); narrow depot model waits on
  Codex.
- Bridges: stack #661 -> #681, all green 2026-11-25, waits on the local run's render check.
- Water chain: done; #648, #649, #651, #654, #660, #671, #678 merged (checked 2026-11-25).
- Rare landmarks (#529): #627 and #628 merged 2026-11-25; #708-#718 green, wait on the local run.
- People walkers: #694 and #695 green after a develop merge (2026-11-25); painted cycles wait on
  Codex.
- Resource modes (#306): all 17 tasks built on `gameplay/306-resource-modes`; final review and
  pull request were left. The branch is not on GitHub (checked 2026-11-25): local run, push it.
- Map view (Térkép): design approved, spec on local branch `rendering/terkep-spec`.
- UI redesign: open #629 gate label, Codex assets.
- Loco sprites: 7 locos pending; downloaded 3D models have leftovers.
- Ideas with no spec yet: track wear and maintenance trains, events (small, Stellaris-style
  choices, nothing very harmful).

## Author's decisions

Standing preferences as of 2026-11-24. The author's newer word in #707 overrides any of them.

- Replies to the author are in Hungarian. Repository documents stay in English.
- The game is no longer gacha; crafting replaced it. Tickets have no place in the balance.
- Trains follow model-railway logic, not prototype research.
- Models and pictures must be undistorted. Angles come from turning the 3D model; off-angle
  pictures are repainted, never stretched or bent. Where a portrait and the 3D model differ, the
  model is right.
- Track art uses true projection; fix drawing artifacts instead of evening the gauge on screen.
- Buildings are real-size 3D renders in the game, with no turning.
- Running gear: wheels turn, bogies stay attached, nothing splits off a body, no pulsing in turns.
- Track lines and train classes: Narrow Gauge, Branch, Main, Trunk Line, Maglev Guideway,
  Hyperloop Tube (`specs/track-classes.md`).
- Old saves are not a priority.
- Codex paints art in `G:\DEV\Terepasztal\terepasztal`; briefs for it live in `specs/codex-*`
  on the author's machine.
- When changes or decisions conflict, the newest wins.

## Ideas

None yet. Decided 2026-11-25 19:36Z: no new feature work while ~40 pull requests wait on a
render check; cloud runs clear the queue (QA, develop merges, conflicts) instead. Format: idea, why it fits, size, status.

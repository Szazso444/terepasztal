# Supervisor state

Last updated: 2026-11-25 (cloud run 13:38Z).

## Lock

none

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

Cloud run 2026-11-25 left these green on `check` and `scope` (or with `scope:cross` just added
and the check re-running): each needs only the render check before merging.

- Landmarks stack #708 -> #709 -> ... -> #718 (#627 and #628 merged; #708 now targets develop).
  Formatting fixed and carried up the stack. Saves go to v25 (#711): list under Bigger
  developments when it merges. #718 is a review scene of all twelve.
- Bridge stack #661 -> #662 -> ... -> #681: all `check` green, `clean`. Review renders exist at
  https://claude.ai/artifact/TvgwxsHMvu3hH826NLsQ46. Merge bottom first.
- Fuel stack #690 -> #692 and Maglev #606: see In progress.
- Weather/nature: #650 (trees sway) is the base of #652, #658, #659, #673 and #684; #683 (nature
  atlas) is the base of #685. `scope:cross` added to #650 #652 #658 #659 #673 #684 (only
  wiring lines in `src/game.ts`). #685 still fails scope (192 files of other roles): look first.
- #702 night flicker: clean, green.
- People #694, #695: develop merged in, the old ageTooltip failure is gone (check re-running).
- Track wear #647 (`scope:cross` added) and #693 on it (a timeout fix pushed for the six-train
  wear test).
- #697 Tunnels step 1: check green; scope fails only for `gate:approved` (it re-blesses
  `src/world/mapgen.test.ts` for tall mountains). The charter lets you add it; tall mountains
  are the point of the change.

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

None yet. Format: idea, why it fits, size, status.

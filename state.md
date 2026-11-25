# Supervisor state

Last updated: 2026-11-24 (seeded at setup; no run yet).

## Lock

cloud run, started 2026-11-25T13:38Z

## Links

- Requests from the author: https://github.com/Szazso444/terepasztal/issues/707
- Triage report: https://github.com/Szazso444/terepasztal/issues/597
- Daily summary page: https://claude.ai/artifact/QrD1ENRm237JVRLuL1nEik

## In progress

Nothing yet.

## For the local run

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

None yet.

## Unfinished themes

Seeded from the author's local memory index on 2026-11-24. These are notes, some weeks old:
verify each against GitHub before acting.

- Tunnels: step 1 pull request #697 open into `develop`.
- Track lines: Maglev pull request #606 open; lines-fit-the-ground trial was uncommitted locally.
- Windmill and building life: stack #650 #652 #658 #659 #673, nature set #683 #684 #685.
- Fuel buildings: #690 #691 #692, merge in order; narrow depot model waits on Codex.
- Bridges: stacked pull requests #661-#670 (heights, viaducts, narrow decks).
- Water chain: stacked pull requests #648-#678 (#678 merged; check the rest).
- Rare landmarks (#529): a 13-branch stack; pull requests waited on a force push of #627/#628.
- People walkers: #694 and #695; painted cycles wait on Codex.
- Resource modes (#306): all 17 tasks built on `gameplay/306-resource-modes`; final review and
  pull request were left.
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

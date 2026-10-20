# Core handoff, 2026-10-18

The previous Core session (session_01PhZXSrZ8qdradU8ZMK8kT3) ended here because its context was
large enough to make every turn expensive. This branch is an archive of its working state, not code
for `develop`. Read this file, then only the files a task needs.

## Standing rules (from the author)

- Core runs the organisation as AGENTS.md and the `/core` skill say. Only the author merges into
  `main`, adds `gate:approved` or deletes non-`claude/*` branches. Replies to the author are in
  Hungarian, in Absolute Mode (no filler, no offers, no closing questions). Use they/them for the
  author.
- The author works on G: (`G:\DEV\Terepasztal\terepasztal`). C: has no room: never give commands
  that clone, copy or fetch the repository onto C:. Prefer the GitHub web UI.
- **Token rules.** The goal is the best quality for the fewest tokens. Never spend tokens to buy
  speed.
  - Parallel tasks: up to four implementation tasks at a time, but only when they touch no file in
    common and the disk holds their worktrees (a worktree is 0.5 to 0.7 GB).
  - Models: Haiku for lightweight work (publishing a branch and opening its PR, labels, small doc
    or data edits, copying prompts). Sonnet for every other agent. Opus only for a fix round after
    a Sonnet round failed.
  - Verification agent only for save, traffic, track graph, mapgen, pathfinding or economy changes.
  - No new tasks on Core's own initiative while the board blocks.
  - Write precise briefs, so fix rounds are rare.
  - Resume a workflow with only its unfinished tasks. A resume re-runs every agent after the first
    changed call, so changing one task re-runs the others.
- **Board check every 8 hours.** The old trigger was bound to the old session and is disabled. The
  new session creates its own: `create_trigger` bound to itself, cron `20 */8 * * *`, the
  prompt in "Board check" below.

## Places

- **Decision board:** https://claude.ai/artifact/56upR6NofQVbEdh2g7zw7g
  - ArtifactData collections `decisions` and `answers`.
  - `if_version` is required on updates.
  - Card pictures go in `pictures: [{caption, img: <asset id>}]`.
  - Last answer processed: `answeredAt` 2026-10-17T19:17:54Z.
- **Codex prompts page:** https://claude.ai/artifact/EEr4ow3SevqTmnngUn4c5n, version 17 (page text v13, 2026-10-19; the width is a measurement, camera strict; one picture accepted: depot a0 r3 attempt 3, see codex-review-1019b.json).
  - Built by `handoff/codex-prompts-v9/build.py`, which writes `page.html`. Prompt texts are in
    `src/*.txt`.
  - The build reads `../codex-prompts-v7/page.html` and `../codex-review-1016/redo-prompts.md`,
    both archived here.
- **Demo:** https://claude.ai/artifact/4VZ9hkVryfLS2hpHAg94sb, version 11 (v9.2).
  - Sources are in `handoff/demo/src.v92-final`, with `build.sh`.
  - The picture assets of the old work dir are not archived. A new demo round rebuilds its
    workspace from develop's atlases.
- **Log:** `handoff/night-log.md`, the full log of the old session. Its tail has the latest state.
- **Delivery workflow:** `handoff/wave-continue.js` (impl, verify, QA, fix rounds, publish), with
  publish on Haiku. Its args are `{tasks:[{key, issue, role, slug, title, brief, verification,
  model, crossReason?, questionsOk?}]}`.
- **Gate before every merge:**
  1. A detached worktree of `origin/develop` in the scratchpad.
  2. Merge the PR head into it, and symlink `node_modules`.
  3. Run typecheck, lint, format:check, `vite build`, then
     `npx vitest run --maxWorkers=2 --reporter=dot` in the background with a timeout of 3600000.
     The full suite takes 13 to 22 minutes under load.
  4. Re-run alone any file a worker killed.
  5. Check the PR's CI, then merge with `expectedHeadSha`.
  6. Close the issue with labels `agent:<role>` and `type:task`.
  7. Remove the worktree.

## State on develop (head c232254 after PR #507)

Road bridges (option A) are complete:
- #494: a road on a bridge platform.
- #500: refreshBridges.
- #501: road tool and bulldozer.
- #504: road and rail decks merge.
- #505: walkers cross.
- #507: the road deck is drawn.

Also on develop: #497 (chimney pots and the crane's load as data), #490 (windmill guide), #491
(people pose guides).

Release PR #294 (develop to main) waits for the author's playtest.

The author should playtest:
- the road tool and the bulldozer on road bridges;
- the two new refusal strings;
- walkers crossing;
- a merged road and rail deck.

## Waiting on the author (board cards, open)

- **Blocking work:**
  - `two-tile-shape` and `two-tile-old-saves` block F1 and F2 (town hall, goods shed and farm halt
    on two tiles).
  - `wind-in-game` blocks W1 and the whole wind chain W2 to W4, W9 and W10.
  - `hills-mountain` blocks #499 (mountain ledges). #499 also needs the relief port #363.
  - `coaling-composite` blocks the coaling stage r1 and r3.
- **Core's default applies if unanswered:**
  - `windmill-views`: one view, reusing C17b's sails.
  - `passenger-variants`: backs.
  - `fuelpump-jib`: shorten.
  - `two-tile-others`: after the playtest.
  - `road-bridge-banks`: no bank check.
  - `road-bridge-deck-height`: straight bank to bank.
- **No default:**
  - `building-scale-pick`: the demo's four scale settings. The author was given the in-game sizes;
    see `handoff/demo/scale-table.md`. The "As before" setting is the game today.
  - `demo-v92`.

## Waiting on Codex (the author pastes the prompts)

- **Buildings lane:**
  1. R8d: Fuel Pump r2, then r3. Branch `art/325-fuel-pump`, issue #325.
  2. C17c: windmill body without sails, in the game camera. Branch `art/461-windmill-sails`,
     issue #461.
- **People lane:** R7c-1, the lumberjack walking away, repainted whole on pose guides. Branch
  `art/331-people`, issue #331.
- **When Codex reports:**
  1. Read its commits.
  2. Measure the pictures against the prompt's tests. `handoff/codex-review-1018.json` is the last
     review, for the format.
  3. Decide.
  4. Update the prompts page.
- **Later Art packing:**
  - Fuel Pump: r1 attempt 12 is accepted.
  - Coaling stage: r2 attempt 8 needs the camera finish.
  - C16 trees (#460).
  - Windmill (#461), after C17c.

## The plan

`handoff/plan-1017/ISSUES.md` and `ORDER.md` hold the remaining items F1 to F6, W1 to W10, S1/S2,
T1 to T3, P1 and M1, with blockers and order. Done items are noted in the log.

## Board check (prompt for the new 8-hour trigger)

> Board check (every 8 hours). Query the decision board's answers collection (ArtifactData query
> on https://claude.ai/artifact/56upR6NofQVbEdh2g7zw7g, collection answers, where answeredAt is
> later than the last answer already processed, per the session log), and list the open pull
> requests that carry the author's gate:approved label. For each new answer: settle its card,
> record the decision on the issues it names, and start or resume the work it unblocks, under the
> token rules. For a gate-approved pull request that is otherwise ready, merge it after the
> combined gate on today's develop. Log what you did, and tell the author in one short Hungarian
> message. If nothing is new, do nothing and say nothing.

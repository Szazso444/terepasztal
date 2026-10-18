# Order of work, 2026-10-17 evening

Rules used: at most **two implementation tasks at a time** (the disk has 2.4 G free: delete each worktree and its vite dir on merge, and
keep one gate worktree); never two Rendering tasks together (F3, W3, W4, W6, W7, W9, W10, S2, T2, B3, B4 and M1 all edit
`src/render/worldRenderer.ts` or the landscape painter); never two tasks that touch `src/game.ts` or `src/sim/save.ts` together
(game.ts lines: F3, W2, T3, W10; save.ts: F2 and W1); a shared contract lands first with the old behaviour kept (F1 before F2, B1 before
B2 to B4); no golden changes in an ordinary task (only S1, with the author's `gate:approved`). Verification gates each branch's head,
then QA, as in `deliver-issue.js`.

In flight already (counts as a slot until it merges): wf_d14e3ed4-ad8, the #325 block-out (optional `blockHeight` per family, `fuel_stop` own guides,
in `tools/building-guides.mjs` and `families.json`), and the demo v9.2 build (wf_e43194f9-e5d, a demo, no repository slot, but it uses disk).

## Ask the author first (so nothing starts on a guess)

Blocking: **Q1** (shape of "2 tiles"), **Q2** (old saves), **Q4** (wind: setting or weather). Not blocking, Core's recommendation applies if
unanswered: Q3 (other buildings after the playtest), Q5 (windmill turns in rotation 0 only), Q6 (passenger variants). Text in ISSUES.md.

## What can start now

| What | Who | Needs |
| --- | --- | --- |
| Paste **R8c** on the Codex page | Codex, buildings lane | nothing |
| **A1 part A**: people pose guides, identity crops, tool and test | Art | nothing |
| **W8**: chimney pots and the crane load as data | Art | nothing (a slot) |
| **B1**: a road may go on a bridge platform | Gameplay | nothing (a slot) |
| **B5**: road-top bridge surfaces | Art | nothing (a slot) |
| **M1**: mountain level steps on the right-hand faces | Rendering | nothing (a slot) |
| **F1**: a station def can span two tiles | Gameplay | Q1, Q2 |
| **W1**: wind state and settings | Gameplay | Q4 |

Only two of the slot items run at once; the next table says which.

## The sequence

Codex lanes run beside it (buildings lane: R8c now, then C17c, then C4d; people lane: R7c-1, then the rest).

| Step | Slot 1 | Slot 2 | Starts when | Then unlocks |
| --- | --- | --- | --- | --- |
| 0 | #325 block-out (in flight) | **A1 part A** people guides (Art) | now | R7c-1 can be pasted when A1-A merges; C4d text when the block-out merges |
| 1 | **A1 part B** windmill guides (Art) | **F1** (Gameplay, Verification tests) | block-out merged (part B edits the same tool and `families.json`); Q1, Q2 answered | C17c pasteable; F2 |
| 2 | **F3** Rendering, with the game.ts branch (scope:cross) | **F2** (Gameplay): data flip, v21 migration, load repair | F1 merged. F3 and F2 can run together: F3 reads `Station.w/h`, F2 changes the data; `save.ts` and `game.ts` are not shared | F4 |
| 3 | **F4** Art: regenerate ground data, turned views | **W1** Gameplay: wind and settings fields | F2 and F3 merged (F4); Q4 (W1). `save.ts` is free again | W2, W3, W4, W6 |
| 4 | **W2** UI/UX settings rows (+ a game.ts line) | **F5** Verification: drawn base fits footprint | W1 merged; F2 to F4 merged | |
| 5 | **W3** trees sway (Rendering) | **W8** Art chimney data (if not done) | W1, W2 merged | |
| 6 | **W4** desert (Rendering) | **T1** Gameplay town borders | W1, W2; F2 | T2 |
| 7 | **W9** smoke and crane (Rendering) | **B2** Gameplay walkers cross | W8; **v9.2 published** (smoke numbers); B1 merged (B2) | |
| 8 | **T2** border drawing (Rendering) | **B5** Art road surfaces (if not done earlier as a filler) | T1 | T3 |
| 9 | **B3** bridge layout (Rendering) | **T3** UI/UX hover and click (+ game.ts line) | B1; T2 | B4 |
| 10 | **B4** road deck mesh (Rendering) | **B6** UI/UX road tool on bridges | B3, B5; B1 | |
| 11 | **M1** mountain steps (Rendering) | spare (a Verification sweep, or X-held items) | | |

Items outside the sequence because something else must arrive first:

| Item | Waits for | Then |
| --- | --- | --- |
| **W10** windmill sails turn (Rendering, game.ts line) | Codex C17c delivered and reviewed; Art packs the new body and the cross (follow-up Art task in #461); W1, W2; Q5 | slot after step 7 |
| **P1** people's fixed walk (#323) | Codex R7c done through the trial and the needed strips; Art packs the people atlas (#331, #304); the Rendering work then starts | a slot after the pack; R7c-2 to -6 can still be arriving |
| **W5, W6, W7** waves and swash (Rendering) | the moving-water slice of #365 (Core carves it out), W1, W2 | three Rendering slots in a row; W5 first. #365 itself is blocked by #343, #355, #356, #363, so this is the longest tail |
| **S1, S2** swamp coast | the author's `gate:approved` for the mapgen goldens (S1); W3 (S2's sway); a UI/UX strings task | S1 alone in a slot (World), S2 after it |
| **F6** other buildings | the author's playtest of F1 to F5 (Q3) | filed after |
| **X1** storm and fog, **X2** building scale, **X3** | the author sees v9.2 and decides | filed after |

## Where the author can playtest

- **Playtest 1 (after step 4):** two-tile town hall, goods shed and farm halt (F1 to F5), the wind setting (W1, W2). Old and new games, one old save with the
  three buildings placed beside houses.
- **Playtest 2 (after step 7):** trees, desert, chimneys and the crane (W3, W4, W9), then town borders (T1 to T3) after step 9.
- **Playtest 3:** road bridges (step 10), mountain steps (M1), the windmill (W10) and walking people (P1) as soon as Codex's pictures are packed, then the waves
  and the swamp, which are the longest.

"Every task on develop" is therefore a series of three or four merges of the author's play, not one; the Codex-dependent items (windmill, people,
coaling stage) arrive on Codex's clock, not on the slots'.

## Per-task notes for the delegating session

- Brief each task from its issue; give each only its context pack (the files named under "Today"), the task brief and what its role file gives.
- F2, W1 (the `Settings` fields), W2, T3, F3 and W10 carry a `src/game.ts` line or a shared file: label `scope:cross`, state the line count in the
  brief, and check the scope with `node tools/agents/scope.mjs check --role <role>` before the pull request.
- Verification tests are needed on F1, F2, F5, W1, W3 (the pure lean), W4, W5, W7, W8, W9, W10, S1, T1, B1 to B3, P1. Not needed: W2, W6 (browser QA),
  W9's visuals, F4, B4 to B6, M1, S2, T2, T3.
- Sizes are estimates against the 400-line cap. Likely to need a split in flight: W6 (about 400), S1 (about 400, split off `PropKind` first), F2
  (about 350 with the migration tests). A1 is two pull requests by design.
- After each merge: delete the task's worktree and its vite dir; regenerate the scope map only if a role's paths changed (none do).

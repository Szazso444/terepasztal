---
name: core
description: Run terepasztal's delivery loop as Core, the orchestrator. Use when the session is asked to build, fix or change something in the game (not to answer a question): it clarifies with the author, splits the work into role-sized GitHub issues, delegates to the role subagents in parallel worktrees, gates every result with QA, Verification and CI, and merges into develop.
---

# Core: the delivery loop

You are Core (`AGENTS.md`, `.claude/agents/core.md`). The lifecycle and its gates are
`docs/process/lifecycle.md`; the brief and report formats are `docs/process/context.md`. This is
the order to run them in a Claude Code session.

## 1. Intake

- Read the request, `CORE.md` (decisions and open risks) and the spec it touches.
- List what is ambiguous or contradictory. If anything is, ask the author now with
  AskUserQuestion: options, consequences, your recommendation first. Do this even when much
  depends on it; do not start work around an open question.
- A feature that changes what the player sees needs a spec the author approved
  (`docs/superpowers/specs/`). Write it, ask, wait.

## 2. Plan

- For anything beyond a single obvious task, start the `core` subagent to produce the plan, so
  the main context keeps only the result: the tasks with filled briefs, the dependency graph and
  the cross-role seams.
- Check each task against the definition of ready (lifecycle step 3). Split any task that needs
  two roles at the seam.
- File each task as an issue (Task template fields, labels `type:task`, `agent:<role>`,
  `status:ready`), as a sub-issue of the epic when there is one. Record `Blocked by #n`.

## 3. Implement in parallel

- For every ready task whose blockers are merged, create its branch `<role>/<issue>-<slug>` from
  `origin/develop` and start the role's subagent with `isolation: "worktree"`, all independent
  tasks in one message. The prompt is the task brief and nothing else.
- Hosted sessions that cannot push other branches create them with the GitHub API
  (`create_branch` from `develop`) and push the worktree's files with `push_files`, or use the
  session's own branch for a single task.
- Label the issue `status:in-progress`.

## 4. Gate

For each result report, in this order (different tasks' gates run in parallel):

1. `verification` with the brief and the branch, when the task requires it; it adds its tests to
   the branch;
2. `qa` with the brief and the branch, on the head commit including those tests.

Do not accept "tests pass" from the implementer; QA's re-run and CI are the evidence.

## 5. Fix loop

- `changes`: send the findings and the files they cite to a fresh agent of the same role, on the
  same branch. At most three rounds.
- After the third round, or when the failure reproduces on `develop` or lies outside the task:
  file a Bug issue (reproduction, log excerpt, seed, expected/actual, acceptance criteria), label
  the task `status:blocked`, carry on with the other tasks.

## 6. Pull request and merge

- Open the pull request into `develop` from `.github/pull_request_template.md`: `Closes #n`,
  label `agent:<role>`, the QA verdict, the verification evidence. `scope:cross` only with a
  written reason.
- Merge when CI is green on the head commit, QA approved that commit, required tests exist and
  pass, and nothing waits on the author. Merge commit titled `Merge <branch>: <outcome>`; delete
  the branch.
- A red `develop` comes first: revert the breaking merge with a revert pull request, or fix it in
  this session.

## 7. Close the loop

- Tell the author what merged, what is blocked and what needs their decision, in a few lines.
- Releases (`develop` → `main`) are prepared as a pull request and left for the author to merge.
- Keep `CORE.md` true: new decisions in its decision log, new risks in its risks.

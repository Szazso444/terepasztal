# Development lifecycle

How a request becomes merged code. The organisation is nine roles (see `AGENTS.md`); this file is
the order they work in, the gate each step must pass and what happens when one fails. Every role
reads the section for its own step, not the whole file.

## Branches

| Branch | Purpose | Who writes | Who merges into it |
| --- | --- | --- | --- |
| `main` | released game | nobody directly | the author, from `develop` |
| `develop` | integration; every task lands here first and is validated here | nobody directly | Core, through a pull request |
| `<role>/<issue>-<slug>` | one task, one role, one pull request | the role's agent | — |

- A task branch starts from the current `develop` and lives in its own git worktree under
  `.claude/worktrees/<role>-<issue>-<slug>` (ignored by git), so parallel tasks never share a
  working copy: `git worktree add -b <role>/<issue>-<slug> .claude/worktrees/<role>-<issue>-<slug> origin/develop`.
- An agent is bound to its role, never to a branch. The same role can run several tasks at once,
  each on its own branch and worktree. No branch is kept per role.
- Hosted sessions that can push only one assigned branch (`claude/...`) still follow the model:
  the pull request carries the `agent:<role>` label and `Closes #<issue>`, which is what the
  scope check and the merge gate read.
- A merged task branch is deleted. Work that never merged is not deleted: it is tagged
  `archive/<branch>` and recorded in `docs/archived-work.md` (see `.github/ref-archive.json`).

## States

An issue carries exactly one `status:` label. Core moves it.

`status:triage` → `status:ready` → `status:in-progress` → `status:in-review` → closed by the merge,
with `status:blocked` reachable from any of them. `needs:decision` is added whenever the next step
waits on the author.

## Steps and gates

### 1. Intake (Core)

Core reads the request and classifies it: question, task, bug or epic.

Gate: the request is unambiguous and consistent with `AGENTS.md`, the spec it touches and earlier
decisions in `CORE.md`. Anything unclear or contradictory goes to the author as a question,
however much depends on it, with the options and a recommendation. Core never resolves a product
decision by guessing. The issue waits with `needs:decision`.

### 2. Spec (Core, for an epic or anything that changes what the player sees)

Core writes or updates a spec in `docs/superpowers/specs/<date>-<topic>-design.md`: goal, non-goals,
acceptance criteria in testable form, the roles it touches, open questions.

Gate: the author approved the spec. A task or bug inside an existing spec skips this step.

### 3. Decompose (Core)

Core splits the work into tasks and files each as an issue from the Task template, as a sub-issue
of the epic.

A task is ready when:

- exactly one role owns every file it changes (`tools/agents/ownership.json`); work that crosses
  roles is split at the seam, and the dependent task is marked `Blocked by #n`;
- it fits one pull request a reviewer can hold in their head (aim for under 400 changed lines);
- its acceptance criteria are checkable by a command or a test, not by opinion;
- its context pack names the files and docs the agent needs, and nothing else;
- it says whether the Verification role must add tests (mandatory for pathfinding, collisions and
  separation, track geometry, traffic sections, save migrations, RNG and map generation, economy
  sums and rigid bodies).

Tasks without open `Blocked by` links run in parallel. Core labels them `status:ready`.

### 4. Implement (domain role)

The agent gets the task brief (`docs/process/context.md`) and nothing else. It works in its own
worktree on `<role>/<issue>-<slug>`, changes only files its role owns or is granted, adds the tests
its own change needs and runs the local gate:

```
npm run typecheck && npm run lint && npm test && npx vite build \
  && npx prettier --check "src/**/*.{ts,json,css}" index.html \
  && node tools/agents/scope.mjs check --role <role> --base origin/develop
```

It returns the result report (`docs/process/context.md`). It stops and reports instead of
guessing when the brief is ambiguous, when the change needs a file another role owns, or when a
golden test (map generation hashes, art frame counts) fails.

### 5. Verify (QA and Verification, in parallel)

- **QA** reviews the diff against the issue's acceptance criteria, `AGENTS.md`'s rules and the
  role's scope. It runs the gate itself; a report that says "tests pass" is a claim, not evidence.
  It never edits. It returns a verdict: `approve` or `changes` with findings, each with
  `file:line`, the concrete failure and the expected behaviour.
- **Verification** adds or runs the deterministic tests the task requires (`docs/process/verification.md`).
  A property that fails is a finding with its seed and the smallest failing case.

Nothing a role reports is accepted on its own word. Only the verdicts and a green gate move a task.

### 6. Fix loop (Core)

Findings go back to the owning role as a new brief that holds the findings and the files they
cite, not the earlier conversation. At most three rounds. After the third, or at once when the
failure reproduces on `develop` or lies outside the task's scope, Core files a Bug issue with the
log, the reproduction command, the seed where there is one, expected and actual behaviour and
acceptance criteria, labels the task `status:blocked`, and goes on with independent tasks.

### 7. Pull request (Core)

Core opens the pull request into `develop` from the template, with `Closes #<issue>`, the
`agent:<role>` label, the QA verdict and the verification evidence. CI runs typecheck, lint, tests,
build, formatting and the scope check (`.github/workflows/scope.yml`). A pull request that needs to
cross roles carries `scope:cross`, which only Core sets and which the description has to justify.

### 8. Merge into `develop` (Core)

Core merges when all of these hold:

- CI is green on the head commit;
- the QA verdict on the head commit is `approve`;
- Verification's tests exist and pass, where the task required them;
- no open question and no `needs:decision` label.

Merge with a merge commit titled `Merge <branch>: <one-line outcome>` (the existing history's
style), then delete the branch. A red `develop` is the top priority: Core reverts the merge that
broke it (a revert pull request, never a force push) or lands a fix within the same session.

### 9. Release into `main` (the author)

Core prepares a release pull request `develop` → `main`: version, `CHANGELOG.md` entry, the issues
it closes and anything the author should play-test. The author reviews, plays and merges. Only the
author merges into `main`.

### 10. Audit (Core)

After each release, and whenever the author asks, Core refreshes `CORE.md`: state of the game, open
risks, test gaps, the branch and issue inventory, and what the last cycle cost in fix rounds and
reverts. Audit findings stay in `CORE.md` until the author approves them; only approved ones become
issues.

## Commits

One logical change per commit. The subject is `Area: outcome` in plain words (`Pathfinding: ties
break toward the straight leg`), no conventional-commit prefixes, matching the history. The body
says why when the diff does not.

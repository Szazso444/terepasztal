# Development lifecycle

How a request becomes merged code. The organisation is nine roles (see `AGENTS.md`); this file is
the order they work in, the gate each step must pass and what happens when one fails. Every role
reads the section for its own step, not the whole file.

## Branches

| Branch                  | Purpose                                                        | Who writes       | Who merges into it           |
| ----------------------- | -------------------------------------------------------------- | ---------------- | ---------------------------- |
| `main`                  | released game                                                  | nobody directly  | the author, from `develop`   |
| `develop`               | integration; every task lands here first and is validated here | nobody directly  | Core, through a pull request |
| `<role>/<issue>-<slug>` | one task, one role, one pull request                           | the role's agent | —                            |

- A task branch starts from the current `develop` and lives in its own git worktree under
  `.claude/worktrees/<role>-<issue>-<slug>` (ignored by git), so parallel tasks never share a
  working copy: `git worktree add -b <role>/<issue>-<slug> .claude/worktrees/<role>-<issue>-<slug> origin/develop`.
  A worktree there resolves the repository's `node_modules`, so the gate runs without a fresh
  install unless the task changes `package.json`.
- An agent that finishes with a branch commits and then runs `git switch --detach`, so the next
  agent (Verification, QA, a fix round) can check the branch out in its own worktree.
- An agent is bound to its role, never to a branch. The same role can run several tasks at once,
  each on its own branch and worktree. No branch is kept per role.
- Hosted sessions that can push only one assigned branch (`claude/...`) still follow the model:
  the pull request carries the `agent:<role>` label and `Closes #<issue>`, which is what the
  scope check and the merge gate read. When Core recreates a task branch through the GitHub API
  (`create_branch`, `push_files`), the pushed commit has a new hash, so before opening the pull
  request it checks that its tree equals the tree QA approved (`git rev-parse <sha>^{tree}`).
- A merged task branch is deleted. Work that never merged is not deleted: it is tagged
  `archive/<branch>` and recorded in `docs/archived-work.md` (see `.github/ref-archive.json`).

## States

An issue carries exactly one `status:` label. Core moves it.

`status:triage` → `status:ready` → `status:in-progress` → `status:in-review` → closed by Core after the merge,
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
golden test (map generation hashes) fails.

### 5. Verify (Verification, then QA)

- **Verification**, when the task requires it, adds the deterministic tests the task needs to the
  task branch (`docs/process/verification.md`), in test files of the task's own role. A shared
  helper in `src/testing/` is its own Verification task, merged first. A property that fails is a
  finding with its seed and the smallest failing case, and goes to the fix loop before QA.
- **QA** then reviews the head of the branch, tests included, against the issue's acceptance
  criteria, `AGENTS.md`'s rules and the role's scope. It runs the gate itself; a report that says
  "tests pass" is a claim, not evidence. It never edits. It returns a verdict: `approve` or
  `changes` with findings, each with `file:line`, the concrete failure and the expected
  behaviour.

Nothing a role reports is accepted on its own word. Only the verdicts and a green gate move a task.
Independent tasks are verified in parallel with each other.

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

**Gate files** are the ones that decide what passes or what agents may do: `AGENTS.md`, `CLAUDE.md`,
`.claude/**`, `.codex/**`, `.mcp.json`, `.github/**`, `tools/agents/**`, the dependency and tool
configs and the map generation goldens (the `gate` list in `tools/agents/ownership.json`). A pull
request that changes one needs the `gate:approved` label, added by the author in person after
review; a new push removes the label. The scope check reads the label's history and does not
count it when a GitHub App added it, which is how hosted agent sessions act. A label added with
the author's own credentials (the `gh` login, a personal token) cannot be told from the author's
own, so a local agent using them must never touch the label: the check cannot stop it. The check runs from
`main`'s copy of the workflow and the scripts (GitHub takes `pull_request_target` workflows from
the default branch), so a pull request cannot change the check that judges it, and a change to
the gate takes effect only once it is released into `main`.

### 8. Merge into `develop` (Core)

Core merges when all of these hold:

- CI is green on the head commit, the scope check included (so gate files carry the author's
  `gate:approved`);
- the QA verdict is `approve` on the head commit, or on a commit with the identical tree;
- Verification's tests exist and pass, where the task required them;
- every note for Core has been read and accepted, sent back as a finding, or turned into a
  question for the author;
- no question for the author is open and no `needs:decision` label is set.

Merge with a merge commit titled `Merge <branch>: <one-line outcome>` (the existing history's
style), then delete the branch, close the issue and remove its `status:` label. GitHub acts on
`Closes #n` only for pull requests into the default branch (`main`), so a merge into `develop`
links the issue but does not close it. A red `develop` is the top priority: Core reverts the merge that
broke it (a revert pull request, never a force push) or lands a fix within the same session.

### 9. Release into `main` (Core prepares, the author merges)

Core prepares a release pull request `develop` → `main`: the version, the `CHANGELOG.md` entry, the
issues it closes, the tag it names and the result of every check below. Only the author merges
into `main`. The author's actions are to merge and to decide; no part of a release is handed to
the author to run.

**Version.** The version is `vMAJOR.MINOR.PATCH` and higher than the newest row of the table in
`CHANGELOG.md`, which is its last row (v0.8.0 today). While MAJOR is 0, MINOR is for a release that
adds or changes anything the player sees or raises `SAVE_VERSION`, and PATCH is for a release of
fixes only. Core proposes the number in the release pull request and the author's merge accepts it.
`package.json` `version` is a placeholder that nothing reads and is not part of a release.

**Changelog.** The release pull request renames `## Unreleased` in `CHANGELOG.md` to `## vX.Y.Z`
(the style of `## v0.8.0`) and adds the version's row at the bottom of the table. A release pull
request without both is not ready.

**Checks.** Each task pull request carries a "For the author" section. Core collects that section's
items from the release's merged pull requests into one list of checks, and an agent runs each one
before the release pull request is ready: QA by command or test, Core in the running game
(`npm run dev`) through the browser tools of its session. The release pull request lists every
check with its result:

- pass;
- fail, as a finding that goes to the fix loop (step 6);
- unverified, with the reason.

Evidence is given by path, never pasted. Nothing is put to the author as a check to run. A check no
agent can run is not handed over: Core asks only whether to release without it, as one question
with a recommendation.

**Tag.** The tag `vX.Y.Z` is on the release pull request's merge commit in `main` (its
`merge_commit_sha`), not on whatever `main`'s tip is by then. Core creates it right after the
author's merge, through the GitHub API or a tag push, never a push to `main`. The author's only
action is the merge. The release pull request description names the tag. A tag is never moved or
reused.

### 10. Audit (Core)

After each release, Core first checks the tag: `git ls-remote --tags origin vX.Y.Z` returns a ref,
and `git rev-parse vX.Y.Z^{commit}` (after `git fetch origin tag vX.Y.Z`) is the release pull
request's merge commit. Core creates a missing tag itself as in step 9 and tells the author only if
its credentials cannot. A tag that stands on another commit is not moved: Core puts it to the
author as a decision, with the options and a recommendation.

After each release, and whenever the author asks, Core refreshes `CORE.md`: state of the game, open
risks, test gaps, the branch and issue inventory, and what the last cycle cost in fix rounds and
reverts. Audit findings stay in `CORE.md` until the author approves them; only approved ones become
issues.

## Commits

One logical change per commit. The subject is `Area: outcome` in plain words (`Pathfinding: ties
break toward the straight leg`), no conventional-commit prefixes, matching the history. The body
says why when the diff does not.

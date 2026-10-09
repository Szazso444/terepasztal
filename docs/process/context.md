# Context and handoffs

An agent works best on the smallest context that holds everything its task needs. Every extra
document is a chance to follow a rule that belongs to another domain, to mix two tasks or to
invent a connection that is not in the code. This file says what each agent is given and what it
hands back.

## What an agent reads

| Reader | Always | Only when the brief names it | Never |
| --- | --- | --- | --- |
| Core | `AGENTS.md`, `CORE.md`, `docs/process/*`, the issue tree | specs, plans, any file | — |
| A domain role | `AGENTS.md`, its own `.claude/agents/<role>.md`, the task brief | files in its context pack, a spec section | `CORE.md`, other roles' agent files, other tasks, the chat that produced the brief |
| QA | `AGENTS.md`, `.claude/agents/qa.md`, the brief, the diff | the role file of the role under review | the implementer's reasoning beyond its report |
| Verification | `AGENTS.md`, `.claude/agents/verification.md`, `docs/process/verification.md`, the brief | the module under test and its seams | the implementer's reasoning beyond its report |

Long histories (`CHANGELOG.md`, `MILESTONES.md`, `docs/phase-decisions.md`, `docs/archived-work.md`)
are in no default pack. A brief cites the section it needs.

Rules for whoever writes a brief:

- Name paths, not "the relevant files". If the agent has to search for its context, the brief is
  not ready.
- Give each task a fresh agent. Never carry one task's conversation into the next.
- A fix-loop brief holds the findings and the files they cite, not the earlier attempt's
  reasoning.
- Outputs are summaries with paths. Logs are cut to the failing part and the command that made
  them. Images and other large artifacts stay in the repository and are referred to by path.

## Task brief (Core → role)

```
Issue: #<n> <title>
Role: <role>
Branch: <role>/<n>-<slug> from origin/develop, worktree .claude/worktrees/<role>-<n>-<slug>
Goal: <one or two sentences: the outcome, not the steps>
Acceptance criteria:
  - <checkable by a command or a test>
Context pack:
  - <path>[:lines] — <why it matters>
Seams it must not break:
  - <symbol in path> — <who depends on it>
Verification required: yes (<which properties>) | no
Blocked by: #<n> (merged) | none
Out of scope: <what to leave alone even if it looks wrong; report it instead>
```

## Result report (role → Core)

```
Issue: #<n>
Branch / commit: <branch> @ <sha>
Outcome: done | partial | blocked
Changed: <path> — <one line each>
Gate: typecheck <ok|fail> · lint <ok|fail> · test <passed/total> · build <ok|fail> · prettier <ok|fail> · scope <ok|fail>
Tests added: <file — invariant it pins>
Questions for the author: <product or rule decisions only the author can make; these stop the task>
Notes for Core: <choices made inside the brief that Core should confirm; these do not stop it>
Found out of scope: <problems noticed in files the role does not own>
```

## QA verdict (QA → Core)

```
Issue: #<n> at <sha>
Verdict: approve | changes
Gate re-run: <the commands and their results, run by QA>
Findings:
  - <file:line> · <blocking | nit> · <what breaks, with the input that breaks it> · <expected>
Acceptance criteria: <each one: met | not met, with evidence>
Scope: <ok | files outside the role's scope>
```

## Verification report (Verification → Core)

```
Issue: #<n> at <sha>
Properties checked: <property — test file — seeds or cases run — pass|fail>
Failures: <seed, smallest failing case, expected, actual>
Gaps left: <properties not covered and why>
```

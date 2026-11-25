---
name: steward
description: Repository conventions for driving a terepasztal pull request to mergeable — branch targets, merge style, who may merge, how CI and review findings are handled. Read before acting on CI or review events on a pull request in this repository.
---

# Steward: pull requests in terepasztal

- **Targets.** Task pull requests go into `develop`. Only release pull requests go from `develop`
  into `main`, and only the author merges those.
- **Who merges into develop.** Core, after CI is green on the head commit, the QA verdict on that
  commit is `approve`, required verification tests exist and pass, and no `needs:decision` label
  is open (`docs/process/lifecycle.md` step 8).
- **Merge style.** A merge commit titled `Merge <branch>: <one-line outcome>`, then delete the
  branch. No squash, no rebase of a branch someone else is working on, no force push.
- **Scope check red.** The change touches a path its role does not own
  (`node tools/agents/scope.mjs check --role <role>`). Split the change by owner; `scope:cross`
  is for a reason written in the description, set by Core only.
- **Scope check red on gate files.** The change touches a gate file and the author has not
  added `gate:approved` in person. Ask the author; never add the label, and do not try to route
  around it. A push withdraws the approval, so push before asking, not after.
- **Ownership test red** (`tools/agents/ownership.test.mjs`). A new file has no owner or two:
  add it to exactly one role in `tools/agents/ownership.json`. An agent file's `## Scope` must list
  exactly its role's patterns.
- **Golden test red** (map generation hashes). A question for the author, never
  a number to update in the pull request.
- **Review findings.** Fixes go to the owning role through Core, as a new brief with the findings.
  A finding outside the change becomes an issue, not a widening of the pull request.
- **Persistent failure.** After three fix rounds, or a failure that reproduces on `develop`, file
  a Bug issue with the log and acceptance criteria and stop pushing to the pull request.

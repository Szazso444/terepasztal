@AGENTS.md

## Claude Code

Everything above is shared with every agent tool. This part is how Claude Code runs the
organisation.

- **The main session is Core** when it is given work to deliver rather than a question to answer.
  The `/core` skill (`.claude/skills/core/SKILL.md`) is its playbook: intake, ask the author when
  anything is unclear, split into issues, delegate, gate, merge into `develop`.
- **Roles are subagents.** Each file in `.claude/agents/` is one role. Start a role with the Agent
  tool and `subagent_type: "<role>"`; give it the task brief from `docs/process/context.md` and
  nothing else. Implementing roles run with `isolation: "worktree"` so parallel tasks never share
  a working copy. Independent tasks start in the same message so they run in parallel.
- **Subagents do not delegate.** Only the main session starts agents. A subagent that needs work
  from another role reports it, and Core decides.
- **A repeatable delivery** can run as the saved workflow `.claude/workflows/deliver-issue.js`
  where the Workflow tool is available: plan, implement in worktrees, QA and Verification in
  parallel, fix loop, report.
- **Hosted sessions** that may push only their assigned `claude/...` branch use it as the task
  branch and label the pull request `agent:<role>`; Core creates other branches through the
  GitHub API.
- The `SessionStart` hook (`.claude/hooks/session-start.sh`) installs dependencies in hosted
  sessions so the gate can run straight away.

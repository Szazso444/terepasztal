# Launcher prompt

Paste this into Codex (one conversation). Everything else is read from the queue.

```
You are the orchestrator of the Terepasztal art queue. G:/DEV/Terepasztal/terepasztal is read-only for you (it has uncommitted work): never edit or switch anything there, and never write to C:.
1. git -C G:/DEV/Terepasztal/terepasztal fetch -q origin claude/codex-queue
2. Make the ledger worktree: git -C G:/DEV/Terepasztal/terepasztal worktree add -b claude/codex-queue G:/DEV/wt/codex-queue origin/claude/codex-queue (if it already exists: fetch there and git merge --ff-only origin/claude/codex-queue).
3. Read G:/DEV/wt/codex-queue/codex-queue/README.md and queue.json in full, and follow them.
4. Run every group with status "ready" as its own sub-agent, in parallel, each in its own git worktree on G: (never in the main checkout); the prompts of a group run in order. If you cannot run sub-agents in parallel, run the groups one by one as the README says.
5. Honour every stop condition in the prompts: a stop halts only that group. Never force-push, never delete branches.
6. After each prompt the sub-agent appends its result to codex-queue/status/<group>.md and pushes it (see the README, "Ledger").
7. When all groups are done or stopped, write and push codex-queue/status/SUMMARY.md and report the summary to me here.
```

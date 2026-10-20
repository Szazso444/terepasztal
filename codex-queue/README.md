# Codex art queue: orchestrator instructions

You are the ORCHESTRATOR. This folder is a queue of art prompts, one folder of prompts per group. Your job: run every READY group as its own sub-agent, in parallel, keep a ledger of what each prompt produced, and write a summary at the end. You paint nothing yourself.

Read first: `codex-queue/queue.json` (the groups, their lane branches, status and the ordered prompt files) and this file. The prompt text is in `codex-queue/prompts/<id>.md`. Each prompt file starts with a short block, QUEUE RULES FOR THIS PROMPT, then the prompt as the author wrote it. The block wins where it disagrees with the prompt below it.

## Hard rules (the orchestrator and every sub-agent)

1. NEVER work in the main checkout `G:/DEV/Terepasztal/terepasztal`. It has uncommitted work that must not be touched: no edits, no `git switch`, `git checkout`, `git stash`, `git reset`, `git clean`, no commits there. Do not touch the other existing worktrees either (`G:/DEV/Terepasztal/*`, `C:/Users/Zso/.codex/worktrees/*`, `.claude/worktrees/*`), even where one of them has a lane branch checked out.
2. NEVER write to C: (it is full). No `~/.codex/worktrees`, no scratch or temp folders on C:, no npm cache on C:. Everything you create goes under `G:/DEV/wt/`. If a tool wants a temp folder, point it at `G:/DEV/wt/codex-tmp/<group>/` (set TEMP and TMP for the command). If the image tool saves its result somewhere on C: by itself, copy the bytes to the prompt's `raw/` folder on G: and leave the original alone.
3. NEVER force-push, never delete a branch (local or remote), never push to `main` or `develop`, never open a pull request, never rewrite a commit that is already pushed.
4. Two groups never share a lane branch. Each sub-agent commits to its own lane branch only. (C33b, the Later prompt, is on the Rotations lane `art/535-rotations`; it is NOT to run. See "Later".)
5. One writer per lane. Only the group's own sub-agent pushes to its lane, and only its own commits.

## Setup (orchestrator, once)

Run the git commands from any worktree of the repository (the ledger worktree is fine); `git fetch` and `git worktree add` only change `.git` metadata, never the main checkout's files.

```
git -C G:/DEV/wt/codex-queue fetch -q origin
```

Ledger worktree (you create it, see the launcher): `G:/DEV/wt/codex-queue`, from `origin/claude/codex-queue`, local branch `claude/codex-queue`. The ledger is `codex-queue/status/` in it.

For each READY group in `queue.json`, one at a time (not in parallel, git locks its metadata), create its worktree:

```
git -C G:/DEV/wt/codex-queue worktree add -b codex-<group> G:/DEV/wt/codex-<group> origin/<laneBranch>
```

- `<group>` and `<laneBranch>` come from `queue.json` (`worktree`, `localBranch`, `laneBranch`).
- The local branch is named `codex-<group>`, NOT the lane's name: the lane branches are already checked out in other worktrees and git refuses a second checkout of the same branch. The sub-agent pushes with `git push origin HEAD:<laneBranch>`, so the commits still land on the lane branch.
- If `G:/DEV/wt/codex-<group>` or the branch `codex-<group>` already exists (an earlier run), do not delete or reset it. Check that it is clean and that `git log origin/<laneBranch>..HEAD` shows only its own commits, then reuse it with `git fetch origin <laneBranch>` and `git merge --ff-only origin/<laneBranch>`. If it is not clean or has diverged, that group does not start: write the reason in its ledger and go on with the others.
- Only a group with status `ready` gets a worktree. A group with status `later` gets nothing.

If a prompt needs `node_modules` (some run `node tools/...`), the sub-agent runs `npm ci` inside its own worktree with `npm_config_cache=G:/DEV/wt/_npmcache`. Never on C:.

## Running the groups

Start one sub-agent per READY group, all at the same time. Give each sub-agent exactly: its group id, its worktree path, its local branch, its lane branch, the ordered list of prompt files (read from `queue.json`), and the section "Sub-agent duties" below. It reads each prompt file and does what the prompt says, with the QUEUE RULES block at the top applied.

- Prompts WITHIN a group run in order, one after the other. The next prompt starts only after the previous one has finished and its ledger entry is written and pushed. (Windmill: C17d needs C17c's commit.)
- Groups run side by side. A stop in one group never stops another.
- Every prompt has its own stop conditions ("stop and say so", "then STOP", a hash that differs, a merge conflict, a tool that refuses). They are honoured. When one fires, that group halts at that prompt: the sub-agent does what the prompt says to keep (commit and push what it says), writes the ledger entry with the stop reason, and reports. It does NOT start the group's next prompt. The other groups go on. Do not retry a stopped group on your own and do not work around a stop.
- Several prompts say "stop after r0" (C29a, C35a): that is their normal end, not an error. Stage 2 is a separate prompt that does not exist yet; do not invent it.
- If you cannot start sub-agents in parallel, run the groups yourself one after another in the order of `queue.json`, with the same worktree and ledger rules. Say so in the summary.
- If the prompt, a tool or a check contradicts these rules in a way you cannot resolve (for example a prompt that cannot be followed from a worktree), do not guess: stop that group, write the ledger entry, and say what the conflict is.

## Sub-agent duties

1. Work in `G:/DEV/wt/codex-<group>` only. `cd` there for every command (or use `git -C`); never rely on the starting directory, which may be the main checkout.
2. Per prompt: read `codex-queue/prompts/<id>.md` from the ledger worktree `G:/DEV/wt/codex-queue` (read it, do not copy it into the lane). Do what it says. Commit to the lane (the prompt gives the subjects, "Art: <outcome>"), then push: `git fetch origin <lane>`, `git rebase origin/<lane>` (only your own unpushed commits get replayed), `git push origin HEAD:<lane>`. If the push is refused, fetch, rebase and push again. Never force.
3. Git safety: fetch before every push; rebase only your own commits; never reset or amend pushed commits; never delete branches; never touch files outside the folders the prompt names.
4. Ledger, after EACH prompt (done or stopped), see below.

## Ledger

Each group has `codex-queue/status/<group>.md` on the branch `claude/codex-queue`. The sub-agent appends one entry per prompt (create the file with the heading `# <group>` the first time). It is what Core reads, so it must be factual and complete:

```
## <prompt id> (<UTC date and time>)
- Result: done | stopped
- Lane commit: <sha pushed to origin/<lane>, or "none">
- Views accepted: <view>: <path in the lane> (attempt <k>; the numbers that decided it) ...   (or "none")
- Refused attempts: <view> attempt <k>: <why, with the number that failed> ...                (or "none")
- Stop reason: <the prompt's stop condition that fired, in the prompt's words, or "none">
- Notes: <anything the prompt asked to report that is not above; things you could not do as written>
```

Write it in the ledger worktree `G:/DEV/wt/codex-queue` and commit ONLY that file, then push:

```
git -C G:/DEV/wt/codex-queue add codex-queue/status/<group>.md
git -C G:/DEV/wt/codex-queue commit -m "Ledger: <group> <prompt id> <done|stopped>" -- codex-queue/status/<group>.md
git -C G:/DEV/wt/codex-queue fetch -q origin claude/codex-queue
git -C G:/DEV/wt/codex-queue rebase origin/claude/codex-queue
git -C G:/DEV/wt/codex-queue push origin HEAD:claude/codex-queue
```

The ledger worktree is shared by the sub-agents; if git reports an `index.lock`, wait a few seconds and retry. Each sub-agent writes only its own `<group>.md`, so rebases never conflict. Never touch another group's file. No force-push.

## Summary (orchestrator, at the end)

When every READY group has finished or stopped, write `codex-queue/status/SUMMARY.md`: a table with one row per prompt (group, prompt id, result, lane commit, views accepted, refused attempts, stop reason), then a short list of what Core or the author must decide next (stopped groups and why, anything that could not be done as written, whether sub-agents really ran in parallel), then commit and push it the same way as a ledger entry (`Ledger: summary`). Finally report the summary to the author in the conversation.

## Later (NOT to run)

`C33b` (biome variants of the House) is in `queue.json` under the group `later`. It belongs to the Rotations lane (`art/535-rotations`) and waits for the author to accept C33a's r1, r3 and r2. Do not run it, do not create a worktree for it. The two stage 2 prompts (hydro plant, narrow depot) are not written yet.

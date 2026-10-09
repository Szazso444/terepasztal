# Local workspace

Where the repository lives on the author's machine, how to move it, and why it is heavy.

## Layout

| Path                                  | What it is                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `G:\DEV\Terepasztal\terepasztal`      | the main clone (after the move below)                                                                               |
| `G:\DEV\Terepasztal\worktrees\<name>` | extra worktrees, e.g. the former `terepasztal-local`                                                                |
| `G:\DEV\Terepasztal`                  | the asset workspace: the locomotive spreadsheet (`locomotive-wheels-bogies (v9).xlsx`), Blender and ComfyUI outputs |
| `<clone>\.claude\worktrees`           | agent worktrees, created and removed by Claude Code; ignored by git                                                 |

Nothing that matters lives only on `C:` once the move is done.

## Moving from `C:` to `G:`

The clone at `C:\Users\Zso\terepasztal` has worktrees beside it (`terepasztal-local`,
`terepasztal-narrow`, `terepasztal-main`). Work not in git (the hand-built pipeline under
`tools\asset-pipeline\handbuilt\`, renders, `assets_out\`) moves with the folders. Run in
PowerShell, with every editor, Claude Code and Codex session on these folders closed:

```powershell
# 1. See what is not in git yet, in each worktree, before anything moves.
git -C C:\Users\Zso\terepasztal worktree list
git -C C:\Users\Zso\terepasztal-local status --short --ignored

# 2. Move the main clone, then each worktree (robocopy keeps timestamps; /MOVE deletes the source
#    only after a successful copy).
robocopy C:\Users\Zso\terepasztal G:\DEV\Terepasztal\terepasztal /E /MOVE /R:1 /W:1
robocopy C:\Users\Zso\terepasztal-local G:\DEV\Terepasztal\worktrees\local /E /MOVE /R:1 /W:1

# 3. Tell git where everything went.
cd G:\DEV\Terepasztal\terepasztal
git worktree repair G:\DEV\Terepasztal\worktrees\local
git worktree prune
git worktree list

# 4. Dependencies and hooks; keep npm's cache off C: as well.
npm config set cache G:\DEV\.npm-cache
npm ci
git config core.hooksPath .githooks
```

Then open `G:\DEV\Terepasztal\terepasztal` in Claude Code and Codex instead of the old folder.

Paths that still point at `C:` after the move:

- **Blender** in `tools/asset-pipeline/pipeline.toml` (`blender = ...`): an absolute install path.
  Leave it if Blender stays installed on `C:`.
- **Old scratch scripts** (`scratchpad/rails/reshoot0.mjs`, `scratchpad/terrain-production/capture.mjs`).
- **Recorded prompts** under `assets/source/*/prompt.json`: history only, never read.

## Why the repository is heavy

`.git` holds about 830 MB, most of it the history of 582 tracked images (source studies, atlases and
before/after evidence under `scratchpad/`, about 146 MB). Rewriting history to drop them would break
every existing clone and archive tag, so it is not done. Git LFS would move future images off the
main history but costs GitHub LFS storage and bandwidth and changes every contributor's setup; not
adopted for now.

What keeps a machine light instead is a partial clone, which downloads history without old file
contents and fetches a file's old versions only when something asks for them:

```powershell
git clone --filter=blob:none https://github.com/Szazso444/terepasztal.git G:\DEV\Terepasztal\terepasztal-lite
```

Use it for a fresh machine or a second clone. For the move above it is not needed: moving keeps the
local branches and stashes that a fresh clone would not have.

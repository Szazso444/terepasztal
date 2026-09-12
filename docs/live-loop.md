# The live loop

Speak a prompt, watch the change land in the running game, no branch and no pull request.

## The one decision that makes it work

**Run Claude Code on your own machine, in the repo folder.** Two of your three requirements come
from that single change:

- **Voice needs a local microphone.** Claude Code's dictation does not work in Claude Code on the
  web or over SSH — the microphone is on your machine and the session is not. The session that
  wrote this file was remote, which is exactly why it produced a branch and a pull request.
- **A local session edits your working tree.** There is nothing to push and nothing to review
  before you see the result; the file changes under the dev server that is already running.

The remote setup is still worth keeping for long unattended jobs. It is the wrong shape for
talking at a running game.

## Setup

1. Clone the repo on the Windows machine and `npm install`.
2. Run `claude` from the repo root.
3. `/login` with a **Claude.ai account**. Dictation is unavailable when Claude Code is configured
   with an Anthropic API key directly, or through Bedrock, Google Cloud or Foundry.
4. `/voice` turns it on in hold mode (hold `Space`, talk, release). `/voice tap` taps once to
   start and again to send. Make it stick in your user settings instead of typing it each time:

   ```json
   { "voice": { "enabled": true, "mode": "tap" } }
   ```

   Add `"autoSubmit": true` to send on release in hold mode, for transcripts of three words or more.

5. Windows microphone permission: **Settings → Privacy & security → Microphone**, on for desktop
   apps, then `/voice` again.

**Dictation language.** Hungarian is not on the supported list, and an unsupported `language`
setting falls back to English for dictation — `/voice` warns you when you enable it. Claude's
written replies are unaffected. Dictate in English, or check the current list before setting it.

## Three terminals

```
npm run dev         # the game, http://localhost:5173
npm run test:watch  # vitest, re-running on every save
claude              # the conversation
```

## What happens on every edit

**The game survives the reload.** Vite full-reloads the page when a source file changes, which
would otherwise throw away the world you were looking at. `src/engine/devsession.ts` snapshots the
running game to `sessionStorage` just before the reload and applies it on the way back, so a
one-line change to a train rule lands where you were standing instead of costing you a new game.
Seed, clock time, speed and mode all carry over; the snapshot goes through the normal migration
chain, so an edit that changes the save format is handled like any other save.

It never touches the real save in `localStorage`, and the snapshot dies with the tab.

**Type errors reach the browser.** `vite-plugin-checker` runs tsc against the dev server and shows
failures as an overlay and in the dev terminal within a couple of seconds, instead of at the next
`npm run build`. Without it a type error just silently fails to apply and the loop stalls on a
change that never took.

**Tests re-run.** The suite is about a second, so `test:watch` is effectively instant feedback on
the simulation.

## What does not carry over

- **The main menu and the level editor.** The snapshot is only taken in play mode with no menu
  open, so a reload from the menu boots normally rather than dropping you into a game.
- **Anything not in the save.** Open screens, selections, hover state and notices are rebuilt.
- **A manual refresh.** Only Vite's own reload is hooked. F5 is still a cold boot, on purpose.

## Letting Claude see the result

The `chrome-devtools` MCP server in `.mcp.json` drives a real Chrome against the dev server, so
Claude can take a screenshot, read the console, and record a performance trace after making a
change. Ask for it directly — _"screenshot localhost:5173 and tell me what the top bar says"_ —
rather than describing what you see.

`docs/mcp-setup.md` covers the setup, and the Blender and Unity servers alongside it.

## What replaces the pull request

Nothing about dropping the PR cycle removes the need for the checks; it moves them earlier.

- `npm run test:watch` in its own terminal is the review that runs on every save.
- The type overlay in the browser is the second one.
- **Commit locally, often.** Git is the undo buffer that made a PR feel safe. `git add -A && git
commit` after anything that works costs nothing and gives you somewhere to go back to when a
  spoken instruction turns out to have been ambiguous.
- Push when you want the CI workflow to run it properly. `main` still gets the gate; your working
  session does not have to wait for it.

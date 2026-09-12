# Blender MCP and Unity MCP

Two local MCP servers, wired into both Claude Code and Codex.

- **MCP for Blender** (`ahujasid/blender-mcp`, PyPI `blender-mcp`) — a Blender addon opens a socket
  server inside Blender on `localhost:9876`; the MCP server `uvx blender-mcp` talks to it over that
  socket. Use it to model, texture and render the sprite sources for `public/assets`.
- **MCP for Unity** (`CoplayDev/unity-mcp`) — a Unity Editor package plus a Python server
  (`mcpforunityserver`, entry point `mcp-for-unity`). Default transport is HTTP on
  `http://127.0.0.1:8080/mcp`; stdio is available for clients that need it.

Both servers run on your machine, next to Blender and Unity. Nothing in this repository runs them;
`.mcp.json` at the repo root only tells Claude Code where to find them, and the Codex config lives
in your home directory.

---

## 0. Prerequisites

| | |
|---|---|
| `uv` | Install with the official installer only, **not** `pip install uv`. Windows: `powershell -c "irm https://astral.sh/uv/install.ps1 \| iex"` |
| Python | 3.10+ (uv can supply it) |
| Blender | 3.0 or newer |
| Unity | 2021.3 LTS through 6.x |
| Git | on `PATH`, if you install the Unity package by git URL |

Restart (fully quit, not just close the window) any client after changing `PATH`.

---

## 1. MCP for Blender

### 1.1 Install the Blender addon

```bash
uvx blender-mcp install-addon
```

Then in Blender: **Edit → Preferences → Add-ons** → enable **Interface: MCP for Blender**.
(Manual fallback: download `addon.py` from the repo and use **Install…** in that same panel.)

### 1.2 Register the server

**Claude Code** — already configured for this repository by `.mcp.json`. Open Claude Code in the
repo root, approve the project servers when prompted, and check with `/mcp`. For a machine-wide
registration instead:

```bash
claude mcp add blender uvx blender-mcp
```

**Codex** — the CLI, desktop app and IDE extension share `~/.codex/config.toml`, so one
registration covers all three:

```bash
codex mcp add blender -- uvx blender-mcp
```

Or by hand in `~/.codex/config.toml` (`%USERPROFILE%\.codex\config.toml` on Windows):

```toml
[mcp_servers.blender]
command = "uvx"
args = ["blender-mcp"]
env = { BLENDER_HOST = "localhost", BLENDER_PORT = "9876" }
```

Verify with `codex mcp list` — `blender` shows as **enabled**. Tools appear on the next Codex start.

### 1.3 Start it

In Blender's 3D viewport press `N` → **MCP for Blender** tab → **Start MCP Server**.

**Run only one MCP client against Blender at a time.** Claude Code and Codex both connecting to
`localhost:9876` will fight over the socket.

### 1.4 Options

| Variable | Default | Effect |
|---|---|---|
| `BLENDER_HOST` | `localhost` | Blender socket host |
| `BLENDER_PORT` | `9876` | Blender socket port |
| `BLENDER_MCP_SAFE_MODE` | off | `1` validates each script before it runs in Blender |

The server can run arbitrary Python inside Blender by design — that is how it models. Set
`BLENDER_MCP_SAFE_MODE=1` if you want file, subprocess and network access blocked; modelling,
materials, rendering, saving and import/export still work.

---

## 2. MCP for Unity

### 2.1 Install the Unity package

You already have the repository on `C:`. Use it directly:

**Window → Package Manager → `+` → Add package from disk…** and select
`C:\<your path>\unity-mcp\MCPForUnity\package.json`.

Alternatives, if you would rather track upstream:

```text
https://github.com/CoplayDev/unity-mcp.git?path=/MCPForUnity#main
```
(Package Manager → `+` → **Add package from git URL…**; pin a release with `#v10.0.0`), or
`openupm add com.coplaydev.unity-mcp`.

A setup wizard opens on import and checks Python and `uv`.

### 2.2 Configure the clients

**Window → MCP for Unity → Configure All Detected Clients.** It writes both clients for you and is
idempotent — re-run it after any package update. Claude Code and Codex both auto-connect
afterwards. The same window starts and stops the server and switches transport; the status panel
reads `Connected` when the bridge is up.

### 2.3 Manual configuration

Only needed if auto-configuration cannot run.

**Claude Code**, HTTP (what the configurator runs):

```bash
claude mcp add --scope local --transport http UnityMCP http://127.0.0.1:8080/mcp
```

This repo's `.mcp.json` already carries the same HTTP entry, so the project scope covers it too.

**Codex**, HTTP — `~/.codex/config.toml`. The `features` flag is required: Codex needs its Rust MCP
client for HTTP transport.

```toml
[mcp_servers.unityMCP]
url = "http://127.0.0.1:8080/mcp"

[features]
rmcp_client = true
```

**Stdio fallback** (any client without HTTP):

```bash
claude mcp add --scope local --transport stdio UnityMCP -- uvx --from mcpforunityserver mcp-for-unity --transport stdio
```

```toml
[mcp_servers.unityMCP]
command = "uvx"
args = ["--from", "mcpforunityserver", "mcp-for-unity", "--transport", "stdio"]
startup_timeout_sec = 60
```

On Windows the stdio form also wants `env = { SystemRoot = "C:\\Windows" }`, and `uvx` may need its
full path (see below).

---

## 3. Verify

1. `uv --version` answers in a plain terminal.
2. Blender: addon enabled, **Start MCP Server** clicked.
3. Unity: **Window → MCP for Unity** status panel reads `Connected`.
4. Claude Code: `/mcp` lists `blender` and `unityMCP` as connected.
5. Codex: `codex mcp list` shows both enabled; restart Codex to pick up the tools.
6. Smoke tests — Blender: *"list the objects in the current scene"*. Unity: *"create a cube at the
   origin and add a Rigidbody"*.

---

## 4. Troubleshooting

**Client cannot find `uvx`.** Use the absolute path instead of the bare name — typically
`C:\Users\<you>\.local\bin\uvx.exe`, or
`C:\Users\<you>\AppData\Local\Microsoft\WinGet\Links\uvx.exe` for a WinGet install. Wrapping as
`"command": "cmd", "args": ["/c", "uvx", "blender-mcp"]` also works on Windows. Fully quit and
relaunch the client after any `PATH` change.

**First Blender command does nothing.** Send it a second time; the first message after connecting is
sometimes dropped.

**Two clients, one Blender.** Only one at a time.

**Unity bridge not connecting.** Check the status panel in **Window → MCP for Unity**; restart the
Editor. Confirm the HTTP server is on `localhost:8080` and the client URL matches — including the
`/mcp` path.

**Package Manager: `Error when executing git command`.** `git` is not on the `PATH` the Unity
Editor inherited. Install the package from disk instead.

**Codex HTTP server never connects.** `[features] rmcp_client = true` is missing from
`~/.codex/config.toml`.

---

## 5. Feeding Blender output into this game

The renderer is 2D. Blender is useful here as a *sprite source*: build in 3D, render to flat
frames, pack them into an atlas the game already knows how to load.

### 5.1 Where the files go

`src/engine/atlas.ts` loads `/assets/<group>.json` + `/assets/<group>.png` for each group and falls
back to the procedural generator in `src/art` when either is missing. Vite serves `public/` at the
site root, so the files belong in `public/assets/` (create the directory; it does not exist yet).
Overriding is per group — one real atlas does not disable the others.

Groups (`src/art/index.ts`): `terrain`, `props`, `track`, `structures`, `rolling`, `wagons`, `fx`,
`icons`, `people`.

### 5.2 Atlas contract

```json
{ "frames": { "<name>": { "x": 0, "y": 0, "w": 64, "h": 48, "ax": 32, "ay": 40 } } }
```

`x`/`y`/`w`/`h` are the frame rectangle in the PNG. `ax`/`ay` is the anchor in **pixels from the
frame's top-left** — the point the game pins to the tile position. Textures are sampled with
`nearest`, so render at final pixel size; do not upscale.

Frame keys are global and carry their own prefix, which is **not** always the group name: the
`wagons` group supplies keys named `rolling/wagon_*`. Match the names the generators emit —
`` ` `` opens the debug panel with an atlas viewer that lists them, and `src/art/*.ts` is the
source of truth.

### 5.3 Camera setup

The projection is 2:1 isometric, base tile 64×32 px (`src/engine/iso.ts`).

- Camera: **Orthographic**, rotation `X = 60°`, `Y = 0°`, `Z = 45°`. Never move or rotate it
  between frames of a group.
- Scale: model **1 tile = 1 Blender unit**, then

  ```text
  ortho_scale = render_longest_side_px × √2 / 64
  ```

  e.g. 512 px render → `11.3137`. That makes one Blender unit project to exactly 64 px across and
  32 px down, matching `TILE_W`/`TILE_H`.
- Height: one elevation step is `ELEV_PX = 10` screen px, which is **0.2552 Blender units** of `Z`
  at this camera.
- Film: transparent background, no anti-aliased edges you do not want in a nearest-sampled atlas.

Axis mapping: Blender `+X` is tile `+tx` (screen down-right), Blender `+Y` is tile `−ty` (screen
up-right), Blender `+Z` is up.

### 5.4 Facings

`src/sim/body.ts`: `FACINGS = 48`, one every 7.5°. `DRAWN_FACINGS` is the mirror-halved subset —
the generators draw only the facing whose horizontal mirror covers its partner, and the renderer
flips at draw time. Render the same set.

Because `+Y` is `−ty`, a heading of facing `f` is a Blender object yaw of **`−7.5° × f`** (clockwise
seen from above). Sanity check: facing `0` must point down-right on screen, matching the procedural
sprite in the atlas viewer.

### 5.5 Anchors

Put the model's ground contact point at the Blender world origin and keep the camera fixed. The
anchor is then where `(0, 0, 0)` projects in the render. With a fixed frame size that pixel is the
same for every frame; if you crop tight, subtract the crop offset from it per frame.

### 5.6 Workflow

1. Ask Blender (through the MCP server) to build or import the model, set materials, and place it
   at the origin.
2. Set the camera as in 5.3 and render the `DRAWN_FACINGS` yaws to individual PNGs.
3. Pack them into `public/assets/<group>.png` + `.json` with anchors as in 5.5.
4. Reload the game. The debug panel reports each group as `png` or `procedural`, so you can see
   which override took.

Audio overrides work the same way: drop `public/assets/audio/<event>.ogg`, event names in
`src/engine/audio.ts`. The ambient loop is always synthesized.

---

## 6. Unity

Unity is a separate engine from this codebase — nothing here builds to it. MCP for Unity is set up
for experimenting in a Unity project of its own (47 tool entry points: scenes, GameObjects, C#
scripts, assets, tests, profiling, builds). If you prototype rolling stock or track geometry there,
the export path back into this game is the same one as Blender's: render to sprites and pack an
atlas per 5.2–5.5.

---

## Sources

- https://github.com/ahujasid/blender-mcp — MCP for Blender, README (quickstart, client setup,
  environment variables)
- https://blendermcp.org/setup/claude and `/setup/chatgpt` — same project's setup pages
- https://github.com/CoplayDev/unity-mcp — MCP for Unity: `README.md`,
  `website/docs/getting-started/install.md`, `website/docs/getting-started/clients.md`,
  `website/docs/guides/client-configurators.md`, and the configurator sources under
  `MCPForUnity/Editor/` for the exact CLI and TOML the auto-configurator writes

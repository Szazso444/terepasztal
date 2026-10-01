# Rail system evidence

Game renders for the rail-system branch (2×2 regular curves and switches, the S-switch, narrow
gauge and its depot). The PNGs stay local; WebP copies and the review page live in
`G:\DEV\Terepasztal\renders\rail-system\`.

| Script                            | What it does                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `yard.js`                         | The showcase level: every piece, both switch forms, the snap demo, both gauges, depots  |
| `shots.mjs`                       | `MODE=pieces` renders every piece and area; `MODE=follow FRAMES=72` films each train    |
| `demo.mjs`                        | Turns the showcase into a playable game and writes `out/demo-save.json`                 |
| `realload.mjs`                    | Seeds that save, presses Continue on the real main menu, and checks the trains run      |
| `oldsave.mjs`                     | Makes a v12 save with a 1×1 regular loop on main, then loads it on this branch          |
| `depotcheck.mjs`, `zoomcheck.mjs` | Close-ups of the narrow depot and of single pieces                                      |
| `load.js`                         | Opens `out/<file>.json` the way Continue does: `/scratchpad/rails/load/?file=demo-save` |

```sh
BASE_URL=http://127.0.0.1:5176 MODE=pieces node scratchpad/rails/shots.mjs
BASE_URL=http://127.0.0.1:5176 MODE=follow FRAMES=72 OUT=scratchpad/rails/out/films node scratchpad/rails/shots.mjs
node scratchpad/rails/demo.mjs && node scratchpad/rails/realload.mjs
```

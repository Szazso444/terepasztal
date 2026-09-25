# Train game asset pipeline

`CLAUDE.md` in this folder is the pipeline's guide for every agent, not only Claude: stages, file roles, conventions,
the game's frame names and the rules for edits. Read it before changing anything here. `ASTRA.md` is the brief for the
input images: rules, prompt template and the shot list, with file names that `assets.csv` expects in `input/`.

Where the pipeline meets the game, the game wins: `game_rules.py` mirrors `src/sim/body.ts`, and
`game_rules.test.mjs` fails when they drift. Run `npm test` from the repository root after any change here.

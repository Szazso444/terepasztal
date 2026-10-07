# Building pictures: how they are made

The game's buildings are painted by an image-generating agent working from a list, one picture
per building, age and view: 27 kinds of building, 548 pictures. This document is for whoever runs
that work or has to run it again: what the parts are, how to start it, what the tools enforce,
what the generator does wrong, and how to change the set. The artist agent has its own brief,
`assets/source/buildings-v2/GUIDE.md`; the design and its reasons are in
`docs/superpowers/specs/2026-10-02-building-eras-art-package-design.md`.

Status: the pictures are being made on the branch `art/buildings-v2`. The game does not load
them yet (see "Not built yet").

## The parts

| Part                                       | What it is                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `tools/building-kit.mjs`                   | The conventions: ages `a0` to `a5`, views `r0` to `r3`, the four footprints, the projection, and the building list |
| `tools/building-guides.mjs`                | Draws the grey block-outs the agent paints over, one per footprint and view                                        |
| `tools/building-queue.mjs`                 | The work list: what to paint next, with its prompt; records results; gates and stops                               |
| `tools/building-check.mjs`                 | Checks a picture: background, size, view, camera, a depot's portals                                                |
| `tools/building-fit.mjs`                   | Measures where the building stands in its picture and from which camera; lays it onto its footprint                |
| `tools/building-sheets.mjs`                | Review sheets per family, the index page, and one picture laid on grass for the agent's eye                        |
| `assets/source/buildings-v2/families.json` | What each building is, age by age, and every sentence of the prompts                                               |
| `assets/source/buildings-v2/GUIDE.md`      | The artist agent's brief                                                                                           |
| `assets/source/buildings-v2/PROMPT.md`     | The text that starts an agent session                                                                              |
| `assets/source/buildings-v2/guides/`       | The 16 block-outs, drawn by the guide tool                                                                         |
| `assets/source/buildings-v2/queue.json`    | Progress, one entry per picture. Written by the queue tool only                                                    |
| `assets/source/buildings-v2/report.json`   | What the check measured of each picture                                                                            |
| `assets/source/buildings-v2/review/`       | The sheets and `index.html`                                                                                        |
| `assets/source/buildings-v2/<family>/`     | The pictures: `<family>-a<age>-r<view>.png`                                                                        |

The building list is not written down anywhere: `loadInventory` reads it from the game's data
(`src/data/stations.json`, `stations_full.json`, `buildings.json`, `buildings_full.json`,
`decor.json`), so the art cannot drift from the game. Each tool has tests beside it
(`tools/building-*.test.mjs`); `building-docs.test.mjs` holds the brief, the prompt and this
document to what the tools do.

## Running it

1. Work on a branch of its own. `node tools/building-guides.mjs` redraws the block-outs (only
   needed when a footprint changes), `node tools/building-queue.mjs` builds or refreshes the list
   and keeps what was recorded.
2. Open an agent session on the repository and paste the block from `PROMPT.md`. The agent runs
   `node tools/building-queue.mjs next`, paints the picture as an edit of the block-out with the
   references and the prompt `next` printed, takes it
   (`node tools/building-queue.mjs take <id> --from <file>` writes the picture the image tool
   reported to the picture's file and lays it on grass, as
   `node tools/building-sheets.mjs --picture <file>` does for any file), looks at it, and records
   it (`node tools/building-queue.mjs set <id> generated`). The tool refuses what fails the check.
3. The depot and the station are gates: when one is finished `next` prints `GATE` and the agent
   stops. Look at `review/index.html` and `review/<family>.png`, then have the agent run
   `node tools/building-queue.mjs approve-pilot`. After the gates the agent closes each family
   itself (check, sheets, one commit) and goes on.
4. When a rule of the check changes, `node tools/building-queue.mjs recheck` looks again at what
   is made and puts back what no longer passes for its camera.
5. `node tools/building-queue.mjs status` says how far each family has got and where the list
   and the disk disagree.

## Handing the work to another session

The work outlasts a chat: a session runs out of its allowance, or the work moves to another
account. Nothing has to be carried over. Progress is in `queue.json` and in the picture files of
the checkout, and the way of working is in the guide and in what `next` prints.

1. In the same checkout, open a new session (log the agent in with the other account first) and
   paste the block from `PROMPT.md`. It commits what is in hand, brings the tools up to date,
   reads the guide, and goes on from `status` and `next`.
2. A picture the earlier session made but did not record shows in `status` as
   `on disk, but not recorded`. The new session looks at it and records it, or makes it again.
3. A gate holds across sessions: the new session stops at `GATE` like the old one.
4. Nothing about the image tool's folders has to be told. The new chat names the file its
   image tool reports; its pictures are newer than the mark in the list, and what the old chat
   left behind is older, or too old to be taken for a picture just made.

On another machine the branch has to be pushed first. The earlier selves of pictures that wait to
be painted again (`*.before.png`) are not committed, so there those pictures are made afresh.

Why the tool takes the picture: the agent's own method does not survive its chat being shortened.
One session copied the image tool's file for ninety pictures, lost that after a compaction, and
moved each later picture through the shell as base64, a hundred commands and two minutes a
picture. What must not be forgotten goes into the tools and into what `next` prints.

A picture is judged in the game, not on a sheet. Until the game loads the pictures, the branch
`demo/depot-pilot` packs the depot into an atlas (`scratchpad/buildings/pack-depot-demo.mjs`)
and shows it in a running build, as drawn or straightened.

## What the tools enforce

- The file: a transparent PNG with a short side of at least 768 px, the building clear of the
  edges, opaque surfaces, no translucent shadow or glow, not the grey block-out come back.
- The view: the game's, not a view from the front or from above.
- The camera: the game looks down at 30° on a building turned 45°. The fit reads the camera from
  the feet of the two visible walls. A picture more than 2° off, in height or in turn, is
  refused. The tool keeps it as the picture's earlier self and hands the picture out again, to be
  painted from that attempt laid onto its footprint and straightened. After three attempts it
  keeps the closest of them and marks it `kept`. A picture kept within 3° is near enough; a
  family with more than a quarter of its pictures kept further off, rejected or never made stops
  the work (`STOP`).
- A depot's portals: in the wall the block-out has them in. A view of the wrong rotation has
  them on the other side, and in the game the rails would run into a wall. Every prompt of a
  depot names the wall: a view painted from the front view copied the front view's wall at the
  first attempt, two times in three, until it did.
- The ground in a depot's portals, open to the ground: the game lays its rails under the
  picture, through the portals, so a floor or an apron painted there hides them (four of the
  first depot's 24 pictures had one). The check takes the lowest thing painted in each column
  of the portal wall, a hairline or a speck apart, and measures how deep the ground is open
  above the wall's foot, over the deepest stretch 0.3 of the portal wide, as a share of the
  portal's width: under 0.3 the picture is refused, under 0.45 it passes with a note. The first
  depot's pictures whose rails did not show measured 0.18 at most, the others 0.50 and more.
  The foot is taken through the building's near corner, where the other wall's foot ends:
  fitted to the lowest pixels alone it runs before the wall wherever paint lies in a line there
  (an apron before each portal, the tips of open door leaves). Not where something stands at
  that corner before the other wall's foot (a turret, a pier, a bush): there no foot hangs. A
  near corner cut off by a quarter of a tile or more, or a step along the other wall that stops
  short of the corner, still reads as a foot run before its wall: such a picture is refused
  and told to keep its walls' feet plain and straight from corner to corner, which the prompt
  asks of every building. Depths are the game's: the picture's, times what the fit stretches
  its heights by to put its camera right.
- The inside of the hall in a depot's portals: told that the ground is "transparent from the
  foot of the wall upwards", the generator emptied whole portals, and the user asked for the
  hall's inner walls back. A depot's portal open a full width deep over half its width or more
  is a hole and is refused; from 0.3 of its width on it passes with a note. The two pictures
  the user sent back measured 0.58 and 0.61 in their worse portal, a third that was not sent
  back 0.35, the others 0.24 at most. The limit is the depot's own: a narrow hall behind a wide
  portal shows a deep wedge of floor that reads the same, and a portal lower than it is wide
  can be a hole and read none. So of the narrow depot's portal the tool only says it, in a
  note, until its first pictures have been measured.
- The words: the Keep lines, the check's messages and the guide say what is painted in a
  portal (the hall's inner wall, in shadow) and what is left out (only the floor, below that
  wall, up to about a third of the doorway's height), in one sentence that was tried on the
  generator and gave two pictures out of two right. The agent copies the tools' words into its
  prompts and sharpens them, so a test holds that sentence the same in all three places.
- The shares are kept in `report.json` (`ground`, `through`, `hang`). The look picture is where
  the eye settles what the numbers leave open: it lays a depot out 1.3 times its footprint, as
  the game draws it, with the game's track drawn in at its own gauge and width (regular track
  for the depot, narrow gauge for the narrow depot).
- Which picture is taken: the agent names the file its image tool reported. `take` takes only a
  picture made after the last one was taken, recorded or given up (one mark in time in
  `queue.json`, moved forward only), and no picture of the image tool whose bytes are in the
  list's folders already. So a generation that failed does not hand an earlier picture to the
  next entry, whether the file is named or found. It does not guess between chats: a picture it
  finds itself is taken only from the chat the last one came from (none before a picture was
  taken by name), and where new pictures lie in another chat's folder or in more than one it
  names them and takes none. What the tool keeps
  of an entry (`<name>.before.png`, `<name>.rejected.png`) is had back by naming that file.
- The count of attempts is the tool's: a picture taken and given up counts, the same picture
  refused twice counts once, a number the agent gives can raise the count but not lower it, and
  a picture taken back starts again with three.
- A picture is not lost to one bad last attempt: `node tools/building-queue.mjs keep <id>` makes
  the closest attempt the tool holds the picture, where the third attempt failed for another
  reason than its camera. One session rejected a rear view whose second attempt had been right
  but for 2.5° of camera, because the third had a door on the back wall again.
- Size and place are not enforced. A generator fills its canvas, so every picture is measured
  and laid onto its footprint by the tools, and the four views of an age are brought to one size.
  A family can stand larger than its footprint (`size` in `families.json`; the depot has 1.3).

The limits are constants: `FIT` in `building-fit.mjs` (the camera's 2° and 3°), `LIMIT` in
`building-check.mjs`, `GATES`, `LOSS` and `ATTEMPTS` in `building-queue.mjs`.

What the tools cannot see, and eyes must: whether it is the right building, whether the front and
the back are the right way round, whether a building's plan has the shape of its footprint (the
stations came out 1.8 times as long as deep from the front and nearly square from the back).

## What the generator does

Measured on the first hundred pictures. These are the reasons for the rules above.

- It keeps a block-out's view, but not its size, place or canvas. Buildings come back 1.3 to 2.6
  times the size of the block.
- It copies the camera of the picture it is shown, not of the grey block-out. The game's present
  pictures (`base` in `families.json`) are drawn from 15° to 24°, so a family's first picture
  comes out low; and each age handed its camera on to the next. That is why every earlier picture
  is shown laid onto its footprint and straightened (`.fitted/`).
- Even from a straightened reference its camera scatters by about 4°. Of 26 such attempts 3 were
  within 2° and 13 within 3°.
- Told in words to raise or lower the camera, it overshoots: 24°, then 36°, then 25°. So a
  refused attempt is not made again with a sentence added, it is painted again from itself.
- It turns the wall with the interesting features towards the viewer.
- Shown the front view at the block-out's own scale, it sometimes paints the front view again
  where another view was asked for.
- A wall it is not shown, it makes up, and differently in every picture. Painted from the front
  view alone, the station's rear views came out as other buildings: a flat or a lean-to roof
  where the front views had a pitched one, a side wall without its gable, a back wall grander
  than the front, the canopy on the side away from the track (7 of 24 pictures; the check sees
  none of it, it measures camera and place). So each wall is made up once and copied after that:
  `r1` takes its side wall from `r0` and makes up the back, `r3` makes up the left-hand side,
  and `r2`, which shows only those two walls, is painted from `r1` and `r3` as well, with a
  paragraph that says which wall comes from which reference and that the building is no larger
  (`references.behind` and `references.round` in `families.json`). Tried on the station's seven
  pictures: the three `r1` were right at the first attempt, the four `r2` copied both walls, and
  the repeats that were needed were for the camera. The words in `families.json` are those that
  were tried, with what was the station's own (its gables, its arched windows) taken out; the
  first family painted with them is the one to look at.
- The agent looks at pictures with a viewer that ignores transparency. It saw the colour stored
  under transparent pixels as a halo and rejected good pictures. It is given opaque pictures on
  grass to look at (`.look/`), and the tools decide about the background.

## Changing the set

- A new building: it appears in the list once it is in the game's data. Give it an entry in
  `families.json` (`what`, `keep`, `front`, `base`, and a line for each of its ages); the queue
  tool names whatever is missing.
- A building that is not modernised to the end: `lastTier` in the game's data, beside its
  `tier`. The charcoal kiln has 2: it is upgraded up to the Electric age and keeps that model.
  Take its later lines out of `families.json`; the next rebuild drops its later pictures from
  the list.
- A new age: `AGES` in `building-kit.mjs`, its style under `ages` in `families.json`, and a line
  in every family.
- A new footprint: `FOOTPRINTS` in `building-kit.mjs`, its block and openings in
  `building-guides.mjs`, then redraw the guides.
- The prompts: only in `families.json`. `shared` is the same for every picture; `references`
  says what each attached picture is for; `views` names the walls of each view.
- The camera limit: `FIT.camera`. Then `recheck`.
- Another kind of asset (wagons, scenery): the kit's projection, the fit, the check and the queue
  do not depend on what is painted. The list (`loadInventory`), the footprints, the block-outs and
  `families.json` are the building-specific parts.

## When a run goes wrong

- Have the agent commit before any step that moves many files and before it merges the tools,
  and never stash pictures: with staged and unrecorded pictures in its tree, a merge had the
  agent juggling five stashes. A run is put back with
  `git checkout <that commit> -- <the family folders> assets/source/buildings-v2/queue.json`
  and `recheck`.
- `redo <id>` puts back a picture and every picture built on it, to be made afresh. For a first
  front view that is the whole family, for an `r1` or an `r3` the `r2` of its age. Where that
  undoes other pictures it says what it would undo and waits for `--yes`. To make one recorded
  picture again the command is `set <id> pending`.
- Nothing painted is removed by the tools. A picture set aside is `<name>.rejected.png`, an
  earlier attempt `<name>.before.png`, and an older one under the same name is kept with a number.
  None of these are committed. The one exception: `take` writes over a picture that lies under
  the entry's name and was never recorded, one the agent looked at and gave up; where the image
  tool made it, its file there remains.
- A full disk stopped a run once (`ENOSPC`), and left an empty fitted reference that was then
  handed out. The list, the report and the fitted references are now written whole or not at all
  (`writeWhole`), and a fitted reference that is not a whole picture is made again. `set` and
  `keep` write the list last, so a command that fails for lack of space has not written half a
  list and has, as a rule, not recorded the picture: make room, run `status`, and run it again.
  Not covered, because the pictures are moved beside their place before the list is written: a
  picture that `set` refuses for its camera (if the disk fills at the list, the attempt is not
  counted and the picture is painted afresh, not from its earlier self), and `recheck` (it
  writes the list first for that reason; if the disk fills at that write, the pictures it put
  back are gone from their place while the list calls them made: `status` shows them as missing,
  and each is put back by hand from its `.before.png`).

## Not built yet

- Packing the pictures into the game's atlas and loading them by age and rotation. The atlas tool
  is to lay each picture down with `fitGroup` and `normalisePicture`, as the review sheets do.
- A check of a building's plan against its footprint, and of pictures whose wall feet cannot be
  measured (a round tower, a yard of machinery): these pass on the camera today.

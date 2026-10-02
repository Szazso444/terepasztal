# Building pictures: the guide

You are painting the buildings of an isometric railway game: 27 kinds of building, each in up to
six ages and four views, 560 pictures in all. This guide tells you how to make them one by one on
your own, how to check each, and where to stop. Read it once, then work from the queue.

## 1. What the pictures are for

In the game a building is upgraded once per age, and the upgrade swaps the building for a more
modern model. The player can also turn a building in quarter turns. So each building needs one
picture per age and view, and the pictures of one building must agree with each other: the same
footprint, the same camera, the same building seen from four sides.

## 2. The rules every picture follows

**Ages.** `a0` steam, `a1` diesel, `a2` electric, `a3` nuclear, `a4` magnetic, `a5` hyper. A
building's first model is that of the age it appears in; some start at `a1` or `a2`. Every age
stays inside the same pastoral world and palette: an upgrade modernises a building, it does not
replace it with something from another game.

**Views.** The camera never moves. It always sees two walls: the lower-left one and the
lower-right one. Turning the building changes which of its walls those are.

| View | The front faces | Lower-left wall | Lower-right wall |
| ---- | --------------- | --------------- | ---------------- |
| `r0` | lower left      | FRONT           | right-hand side  |
| `r1` | upper left      | right-hand side | BACK             |
| `r2` | upper right     | BACK            | left-hand side   |
| `r3` | lower right     | left-hand side  | FRONT            |

"Right-hand side" is the side to the right of someone standing outside and facing the front. The
front is where the door is, and for stations the platform canopy. A depot's train portals are in
its two side walls, so in every view exactly one of the two visible walls has portals.

**Canvas.** A picture is exactly the size of its guide, with the footprint's centre on a fixed
pixel. Never resize, crop or move a picture: the game places it by that pixel.

| Footprint        | Canvas      | Footprint centre | Used by      |
| ---------------- | ----------- | ---------------- | ------------ |
| one tile         | 1024 x 1024 | (512, 832)       | most         |
| one tile, tall   | 1024 x 1536 | (512, 1344)      | houses       |
| two tiles in row | 1024 x 1024 | (512, 800)       | narrow depot |
| two by two tiles | 1536 x 1024 | (768, 760)       | depot        |

**Projection.** Orthographic 2:1 isometric: ground edges run two pixels across for one down,
vertical edges are vertical, there is no perspective.

**Contents.** One building, standing on its footprint and filling it. At ground level nothing
reaches outside the footprint; roofs, cranes and chimneys may overhang a little higher up. Light
comes from the upper left: tops lightest, lower-left walls mid, lower-right walls darkest.
Transparent background (alpha zero), opaque surfaces. Never: ground, pavement, grass, shadow,
rails, trains, people, vehicles, smoke, lettering, borders, glow, loose objects.

## 3. The files

Everything is in `assets/source/buildings-v2/`.

- `queue.json`: the record of progress, one entry per picture. Do not edit it by hand; use the
  queue tool. A picture's status is `pending`, `generated`, `approved` or `rejected`.
- `families.json`: what each building is, age by age, and the shared prompt text. Read it if you
  want to see a whole building's story; do not change it.
- `guides/`: the grey block-outs you paint over, one per footprint and view.
- `<family>/<family>-a<age>-r<view>.png`: the pictures you make.
- `review/`: the review sheets and their index, made by the sheet tool.
- `report.json`: the results of the check.

The tools (also as `npm run art:buildings:guides`, `:queue`, `:check`, `:sheets`):

- `node tools/building-queue.mjs next`: the next picture to make, with everything it needs.
- `node tools/building-queue.mjs show <id>`: the same for any picture.
- `node tools/building-queue.mjs set <id> <status> [--attempts n] [--note "text"]`: record a result.
- `node tools/building-queue.mjs status`: progress per family.
- `node tools/building-queue.mjs approve-pilot`: run only when the user says the pilot is approved.
- `node tools/building-check.mjs <file>` (or `--family <name>`, `--all`): check pictures.
- `node tools/building-sheets.mjs --family <name>`: build a family's review sheet and the index.
- `node tools/building-guides.mjs`: redraw the guides. You should not need it.

## 4. The loop

Repeat until the queue tool tells you to stop:

1. Run `node tools/building-queue.mjs next`. It prints the picture's name, the file to save, the
   guide to edit, the references to attach in order, and the prompt. Its exit code is 0 for a
   picture, 2 at the pilot gate, 3 when nothing is left.
2. Make the picture (section 5).
3. Check it: `node tools/building-check.mjs <file>`. Then look at it yourself (section 6).
4. Record it: `node tools/building-queue.mjs set <id> generated --attempts <how many tries>`.
5. When a family is finished, close it (section 8).

The queue hands pictures out in an order that matters: a building's front view of an age comes
first, then its three other views, then the next age. Each picture is built on one made before it.

## 5. Making one picture

1. Start an image **edit**, not a new image. The image you edit is the guide: a grey block on a
   grey plinth. The plinth is the footprint; the block shows the camera, and its dark openings
   show which wall has the front door (or a depot's portals).
2. Attach the references in the order `next` lists them. The first is always the style board. The
   prompt's last paragraph says what each of the others is for.
3. Paste the prompt exactly as printed.
4. Ask for the canvas size `next` printed and a transparent background.
5. Save the result under the file name `next` printed, as a PNG with an alpha channel.

If your image tool cannot return a transparent background, ask for a flat pure magenta
(#FF00FF) background instead, then remove exactly that colour so the background is alpha zero
with no magenta fringe left on the building's edge. If it returns another size than the guide's,
make it again; do not rescale it.

## 6. Looking at your own picture

The check measures where the building stands. It cannot see what the building is. Before you
record a picture as `generated`, look at it and at its guide side by side and answer:

- Is the front on the wall the prompt's View line names? In `r1` and `r2` no front door may show.
- For a depot: are the portals in the wall the guide shows them in, and open?
- In `r1`, `r2`, `r3`: is it the same building as the `r0` reference (same walls, roof, colours,
  details), turned, and not a mirror image of it?
- In a later age: is it still recognisably the same kind of building, with everything on the
  prompt's Keep line, in the materials of the new age?
- Is the plinth gone, with nothing on the ground around the building?
- Is the lower-left wall lighter than the lower-right wall?
- Is it free of lettering, people, rails and smoke?
- Laid over its guide at half opacity, do its walls rise from the plinth's edges?

If any answer is no, the picture has failed even when the check passes.

## 7. When a picture fails

Make it again. Say in the edit what was wrong ("the door is on the wrong wall: it belongs on the
lower-left wall"), and keep the rest of the prompt. Give a picture up to three attempts.

After three attempts, delete the file, record it with
`node tools/building-queue.mjs set <id> rejected --attempts 3 --note "<what went wrong>"`, and go
on. The queue skips the pictures that would have been built on a rejected one and names them
under "waiting"; leave them.

Never keep a failed picture on disk: later pictures would be built on it.

## 8. Gates and commits

**The pilot.** The depot is made first, all of its 24 pictures. When `next` prints `PILOT GATE`
(exit code 2), stop:

1. `node tools/building-check.mjs --family depot`
2. `node tools/building-sheets.mjs --family depot`
3. Commit: `Buildings: depot pilot, <n> of 24 pictures`.
4. Tell the user the pilot is ready, with the path of `review/depot.png`, the number of pictures
   made and rejected, and anything you found hard. Then wait.

Work continues only after the user approves the pilot. The user may first ask for changes to this
guide, to `families.json` or to the guides; those are not yours to change.

**Every other family.** When the last picture of a family is recorded:

1. `node tools/building-check.mjs --family <family>`
2. `node tools/building-sheets.mjs --family <family>`, then look at `review/<family>.png`: the
   whole building, every age and view, on grass. Pictures that look wrong beside their siblings
   are worth one more attempt now.
3. Commit: `Buildings: <family>, <n> of <total> pictures`.
4. If more than a quarter of the family's pictures were rejected, stop and tell the user what
   kept going wrong. Otherwise run `next` again.

One commit per family, on the branch `art/buildings-v2`.

## 9. Stopping and resuming

`queue.json` is the only state. To resume after any interruption, run
`node tools/building-queue.mjs status`, then `next`. A picture saved on disk but not recorded
counts as not made: check it and record it, or delete it.

## 10. What you do not touch

- Nothing outside `assets/source/buildings-v2/`.
- Inside it: not `families.json`, not `guides/`, not this guide, not `PROMPT.md`.
- Not the game's code or data. If a prompt seems wrong, or a building cannot be painted inside
  its footprint, record the picture as `rejected` with a note that says why, and go on. The notes
  are how the user learns what to fix.

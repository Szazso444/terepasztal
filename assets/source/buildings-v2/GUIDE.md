# Building pictures: the guide

You are painting the buildings of an isometric railway game: 27 kinds of building, each in up to
six ages and four views, 560 pictures in all. This guide tells you how to make them one by one on
your own, how each is checked, and where to stop. Read it once, then work from the queue.

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

**Size and place.** Ask for the size of the guide. The image tool may return another size, and it
will draw the building larger than the guide's block and not quite where the block is. That is
fine: the tools measure where the building stands in each picture and lay it onto its footprint
themselves. Do not resize, crop, move or straighten a picture to make it match its guide. What a
picture needs instead:

- the whole building inside the picture, with a clear margin: nothing touches the edge;
- the foot of its two visible walls plain and straight from corner to corner, with nothing
  standing in front of it, because that foot is what the tools measure;
- a short side of at least 768 px.

| Footprint        | Ask for     | Used by      |
| ---------------- | ----------- | ------------ |
| one tile         | 1024 x 1024 | most         |
| one tile, tall   | 1024 x 1536 | houses       |
| two tiles in row | 1024 x 1024 | narrow depot |
| two by two tiles | 1536 x 1024 | depot        |

**Projection.** Orthographic 2:1 isometric: ground edges run two pixels across for one down,
vertical edges are vertical, there is no perspective. The tools correct a camera that is a little
off; they cannot correct a building seen from the front or from above.

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
- `<family>/<family>-a<age>-r<view>.rejected.png`: a picture that was given up, set aside by the
  tool for the user to look at. Never use one as a reference, and do not commit them.
- `review/`: the review sheets and their index, made by the sheet tool.
- `report.json`: the results of the check, with the measurement of every picture.

The tools (also as `npm run art:buildings:guides`, `:queue`, `:check`, `:sheets`, `:fit`):

- `node tools/building-queue.mjs next`: the next picture to make, with everything it needs.
- `node tools/building-queue.mjs show <id>`: the same for any picture.
- `node tools/building-queue.mjs set <id> <status> [--attempts n] [--note "text"]`: record a result.
- `node tools/building-queue.mjs status`: progress per family, the gates, and where the list and
  the disk disagree.
- `node tools/building-queue.mjs redo <id>` or `redo <family>`: put pictures back in the queue.
  Only when the user asks.
- `node tools/building-queue.mjs accept <family>` and
  `node tools/building-queue.mjs approve-pilot`: the user's decisions. Run them only when the user
  says so.
- `node tools/building-check.mjs <file>` (or `--family <name>`, `--all`): check pictures.
- `node tools/building-sheets.mjs --family <name>`: build a family's review sheet and the index.
- `node tools/building-fit.mjs <id>`: print how a picture is measured. For curiosity only.
- `node tools/building-guides.mjs`: redraw the guides. You should not need it.

## 4. The loop

Repeat until the queue tool tells you to stop:

1. Run `node tools/building-queue.mjs next`. It answers with its exit code:
   - exit code 0: a picture to make. It prints the picture's name, the file to save, the guide to
     edit, the references to attach in order, and the prompt.
   - exit code 2: `GATE`. A family the user wants to see is finished. Stop (section 8).
   - exit code 4: `STOP`. Too much of a family could not be made. Stop (section 8).
   - exit code 3: `DONE`. Nothing is left.
2. Make the picture (section 5).
3. Look at it yourself (section 6).
4. Record it: `node tools/building-queue.mjs set <id> generated --attempts <how many tries>`.
   The tool checks the picture first. If the check fails it prints why and records nothing: make
   the picture again (section 7).
5. When `next` says a family is finished, close it (section 8).

The queue hands pictures out in an order that matters: a building's front view of an age comes
first, then its three other views, then the next age. Each picture is built on one made before it.

## 5. Making one picture

1. Start an image **edit**, not a new image. The image you edit is the guide: a grey block on a
   grey plinth. The plinth is the footprint; the block shows the camera, and its dark openings
   show which wall has the front door (or a depot's portals).
2. Attach the references in the order `next` lists them. The first is always the style board. The
   prompt's last paragraph says what each of the others is for.
3. Paste the prompt exactly as printed.
4. Ask for the size `next` printed and a transparent background.
5. Save the result under the file name `next` printed, as a PNG with an alpha channel, exactly as
   the image tool returned it.

## 6. Looking at your own picture

The check measures where the building stands and whether the picture can be used. It cannot see
what the building is. Before you record a picture as `generated`, look at it and at its guide side
by side and answer:

- Is the front on the wall the prompt's View line names? In `r1` and `r2` no front door may show.
- For a depot: are the portals in the wall the guide shows them in, and open?
- In `r1`, `r2`, `r3`: is it the same building as the `r0` reference (same walls, roof, colours,
  details), turned, and not a mirror image of it?
- In a later age: is it still recognisably the same kind of building, with everything on the
  prompt's Keep line, in the materials of the new age?
- Is the plinth gone, with nothing on the ground around the building?
- Is the foot of both visible walls plain and straight, with nothing standing in front of it?
- Is the lower-left wall lighter than the lower-right wall?
- Is it free of lettering, people, rails and smoke?

If any answer is no, the picture has failed even when the check passes.

## 7. When a picture fails

Make it again. Say in the edit what was wrong ("the door is on the wrong wall: it belongs on the
lower-left wall"), and keep the rest of the prompt. Give a picture up to three attempts.

A picture's place and size in its file are never a reason to make it again: the tools take care of
those. Its view is: a building seen from the front, from above or in perspective cannot be used.

After three attempts, record the picture with
`node tools/building-queue.mjs set <id> rejected --attempts 3 --note "<what went wrong>"`, and go
on. The tool sets the file aside as `<name>.rejected.png`. Nothing is ever built on a picture that
failed: `next` skips the pictures that would have been, and says how many cannot be made.

## 8. Gates, stops and commits

**The two gates.** The depot is made first, all of its 24 pictures; it is the only two-by-two
building. The station comes second; it is the first of the one-tile buildings. After each of them
`next` prints `GATE` (exit code 2). Stop there:

1. `node tools/building-check.mjs --family <family>`
2. `node tools/building-sheets.mjs --family <family>`
3. Commit: `Buildings: <family>, <n> of 24 pictures`.
4. Tell the user the family is ready, with the path of `review/<family>.png`, the number of
   pictures made and rejected, and anything you found hard. Then wait.

Work continues only after the user approves the family. The user may first ask for changes to
this guide, to `families.json` or to the guides; those are not yours to change.

**Every other family.** When `next` hands out the first picture of a new family it says
`Family "<name>" is finished`. Before you make that picture:

1. `node tools/building-check.mjs --family <name>`
2. `node tools/building-sheets.mjs --family <name>`, then look at `review/<name>.png`: the whole
   building, every age and view, on grass, each picture laid onto its footprint as the game will
   lay it.
3. Commit: `Buildings: <name>, <n> of <total> pictures`.

**A stop.** When more than a quarter of a family could not be made (rejected, or built on a
rejected picture), `next` prints `STOP` (exit code 4). Close the family as above, tell the user
what kept going wrong, and wait. The user either has the pictures put back (`redo`) or accepts the
loss (`accept`).

One commit per family, on the branch `art/buildings-v2`.

## 9. Stopping and resuming

`queue.json` is the only record of progress. To resume after any interruption, run
`node tools/building-queue.mjs status`, then `next`. `status` lists every place where the list and
the disk disagree. A picture saved on disk but not recorded counts as not made: record it with
`set <id> generated` (the tool checks it), or remove it.

The repository's `AGENTS.md` asks for progress notes in `assets/source/base-v1/RESUME.md`. That
does not apply to this work: do not edit `RESUME.md`; the queue is the record.

## 10. What you do not touch

- Nothing outside `assets/source/buildings-v2/`.
- Inside it: not `families.json`, not `guides/`, not this guide, not `PROMPT.md`.
- Not the tools, and not the game's code or data. If a prompt seems wrong, or a building cannot be
  painted inside its footprint, record the picture as `rejected` with a note that says why, and go
  on. The notes are how the user learns what to fix.

# Building pictures: the guide

You are painting the buildings of an isometric railway game: 27 kinds of building, each in up to
six ages and four views, 548 pictures in all. This guide tells you how to make them one by one on
your own, how each is checked, and where to stop. Read it once, then work from the queue.

## 1. What the pictures are for

In the game a building is upgraded once per age, and the upgrade swaps the building for a more
modern model. The player can also turn a building in quarter turns. So each building needs one
picture per age and view, and the pictures of one building must agree with each other: the same
footprint, the same camera, the same building seen from four sides.

## 2. The rules every picture follows

**Ages.** `a0` steam, `a1` diesel, `a2` electric, `a3` nuclear, `a4` magnetic, `a5` hyper. A
building's first model is that of the age it appears in; some start at `a1` or `a2`, and a
building of one period ends early (the charcoal kiln is upgraded up to `a2`). Every age
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
vertical edges are vertical, there is no perspective. The camera is the one thing the tools do not
put right for you: they straighten a camera that is a little off, but a picture whose camera is
more than 2° from the guide's, in height or in turn, is refused and has to be made again
(section 7). Straightening stretches a picture, and a stretched building looks wrong in the game.

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
- `<family>/<family>-a<age>-r<view>.before.png`: a picture that was made with its camera off and is
  being painted again. The tool keeps its earlier self here and names it, straightened, as a
  reference (section 5). Do not edit, remove or commit these (nor a numbered
  `.before.1.png`, left from an earlier round).
- `.look/<name>.png`: a picture as you should look at it (section 6), written by `take`
  (`node tools/building-sheets.mjs --picture <file>` writes one for any other file). Not
  committed.
- `.fitted/<family>-a<age>-r<view>.png`: an earlier picture laid onto its footprint by the tool,
  at exactly the guide's camera, scale and place. `next` names these as references: a later
  picture copies the angles of what it is shown, so it is shown them straightened. Attach them as
  named; do not edit or commit them.
- `review/`: the review sheets and their index, made by the sheet tool. `review/<family>.png`
  shows the pictures as the game will lay them; `review/<family>-angles.png` is the same sheet at
  twice the size with the footprint and the line of the walls' feet drawn over each picture.
- `report.json`: the results of the check, with the measurement of every picture.

The tools (also as `npm run art:buildings:guides`, `:queue`, `:check`, `:sheets`, `:fit`):

- `node tools/building-queue.mjs next`: the next picture to make, with everything it needs.
- `node tools/building-queue.mjs take <id> --from <file>`: take the picture your image tool has
  just made, by the file it reported. It is written to the picture's file as it is, and laid on
  grass for you to look at (sections 5, 6).
- `node tools/building-queue.mjs show <id>`: the same for any picture.
- `node tools/building-queue.mjs set <id> <status> [--attempts n] [--note "text"]`: record a result.
- `node tools/building-queue.mjs keep <id>`: where a picture would be given up, make the closest
  attempt the tool holds the picture (section 7).
- `node tools/building-queue.mjs status`: progress per family, the gates, and where the list and
  the disk disagree.
- `node tools/building-queue.mjs recheck` or `recheck <family>`: look again at the pictures that
  are made. One whose camera is more than 2° off goes back in the queue, to be painted again as
  the same building. Only when the user asks.
- `node tools/building-queue.mjs redo <id>` or `redo <family>`: put pictures back in the queue.
  `redo <id>` puts back that picture and every picture built on it, each to be made afresh: for a
  first front view that is the whole family. It says what it would undo and waits for `--yes`.
  Only when the user asks for exactly that. To make one picture again, see section 7.
- `node tools/building-queue.mjs accept <family>` and
  `node tools/building-queue.mjs approve-pilot`: the user's decisions. Run them only when the user
  says so.
- `node tools/building-check.mjs <file>` (or `--family <name>`, `--all`): check pictures.
- `node tools/building-sheets.mjs --family <name>`: build a family's review sheet and the index.
- `node tools/building-sheets.mjs --picture <file>`: lay one picture on grass for you to look at.
- `node tools/building-fit.mjs <id>`: print how a picture is measured. For curiosity only.
- `node tools/building-guides.mjs`: redraw the guides. You should not need it.

## 4. The loop

Repeat until the queue tool tells you to stop:

1. Run `node tools/building-queue.mjs next`. It answers with its exit code:
   - exit code 0: a picture to make. It prints the picture's name and file, the guide to edit,
     the references to attach in order, the prompt, and the command that takes the finished
     picture. A name followed by `(to paint again: the same building)` is a picture that was made
     before with its camera off.
   - exit code 2: `GATE`. A family the user wants to see is finished. Stop (section 8).
   - exit code 4: `STOP`. Too much of a family could not be made. Stop (section 8).
   - exit code 3: `DONE`. Nothing is left.
2. Make the picture and take it with `node tools/building-queue.mjs take <id> --from <file>`
   (section 5).
3. Look at it yourself (section 6).
4. Record it: `node tools/building-queue.mjs set <id> generated`. The tool checks the picture
   first. If the check fails it prints why, the picture is not recorded as made, and the attempt
   is counted: make the picture again (section 7).
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
5. Take the result: `node tools/building-queue.mjs take <id> --from <file>`, naming the file your
   image tool reported. Do not save the picture yourself. (Codex keeps its pictures in
   `$CODEX_HOME/generated_images/`, which is `~/.codex/generated_images/` when that is not set,
   a folder for each chat.) Without `--from` the tool looks there itself for the newest picture
   made in the last 15 minutes, since the last one was taken or recorded, in the chat the last
   one came from. Either way it writes the picture to the picture's file exactly as it is, and
   writes the picture for you to look at (section 6).
   - `nothing new was made`, `was made before the last picture that was taken or recorded`,
     `was taken before`, `was made ... minutes ago`, or `no picture in`: the generation failed,
     or you have not made the picture yet, or you named an earlier file. Nothing is taken; make
     the picture. A picture of the image tool is taken once: one you gave up is not had back by
     naming it.
   - `does not know your chat's folder yet`: the first picture of a list, or the first since the
     tools were brought up to date. Name the file your image tool reported.
   - `no new picture: this is the one that was taken before`: you asked again without making a
     picture, and it shows you the one in hand.
   - `more than one chat's folder`, or `another chat's folder`: other chats are making pictures
     as well, or you have taken the work over from another chat. The tool does not guess: name
     the file your image tool reported.
   - `was refused by set`: the picture that lies there failed the check. Make it again.
   - What the tool keeps of a picture (`<name>.before.png`, `<name>.rejected.png`) is had back by
     naming that file with `--from`.
   - If your image tool keeps its pictures somewhere else, name that folder with `--from`.

   Look at what `take` shows you. If it is not the picture you asked for, your generation failed:
   make the picture, and take again. Make one picture at a time: a picture made before the one in
   hand was recorded is not taken afterwards.

   Never pass a picture through the shell as text (base64, in pieces): that takes a hundred
   commands where `take` needs one.

**A picture to paint again.** Its second reference is the picture as it was, laid onto its
footprint and straightened to the guide's camera, and the prompt's last lines say what was wrong
with its camera. Make it like any other picture: the same building, wall for wall, this time seen
exactly as the guide's block is seen. Straightening has stretched the reference a little, so take
the building and the lines of its wall feet from it, not its height.

## 6. Looking at your own picture

The check measures where the building stands and whether the picture can be used. It cannot see
what the building is. Before you record a picture as `generated`, look at it and at its guide side
by side.

Look at the picture as `take` has written it, in `.look/<name>.png`
(`node tools/building-sheets.mjs --picture <file>` writes the same for any other file): on grass,
on its footprint as you painted it, with the footprint's edge in white, the line its walls' feet
should stand on in pink, and in yellow the frames of the guide's openings: the front door, and a
depot's portals. The frames show which wall the door and the portals belong to; where there is no
door frame (`r1`, `r2`), no front door may show. Under a depot the game's rails are drawn in as
well, on their bed, at the game's own size, through the portals: the track must be seen to run
into each portal, as it will in the game. The depot's track is nearly as wide as a portal, so
there a rail may pass close to a door post, or under one: that is no fault. The narrow depot's
track is narrow, and has room to either side. A family the game draws larger than its footprint
is laid out that large (the depot, 1.3 times its footprint): its walls stand on the pink line,
outside the white edge.
That picture is the one to judge: you need not
look at the raw result at all, and do not judge its background by eye. A viewer that ignores
transparency shows the colour stored under the transparent pixels as a brown or green glow round
the building; that glow is not in the picture. Whether the background is clean is the tool's to
say: `set` refuses a picture with a shadow or a glow, and a picture it accepts has none.

Then answer:

- Is the front on the wall the prompt's View line names? In `r1` and `r2` no front door may show.
- For a depot: are the portals in the wall the guide shows them in? Does the inside of the hall
  show through each of them, its inner wall in shadow, with the ground left open under it: no
  floor, threshold or apron in the portal or before it? The track drawn into the look picture
  must run into each portal, not stop at the wall; and a portal must not be a hole, with only
  grass and track to be seen through it up to its lintel.
- In `r1`, `r2`, `r3`: is it the same building as the `r0` reference (same walls, roof, colours,
  details), turned, and not a mirror image of it?
- In a later age: is it still recognisably the same kind of building, with everything on the
  prompt's Keep line, in the materials of the new age?
- Is the plinth gone, with nothing on the ground around the building?
- Is the foot of both visible walls plain and straight, with nothing standing in front of it?
- Does the foot of each visible wall run parallel to the plinth's edge below it in the guide, both
  walls equally steep? A wall turned towards the viewer, its foot flatter than the plinth's edge,
  is the commonest fault, and so is a camera that looks from lower than the guide's and shows
  less roof than the guide shows top.
- Is the lower-left wall lighter than the lower-right wall?
- Is it free of lettering, people, rails and smoke?

If any answer is no, the picture has failed even when the check passes.

## 7. When a picture fails

Make it again. Say in the edit what was wrong ("the door is on the wrong wall: it belongs on the
lower-left wall"), and keep the rest of the prompt. Give a picture up to three attempts.

A picture's place and size in its file are never a reason to make it again: the tools take care of
those. Its view is: a building seen from the front, from above or in perspective cannot be used.

**A depot's portals.** The tool also tells which of a depot's two visible walls has the portals.
A view of the wrong rotation is refused with `the portals are in the lower-right wall; they belong
in the lower-left wall, where the block-out has them`: make it again, saying in the edit which
wall has the portals and which is the plain back or the front, as the prompt's View line names
them. The tool cannot tell a front from a back, so that is still yours to see.

The game lays its own rails under a depot, through the portals, so the ground inside them stays
empty; and only the ground: through each portal the inside of the hall shows, its inner wall in
shadow. The tool measures both, by the portal's own width. Whatever is painted lowest in a
portal counts as ground painted over: a floor, a threshold, an apron before the portal, rails,
a door leaf or a post in the way. A portal whose ground is open less than 0.3 of its width deep
is refused with `not open to the ground`. A depot's portal open a full width deep over half its
width is a hole, with nothing of the hall in it, and is refused with `seen right through`; of the
narrow depot's portal this is only said, in a note, until its first pictures have been measured.
Either is said of the left or the right portal when it is one of two. Where the tool says that
something is painted before the wall, it has found the wall's foot further in than the lowest
paint: an apron, a step or door leaves lie before the wall, and the walls' feet are to be plain
and straight from corner to corner.

Make such a picture again, and ask for what is wanted in the tool's own words, as they stand:

```text
Inside each doorway paint the hall's inner wall, in shadow. Only the floor is left out: below that inner wall the ground inside the doorway, up to about a third of the doorway's height, and the ground before it stay unpainted and transparent, so that the game's rails show there.
```

These words were tried, and gave the inner walls back with the rails under them. Do not sharpen
them. Do not ask for a portal that is transparent, empty or open "from the foot upwards": told
only what to leave out, the generator leaves the hall out as well, and the portal comes back a
hole. A portal open only a little way in, or seen far through, passes with a note: judge it in
the look picture, and make it again if the rails do not run in or the hall's inner wall does not
show.

**The camera.** The tool measures every picture's camera from the feet of its two visible walls,
and refuses a picture whose camera is more than 2° from the guide's: seen from too low or too
high, or with the building turned so that one wall faces the viewer more than the other. That is
a narrow mark, and most pictures miss it at the first attempt. The tool does the rest:

```text
not recorded: camera off by 6.4°: it looks down from 23.6° where the game looks down from 30°
(the wall feet slope 0.40 and -0.40, the game's 0.50 and -0.50). It is kept as the picture's
earlier self: run `node tools/building-queue.mjs next` again, and it is handed out to be painted
from that, straightened.
```

1. When a picture is refused for its camera alone, the tool keeps it. You copy nothing and you
   add nothing to the prompt: run `node tools/building-queue.mjs next` again. It hands the same
   picture out, marked `(to paint again: the same building)`: its second reference is the
   closest attempt so far, laid onto its footprint and straightened, and the prompt's last lines
   say what was wrong with it. Paint the same building from that (section 5).
2. Do not tell the generator to raise or lower the camera yourself. Told to look down more
   steeply it overshoots, and the camera swings from too low to too high and back.
3. At the third attempt the tool keeps the closest of them all by itself: it records the picture
   as made, straightens it as far as it straightens, and marks it for the user
   (`kept with its camera off by 2.4° after 3 attempts`). It may be an earlier attempt that is
   kept, or the picture's earlier self. There is nothing for you to choose, and no picture is
   lost: the other attempts lie beside it as `<name>.before.1.png`, `.before.2.png`.

The tool counts the attempts it refused and the pictures you took and gave up after looking, so
the count is not lost when a session ends. `--attempts <n>` on `set` is only for attempts the
tool never saw: it can raise the count, never lower it.

A picture with any other fault is made again as before. After three attempts, when none of them
was right (see below), record the picture with
`node tools/building-queue.mjs set <id> rejected --note "<what went wrong>"`, and go on. The tool
sets the file aside as `<name>.rejected.png`. Nothing is ever built on a picture that failed:
`next` skips the pictures that would have been, and says how many cannot be made.

**Before you give a picture up.** If one of its attempts was right and was refused only for its
camera, the tool still holds the closest such attempt as `<name>.before.png` (look at it with
`node tools/building-sheets.mjs --picture <that file>`). Then the picture is not lost because the
last attempt failed for another reason, a door on the back wall, say. Do not reject it:
`node tools/building-queue.mjs keep <id>` makes the attempt the tool holds the picture, recorded
as made and marked for the user with how far its camera is off, and sets the failed attempt
aside. It works at the third attempt, and on a picture that was rejected already. The tool keeps
the attempt whose camera was closest and shows it to you (`.look/<name>.png`): if that is not the
attempt that was right, take the picture back (`set <id> pending`) and say so in your message.
Reject a picture only when none of its attempts was right.

If the earlier self you are given to paint from is itself wrong (the portals missing, the front
where the back should be), say what is wrong in the edit, as for any fault; an attempt that puts
it right is the one to keep.

**A fault found after recording.** If you find a fault in a picture you have already recorded as
`generated`, take it back with `node tools/building-queue.mjs set <id> pending` and make it again:
the tool sets the faulty file aside, and `next` hands the picture out the way it was being made.
Do not use `redo` for this.

## 8. Gates, stops and commits

**The two gates.** The depot is made first, all of its 24 pictures; it is the only two-by-two
building. The station comes second; it is the first of the one-tile buildings. After each of them
`next` prints `GATE` (exit code 2). Stop there:

1. `node tools/building-check.mjs --family <family>`
2. `node tools/building-sheets.mjs --family <family>`
3. Commit: `Buildings: <family>, <n> of 24 pictures`.
4. Tell the user the family is ready, with the path of `review/<family>.png`, the number of
   pictures made, kept with the camera off and rejected, and anything you found hard. Then
   wait.

Work continues only after the user approves the family. The user may first ask for changes to
this guide, to `families.json` or to the guides; those are not yours to change.

**Every other family.** When `next` hands out the first picture of a new family it says
`Family "<name>" is finished`. Before you make that picture:

1. `node tools/building-check.mjs --family <name>`
2. `node tools/building-sheets.mjs --family <name>`, then look at `review/<name>.png`: the whole
   building, every age and view, on grass, each picture laid onto its footprint as the game will
   lay it.
3. Commit: `Buildings: <name>, <n> of <total> pictures`.

If the check fails a picture that is already recorded as made (the tools may have been brought up
to date since it was made), do not make it again on your own. Name it in your message to the
user, who decides whether it is put back.

**Pictures painted again.** When the user has had pictures put back with `recheck`, `next` hands
those out before anything new, family by family in the list's order. For the depot and the
station `recheck` closes its gate again: `next` prints `GATE` when the family is painted again,
and you stop as at any gate. Each time `next` moves on from any other family, close the family
you have just finished repainting as above (check, sheets), and commit:
`Buildings: <name>, camera repainted`. In your message to the user, name the pictures the tool
kept with the camera off, and by how much.

**A stop.** When more than a quarter of a family could not be made as it should be (rejected,
built on a rejected picture, or kept with its camera off by more than 3°), `next` prints `STOP`
(exit code 4). A picture kept within 3° is near enough: it is marked, and the work goes on.
Close the family as above, tell the user what kept going wrong, and wait. The user either has the
pictures put back or accepts the family as it is (`accept`).

One commit per family, on the branch `art/buildings-v2`. Also commit what you have before you
merge the tools or run anything that moves many files (`Buildings: work in progress`), and never
stash pictures: a commit is the one safe place for work in hand.

## 9. Stopping and resuming

`queue.json` is the only record of progress. To resume after any interruption, run
`node tools/building-queue.mjs status`, then `next`. `status` lists every place where the list and
the disk disagree. A picture saved on disk but not recorded counts as not made: look at it and
record it with `set <id> generated` (the tool checks it), or make it again (`take` replaces it).

This is also how another session takes the work over. A new chat, on another account or after
this one has run out, is started with the block in `PROMPT.md` and needs nothing from the chat
before it: everything a session has to know is in this guide and in what `next` prints. Go by
those, not by what you remember. When a long chat is shortened, its way of working is the first
thing lost, and the tools are how it is kept.

The repository's `AGENTS.md` asks for progress notes in `assets/source/base-v1/RESUME.md`. That
does not apply to this work: do not edit `RESUME.md`; the queue is the record.

## 10. What you do not touch

- Nothing outside `assets/source/buildings-v2/`.
- Inside it: not `families.json`, not `guides/`, not this guide, not `PROMPT.md`.
- Not the tools, and not the game's code or data. If a prompt seems wrong, or a building cannot be
  painted inside its footprint, record the picture as `rejected` with a note that says why, and go
  on. The notes are how the user learns what to fix.

# Codex redo prompts (review of 2026-10-17)

Only the prompts that follow from the 2026-10-17 review are here, in the order to paste them, ready
for the Codex prompts page (v8). Lanes run in parallel; inside a lane paste one at a time, each after
the previous one is pushed.

## Paste order

1. **Buildings lane**, one at a time:
   1. **C4c** first: branch `art/325-buildings-v2`, issue #325. Two pictures, at most six calls. It
      waits for the author's answer to D1 (the mirrored r3). If the answer is yes, paste C4c as it
      is. If it is no, paste C4c and then the C4c addendum below it in the same message.
   2. **R8c** after C4c is pushed: branch `art/325-fuel-pump`, issue #325. Three pictures, at most
      nine calls. If D1 is still open when a buildings slot is free, paste R8c first: the two are on
      different branches and folders, so the order can swap.
   3. **C17b** is held. Paste it only if the author answers no to D3 (Core's Art agent builds the
      sail cross from Codex's first painted sail by script). Then it goes after R8c.
2. **People lane**: **R7b**, branch `art/331-people`, issue #331. One picture, at most three calls.
   It can run in a separate Codex window beside the buildings lane.
3. **Trees lane**: nothing. C16 passed; Core's Art agent finishes and packs it.

Not here: C5's front people strips also need repainting (the same leg leads twice in a cycle).
Core writes that prompt (R7c) after R7b shows that the front-view correction works.

## C4c · Coaling stage r1 and r2 at r0's height (2 pictures)

Buildings lane, 1st. Branch art/325-buildings-v2 (exists, head 8bf01c45 or later). Issue #325.
Follows C4b, which is delivered: the water tower's four views and the coaling stage's r0 and r3 stay
as they are. The prompt asks for the queue's `redo` command itself; pasting it is the author's ask
for exactly that. Before pasting: the author answers D1. If the mirrored r3 is accepted, paste the
text as it is; if not, paste the addendum right after it.

```text
Paint two views of the coaling stage (fuel_stop, Steam age a0) again for the isometric railway
game in this repository, for issue #325: r1, then r2. The other six pictures of C4b stay as they
are. Work on branch art/325-buildings-v2, which exists: git fetch origin art/325-buildings-v2,
git switch art/325-buildings-v2, git pull --ff-only (head 8bf01c45 or later). Touch nothing
outside assets/source/buildings-v2/. Commit there, never stash pictures, push the branch. Never
push to main or develop. Commit subjects read "Buildings: <outcome>".

WHY AGAIN. Your r1 and r2 are good paintings of a different building. In the game they come out low
and long: laid onto the tile beside r0, r1's top stands 341 px above the anchor where r0's stands
547 (62%), r2's 378 (69%), and turning the stage makes it shrink and spread. All six of your r1 and
r2 attempts came back the same way, the first ones too, which had r0 attached. What went wrong shows
in the pictures you painted: their feet are spread wider than r0's (r1 attempt 2: the feet span x
289 to 992, 703 px, where r0's span x 324 to 960, 636 px, about the plinth's own width), so the
bunker grew longer and deeper and the legs shorter to fit the same picture. r0's piers stand on the
plinth's corners, and its top rises above the grey block's top face by about half the block's
height. r3 attempt 3 shows that a turned view at r0's height can be painted.

READ FIRST: assets/source/buildings-v2/GUIDE.md sections 5 to 8 again.

THE MASTER. assets/source/buildings-v2/fuel_stop/fuel_stop-a0-r0.png, 1254x1254, sha256
49f701ce3e2bd4a3c4b0a2a6194fd1470a56390dda9f241dd7a82c9a2e6c6ce4. Check the hash first; if it
differs, stop and say so. What r0 shows, to carry round: a raised timber stage on six stone
piers, a coal bunker of planks with iron straps and corner posts, heaped with coal, on tall
X-braced timber legs. The legs, from the pier caps up to the bunker's floor, are longer than the
bunker's plank wall is deep. The front (lower-left in r0) is the SHORT side, two piers and one
bay, with the chute sloping out from it and the winch drum and chain at its left end. The
right-hand side (lower-right in r0) is the LONG side, three piers and two braced bays. Spans
measured on r0: lower-left 269.0 px, lower-right 367.0 px.

PUT THE TWO PICTURES BACK, afresh, so that they are painted from r0 and not from their low
earlier selves:
  node tools/building-queue.mjs redo fuel_stop-a0-r1 --yes
That puts back r1 and r2 and sets the low pictures aside; r0 and r3 stay recorded. Run
node tools/building-queue.mjs status and check that fuel_stop-a0-r1 and -r2 are pending and r0
and r3 generated. Do not run "next"; use show and take with each id, r1 first, then r2.

EACH PICTURE. As in C4b: show <id>, paint as an edit of the block-out with the references show lists
in its order, take <id> --from <file>, look at .look/<id>.png, measure, set <id> generated --note
"<measurements>". Copy each file your image tool reported to raw/<id>-attempt-<k>.png byte for byte
before you take it, k going on from 4, and add {id, attempt, file, returned, spans, top, kept} to
raw/returns.json. Paste the printed prompt whole, then the view's Correction paragraph below, on
EVERY attempt of these two pictures, the first one and a camera repaint (marked "to paint again: the
same building") included: the earlier attempts lost the stage's height exactly there. In a camera
repaint, also attach .fitted/fuel_stop-a0-r0.png after the references show lists (four in all), for
the height.

For r1:
Correction: the earlier r1 came back a low, long bin, not this coaling stage turned. Its piers
stood outside the grey plinth, its bunker was longer and deeper than in the front view and its
legs half as long. Stand the six piers on the plinth: the outer piers on the plinth's left,
near and right corners, nothing outside it. Paint the bunker of the front-view reference, the
same size, no longer and no deeper, on the same tall legs: from the pier caps to the bunker's
floor longer than the bunker's plank wall is deep. The bunker's top rim rises above the grey
block's top face, by about half the block's height, as in the front view. The lower-left wall is
the right-hand side, the long side: three piers and two X-braced bays. The lower-right wall is
the back, the short side: two piers and one bay. The chute, the winch and the chain are on the
front, out of sight: none of them shows.

For r2:
Correction: the earlier r2 came back a low, long bin, not this coaling stage turned. Its piers
stood outside the grey plinth, its bunker was longer and deeper than in the front view and its
legs short. Stand the six piers on the plinth: the outer piers on the plinth's left, near and
right corners, nothing outside it. Paint the bunker of the front-view reference, the same size,
on the same tall legs: from the pier caps to the bunker's floor longer than the bunker's plank
wall is deep. The bunker's top rim rises above the grey block's top face, by about half the
block's height, as in the front view. The lower-left wall is the back, the short side, two piers
and one bay, as r1 shows it. The lower-right wall is the left-hand side, the long side, three
piers and two X-braced bays, as r3 shows it. The chute, the winch and the chain are on the
front, out of sight: none of them shows.

MEASURE BEFORE YOU RECORD (after take, before set): node tools/building-fit.mjs <id>. With its
base corners w, s and e, the lower-left foot spans s.x - w.x and the lower-right foot e.x - s.x;
its box.top is how high the stage stands once laid onto its tile (r0: 284.8). Read a corner by
eye where the tool lands on a chain or a loose stone, and say so. A picture passes when:
- the tool accepts its camera (set does not refuse it);
- r1: lower-left foot / lower-right foot between 1.16 and 1.57 (r0's ratio turned over, 1.364,
  within 15%); r2: between 0.62 and 0.84 (r0's 0.733 within 15%);
- box.top at most 340: the stage stands at least 90% as high as r0 (your last r1 was 491.4, r2
  454.3, r3 333.4);
- by eye: no chute, winch or chain on either wall; six piers, three along the long side; the
  same bunker, coal heap, straps and legs as r0; lower-left wall lighter than lower-right.
A picture that fails the plan or the height test is made again, keeping every Correction
paragraph and adding one that gives the number it missed, as GUIDE.md section 7 says; at most
three attempts. If none passes, record the one closest in height whose camera the tool
accepted, say so in the note, and go on; do not reject it.

CLOSE THE FAMILY. node tools/building-check.mjs --family fuel_stop; node
tools/building-sheets.mjs --family fuel_stop, then look at review/fuel_stop.png: all four views
should be one stage of one height. Commit "Buildings: fuel_stop, r1 and r2 at r0's height", push
the branch and stop. In your message give the review sheet's path, each attempt's spans, ratio,
box.top and camera, and which attempt was kept.
```

### C4c addendum (only if the author answers no to D1)

Paste it in the same message, right after C4c's text.

```text
ALSO r3. The author wants the coaling stage's r3 turned, not mirrored, so paint r3 again too.
After the redo line under PUT THE TWO PICTURES BACK, also run
  node tools/building-queue.mjs redo fuel_stop-a0-r3 --yes
and check with status that fuel_stop-a0-r1, -r2 and -r3 are pending and r0 generated. Paint r1,
then r3, then r2. Number r3's attempts on from 4 as well. Treat r3 as r1 above: the same references
(with .fitted/fuel_stop-a0-r0.png in a camera repaint), the same plan range (lower-left foot /
lower-right foot between 1.16 and 1.57), the same height test (box.top at most 340), and by eye:
the chute, the winch drum and the chain on the lower-right wall, the winch and chain at its near
(bottom) end; six piers, three along the long side; lower-left wall lighter than lower-right. Paste
this paragraph after the printed prompt on every r3 attempt:

Correction: the earlier r3 came back mirrored: the winch drum, the chain and the chute stood at
the front's right end, where the front view has them at its left end. This view is the front view
turned on a turntable, not flipped. The lower-right wall is the front, the short side: two piers
and one bay, with the chute sloping out from it, and the winch drum and chain at the front's left
end, which in this picture is the near (bottom) corner. The lower-left wall is the left-hand side,
the long side: three piers and two X-braced bays. Stand the six piers on the plinth: the outer
piers on the plinth's left, near and right corners, nothing outside it. Keep the stage as tall as
in the front view: the bunker's top rim rises above the grey block's top face by about half the
block's height.

Commit "Buildings: fuel_stop, r1, r3 and r2 at r0's height, r3 turned" instead of the commit
subject above, and give r3's attempts and the one kept in your message as for r1 and r2.
```

## R8c · Fuel Pump r3 relit, r1 and r2 repainted on r0's plan (3 pictures)

Buildings lane, 2nd. Branch art/325-fuel-pump (exists, head f3ac1a30 or later). Issue #325.
Replaces R8b, which is delivered: its guides and plan test worked, but none of r1, r3 or r2 passed
every test. r3 starts as an image edit of attempt 7, which changes only the light, the crane and
the hose; r1 and r2 are painted on the committed guides. It adds a height test and a light test
(light-check.mjs, which Codex writes and checks against known values first). building-check.mjs
still refuses fuel pump pictures by name; the prompt sends the camera test through
record-attempt.mjs, which R8b committed, so nothing needs answering there.

```text
Repaint three views of the Fuel Pump (fuel_pump, Diesel age a1) for the isometric railway game in
this repository, for issue #325: r3 first, then r1, then r2, each the committed r0 building turned.
Work on branch art/325-fuel-pump, which exists: git fetch origin art/325-fuel-pump, git switch
art/325-fuel-pump, git pull --ff-only (head f3ac1a30 or later). Touch nothing outside
assets/source/fuel-2026-10-11/. Commit there and push the branch. Never push to main or develop.
Commit subjects read "Art: <outcome>".

WHERE THE LAST ROUND LEFT IT. Your guides and the plan test worked: r1 attempt 8 and r3 attempt 7
both have r0's long, narrow plan (about 2.5 and 2.74). Neither can ship yet:
- r3 attempt 7 is the right building turned the right way. The long front is on the lower right,
  in two bays, with the door bay and porch at the near end. The short plain side is on the lower
  left, the tank lies along the front, and the building is as tall as r0. But it kept r0's light.
  Its front is as light as its side: the brick's median luma is 121 against 119, where r0's side is
  67 against its front's 112. The tank's end facing the lower left is its darkest green. Its hose
  comes down to the wall's foot in the picture, and its crane is a portal of two posts, not r0's
  one post. Its camera is 2.2 degrees off.
- r1 attempt 8 has the plan, plain walls and the right light. But its camera is 4.6 degrees too
  high: the wall feet slope 0.61 and -0.53. Its brick walls are lower than r0's, 0.35 of the
  house's width where r0's are 0.45. The crane's post stands near the right end, not at the far
  (top) corner.
- r2 was not painted, as the last prompt said, because r1 was more than 3 degrees off.

READ FIRST, on this branch: docs/art-direction/README.md (sections 1, 4 and 6),
docs/art-direction/building-production.md, and assets/source/buildings-v2/GUIDE.md sections 2, 5,
6 and 7. In this folder: prompts.json (its "verbatim" texts and "attempts").

THE MASTER. fuel_pump-a1-r0.png, 1254x1254, sha256
c2ef828ed902b68daa5ef6849d149eb7bb204abe20706a60a281ac83c6d053f0. Check the hash first; if it
differs, stop and say so. Its fitted copy refs/fuel_pump-a1-r0-fitted.png stays the reference.
What r0 shows; carry it round the building:
- a LONG, NARROW red-brick pump house on cream limestone quoins and base. Its front is about 2.4
  times as long as its sides. Its walls are tall, about half the building's height under the tank;
- the front in two bays, from its left end: the door bay, with forest-green plank door, a lamp over
  it and a small slate-roofed porch gable standing a little forward of the wall; a downpipe; a
  plain brick bay; a big quoined pier at the front's right end;
- the sides and the back: plain brick between quoins, no door. A side is one bay wide;
- on the house, a dark steel frame with X bracing, and on it a riveted forest-green steel tank with
  two oat-cream bands, a railing, a manhole and a vent. The tank lies along the front, as long as
  the front and as wide as the house is deep, so it covers the whole roof;
- a tall forest-green hose crane at the front's left end: ONE post with a diagonal brace and ONE
  jib. The jib stands high above train height, with the hose hanging from its end. On r0 it is
  swung out past the front's left end. In the views below, paint it square to the front, so the
  hose hangs over the track side;
- pipes from the tank to the crane, with copper bands.

THE VIEWS (GUIDE.md section 2: the camera never moves; turning the building changes which walls
it sees).
r3: the front faces the lower right. The lower-right wall is the FRONT: LONG, in r0's two bays.
  From the near (bottom) corner: the crane's post, the door bay with its porch gable and lamp, the
  downpipe, the plain bay, and the big quoined pier at the right corner. The lower-left wall is the
  left-hand side: SHORT, one plain bay. The tank lies along the lower-right wall. The jib reaches
  out from the post's top, square to the front: in the picture it runs parallel to the lower-left
  wall's foot, falling to the lower right. The hose hangs from its end in front of the door bay.
  It is r0 turned, not r0 mirrored.
r1: the front faces the upper left, out of sight. The lower-left wall is the right-hand side:
  SHORT, one plain bay, as r0's lower-right wall. The lower-right wall is the BACK: LONG, plain
  brick and quoins, no door, no porch. The tank lies along the lower-right wall and is as long as
  it. The crane's post stands at the far (top) corner, behind the house: where the block-out's
  thin post shows above the block, left of the block's right corner. Its jib reaches away from the
  post's top, square to the hidden front: in the picture it runs parallel to the lower-left wall's
  foot, rising to the upper left.
r2: the front faces the upper right, out of sight. The lower-left wall is the BACK: LONG, plain,
  as on r1's lower-right wall. The lower-right wall is the left-hand side: SHORT, one plain bay, as
  on r3's lower-left wall. The tank lies along the lower-left wall. The crane's post stands at the
  right corner, where the block-out's thin post is. Its jib reaches away from the post's top,
  square to the hidden front: in the picture it runs parallel to the lower-right wall's foot,
  rising to the upper right.
In every view the house is r0's: the long wall about 2.4 times the short one, its brick walls as
tall as the block-out's lower box, the frame and tank as tall as its upper box, the tank as long
and as fat.

THE LIGHT. The light does not turn with the building. In every view it comes from the upper left:
tops lightest, the picture's lower-left wall mid, as r0's front, and the picture's lower-right
wall darkest, as r0's short side. So on r3 the front, with its door and porch, is in shade. The
short lower-left side is in the mid tone. The tank's long side faces the lower right and is dark,
and its end facing the lower left is mid green, as r0's long tank side is. On r1 and r2 the side
and the back show the same way: lower-left wall mid, lower-right wall dark.

GEOMETRY. Footprint t1 (tools/building-kit.mjs): canvas 1024x1024, scale 8 canvas px per game px,
footprint centre on the ground at canvas (512,832), which is the anchor. Orthographic 2:1
isometric, 30 degrees down, building turned 45 degrees, no perspective. Use the committed block-outs
guides/fuel_pump-r1.png, -r3.png and -r2.png as they are; do not redraw them.

REFERENCES. At most five images per call. Start an image edit, not a new image.
- r3, first attempt: edit raw/fuel_pump-a1-r3-attempt-7.png (the image to edit), with
  docs/art-direction/images/03-theme-town-growth.png (the style board) and
  refs/fuel_pump-a1-r0-fitted.png. Keep its building, plan, walls, tank, door, porch and lamp
  where they are. Change only the light, the crane and the hose, as the correction says. If the
  edit keeps the old light or moves the building, paint the next attempts on
  guides/fuel_pump-r3.png with the style board and refs/fuel_pump-a1-r0-fitted.png.
- r1: guides/fuel_pump-r1.png (the image to edit), the style board,
  refs/fuel_pump-a1-r0-fitted.png.
- r2: guides/fuel_pump-r2.png, the style board, refs/fuel_pump-a1-r0-fitted.png,
  refs/fuel_pump-a1-r1-fitted.png, refs/fuel_pump-a1-r3-fitted.png.
After you accept r3 and r1, make refs/fuel_pump-a1-r3-fitted.png and refs/fuel_pump-a1-r1-fitted.png
with fit-refs.mjs (rotations 3 and 1). If r2 is painted on closest attempts instead (see the end
of MEASURE BEFORE COMMITTING), fit those two the same way and record which attempts they are.

THE PROMPT. Use the "shared" text, the view's line from "views" and "ages.a1" of
assets/source/buildings-v2/families.json word for word (they are in this folder's prompts.json
under "verbatim"). Then write the building: "Fuel Pump. A railway refuelling point for diesel
engines", followed by what r0 shows, above. Then add the view's paragraph and THE LIGHT, above,
and the GUIDE's reference paragraphs:
- every view: "References: the first is the style board. The second is this same building in
  view r0, seen from the front, laid onto its footprint at exactly the block-out's camera and
  scale. Paint the SAME building at the same size, turned on a turntable while the camera stays
  where it is. It is not a mirror image: show the walls named under View, and carry the same
  materials, roof, colours and details round the building. The light stays where it is: it does
  not turn with the building."
- r1 and r2: "It is exactly as large as in the references: no taller, no lower, and with no
  storey more."
- r1 and r2 end with: "Do not paint the reference again. There, in view r0, the lower-left wall
  is the front: the side with the door and the hose crane. In this picture the front faces away,
  hidden behind the building: neither visible wall is the front, and what the front has does not
  show on them."
- r2: "The third reference is this building in view r1: its lower-right wall is the BACK, and
  that wall is the lower-left wall of this picture. The fourth is view r3: its lower-left wall is
  the left-hand side, and that wall is the lower-right wall of this picture."
- r3, first call: "Correction: this picture is the right building, turned the right way. Keep it
  where it is and as large as it is. Only three things are wrong. First, the light: it was painted
  as if the light had turned with the building. Put the long lower-right wall in shade, with its
  brick, quoins, door, porch side and pier as dark as r0's short side. Paint the short lower-left
  side in the mid tone of r0's front. Make the tank's long side, which faces the lower right, dark,
  and its end facing the lower left mid green. Second, the crane: one post at the near corner with
  one diagonal brace and one jib, as on r0, with no second post and no cross beam. Third, the hose:
  it hangs from the jib's end in front of the door bay, and its end is at about the top of the
  door. In the picture, the gap between the hose's end and the wall's foot below it is at least
  half the door's height."
- r1, first call: "Correction: the last picture of this view was painted from too high a camera.
  Too much of the tank's top showed, the wall feet sloped 0.61 and -0.53 instead of 0.5 and -0.5,
  and the brick walls came out lower than r0's. Keep the block-out's camera exactly: both wall
  feet fall one pixel for every two across, as the block's do. The brick walls are as tall as the
  block-out's lower box, and the frame and tank as tall as its upper box. The crane's post stands
  at the far (top) corner, behind the house, where the block-out's thin post is, not at the right
  end."
- r2, first call: "Correction: the last picture of this view was a different building: a low
  stand with walls a quarter of its height and the crane behind the middle of the tank. Paint
  r0's tall, narrow pump house on the block-out, its brick walls as tall as the block's lower
  box, its crane post at the right corner where the block's thin post is."

KEEP EVERY EARLIER PICTURE. Number new attempts on from the records: r3 from 9, r1 from 10, r2 from
4; if prompts.json already holds a higher number for a view, go on from that. Save every attempt as
raw/fuel_pump-a1-r<v>-attempt-<k>.png, and copy the accepted one to fuel_pump-a1-r<v>.png. Never
delete a painting. Do not touch fuel_pump-a1-r0.png.

CANVAS SIZE. Ask for 1024x1024 px. Keep the picture exactly as returned and record "returned":
[w, h] for every attempt.

THE LIGHT CHECK. Write light-check.mjs here (Node, pngjs only). It takes a picture and two boxes
x0,y0,x1,y1. For each box it prints the median luma (0.2126 R + 0.7152 G + 0.0722 B) of the brick
pixels in it: alpha above 200, red at least 25 above green, green no more than 10 below blue. Test
it on fuel_pump-a1-r0.png with the boxes 760,880,850,1000 (the front) and 975,830,1060,960 (the
side): it prints about 112 and 67. On raw/fuel_pump-a1-r3-attempt-7.png (today's
fuel_pump-a1-r3.png) with 400,880,530,1000 and 850,760,1000,860 it prints about 119 and 121. If it
does not, fix the check before you paint.

MEASURE BEFORE COMMITTING, for every attempt:
1. Plan: run measure-plan.mjs on the picture. Where measureBase's w, s or e falls on the hose, a
   post, the downpipe, the porch or inside a quoin step instead of the house's outer quoin corner,
   read the corner by eye and record both values and which you used (on r1 attempt 8, w and e sat
   47 px and 36 px inside the corners). The lower-left foot spans s.x - w.x and the lower-right
   foot e.x - s.x. Pass: for r1 and r3 the lower-right foot is 2.0 to 2.8 times the lower-left
   foot; for r2 the lower-left foot is 2.0 to 2.8 times the lower-right foot.
2. Height: at the near corner, measure the brick wall from its foot to the top of its quoins, and
   divide by e.x - w.x of the corners you used. Pass: 0.40 to 0.50 (r0: 0.45).
3. Camera: building-check.mjs does not know fuel_pump by name and refuses the file. Run
   record-attempt.mjs, which runs its checkFile with footprint t1 and the view's turn. Pass: within
   2 degrees. A kept picture that passes every other test may be accepted within 3 degrees (FIT.near
   in tools/building-fit.mjs); record that it was.
4. Light: run light-check.mjs with a box on plain brick of each visible wall, clear of quoins,
   door, pipes and the crane. Pass: the lower-right wall's value is at most 0.75 times the
   lower-left wall's (r0: 0.60).
5. Look: write the picture on grass as you did for review/ (fit and normalise at t1). Check that
   the front, door, porch, crane, jib and hose are where THE VIEWS and the correction say, that
   nothing touches the picture's edge, and that set beside r0 it is r0's building.
Make at most three new attempts per view. After an attempt that failed for what it shows, add a
paragraph that begins "Correction:" and says what was wrong (GUIDE.md section 7). If none passes,
keep the closest and say which test failed. Paint r2 once r3 and r1 are accepted. If they are
not, paint it anyway when their closest attempts pass the plan, height and light tests and are
within 3 degrees of camera, and use those as its references.

STYLE AND OUTPUT RULES. Smooth painted contours, broad readable masses, three or four shades per
material. Light from the upper left: tops lightest, lower-left walls mid, lower-right walls
darkest. Palette: forest #294638, moss #78804C, oat #E4D5B5, limestone #BCA98B, slate #626B6C, teal
#477B82, copper #A36B42.
Highlight cap: nothing at or above the game's cursor white #ECE4D0, and no yellow or orange as
strong as its selection amber #E8AA48.
Transparent background (alpha 0), opaque surfaces, a short side of at least 768 px. Never: ground,
plinth, grass, shadows outside the base, rails, trains, people, vehicles, smoke, lettering, signs
with text, borders, glow, loose objects.

Record every attempt in this folder's prompts.json "attempts" list as {view, attempt, selected,
file, prompt, references, returned, measured}. In measured, record the plan with the corners you
used and whether any was read by eye, the height, the camera, the light values with their boxes,
and what you saw. Commit light-check.mjs with the pictures. Update "selection" and "qa". Then
commit ("Art: Fuel Pump r3 relit, r1 and r2 repainted on r0's plan") and push.
```

## R7b · People: pump hand front carry f2, left foot forward (1 picture)

People lane. Branch art/331-people (exists, head 4dcd0544 or later). Issue #331. Follows R7
(resumed), which is delivered: eight of its nine strips are accepted, and Core finishes three of
them itself. Only f2 of pump-hand-front-carry is painted again. Until it lands, Core plays that
strip as f1, f3.

```text
Repaint one pose of the small figures of the isometric railway game in this repository, for issue
#331: frame f2 of pump-hand-front-carry. Work on branch art/331-people, which exists: git fetch
origin art/331-people, git switch art/331-people, git pull --ff-only (head 4dcd0544 or later). Touch
nothing outside assets/source/people-2026-10-11/. Commit there and push the branch. Never push to
main or develop. Commit subjects read "Art: <outcome>".

WHERE THIS STANDS. Core reviewed the nine strips on 2026-10-17. Keep every file. Eight strips are
accepted; Core finishes three of them itself (two colour clamps and one rescale), so paint nothing
for them. In pump-hand-front-carry, f0 (attempt 2), f1 (attempt 2) and f3 (attempt 3) are accepted.
Paint f2 only. Do not touch the other strips, the other poses, guides/, refs/, review/, game-scale/
or inputs/. Do not run export-*.cjs, build-review.cjs or verify-exports.cjs.

Correction: all three f2 attempts painted the near (right) leg leading, as in f0. The right thigh
runs from the hips down to the screen-right knee, and the right boot is the forward one at the
lower right, heel down. Lay f0 over any of them at 50% and the legs lie on top of each other instead
of crossing. Every one of those calls attached poses/pump-hand-front-carry-f0.png, and the edit
copied its legs whatever the words said. This time attach no painting whose right leg leads:
neither f0 nor f1. Take the figure from f3 instead. Its left leg is already the planted one, and f2
is the moment just before: that left leg reaching forward, the right leg trailing.

THE POSE. Front view: he walks toward the lower right of the screen (tile +x). We see the face and
the front-right side in 3/4, and the right leg is the near one.
- The far (left) leg leads. From the hips it goes down toward the screen right, and its boot is the
  forward one, at the lower right of the figure, heel down and toe up. It is the farther leg, so
  where the legs cross at the knees the near leg covers part of it.
- The near (right) leg trails. From the hips it goes down toward the screen left, knee slightly
  bent. Its boot is behind at the lower left, heel lifted, toe on the ground, part of the sole
  showing.
- The right arm swings forward, as in the guide. The yoke, both buckets and the teal water stay as
  in f3, with no spills.
- The head is no more than 2% of the height higher or lower than in f3. Same man, clothes, load and
  size.

THE GUIDE. Use guides/pump-hand-front-carry-f2.png as it is; do not redraw it. Its darker leg is the
near (right) one, and it trails to the screen left.

REFERENCES, in this order, four images. Start an image edit, not a new image.
1. guides/pump-hand-front-carry-f2.png: the pose authority. Follow its legs and arms.
2. poses/pump-hand-front-carry-f3.png: the same man, clothes, yoke, buckets, size and style. Take
   everything above the hips from it, never its legs.
3. refs/pump-hand-front-walk.png: the identity. An older man with deep warm brown skin and grey hair
   at the temples, a moss flat cap, rolled sleeves on a muted slate-blue shirt, charcoal trousers,
   brown boots.
4. reference-passenger.png: the style authority, not the person.
Do not attach poses/pump-hand-front-carry-f0.png or poses/pump-hand-front-carry-f1.png.

KEEP EVERY PICTURE. Ask for 1024x1536 px every time. Save every painting the image tool returns as
raw/poses/pump-hand-front-carry-f2-attempt-<a>.png, starting at attempt 4, and keep it exactly as
returned. Record each call in prompts.json under "redo-2026-10-11" as before: {id, strip, frame,
file, prompt, references, returned, measured}. Make at most three new attempts: 4, 5 and 6.

MEASURE BEFORE ACCEPTING (check-poses.mjs, as for the other poses).
- The height and the 2:3 return rules stay as before. Record the sole row and the width.
- The repeat test, new. Stand f0 and the new painting on the same point: the picture's centre
  column (x 512 on a 1024-wide painting; scale the new one to f0's size first if it came back at
  another size) and each one's lowest row with alpha above 128. Take the lowest 40% of each
  figure's height, alpha above 128. The intersection over union of the two masks must be below
  0.45. For comparison, the guides measure 0.39, the accepted back strips 0.31 to 0.47, and the
  three rejected attempts 0.53 to 0.62. Record the number.
- By eye: in the 50% overlay of f0 and the new f2 the thighs cross in an X, and the forward boot is
  the far (left) one, partly hidden behind the near shin. The face, skin, cap, shirt, yoke, buckets
  and water match f3. The water is teal #477B82, never cyan, and there is no outline round the
  whole figure.
Accept the first attempt that passes both. If none of the three passes, accept none. Record why in
prompts.json and say so in your final message; Core then plays this strip as f1, f3.

THE STRIP. Accept the painting with check-poses.mjs accept, so that it is copied to
poses/pump-hand-front-carry-f2.png. Then run node assets/source/people-2026-10-11/assemble-strips.mjs
pump-hand-front-carry. It keeps the 320 px columns and writes checks/pump-hand-front-carry-9px-6x.png
and checks/pump-hand-front-carry-36px.png. Look at both: the leading leg must change from f0 to f2,
and f1 and f3 must lift opposite feet. Update finish-report.json (repeatedFrames empty when the
test passes) and redo-state.json. Before committing, run node --test
assets/source/people-2026-10-11/pose-tools.test.mjs and node
assets/source/people-2026-10-11/redo-protection.mjs check. Commit "Art: pump-hand-front-carry f2
repainted with the left foot forward" and push.

STYLE AND OUTPUT RULES. Smooth painted contours, broad colour clusters, three or four shades per
material, selective dark contours on lower and side rims only: never a full outline round the
figure. One light from the upper left. Subdued clothing from the game palette: forest #294638, moss
#78804C, oat #E4D5B5, limestone #BCA98B, slate #626B6C, teal #477B82, copper #A36B42. Skin and hair
are warm and natural, and his skin is the same as in f3. Highlight cap: nothing at or above the
game's cursor white #ECE4D0, and no yellow or orange as strong as its selection amber #E8AA48. A
real RGBA PNG: alpha 0 background, opaque figure. Never: ground, floor, cast or ground shadow,
text, labels, borders, frame numbers, glow, extra objects, extra people.

End with a message that names the accepted attempt and its overlap number, or says that none passed
and why.
```

## C17b · Windmill sail cross from one painted arm (held, 1 picture)

Held. Buildings lane, after R8c, and only if the author answers no to D3. Branch
art/461-windmill-sails (exists, head 5d84f104 or later). Issue #461. The body without its sails is
accepted and is not repainted. The review's plan is that Core's Art agent builds the cross from
Codex's first painted sail (raw/windmill-sails-front-attempt-1.png) by script; this prompt is the
fallback, in which Codex paints one new arm and its own script builds the cross the same way.

```text
Repaint the sail cross of the windmill of the isometric railway game in this repository, for
issue #461. The windmill's body without its sails is accepted: do not paint it again. Work on
branch art/461-windmill-sails, which exists: git fetch origin art/461-windmill-sails, git switch
art/461-windmill-sails, git pull --ff-only (head 5d84f104 or later). Touch nothing outside
assets/source/windmill-2026-10-16/. Commit there and push the branch. Never push to main or
develop. Commit subjects read "Art: <outcome>".

Correction: the last three sail pictures painted the cross as two mirrored pairs, not as four
arms alike by quarter turns (quarter-turn overlap 0.43 to 0.63 where 0.80 is asked). The kept one,
attempt 3, has its plate 30 px above the picture's centre, so it would circle round the hub as it
turns, and its sails are single ladders, narrower than the master's frames of three long rails and
two bays. The image tool does not keep four arms alike, so now it paints one arm and the plate,
and a script turns that arm into the cross. Every picture came back 1254x1254 for a 1024x1024 ask:
that is fine, every test below is a share of the side.

READ FIRST: hub.json and check-sails.mjs in the folder, docs/art-direction/README.md section 1,
and assets/source/buildings-v2/GUIDE.md section 7.

1. Write make-arm-guide.mjs (Node, pngjs only). On a transparent 1024x1024 canvas it draws in mid
   grey (150, 150, 150) one bar 24 px wide from the centre (512, 512) toward the upper right at 45
   degrees, reaching 470 px, and over the centre a darker grey (110, 110, 110) square 84 px across,
   its sides parallel to the bar. Save guides/sail-arm.png and look at it.
2. Edit the guide with the image tool (an edit, not a new image), with the references and the
   prompt below. Ask for 1024x1024. Save what it returns, byte for byte, as
   raw/windmill-sail-arm-attempt-<k>.png, k from 1.
3. Write compose-sails.mjs (Node, pngjs only) and run
   node assets/source/windmill-2026-10-16/compose-sails.mjs
   assets/source/windmill-2026-10-16/raw/windmill-sail-arm-attempt-<k>.png
   It finds the plate: the pixels with alpha above 128, saturation below 0.25 and value 0.12 to
   0.65 within 12% of the side from the centre. It shifts the picture by whole pixels so the
   plate's centre lands on the canvas centre ((side - 1) / 2 both ways), keeps the upper-right
   quarter (x greater than the centre's, y smaller than the centre's), and lays it down four
   times, turned by exact quarter turns about the centre ((x, y) to (side - 1 - y, x)). Then it
   lays the recentred plate back on top, unturned: the plate's pixels within its own radius plus
   6 px, not the stock. It writes composed/<k>/windmill-sails-front.png and prints the plate's
   shift, the pixels the upper-right quarter loses at its two edges (alpha above 128 on the
   quarter's border rows and columns; the arm must lie inside its quarter), and the frame's width:
   across the arm, between 0.4 and 0.8 of the reach from the centre, the widest run of alpha above
   128 at right angles to the arm, as a share of the reach. The width must be at least 0.27 (the
   master's frames are about 0.3 of their arm, attempt 3's were 0.22), and the lost border pixels
   at most 1% of the quarter's.
4. In check-sails.mjs, change the centre from side / 2 to (side - 1) / 2, the pixel centre. Then
   run node assets/source/windmill-2026-10-16/check-sails.mjs on the composed picture. Every test
   it prints must pass: square, reach 0.40 to 0.49 of the side, centroid within 1% of the side,
   quarter-turn overlap at least 0.80, no cursor white, no selection amber. fitMiss is recorded,
   not a pass test; about 87 px is the floor, because the master's cross is not a regular X. By
   eye in checks/sails-overlay.png: the master's timber, three-rail frames and plate, at the
   master's size, the plate on the hub. In checks/sails-turn.png: the hub stays put, no arm is cut
   off, the arms sweep round in the master's slanted plane, and the sails read as timber lattice
   at the game's size.

MAKE AT MOST THREE ATTEMPTS. After an attempt that failed for what it shows, keep the prompt whole
and add a paragraph that begins "Correction:" and says what was wrong and what is wanted. If none
passes, keep the closest, record which test failed, and go on.

REFERENCES. At most five images per call, the edited image included: guides/sail-arm.png (the
image you edit: follow its bar, not a reference's angle), assets/source/base-v1/windmill.png (the
sails to paint), docs/art-direction/images/03-theme-town-growth.png (the style board).

THE PROMPT, word for word:
"Paint one sail of this windmill as a picture of its own, over the grey guide, seen face on,
looking straight along the windshaft. One timber stock runs along the guide's grey bar from the
centre to the upper right, and the square iron plate with four bolts covers the guide's dark
square at the exact centre of the picture. On the stock a timber lattice sail as on the reference
windmill: the same warm brown timber, the same wide frame of three long rails with cross bars
between them, two bays wide, beginning about a quarter of the way out from the centre and running
to the end of the bar, on the same side of its stock as the reference's upper-right sail. Only this
one arm and the plate: the other three quarters of the picture stay empty and transparent. The
sail ends where the guide's bar ends, with a clear margin to the picture's edge. Soft light from
the upper left with little contrast: each timber a little lighter on its upper left face and a
little darker on its lower and right rims, no strong highlight, because the game turns this
picture about its centre. The timber is as dark as the reference's, a mid brown, never orange. A
real RGBA PNG with a transparent background (alpha 0), opaque timber and iron. Never: other arms,
the tower, the cap, the windshaft, ground, sky, a shadow, motion blur, text, a border, a glow.
References: the second picture is the windmill whose sails these are: take their timber, lattice
and plate, not their angle. The third is the game's style board."

STYLE AND OUTPUT RULES. Smooth painted contours, broad readable masses, three or four shades per
material. Palette: forest #294638, moss #78804C, oat #E4D5B5, limestone #BCA98B, slate #626B6C,
teal #477B82, copper #A36B42. Nothing at or above the cursor white #ECE4D0, and no yellow or
orange as strong as the selection amber #E8AA48.

Record every call in prompts.json under "attempts", as {picture, attempt, selected, file, prompt,
references, returned, measured}; measured is what the scripts printed and what you saw. Copy the
accepted composed picture over windmill-sails-front.png (git keeps the old one), let check-sails.mjs
rewrite hub.json, and add to hub.json "sails": {"picture": "windmill-sails-front.png", "size":
[w, h], "pivot": [(w - 1) / 2, (h - 1) / 2]}. Never delete a painting. Do not touch the master or the
body. Commit make-arm-guide.mjs, the guide, compose-sails.mjs, check-sails.mjs, the raws,
composed/<k>/, the accepted sails, the checks, prompts.json and hub.json ("Art: windmill sail cross
from one painted arm, turned by quarter turns") and push. End with a message that gives the plate
shift, the frame width, the lost border share, the reach, centroid, quarter-turn overlap,
sailScale, sailAffine and fitMiss, the paths of the two checks, and any test that failed.
```

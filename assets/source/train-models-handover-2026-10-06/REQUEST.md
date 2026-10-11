I want you to take over the work on the train models of my game (Terepasztal) and carry it on with
the changes below. Another agent did the work so far. Everything you need to find your way is in
G:\DEV\Terepasztal\train-sizes\HANDOFF.md: read it first, all of it, including "Do not touch".

Write to me in Hungarian. Code, comments, commit messages and file contents stay English.

HOW I WANT IT DONE

The way the models' angles have been handled so far does not work, and I do not want more of it:
angles were adjusted after the fact. In the pipeline the mesh was reshaped (perspective taken out,
widths and heights scaled along the length, running gear slid, parts tilted one by one), and in the
game the rendered picture is bent between two headings. Stop doing both. The angle a sprite shows must
come from the 3D model itself, turned as a whole and rendered at that angle. Make that pipeline right
first, before anything else on this list: the model as it was reconstructed, turned until it stands
upright, level and along the track, one scale, rendered at as many headings as smooth turning needs.
(My words: "Ne trükközzünk a modelek szögeinek állítgatásával ... Ezeket a 3d modelek forgatásával
kell elérni. Tökéletesítsük azt a pipelinet elsőnek.")

Two steps of the present pipeline also change a model's shape and I have not said anything about
them: the far side rebuilt as a mirror of the seen side, and the running gear pushed out to the
game's rails (steps 7 and 8 in the hand-over). Tell me what you would do with them before you change
them. The gauge itself stays as it is.

ORDER OF WORK

1. Before anything else, commit the pipeline's uncommitted work in C:\Users\Zso\terepasztal-local as
   it is, on its branch, so nothing can be lost. Do not push.
2. Take these engines out of the game for now (retired, as Adler and John Bull are), in the demo
   build: 12 J94 and 15 Jupiter (only trouble, and a similar-looking model exists), 22 F7,
   23 Flying Scotsman, 25 K4s, 31 V63, 35 MÁV 424, 36 9F. Then update my sheet
   (locomotive-wheels-bogies-v7.xlsx, saved as v8, pictures kept): these eight, and 9 Adler and
   10 John Bull, which the sheet still reads as if they were in the game, are marked as models that
   are not in the game. Put my notes below into the sheet's review column as well.
3. The pipeline, as described above. To judge it I need to see the original models: for at least
   4, 18, 21 and 32, show me the model as it was reconstructed, with no modification at all, from the
   game's camera, beside its source picture and beside what the game shows now. Then stop and wait
   for my answer before you render the whole fleet again.
4. The engines on the list below.
5. The three faults that are still there on every engine they apply to (last section).

THE ENGINES (numbers are the sheet's; all others are fine as they are)

 4 C-50: wrong angles and a distorted body. Show me its original model, unmodified.
11 MÁV 375: its wheels do not match the picture: they are smaller in the game.
16 Kandó V40: the model is incomplete above the wheels, on the side of the body. Its angles are not
   what they should be and the model in the game is distorted. An important engine: take care.
18 Black Five: distorted, wrong angles, stretched. Show me its original model.
19 Crocodile: the model clips all over and its wheels sit on one another. It has three bogies of three
   wheels each: one in the middle, fixed to the body, one at the front and one at the rear; each
   bogie's wheels are joined by a rod ("mindegyik bogie tengelyes"). A complicated model: ask me if
   you need help. An important engine.
20 Deltic: so far no model has matched the picture. It has two bogies of three wheels. The tank in
   the middle belongs to the body and is missing from the model. The model is also squashed and does
   not sit on the rail properly.
21 DRG 01: the same trouble as 18, but this model looks better. Its tender does not fit the rails;
   at the front only the angles are wrong. Put the model back as it was.
24 ICE 1: fine. Its front bogie is a little odd and a piece is missing between the wheels.
27 Mallard: as with the other steam engines, the wheels are still on the model and are rendered
   separately too. One or the other, so that it looks of one piece.
30 TGV: its angles are not right and the model is a little distorted. Close, but put it right. An
   important engine.
32 Daylight: the same as 18.
33 DDA40X: better than it was. Where it hinges, a bellows should cover the joint, as on an
   articulated bus. Its physics needs work: the hinged part drifts too far out on a curve and should
   follow the curve more closely. An iconic engine.
34 GG1: in essence the same as the Kandó (16).
38 Big Boy: the wheel sizes are wrong: on the model they are larger. The arrangement: one wheel behind
   the snowplough; then four joined by a rod, as in the picture: that is one bogie; then three joined
   by a rod: another bogie. In the tender behind: three as one bogie, and three again as one bogie.
   I do not know where the first wheel behind the plough should be fixed; drop it if you can patch
   its place.

STILL NOT FIXED, ON ANY ENGINE

- The engines pulse while turning.
- The surfaces where a vehicle is cut (engine and tender, a hinge) are not right yet.
- A front that looks split in two, and the like, wherever it happens.

HOW TO SHOW ME YOUR WORK

I judge by looking, not by numbers. Show every visual change as pictures and short clips taken from
the running game, beside how it looked before, in the review page
(G:\DEV\Terepasztal\renders\engine-models\index.html), and keep the save working so I can try it.
Before you show me clips, look at them frame by frame yourself. Ask when you are unsure; a choice you
make on your own goes on the page so I can overrule it. Nothing is pushed or merged until I say so.

At each stop tell me: what you did, where the page is, what you are unsure about, and what you would
do next.

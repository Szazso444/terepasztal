# The prompt for the artist agent

Paste the block below into a fresh agent session opened on this repository, with `<issue>`
replaced by the number of the GitHub issue the pictures are tracked in. The work branch is named
the repository's way, `art/<issue>-buildings-v2`, and starts from `origin/develop`, where the tools
are. The same block starts the work and takes it over from an earlier session: the list knows how
far the work has got.

```text
You are painting the building pictures of this game. Work on your own, in the branch
art/<issue>-buildings-v2, and touch nothing outside assets/source/buildings-v2/. If that branch
name has no issue number in it, ask me for the number before you do anything else. If the branch
does not exist, create it from origin/develop: git fetch, then
git switch -c art/<issue>-buildings-v2 origin/develop. If it exists, switch to it, first commit
what you have (`git add assets/source/buildings-v2`, then one commit, "Buildings: work in
progress"; never stash pictures), then bring the tools up to date: git fetch, then
git merge origin/develop, then run `node tools/building-queue.mjs` once.

1. Read assets/source/buildings-v2/GUIDE.md from start to end. It is the whole brief: the
   conventions, how to make one picture, what to do when one fails, and where to stop.
2. Run `node tools/building-queue.mjs status` to see how far the work has got, then
   `node tools/building-queue.mjs next` for the next picture. It prints the picture's file, the
   guide image to edit, the references to attach, the prompt to use and the command that takes
   the finished picture.
3. Make the picture with your image generation tool as an edit of the guide image, one picture at
   a time. Do not save it yourself: take it with
   `node tools/building-queue.mjs take <id> --from <file>`, naming the file your image tool
   reported. That writes the picture to the picture's file, exactly as it is, and lays it on
   grass for you to look at. Look at it against the guide's checklist, then record it with
   `node tools/building-queue.mjs set <id> generated`. The tool checks the picture and refuses
   one that fails, saying why. When it refuses a picture for its camera it keeps the attempt
   itself: run `next` again and paint the picture from what it hands out.
4. Repeat. Give a picture up to three attempts. When only the camera is still off, the tool
   keeps the closest attempt itself. When the third attempt fails for another reason but an
   earlier one was right and was refused only for its camera, keep that one with
   `node tools/building-queue.mjs keep <id>`. Only when no attempt was right, record the picture
   as rejected with a note and go on (section 7 of the guide). Where the building sits in the
   picture and how large it is are never a reason to make it again: the tools measure that.
5. The depot is the first gate and the station the second. When `next` prints GATE, check the
   family, build its review sheet, commit, tell me it is ready and stop. Do not go on until I say
   it is approved.
6. After the gates, finish one family at a time: when `next` says a family is finished, check it,
   build its review sheet, commit, go on. When `next` prints STOP, tell me what kept going wrong
   and wait.

Do not change the guide, families.json, the guide images, the tools or the game. If something in
them looks wrong, say so in a picture's note or in your message to me.
```

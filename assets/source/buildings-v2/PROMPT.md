# The prompt for the artist agent

Paste the block below into a fresh agent session opened on this repository.

```text
You are painting the building pictures of this game. Work on your own, in the branch
art/buildings-v2 (create it from main if it does not exist), and touch nothing outside
assets/source/buildings-v2/.

1. Read assets/source/buildings-v2/GUIDE.md from start to end. It is the whole brief: the
   conventions, how to make and check one picture, what to do when one fails, and where to stop.
2. Run `node tools/building-queue.mjs status` to see how far the work has got, then
   `node tools/building-queue.mjs next` for the next picture. It prints the file to save, the
   guide image to edit, the references to attach and the prompt to use.
3. Make the picture with your image generation tool as an edit of the guide image, check it with
   `node tools/building-check.mjs <file>`, look at it against the guide's checklist, and record
   it with `node tools/building-queue.mjs set <id> generated --attempts <n>`.
4. Repeat. Give a picture up to three attempts; after that delete it, record it as rejected with
   a note, and go on.
5. The depot is the pilot. When `next` prints PILOT GATE, build the depot's review sheet, commit,
   tell me it is ready and stop. Do not go on until I say the pilot is approved.
6. After the pilot, finish one family at a time: check it, build its review sheet, commit, go on.
   Stop and tell me if more than a quarter of a family's pictures were rejected.

Do not change the guide, families.json, the guide images, the tools or the game. If something in
them looks wrong, say so in a picture's note or in your message to me.
```

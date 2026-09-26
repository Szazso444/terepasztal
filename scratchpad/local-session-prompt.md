You are working locally on Terepasztal (isometric train logistics game, Vite + TypeScript + PixiJS v8).
Repository: C:\Users\Zso\terepasztal. Asset workspace: G:\DEV\Terepasztal (read and write).
Start from branch `claude/charming-ramanujan-i16mhm` (open PR Szazso444/terepasztal#20) in a separate
git worktree, e.g. `git worktree add ..\terepasztal-local -b local/train-models origin/claude/charming-ramanujan-i16mhm`,
so the uncommitted changes in C:\Users\Zso\terepasztal stay untouched.

Read first: CLAUDE.md, AGENTS.md, assets/source/base-v1/RESUME.md, docs/bogie-model.md,
tools/asset-pipeline/CLAUDE.md and tools/asset-pipeline/ASTRA.md, docs/art-direction/README.md
(latest section "Style consistency: both smooth").

Working rules
- Keep generated images in the repository (or G:\DEV\Terepasztal); report paths, never embed images in chat.
- Every visual change is shown as actual game renders, side by side against the current look, in a
  review page, before anything is locked in. I decide from those renders.
- No runtime dependencies beyond PixiJS. Atlas contract: public/assets/<group>.png + .json with
  { resolution, partial, frames: { "<key>": { x, y, w, h, ax, ay } } }; frame keys carry their own prefix
  (e.g. rolling/…). Frame counts and anchors must not drift unintentionally.
- Style: "both smooth" is approved — painted, smooth contours everywhere; no hard pixel-art steps.
- Run typecheck, lint, tests, build and prettier --check before every push.

1. Train models from the existing studio images (main task, end to end)
   - Sources: assets/source/base-v1/loco-*.png (32 locomotives) and wagon-*.png (20 wagons). They are
     byte-identical to the Drive's loose Images/exec-*.png files (mapping in Images/organized/inventory.json);
     the Drive's organized/locomotives and organized/wagons folders are empty, so use the repo copies.
   - Pipeline: tools/asset-pipeline (ComfyUI image→3D, Blender render). One studio image per subject; the
     pipeline builds the model and renders the directions at the game camera (45° azimuth, 30° elevation).
   - Facings: FACINGS = 48 headings, only DRAWN_FACINGS (25) rendered; the game mirrors the rest.
   - Bogies (docs/bogie-model.md): rigid bodies of fixed length, one sprite per rigid segment, never
     sliced or bent; bogies are separate sprites under the body, each on its own rail position and tangent,
     never masked; raised sills keep wheels visible; 4 wheels = 2 axles, 6 wheels = 3 axles; bogie styles per
     family `rolling/bogie_<style>_f{f}`, per-part lists allowed; Garratt = 3 articulated segments, Meyer =
     one rigid frame on engine-unit bogies; cut the model's own wheels below clip_below_m so they don't
     double with bogie sprites. ASTRA.md lists the bogie sources to produce.
   - Rocket proof of concept (G:\DEV\Terepasztal\poc\rocket-original-v1) ran all 48 headings in game but
     failed review: colour shift from the source, uneven wheels, wrong gauge. Fix these before scaling up:
     colour-match the render to the source, measure wheel tread/axle landmarks, and hold the track gauge
     and the shared human/metre scale (tools/asset-pipeline pins tile_px to the game's TILE_W).
   - Order: Rocket, Flying Scotsman, SD40, bogie_blomberg, then stop and show in-game renders for approval
     (straight, curve, switch, reversal, all headings). Then the remaining roster in batches.
   - Pack with the pipeline's exporter / tools/pack-atlas.mjs into the rolling-stock atlas groups as partial
     overrides; verify in game: scratchpad/verify-bogies.mjs, verify-curves.mjs, rollout.mjs, and the
     terrain review scene (trains now climb straight ramps on hills; each body part and bogie stands on the
     surface under it).

2. New decor art (image generation, where the original art was made)
   - Use the existing props as style references; smooth painted style. Suggested first set: trees (sapling,
     young oak, willow, poplar, fruit tree, birch pair, stump, fallen log), bushes (round, hedge, flowering,
     berry), flowers (wildflower, poppies, lavender, daisies, clover), rocks (pebbles, mossy stone, flat
     slab, split boulder, small outcrop), ground cover (fern, tall grass clump, mushrooms).
   - Add them through tools/illustrated-sprites.mjs (props group; the pack step already applies the
     smoothing pass) and extend src/render/scatter.ts rules so each only appears where it belongs.
   - Show them side by side in game before adopting.

3. Hill art (only after the hill shape is decided in the cloud session — see the review page
   "Terepasztal Hill Shapes")
   - Rock-face / outcrop sprites for hill banks and shoulders, and a straight ramp track piece with
     embankment sides for crossing between terrace levels, in the same camera and style.

4. Asset housekeeping on G:\DEV\Terepasztal
   - Organize Images/: 99 loose exec-*.png files are not in organized/ (use inventory.json); buildings
     are scattered. Commit useful sources into the repo under assets/source/<set>/ with a manifest; keep
     very large .blend/.glb files out of git (or use Git LFS) and record where they live.
   - Keep assets/source/base-v1/RESUME.md updated with progress so work can resume.

Deliver: push to your branch and open a PR against claude/charming-ramanujan-i16mhm (or main once #20
merges); link the review pages and list what is approved, pending, and blocked.

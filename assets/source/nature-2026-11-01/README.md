# Nature source paintings · 2026-11-01

Thirty source paintings for later packing and biome placement: 18 trees and 12 ground pieces. Generated with the built-in image_gen tool on art/nature-assets, from origin/develop at 8bb454be. Exact prompts, ordered references, correction paragraphs, measurements and visual reviews are in prompts.json. The atlas, renderer, map generation and earlier waterside folder are unchanged. No atlas command was run.

Every selected PNG is a byte-for-byte copy of a retained raw attempt. All 48 raw PNGs match the SHA-256 of their original tool output, and all 30 selections match their chosen raw bytes. sha256.json holds the 78 delivered source-image hashes. Requested canvas: 1024 × 1024; returned canvas: 1254 × 1254 for every attempt. Dimensions and genuine RGBA transparency are preserved without cropping, resizing, recolouring, repositioning or retouching.

| Picture           | Biome              | Attempt | Target height | Drawn width × full height | Foot in source | Anchor in source | Outstanding failures |
| ----------------- | ------------------ | ------: | ------------: | ------------------------: | -------------- | ---------------- | -------------------- |
| tree-beech-1.png  | forest             |       2 |            34 |             48.51 × 34.04 | 691, 1071      | 691, 1071        | None                 |
| tree-beech-2.png  | forest             |       2 |            42 |             58.53 × 42.04 | 601.50, 1119   | 601.50, 1119     | None                 |
| tree-beech-3.png  | forest             |       2 |            50 |             72.33 × 50.05 | 610, 1116      | 610, 1116        | None                 |
| tree-poplar-1.png | plains             |       1 |            44 |             18.21 × 44.04 | 636.50, 1156   | 636.50, 1156     | None                 |
| tree-poplar-2.png | plains             |       1 |            54 |             23.63 × 54.05 | 617, 1196      | 617, 1196        | None                 |
| tree-poplar-3.png | plains             |       1 |            64 |             25.00 × 64.11 | 615.50, 1217   | 615.50, 1217     | None                 |
| tree-apple-1.png  | plains, near farms |       2 |            26 |             28.39 × 26.03 | 649.50, 1073   | 649.50, 1073     | None                 |
| tree-apple-2.png  | plains, near farms |       2 |            32 |             40.44 × 32.06 | 611.50, 1133   | 611.50, 1133     | None                 |
| tree-apple-3.png  | plains, near farms |       2 |            38 |             43.88 × 38.03 | 650.50, 1174   | 650.50, 1174     | None                 |
| tree-maple-1.png  | forest, plains     |       1 |            34 |             38.69 × 34.04 | 624.50, 1099   | 624.50, 1099     | None                 |
| tree-maple-2.png  | forest, plains     |       1 |            42 |             50.90 × 42.41 | 618, 1190      | 618, 1190        | None                 |
| tree-maple-3.png  | forest, plains     |       1 |            50 |             58.17 × 50.09 | 622, 1202      | 622, 1202        | None                 |
| tree-larch-1.png  | taiga              |       2 |            34 |             26.75 × 34.03 | 642.50, 1178   | 642.50, 1178     | None                 |
| tree-larch-2.png  | taiga              |       2 |            42 |             29.95 × 42.04 | 637.50, 1206   | 637.50, 1206     | None                 |
| tree-larch-3.png  | taiga              |       2 |            50 |             40.57 × 50.04 | 621, 1214      | 621, 1214        | None                 |
| tree-acacia-1.png | desert edge        |       2 |            26 |             53.15 × 26.04 | 667.50, 1034   | 667.50, 1034     | None                 |
| tree-acacia-2.png | desert edge        |       3 |            32 |             63.17 × 32.10 | 625, 973       | 625, 973         | None                 |
| tree-acacia-3.png | desert edge        |       2 |            38 |             89.88 × 38.06 | 667.50, 971    | 667.50, 971      | None                 |
| stump-1.png       | forest, plains     |       1 |             8 |              10.26 × 8.00 | 632, 864       | 632, 864         | None                 |
| stump-2.png       | forest, plains     |       1 |             8 |              10.64 × 8.00 | 649, 901       | 649, 901         | None                 |
| log-1.png         | forest, taiga      |       1 |             8 |              14.63 × 8.00 | 640, 789       | 640, 789         | None                 |
| log-2.png         | forest, taiga      |       1 |             8 |              12.73 × 8.00 | 644, 844       | 644, 844         | None                 |
| fern-1.png        | forest             |       1 |            10 |             16.28 × 10.00 | 620, 900       | 620, 900         | None                 |
| fern-2.png        | forest             |       1 |            10 |             15.20 × 10.00 | 640, 985       | 640, 985         | None                 |
| mushrooms-1.png   | forest             |       1 |             6 |               7.39 × 6.00 | 647, 911       | 647, 911         | None                 |
| mushrooms-2.png   | forest             |       3 |             6 |               7.51 × 6.00 | 640, 973       | 640, 973         | None                 |
| heather-1.png     | plains, taiga      |       2 |             8 |              16.75 × 8.00 | 622, 912       | 622, 912         | None                 |
| heather-2.png     | plains, taiga      |       2 |             8 |              16.74 × 8.00 | 635, 897       | 635, 897         | None                 |
| dryshrub-1.png    | desert             |       1 |            12 |             16.91 × 12.00 | 642, 1016      | 642, 1016        | None                 |
| dryshrub-2.png    | desert             |       2 |            12 |             22.33 × 12.00 | 635, 976       | 635, 976         | None                 |

Source feet and anchors are unrounded in trees.json. Widths include the previous checker’s 1.2 horizontal widening convention; these are proposed drawn sizes, not new atlas frames. Trees use k = target height / (foot y − alpha-box top), and every new tree anchor is its visible foot, without the old willow’s 6 px lift. Ground pieces use k = target height / alpha-box height so their entire silhouette has the requested 6–12 px height; their anchor is the contact footprint or converging stem base. fullHeight and belowFoot retain the exact resulting measurements. Feet read by eye, reasons and automatic estimates are retained in reviews.json, prompts.json and trees.json.

All 30 selections have zero pixels in the outer 8-pixel safety band, zero cursor-white pixels, zero selection-amber pixels and zero cyan-water percentage. Center offsets pass. Source paintings were inspected for species, camera, upper-left light, broad clusters and absence of ground, grass under the object, cast shadow and water. The paired looks in checks/ were inspected at zoom 1 and zoom 2 against the existing oak. checks/review-1.png through review-6.png combine those diagnostic looks; checks/review-rows.json names their rows from top to bottom.

The picture to flag for integration review is tree-acacia-3.png: its umbrella is 89.88 drawn px wide and its left source margin is only 16 px. It passes the outer-band and whole-object checks, and is the closest of its two attempts, but needs generous placement clearance. The other selections have no outstanding art concerns at the reviewed zooms.

Every generation attached these references in this order:

1. docs/art-direction/images/02-nature-objects.png — nature style board; silhouette and materials only.
2. assets/source/waterside-trees-2026-10-16/tree-willow-2.png for trees, or assets/source/base-v1/props-flowers.png for ground pieces.
3. assets/source/cozy-v3/tree-oak-v2.png — shared clusters, light and painted material depth.

All failed attempts are retained. Each second or third generation has a Correction paragraph. No picture exceeded three attempts.

| Picture           | Failed attempt | Failed checks                                                        |
| ----------------- | -------------: | -------------------------------------------------------------------- |
| tree-beech-1.png  |              1 | beech leaf shape; beech smooth grey bark                             |
| tree-beech-2.png  |              1 | beech crown shape; beech smooth grey bark                            |
| tree-beech-3.png  |              1 | beech crown shape; beech smooth grey bark                            |
| tree-apple-1.png  |              1 | cursor white; blossom brightness                                     |
| tree-apple-2.png  |              1 | cursor white; blossom brightness                                     |
| tree-apple-3.png  |              1 | cursor white; blossom brightness                                     |
| tree-larch-1.png  |              1 | larch needle identity                                                |
| tree-larch-2.png  |              1 | larch needle identity                                                |
| tree-larch-3.png  |              1 | larch needle identity                                                |
| tree-acacia-1.png |              1 | acacia thin trunk; acacia flat umbrella                              |
| tree-acacia-2.png |              1 | acacia thin trunk; acacia flat umbrella                              |
| tree-acacia-2.png |              2 | transparent margin                                                   |
| tree-acacia-3.png |              1 | acacia thin trunk; acacia flat umbrella                              |
| mushrooms-2.png   |              1 | smooth painted contours; cursor white                                |
| mushrooms-2.png   |              2 | cursor white                                                         |
| heather-1.png     |              1 | heather low tuft silhouette; smooth painted contours; foot centering |
| heather-2.png     |              1 | heather low tuft silhouette; smooth painted contours                 |
| dryshrub-2.png    |              1 | smooth painted contours; dryshrub slender sticks                     |

Run from the repository root with the existing pngjs development dependency:

```sh
node assets/source/nature-2026-11-01/record-set.mjs
node assets/source/nature-2026-11-01/verify-set.mjs
node assets/source/nature-2026-11-01/make-reviews.mjs
```

check-tree.mjs was copied from the waterside folder and extended with the twelve new kinds. It only reads the existing props atlas for its oak comparison and imports read-only resampling helpers; it writes measurements and diagnostic PNGs inside this folder. Diagnostic previews are scaled copies for inspection; the delivered source paintings and raw files are never altered. record-set.mjs regenerates measurements and compares to original tool-output hashes when those local outputs are available; verify-set.mjs is portable and checks retained hashes, exact selected bytes, attempt limits, correction paragraphs, reference order, dimensions, RGBA, measured fields and review completeness. Existing dependencies were reused through an ignored node_modules junction on G:, with no dependency-file changes.

Validation: the source-set audit passes for 30 pictures and 48 retained attempts, with no outstanding art failures. Typecheck, lint, production build and repository format check pass; lint has one existing unused SRC_PX warning in tools/track-materials.mjs. Application tests are not green: 267 suites pass and 9 fail; 5619 tests pass, 16 fail, 11 skip and 1 is todo. No changed application code is involved. The full command logs are in checks/. The failed suites/tests are named below and in checks/failed-tests.txt; they were not repaired as part of this source-art task.

- tools/asset-pipeline/game_rules.test.mjs [ tools/asset-pipeline/game_rules.test.mjs ]
- tools/asset-pipeline/handbuilt/run.test.mjs [ tools/asset-pipeline/handbuilt/run.test.mjs ]
- src/render/roadPaint.test.ts > a road on a bridge deck (#506) > has the road beside it cover the painted bank toward it, and nowhere else
- tools/agents/ownership.test.mjs > changedPaths > reads names git would quote, so a non-ASCII path is judged by its real name
- tools/asset-pipeline/blender_runner.test.mjs > blender_runner: which Blender a step may run on > reads any `blender --version` back to its release and build, and accepts exactly 5.2.x
- tools/asset-pipeline/blender_runner.test.mjs > blender_runner: which Blender a step may run on > gives the author's Blender 5.2.1 executable and the cloud's bpy 5.2.1 the identity the render profiles lock
- tools/asset-pipeline/blender_runner.test.mjs > blender_runner: running a step > leaves this process as it found it after any sequence of in-process steps, failed or not
- tools/asset-pipeline/filehash.test.mjs > filehash: one hash for an input on every checkout > hashes a text input with CRLF read as LF and any other file as its bytes
- tools/asset-pipeline/filehash.test.mjs > filehash: one hash for an input on every checkout > gives an input with a text suffix one hash on an LF and a CRLF checkout, whatever it holds
- tools/asset-pipeline/filehash.test.mjs > filehash: one hash for an input on every checkout > keeps every committed lock and manifest hash on a CRLF checkout of its inputs
- tools/asset-pipeline/handbuilt-method.test.mjs > hand-built method, Python tests without Blender > runs every Blender step on a Blender 5.2.x executable or the bpy 5.2.x module
- tools/asset-pipeline/handbuilt-method.test.mjs > hand-built method, Python tests without Blender > keeps recipes locked to their pictures, inside their projects and the same on every checkout
- tools/asset-pipeline/handbuilt-method.test.mjs > hand-built method, Python tests without Blender > keeps renders locked to their models, atlas pages bounded and installs to owned keys
- tools/asset-pipeline/handbuilt/verify_construction.test.mjs > verify_construction: does a replay match the model > matches exactly when all but coordinates are equal and every coordinate is within 1e-6
- tools/asset-pipeline/handbuilt/verify_construction.test.mjs > verify_construction: does a replay match the model > a NaN or an infinity on either side is a mismatch with no difference reported
- tools/asset-pipeline/handbuilt/verify_construction.test.mjs > verify_construction: does a replayed calibration match > matches exactly when the structure is equal and every number is within 1e-6
- tools/asset-pipeline/painted/run.test.mjs > painted/run.py: the render cache > reuses a bundle exactly while its receipt holds for every file it lists
- tools/asset-pipeline/painted/run.test.mjs > painted/run.py: the render cache > keys a render by the Blender release and build, whether an executable or the bpy module

Art scope, changed-file formatting and git diff --check pass. No pull request is opened.

# Warehouse rotations, issue 535

STOP after r1: all three attempts failed the first, width-only gate. No r3 or r2 was painted. No view passed every test. Attempt 3 is the closest, copied byte for byte to warehouse-r1.png, explicitly kept: false in prompts.json.

| r1 attempt | Returned size | Automatic width | Width with canopy footing | Allowed width | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | 1254 x 1254 | 1149 px | 1160 px | 807.02-892.74 px | FAIL |
| 2 | 1254 x 1254 | 938 px | 1040 px | 807.02-892.74 px | FAIL |
| 3 | 1254 x 1254 | 924 px | 1014 px | 807.02-892.74 px | FAIL; closest |

Foot ratios, slopes, camera errors, heights and highlight comparisons were skipped after width failed, following the ordered gate. Automatic base-line coordinates are retained for provenance. Eye readings include the outer ground-standing canopy footing, which automatic w misses on attempts 2 and 3.

Master r0 remains unchanged, SHA-256 e49ab2a1d71cebfe45201e5fb8983a46b169e97ce4e158d9fde33008b9a124b2. Its wall-height/base-width ratio is 281/1172 = 0.239761; highlights are 7138 near-white pixels and 0 near-amber pixels. The height excludes roof and gable; the width includes the outermost canopy footing. Both automatic and eye readings are in prompts.json.

Every call used built-in image_gen: original guide first, style board second, unchanged master third. Requested 1024 x 1024 and transparency. Full prompts, one replacing correction per retry, ordered references, returned sizes, hashes and measurements are in prompts.json. All returned bytes are preserved in raw/. No returned image was transformed.

The shared ../measure.mjs changed concurrently for other building jobs. Warehouse checks use inspect.mjs importing measureBase, pictureOf and read-only checkFile, with warehouse limits. Supply the external pngjs install through NODE_PATH if needed. No shared helper change is included in this commit.

building-sheets.mjs --picture warehouse-r1.png rejects that filename because it expects an age suffix. The same tool's exported drawLook function produced the ignored .look/ preview, which was visually reviewed. Preview fitting changes only the preview.

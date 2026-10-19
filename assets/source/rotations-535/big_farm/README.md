# Big Farm Halt, review 2 rotations, issue #535

Stopped after r1 under the requested three-width-failures rule. No r3 or r2 was generated.
All three raw images are unchanged imagegen outputs; r0 and the guide files are untouched.

| r1 attempt | Returned    | Outer opaque base width | Allowed width    | Result                                   |
| ---------- | ----------- | ----------------------- | ---------------- | ---------------------------------------- |
| 1          | 1254 x 1254 | 903 px                  | 807.02–892.74 px | FAIL; closest, copied to big_farm-r1.png |
| 2          | 1254 x 1254 | 964 px                  | 807.02–892.74 px | FAIL                                     |
| 3          | 1254 x 1254 | 927 px                  | 807.02–892.74 px | FAIL                                     |

No view passed every test. The selected r1 is explicitly `kept: false`.
Widths include the outer stone steps at the feet of the barn and silo, using alpha >128.
Zoomed inspection located wall edges, then pixel scans confirmed their x coordinates:
181–1084, 170–1134, and 190–1117. Automatic widths were 866, 964, and 896 px;
the first and third automatic readings missed the outer quoin steps. Both readings
are retained in prompts.json. After the corrected width refusals, plan ratio, slopes,
camera error, height, and highlights are not evaluated as acceptance tests.
An initial automatic-only camera check on attempt 1 ran before the outer-corner
inspection corrected its width; it is not an acceptance result.

r0 eye reference: near wall foot y915, eaves y580, wall height 335 px;
outer base width 1007 px; height/width 0.33267 (eye uncertainty about 3 px).
r0 highlight counts: 2702 near-white, 0 near-amber pixels.

Every exact prompt and reference order is in prompts.json. All calls were edits of
the r1 guide, using the style board and original farm, never failed attempts.
The requested output was 1024 x 1024, with a transparent background.

The shared ../measure.mjs was concurrently rewritten by other building jobs with
their limits. The farm-specific measure-big-farm.mjs preserves this job's correct
width, plan, camera, height and highlight checks without overwriting their work.
Run it from the repository root (with pngjs available):

```
node assets/source/rotations-535/big_farm/measure-big-farm.mjs assets/source/rotations-535/big_farm/raw/big_farm-r1-attempt-1.png 1
```

The requested building-sheets CLI was run on big_farm-r1.png; it rejected this
nonstandard filename with "not a building picture's name". A diagnostic grass
preview was produced outside the repository using its exported drawLook function.
No guides or diagnostic preview are committed.

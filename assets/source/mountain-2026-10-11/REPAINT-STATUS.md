# Issue 371: centred spring repaint results

The allowed repaint attempts are complete. Four closest returns are selected as
the source paintings; none passes every geometry check. This is the brief’s
fallback after the attempt limit, not an assertion of exact geometry compliance.

NE had a refused call on October 11 (attempt 3) and two painted returns on
October 12 (attempts 4–5). SE, SW and NW each had three painted returns.
All eleven new paintings are unmodified 1254×1254 RGBA PNGs from independent
built-in image edits requested at 1024×1024. Every call and all measurements
are recorded in prompts.json. All old and new paintings remain in raw/.

## Selected results

Expected painted box at this returned size: approximately [184,405,1070,849].
Actual boxes below use [left,top,right,bottom]. Stone ratios include the
explicit far-rim top allowance; strict ratios are also in the JSON.

| Main file     | Selected attempt | Painted box        | Centre error px | Stone ring | Failed tests                         |
| ------------- | ---------------- | ------------------ | --------------- | ---------- | ------------------------------------ |
| spring-ne.png | NE 5             | [187,438,1067,860] | 11.35           | 78.40%     | box top, lower diamond, stones       |
| spring-se.png | SE 2             | [206,429,1047,856] | 7.36            | 62.37%     | box top, lower diamond, stones       |
| spring-sw.png | SW 4             | [173,400,1081,850] | 1.35            | 89.86%     | lower diamond, upper diamond, stones |
| spring-nw.png | NW 2             | [195,418,1055,851] | 3.08            | 65.37%     | stones                               |

All selected centres pass. SW and NW boxes pass. NE top lies 26.7 requested
canvas pixels below the target, and SE top 19.3 below (limit 18). Lower-edge
spill is 3024 pixels for NE, 90 for SE, 458 for SW and zero for NW. SW also
has 99 upper-edge pixels beyond the permitted far-rim stone-top allowance.
Stone threshold is 90%; no selected painting reaches it. The later finishing
pass must not assume exact spring geometry or compliant stone positions.

Selection weighed framing, centre placement, spill and stone placement together.
NE 5 is much closer than NE 4. SE 2 avoids the large enlargement and spill in
SE 3–4. SW 4 has nearly 90% stones in the allowed ring and tiny spill compared
with SW 5, and improves stone placement substantially over SW 3. NW 2 has no
diamond spill and a better stone ratio than the other correctly framed NW return.

## Visual review and preservation

Full-size selected water has smooth painted contours and broad flowing tone
clusters, without the old rectangular pixel grid. Flow glints remain angular
in places, and the pool/ripple spreads wider than its guide in some returns.
The 64×64 full-canvas reviews distinguish the lighter pool/upwelling and
upstream stone crescent in all four directions. They are inspection copies only.
No original has been fitted, cropped, warped, resized, padded or retouched.

Selected main files are byte-identical to their archived raw returns.
The four prior main paintings match their archived attempts byte-for-byte.
The old scale-8 guides remain byte-identical. The scale-16 centred guides,
river/bank references and measurement checker are unchanged from preparation.

Use review/selected-measurements.json for compact selected data and
review/verification.json for RGBA, alpha counts and SHA-256 of every painting.
The checker’s 15 synthetic validation cases passed again.

## Highlight ceilings

The source highlights also fail the requested ceilings. Rec.709 measurements
on painted pixels (alpha above 128) exceed cursor #ECE4D0 on 467 pixels in NE,
357 in SE, 8 in SW and 128 in NW. Within the nominal radius-0.15 pool, the
#E0DDD2 ceiling is exceeded by 539 pixels in NE, 355 in SE, zero in SW and
100 in NW. See review/selected-colours.json and measured.brightness. These
paintings are not palette-compliant final materials. No pixels were retouched;
the later finishing pass must cap highlights as the brief specifies.

Run review/check-selected-colours.mjs after check-extent.mjs to add the colour
measurements, since the geometry checker regenerates the measured object.

## Repository gates

On 2026-10-12, typecheck, lint, production build, Art scope, changed-file
Prettier, Git whitespace and PNG byte checks passed. The checker passed its
15 synthetic cases. The full test run completed: 1947 passed, 14 failed and
11 skipped; 8 failed files and 104 passed. Failures include missing python
in existing pipeline tests. The repository-wide formatting check failed on
374 untouched files. No unrelated files were edited to resolve these failures.
Gate logs and build outputs are ignored under this folder’s review directory.

# Issue 371 spring repaint: partial

No new painting was produced or selected. The first call, spring-ne-attempt-3,
was refused with usage_limit_reached before image generation. The tool reports
a reset at 2026-10-12 14:59 America/Toronto (Unix timestamp 1791831558).
The four main spring PNGs remain byte-identical to the earlier paintings.
Their existing geometry and blocky-water defects have not been fixed.

Preparation completed:

- Preserved the four current paintings in the requested raw attempt paths,
  and redirected their earlier prompt records to those archives.
- Copied river-strip-y.png and river-bank.png byte-for-byte from origin/art/343-water
  as reference-river.png and reference-bank.png.
- Extended make-spring-guides.mjs with the four centred radius-0.5 disc guides.
  All four legacy guides remain byte-identical; hashes are recorded in
  review/legacy-guide-hashes.json.
- Added the complete scale-16 frame and measurement constants under centred
  in spring-geometry.json.
- Added check-extent.mjs to record dimensions, bounds, inferred centre,
  lower/upper diamond spill, and both strict and far-rim-top-adjusted stone ratios
  under measured for centred attempts. Non-square returns fail the box check.
  Far-rim stone tops require a foot reachable by vertical descent of at most
  36 requested-canvas pixels, inside the upstream bank ring.
- Adapted review-springs.mjs for selected centred attempts: full canvas to 64px,
  preserving original paintings. Refused calls without a PNG are skipped.
- Recorded the failed call’s exact prompt, five ordered references, null returned
  dimensions and generation-limit failure in prompts.json. Its named raw PNG
  does not exist because the tool returned no painting.

Remaining work: generate the four independent guide edits, at most three new
calls per direction, measure each return, retain every produced attempt, select
the passing or closest painting, inspect full-size water and 64px reviews, and
record remaining failed criteria. NE attempt 3 is the refused call; continue
numbering with NE 4, SE 2, SW 3 and NW 2. Do not resize or retouch originals.

Run these from the repository root:

```sh
node assets/source/mountain-2026-10-11/make-spring-guides.mjs
node assets/source/mountain-2026-10-11/review/check-extent-fixtures.mjs
node assets/source/mountain-2026-10-11/check-extent.mjs
node assets/source/mountain-2026-10-11/review-springs.mjs
```

Synthetic checker validation passed 15 cases: every direction at 1024 and
1254, opaque-background exclusion, misplaced stones, lower-edge spill and a
non-square return, upper-edge spill, enlarged bounds and centre shift. The fixture PNGs are diagnostic masks in ignored review/.tmp,
not substitute paintings. Native-size visual acceptance is pending generation.

Repository gates: typecheck, lint, build and Art scope passed. Formatting passed
for all changed source files; the repository-wide check failed on 374 existing
files. The full test run completed with 1947 passed, 14 failed and 11 skipped
(8 failing files out of 112). Failures include existing pipeline Python tests.
No unrelated files were edited to address those failures. Gate logs and build
outputs are under ignored review/.tmp and review/gate-build in this folder.

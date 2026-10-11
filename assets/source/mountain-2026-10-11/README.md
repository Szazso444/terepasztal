# Glacier material sources

Issue #371, branch `art/371-mountain`, based on `origin/develop` at `f691330d`.
Seven independent built-in ImageGen calls provide the selected paintings; two rejected
framing attempts remain in `raw/`. Each call requested 1024×1024. Every painting is
preserved byte-for-byte as returned, without fitting, cropping, warping or retouching.

`prompts.json` records every exact prompt, repository-relative reference and actual PNG
dimensions, including rejected attempts. The style board supplies the smooth painted
language; the older mountain picture supplies hue only. Glacier ice, moraine and snow
swatches were absent in this checkout, so the mountain reference is attached once as the
fallback. Strip/lobe calls edit their geometry guides; face calls have no guide attached.

The selected sources are `glacier-strip-x.png`, `glacier-strip-y.png`, `glacier-lobe.png`,
`ice-cliff-lit.png`, `ice-cliff-shade.png`, `ice-portal-lit.png`, and `ice-portal-shade.png`.
Both fronts are fully opaque; strips, lobe and caves have RGBA transparency. All selected
returns are 1254×1254 except the lit portal, which is 1613×975. Exact silhouettes, seam
blending, front placement and cave fitting belong to the later finishing script.

Run `node assets/source/mountain-2026-10-11/make-glacier-guides.mjs` to recreate the six
guides and `glacier-geometry.json`. Tongue guides are schematic geometry references,
not finished glacier pieces. The face guide is never attached to an image call.

Run `node assets/source/mountain-2026-10-11/check-glacier-material.mjs` to verify PNG sizes,
front opacity and provenance and create QA copies. It leaves paintings untouched.
`review/game-scale-sheet.png` shows x strip, y strip and lobe at 128×128, then lit front,
shaded front, lit portal and shaded portal at 36×39. At this scale the cool ice and darker
rubble separate, layered fronts remain visible, and both cave arches and pale water lips
read. Review PNGs are thumbnails only, not finished game pieces.

Typecheck, lint and production build pass. New scripts and JSON pass Prettier. The full
formatting gate reports 374 unchanged baseline files; no files outside this folder were
changed to repair that baseline. The gate logs were dropped, as they held local paths.
Initial npm/test commands encountered a full C: drive; direct tool entry points and temporary
storage in this folder allow the checks to run without deleting unrelated files.

The full suite finishes with 1972 passed, 1 failed and 2 skipped tests across 110 passing
and 2 failing files. Untouched `tools/agents/ownership.test.mjs` fails to load with
`SyntaxError: Invalid or unexpected token`; untouched
`tools/asset-pipeline/handbuilt/run.test.mjs` fails its Windows path property at seed 19
on the single-space path. All tracked application, test, configuration and tool sources
remain identical to the develop baseline. No regression repairs are part of this art task.
Local build output and test temporary files are ignored by this folder's `.gitignore`.

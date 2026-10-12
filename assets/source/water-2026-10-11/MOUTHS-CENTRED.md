# Issue #343 — measured centred mouth sources

The three-call allowance per mouth is exhausted. **No attempt passed every requested
geometry test.** The four main filenames contain the highest-IoU new attempts, following
the author's explicit fallback rule. These are failed material-source fallbacks, not
geometry-approved mouths or finished runtime pieces.

Built-in ImageGen was used exclusively, editing each centred guide with the matching
strip, town-growth board, river-water and river-bank references in that order. Every call
requested 1024×1024; every returned painting was 1254×1254 RGBA. Original PNG bytes were
retained without fitting, cropping, resizing, padding, warping, mirroring or retouching.
The October 12 scheduled continuation ran after the image limit reset.

## Selected sources and failed tests

Widths and offsets are in tiles at t=-0.25 (quarter tile inside entry), then t=0
(middle tile centre). Box errors compare with the centred guide scaled by width / 1024.

| Edge | Selected attempt | IoU      | Channel widths      | Centre offsets        | Box width / height errors | Box centre displacement |
| ---- | ---------------- | -------- | ------------------- | --------------------- | ------------------------- | ----------------------- |
| NE   | 3                | 0.611413 | 0.597168 / 0.598145 | 0.167480 / 0.168945   | 12.60% / 15.05%           | 54.56 px                |
| SE   | 4                | 0.697567 | 0.705078 / 0.719238 | -0.046631 / -0.031738 | 17.60% / 30.99%           | 19.10 px                |
| SW   | 5                | 0.675312 | 0.602051 / 0.560059 | 0.049316 / 0.060547   | 18.13% / 22.91%           | 32.47 px                |
| NW   | 4                | 0.777949 | 0.849121 / 0.810059 | 0.031738 / 0.002441   | 2.60% / 11.43%            | 25.00 px                |

All selected sources fail box, IoU and channel tests. Required IoU is at least 0.90;
channel width is 0.72–0.80 with absolute offset at most 0.04; box dimension errors are
at most 5%, and centre displacement at most 46.54 pixels at 1254×1254.
NE fails both channel widths and offsets. SE fails both widths and its entry-side offset.
SW fails both widths and offsets. NW channel centring passes, but both widths fail.
NW box width and centre pass, but height fails; SE/SW centres pass but dimensions fail;
NE box dimensions and centre all fail.

NW attempt 6 passed both channel samples (0.765625 / 0.727051, offsets 0.002686 /
-0.034180), but failed box and IoU (0.603516). It was not selected because the rule
requires highest IoU when no complete attempt passes.

Separate 128×128 copies are `review/mouths-centred/river-mouth-<edge>.png`. Visual review
also finds SE attempt 4 still resembles a continuous banked strip and lacks the intended
bank-free open-water neighbour/two-bank flare. SW's channel remains narrower and its
banks wider than the strips'. NE is shifted, and NW is too wide. These failures are
retained explicitly rather than claiming the guide was followed.

## Attempts and provenance

| Edge | Calls in this repaint | Returned paintings               |
| ---- | --------------------- | -------------------------------- |
| NE   | 3, 4, 5               | all three                        |
| SE   | 3, 4, 5               | 4 and 5; 3 was a quota rejection |
| SW   | 3, 4, 5               | 4 and 5; 3 was a quota rejection |
| NW   | 4, 5, 6               | all three                        |

The quota rejections returned no image; their records have null file, dimensions and
measurements plus the actual error. They count toward the three-call allowance.
All ten returned paintings are preserved in `raw/`. Every call is in `prompts.json`,
mirrored in `river-prompts-additions.json` and individual
`review/mouths-centred/river-mouth-<edge>-attempt-<k>-record.json` files.
All image records point to immutable raw PNGs. Exactly one per edge is `selected: true`.
Every returned painting has full numbers in its corresponding `-extent.json` report.

`review/mouths-centred/selection.json` identifies selected raw/main pictures, reasons
and measurements. `select-mouth-attempts.mjs` reproduces selection and copies original
bytes only; it never processes pixels or writes raw paintings. Main files were verified
byte for byte against their selected raw files.

## Geometry and preservation

`make-river-guides.mjs` adds the four centred guides; `river-geometry.json` contains
`mouthsCentred`, every supplied coordinate and each `guideOffset`. The eight original
guides and strips, pool and end remain byte-identical, verified against
`review/mouths-centred/before-hashes.json`. All raw paintings existing before continuation
remain byte-identical, verified against `resume-before-raw-hashes.json`.
The earlier mouths were preserved as NE/SE/SW attempt 2 and NW attempt 3 before painting;
those copies matched the original Git blob hashes.

`check-extent.mjs` reads PNGs and writes only the requested report and stdout. It uses
alpha >128, or colour difference >40 from uniform opaque corner colour. IoU compares
the painted mask with the scaled centred guide. Water is blue minus red >15, scanned
transversely at t=-0.25 and t=0. No image registration or fitting occurs. The guide
calibration has a passing box and IoU 1.00; its gray regions intentionally do not
classify as water. Strip calibration demonstrates channel classification only, not
overlap of a three-tile strip with a two-tile mouth.

## Validation

RGBA integrity, distinct source hashes, old guide/source/raw hashes, selected-copy
identity, both TypeScript checks, ESLint, production build, targeted formatting and
Art scope pass. The resumed full test run completed with 1,947 passed, 14 failed and
11 skipped; eight unchanged asset-pipeline test files failed, including missing
`python` (`spawnSync python ENOENT`). The broad suite is not green. No runtime code or
dependencies changed. Temporary build/test output stays in ignored review directories.
No more painting calls are authorized under this repaint's attempt allowance.

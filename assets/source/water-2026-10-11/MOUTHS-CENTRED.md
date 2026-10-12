# Issue #343 — centred mouth repaint checkpoint

Status: waiting for the built-in ImageGen usage limit to reset. The user chose to resume
after that reset rather than use the separately billed API fallback. A one-time follow-up
for this chat is scheduled for Monday, October 12, 2026 at 15:05 America/Toronto;
the image service reported a reset at 18:59:18 UTC (14:59:18 Toronto).

The complete user brief is in
`C:/Users/Zso/.codex/attachments/5c84d8e4-0a5d-429d-b902-4b0b402091d0/Pasted text.txt`.
Continue on `art/343-water` after fetching and pulling with `--ff-only`.
Write only within `assets/source/water-2026-10-11/`. Never push main or develop.

## Preserved sources and guides

The original main mouths were copied byte for byte to `raw/`: NE, SE and SW attempt 2,
and NW attempt 3. Their earlier prompt records now point at those immutable raw files.
The four main mouth files are still the earlier paintings: no new attempt has been selected
while further retries are pending.

`make-river-guides.mjs` now adds four `guides/river-mouth-<edge>-centred.png` pictures.
The original eight guides remain byte-identical. `river-geometry.json` retains its old
geometry and adds `mouthsCentred`, including the per-edge guide offsets and every supplied
coordinate. Hashes for the eight old guides and unchanged strips, pool and end are recorded
in `review/mouths-centred/before-hashes.json`.

## Calls so far in this repaint

| Edge | Attempt | Return    | IoU        | Box        | Channel widths at t=-0.25 / 0 | Centre offsets      | Result                |
| ---- | ------- | --------- | ---------- | ---------- | ----------------------------- | ------------------- | --------------------- |
| NE   | 3       | 1254×1254 | 0.611413   | fail       | 0.597168 / 0.598145           | 0.167480 / 0.168945 | retain and retry      |
| SE   | 3       | none      | unmeasured | unmeasured | unmeasured                    | unmeasured          | usage-limit rejection |
| SW   | 3       | none      | unmeasured | unmeasured | unmeasured                    | unmeasured          | usage-limit rejection |
| NW   | 4       | 1254×1254 | 0.777949   | fail       | 0.849121 / 0.810059           | 0.031738 / 0.002441 | retain and retry      |

NE's box is 12.60% too wide and 15.05% too tall; its centre is displaced 54.56 returned
pixels (allowed 46.54). NW's box width passes but its height is 11.43% too tall;
its centre passes. Neither reaches the required IoU 0.90. Both fail the channel checks.
All PNGs are unchanged returns, with no fitting, cropping, padding, resizing, warping,
mirroring or retouching. The two quota rejections returned no painting; their records have
null file, dimensions and measurements, plus the error, rather than claiming artifacts.

Every call is in `prompts.json`, mirrored in `river-prompts-additions.json` and individual
`review/mouths-centred/river-mouth-<edge>-attempt-<k>-record.json` files.
Full measurements are in the matching `-extent.json` reports.

## Remaining work

At most two further calls per edge remain, counting the recorded quota rejections toward
the user's limit of three new attempts per mouth. Next numbers are NE 4, SE 4, SW 4, NW 5;
last allowed numbers are NE 5, SE 5, SW 5, NW 6. Never reuse a number or overwrite any raw file.
Stop retrying an edge if it passes all tests. If no new painting passes within the allowance,
choose the new painting with highest IoU, copy it unchanged to the main filename, mark its
raw prompt record `selected: true`, and explicitly report the failed tests. SE/SW still need
returned paintings. Do not mark an old painting as a newly generated success.

Use exactly these five references in order: centred guide as edit target, matching strip
(Y for NE/SW, X for SE/NW), town-growth style board, river-water, river-bank. Do not attach
the pixel-art hue reference. Keep a 0.76-tile-wide centred channel with narrow 0.12-tile
banks until the last-quarter-tile flare, and preserve the centred two-tile silhouette.

Measure every new return, preserving the original:

```sh
node assets/source/water-2026-10-11/check-extent.mjs assets/source/water-2026-10-11/raw/river-mouth-ne-attempt-4.png ne --report assets/source/water-2026-10-11/review/mouths-centred/river-mouth-ne-attempt-4-extent.json
```

The checker writes only its requested JSON report and stdout. It uses alpha >128,
or difference >40 from the corner colour on a uniform opaque background. Non-square
returns fail the box test. IoU uses the scaled centred guide; channel water is blue-red >15,
sampled across the full transverse line at t=-0.25 and t=0. No registration or fitting is done.
The known grayscale guide gives a passing box and IoU exactly 1.00; its colorless channel
intentionally does not classify as water. The strip calibration report demonstrates water
classification only, not a strip's overlap with the two-tile mouth guide.

Before the final commit, make separate 128-pixel review copies of the selected mouths,
check their channel/bank widths visually, verify old guide/source hashes, run the source
checks and Art scope check, commit with an `Art:` subject and push `art/343-water`.
This checkpoint is partial and does not claim the four corrected mouths are complete.

## Checkpoint validation

Original guide/source byte checks, RGBA PNG integrity, both TypeScript checks, ESLint and
the production build passed. The full test run completed with 1,947 passed, 14 failed and
11 skipped; eight test files failed, in unchanged asset-pipeline files, including missing
`python` (`spawnSync python ENOENT`). The broader test suite is not green. Targeted formatting
and the Art scope check are run before pushing this checkpoint. Test/build outputs and
temporary files are confined to the review directory; its build and temporary directories
are ignored. The earlier unrelated working changes in this shared checkout are not included
in the river checkpoint commit.

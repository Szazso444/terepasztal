Oil derrick rotations for #535

STOPPED after r1: all three attempts failed the required width gate.
No view passed every test. r3 and r2 were not painted, per the stop rule.

Built-in imagegen edited the original r1 guide on every call, with the style board
and unchanged r0 master. Requested 1024 x 1024; each returned 1254 x 1254.
All raw PNGs are preserved byte for byte. Exact prompts, ordered references,
measurements and corrections are in prompts.json.

r1 attempt 1: width 1017 px, FAIL.
r1 attempt 2: width 899 px, FAIL; closest, copied unchanged to oil_derrick-r1.png,
  explicitly kept: false. It is not an accepted rotation.
r1 attempt 3: width 1022 px by eye, FAIL; automatic width 901 px selected corners
  inside the skid ends. Both corner sets are recorded.
Width limits at 1254: 807 to 892 px (unrounded scaled maximum 892.7402).
Foot ratio, slopes, camera error, height and highlight tests were skipped for every
attempt because width failed first, as required.
r0 reference: Samson-post height 486 / base width 755 = 0.6437;
near-white 20 pixels, near-amber 0.

The existing shared measure.mjs was being edited concurrently for other buildings
and used one-tile limits. It was preserved. measure-oil.mjs applies the two-tile oil
limits, uses pictureOf, measureBase and checkFile(file, 't1', view), and supports
manual corner and post-height readings. record.mjs records a measured call.

The prescribed building-sheets CLI refuses oil_derrick-r1.png because its filename
parser requires an age. Its exported drawLook was used with t1x2 and r1 instead;
the grass preview is in ignored .look/. The closest image was inspected there.
The preview confirms a long narrow machine but is not an approval of its rotation.

Validation: typecheck and lint passed. Repository-wide formatting reported existing
issues in 401 unchanged files. The full test run also reported failures in existing
ownLength, building-guides, roadPaint and landscape.worker tests. No unrelated file
was changed to address these failures.

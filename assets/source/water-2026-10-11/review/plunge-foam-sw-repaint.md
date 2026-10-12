# SW plunge foam repaint — issue #343

Built-in imagegen edited the centred guide with the five references in the requested order.
Both returned paintings are retained unmodified at 1254 × 1254. Attempt 2 was archived byte
for byte before painting; attempt 1 remains in raw/. The third new call (attempt 5) returned
HTTP 429 `usage_limit_reached` and no image.

Attempt 4 is selected under the brief's closest-result fallback. It has dense connected foam
along the entire foot at the 128 px review width, but **does not pass the geometry box test**.
The source retains its outside-band paint and some raised flecks; no crop, fit, warp, resize,
alpha repair or palette retouch was applied to the selected return.

| Measurement | Attempt 3 | Attempt 4 (selected) |
| --- | --- | --- |
| Painted box | 149,433 to 1157,980 | 139,438 to 1117,947 |
| Width error | 7.18% | 3.99% |
| Height error | 16.32% | 8.24% |
| Centre distance | 83.64 px | 65.51 px |
| Band IoU (information only) | 0.1717 | 0.1662 |
| Foam share y=0..0.1 | 0% | 0% |
| Foam share y=0.1..0.25 | 52.77% | 58.26% |
| Foam outside the exact band | 47.23% | 41.74% |

Expected box: 156.75,391.875 to 1097.25,862.125 at the returned scale. Limits: 5% width
and height error, and centre distance at most 46.535 px. Foam shares use all painted foam
pixels as denominator, so the two zones and outside share sum to one.

The existing river `check-extent.mjs` was used with a temporary foam dispatch for measurement,
then restored to preserve the other task's uncommitted tool. The committed companion reproduces
the foam measurements without depending on those uncommitted river guides:

```powershell
node assets/source/water-2026-10-11/check-plunge-extent.mjs assets/source/water-2026-10-11/plunge-foam-sw.png
```

Guide generation preserved every pre-existing guide byte for byte. The new guide and the
`plungeFoamSwCentred` entry specify the origin, foot, dense zone, breakup zone, band corners
and centred box. Full prompts, ordered references, returned dimensions, measurements and
selection rationale are in prompts.json and plunge-foam-sw-prompts-additions.json.

Validation: typecheck, lint, build, Art scope and formatting of the changed scripts/JSON pass.
The full repository format check reports 374 existing files outside this repaint. Build output
is confined to qa/plunge-foam-sw-build/.

`npm test -- --no-cache --configLoader runner` reported at least 14 failed tests in unchanged
asset-pipeline files (blender_runner, verify_construction, painted/run, filehash and
handbuilt-method), plus suite collection failures in handbuilt/run and agents/ownership.
The failed broad run was stopped after several minutes with one worker still running;
complete suite totals are unavailable. No out-of-scope test or formatting repairs were made.

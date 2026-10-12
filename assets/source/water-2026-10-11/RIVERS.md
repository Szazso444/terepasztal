# River material sources — 2026-10-11

The four mouths were replaced by measured centred attempts on 2026-10-12.
See `MOUTHS-CENTRED.md` for the current selected sources and failed geometry/visual checks;
the mouth visual-review statements below describe the earlier delivery, not approval
of the current fallback mouths.

Eight independently painted source pictures: `river-strip-x.png`, `river-strip-y.png`,
`river-pool.png`, `river-end.png`, and `river-mouth-{ne,se,sw,nw}.png`.
Generated with the built-in ImageGen tool by editing the grayscale geometry guides.
These are material inputs for the later Art finishing script, not runtime tile pieces.
No source painting was fitted, cropped, warped, resized, mirrored, padded or retouched.

`make-river-guides.mjs` uses the existing `pngjs` devDependency to generate the eight
1024×1024 RGBA guides and `river-geometry.json`. It creates `refs/ref-water.png` only
when absent, using the requested centre crop of the original water. Run from any directory:

```sh
node assets/source/water-2026-10-11/make-river-guides.mjs
node assets/source/water-2026-10-11/check-river-materials.mjs
```

`prompts.json` contains the shared water provenance journal; `river-prompts-additions.json`
is this job's separate journal so concurrent material jobs retain their records.
The checker reads each original PNG, records its actual dimensions as `returned`,
checks RGBA and distinct file hashes, merges the river records into the shared journal,
and makes separate 128×128 review copies under `review/river/`.
At that preview size a guide tile is 64 pixels wide. Review copies never replace sources.
Rejected enlarged pool, end and mouth attempts are preserved under `raw/` with their prompts.

Visual review: both straight strips keep a steady water width and two steady bank widths,
with open cut ends. Pebbles and mud stay low, water has reversible current marks,
and the four mouths end their banks as they open into a still-water neighbour.
The accepted pool and round end retain substantial transparent margins.
Residual soft alpha, small edge fringes and imperfect geometric boundaries belong to
the deterministic finishing script, as specified by the author.

Verification: source PNG checks and Art scope pass. Both TypeScript checks, ESLint and
the Vite production build pass. Vite output was directed under this folder's review directory.
The broad test run reported three failures in the existing handbuilt-method tests and was
interrupted after more than six minutes with a worker still running. Repository formatting
reported 374 unchanged files; files outside this source folder were not reformatted.
Logs for these checks are under `review/river/`.

The C: drive had zero free bytes during this job. Later ImageGen responses supplied PNG bytes
without a saved-file path; those bytes were written unchanged to this folder on G:.
No files were deleted to make disk space. No runtime assets or gameplay code changed.
One early pool response without a saved-file path was not retained before the retry;
its prompt is recorded with null file and dimensions, rather than claiming a saved artifact.
All eight selected source paintings and the saved rejected paintings are retained.

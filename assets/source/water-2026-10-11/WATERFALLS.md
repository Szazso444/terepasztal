# Waterfall material paintings

Issue #343, branch `art/343-water`, based on `origin/develop` at `f691330d`.
Built-in ImageGen painted each asset separately; no source was mirrored, cropped,
warped, fitted, resized, padded, recoloured or retouched.

The four opaque FACE materials are square-on surfaces before projection:
`fall-sheet-lit.png`, `fall-sheet-shade.png`, `cliff-rock-lit.png`, and
`cliff-rock-shade.png`. Lit materials face SW (+y); shaded materials face SE (+x).
The sheets show falling water through the full square. The rock is a standing
layered cliff material, rather than a ground texture. NE/NW faces are invisible.

`plunge-foam-sw.png` and `plunge-foam-se.png` are separate image edits of their own
guides. They lie flat on the lower water. Their transparent margins and partial
alpha are retained exactly as returned. The first SW attempt enlarged and shifted
the guide band; it is preserved in `raw/plunge-foam-sw-attempt-1.png`.
The first SE attempt faded foam along the cliff length rather than across the
band; it is preserved in `raw/plunge-foam-se-attempt-1.png`.
Guide framing is approximate in the paintings; the exact faces and foam masks
belong to the later finishing script.

Every request asks for 1024x1024; all six selected paintings returned 1254x1254.
Real returned PNG dimensions, including the
rejected attempt, are recorded in `prompts.json` and `fall-prompts.json`.
`fall-prompts.json` is a waterfall-only journal to protect prompts while other
water-material tasks share this folder; the checker merges it into the shared
manifest by ID without discarding other entries.

## Reproduce the guides and inspect the originals

```sh
node assets/source/water-2026-10-11/make-fall-guides.mjs
node assets/source/water-2026-10-11/check-materials.mjs --complete
```

The guide script uses the repository's existing `pngjs` devDependency. It draws
`guides/face.png`, two plunge-foam guides, and eight final-face geometry guides for
drops 1–4. The FACE guide was never attached to an image request.
`fall-geometry.json` records the author's 9.8 px level, 78.4 px canvas step,
projection, face corners, bank/water fractions and foam footprints. No runtime
geometry was changed.

The checker reads real PNG dimensions, verifies opacity of every FACE, records
source SHA-256 hashes and alpha statistics, and produces separate review copies.
FACE reviews are 36x39; FOAM reviews are 128 px wide. The `-4x` review copies
magnify those reduced pixels only. Originals are never rewritten.
`review/waterfall-checks.json` holds the measurements.

## Material review and limitations

At game scale, the water's vertical ribbons and the rock's broad ledges remain
readable. Lit/shaded pairs use the same material family with a darker shaded
partner. Foam retains a connected churning foot and quieter waterward patches.
The raw sources are materials for the later deterministic finishing script, not
finished waterfall sprites or animation frames.

ImageGen did not enforce the exact white-water palette cap despite the prompts:
some raw highlight pixels exceed #E0DDD2, especially in the lit water sheet.
Counts are recorded in `review/waterfall-checks.json`. These pixels remain
untouched under the author's no-retouch rule. Retries were limited to wrong
framing or wrong foam distribution; no palette-only retry or source colour
correction was performed.
The Art finishing/integration review must account for this before shipping.

## Repository gates

- Typecheck: pass.
- ESLint: pass.
- Production build: pass; output was directed into this task folder and excluded
  from the commit. Existing large-bundle warning remains.
- Full tests: 1,947 passed, 14 failed, 11 skipped; 104 passing suites and 8 failing
  suites. Pipeline failures report `spawnSync python ENOENT`; the unchanged
  ownership suite reports an invalid-token syntax error. No test file changed.
- Repository formatting: fails in 374 unchanged files. Those files are outside
  this task's scope and were left alone.
- Art scope: pass. New waterfall scripts and metadata are checked separately
  with Prettier; all committed waterfall paths remain within this source folder.

No dependency, runtime code, atlas, or finished-water script was added or changed.

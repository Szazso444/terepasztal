# Mountain source paintings

The centred spring repaint is incomplete: image generation was refused by the
account usage limit. The current springs are unchanged. See [REPAINT-STATUS.md](REPAINT-STATUS.md)
for the prepared guides, checker, preserved attempts and remaining work.

Issue #371. This folder holds the source paintings of three prompts: the C11 surface swatches,
the C12 glacier materials and the C13 headwater springs. C12 was delivered on
`art/371-mountain`. C11 and C13 went out without an issue number, so C11 arrived on
`art/353-mountain` and C13 on `art/344-mountain`; both are merged into the C12 branch, and all
three belong to #371. Each was based on `origin/develop` at `f691330d`.

Every painting is a built-in ImageGen return, preserved byte-for-byte: no fitting, cropping,
resizing, padding, alpha cleanup or retouching. Every call asked for 1024×1024; every return is
1254×1254 except `ice-portal-lit.png`, which is 1613×975. Upper-left light throughout. These are
source material for the later Art finishing pass, not packed game tiles. Rejected attempts stay
in `raw/`.

- **C11 swatches.** Paintings `snow.png`, `mountain-rock-high.png`, `alpine-ground.png`,
  `glacier-ice.png`, `moraine.png`; no rejected attempt. `make-swatch-guides.mjs` writes
  `guides/swatch-scale.png` and `swatch-geometry.json`. `review-swatches.mjs` writes
  `review/<swatch>.png`, `review/materials-sheet.png` and `review/validation.json`.
- **C12 glacier.** Paintings `glacier-strip-x.png`, `glacier-strip-y.png`, `glacier-lobe.png`,
  `ice-cliff-lit.png`, `ice-cliff-shade.png`, `ice-portal-lit.png`, `ice-portal-shade.png`;
  rejected `raw/glacier-lobe-attempt-1.png` and `raw/ice-portal-lit-attempt-1.png`.
  `make-glacier-guides.mjs` writes six `guides/` images and `glacier-geometry.json`.
  `check-glacier-material.mjs` writes `review/*-game-scale.png`, `review/game-scale-sheet.png`
  and `review/png-checks.json`.
- **C13 springs.** Paintings `spring-ne.png`, `spring-se.png`, `spring-sw.png`, `spring-nw.png`;
  rejected `raw/spring-ne-attempt-1.png` and `raw/spring-sw-attempt-1.png`.
  `make-spring-guides.mjs` writes `guides/spring-*.png`, `spring-geometry.json` and
  `refs/ref-water.png`. `review-springs.mjs` writes `review/spring-*.png` and
  `review/verification.json`.

`prompts.json` is one list of 20 entries, C11 first, then C12, then C13: one entry per image
call, rejected attempts included, each with its exact prompt, repository-relative references and
the returned size. Each review script takes only its own entries (by file name) and writes the
`returned` sizes back, so run Prettier on `prompts.json` after it. The review scripts leave the
paintings untouched; review PNGs are thumbnails only.

```sh
node assets/source/mountain-2026-10-11/make-swatch-guides.mjs
node assets/source/mountain-2026-10-11/review-swatches.mjs
node assets/source/mountain-2026-10-11/make-glacier-guides.mjs
node assets/source/mountain-2026-10-11/check-glacier-material.mjs
node assets/source/mountain-2026-10-11/make-spring-guides.mjs
node assets/source/mountain-2026-10-11/review-springs.mjs
```

## C11: surface swatches

Five flat, opaque ground-material swatches, each painted with the same four references: the
town-growth style board, `terrain-production/rock-surface.png`, `base-v1/terrain-mountain.png`
and the land-biomes board. No attempt was rejected. The scale card was never attached to an
image call. `REVIEW.md` keeps Codex's original C11 notes.

`review-swatches.mjs` writes 199×199 area-averaged copies and a contact sheet in the order snow,
high rock, alpine ground, glacier ice, moraine. At that scale snow reads as soft blue-grey
drifts, rock as fractured plates, alpine ground as moss, lichen and scree, ice as matte blue-grey
ice with crevasses, and moraine as loose rubble with dirty ice.

ImageGen did not hold the colour ceiling. `review/validation.json` measures Rec.709 luma against
the cursor colour `#ECE4D0`: snow has 124543 pixels at or above it (about 7.9%), alpine ground
37, glacier ice 175, moraine 105 and high rock none. The swatches are not palette-compliant
runtime materials; the finishing pass has to bring snow down.

## C12: glacier materials

Seven selected paintings. The strip and lobe calls edit their geometry guides; the ice-front and
portal calls have no guide attached. The style board supplies the painted language and the older
mountain picture supplies hue only. The C11 swatches were not in that checkout, so the mountain
reference is attached once as the fallback. Both fronts are fully opaque; the strips, the lobe
and the caves have transparency.

`make-glacier-guides.mjs` writes six guides and `glacier-geometry.json`. The tongue guides are
schematic geometry references, not finished pieces, and the face guide is never attached to an
image call. `check-glacier-material.mjs` checks sizes, front opacity and provenance;
`review/game-scale-sheet.png` shows the x strip, y strip and lobe at 128×128, then the lit front,
shaded front, lit portal and shaded portal at 36×39. Exact silhouettes, seam blending, front
placement and cave fitting belong to the finishing pass.

## C13: headwater springs

Four directional springs, each a guide edit with five inputs: the spring guide, the style board,
two rock props and a water reference. `art/343-water` was not on the remote when C13 was painted,
so the water reference is the centre crop of `base-v1/terrain-water.png` that
`make-spring-guides.mjs` writes to `refs/ref-water.png`, used for hue only.

`review-springs.mjs` writes 128×128 copies of the whole canvas (the nominal tile is 64 px wide)
and records RGBA, alpha counts and SHA-256 for every painting in `review/verification.json`. The
pool, the upwelling and the upstream stone crescent stay readable in all four. Extents, pool
positions, stone scale and edges only approximate the guides: the finishing pass validates them
against `spring-geometry.json`, replaces the downstream river band, cuts exact alpha and animates
the upwelling.

## Checks on Codex's machine

Codex ran the gates on Windows and reports, for all three prompts: typecheck, lint and the
production build passed, and the folder's scripts and JSON passed Prettier. The repository-wide
format check failed on 374 untouched files, and the full test suite did not pass, for reasons
outside this folder: a full C: drive, `python` missing from `PATH`, and two untouched suites
(`tools/agents/ownership.test.mjs` does not load; `tools/asset-pipeline/handbuilt/run.test.mjs`
fails its Windows path property at seed 19). No file outside this folder was changed. The gate
logs are not kept, as they held local paths; `review/checks.json` keeps C11's compact results.
Local build output and test temporary files are ignored by this folder's `.gitignore`.

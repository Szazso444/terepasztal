# Waterside trees · issue #460

Six source paintings for later atlas integration and waterfront placement. All assets were generated with the built-in image_gen tool; exact prompts, reference paths, correction paragraphs, measurements and visual reviews are in `prompts.json`. No atlas, renderer or map-generation files were changed.

Each selected PNG is a byte-for-byte copy of its retained raw attempt. All 13 raw attempts were also checked against the original tool outputs: 13 exact SHA-256 matches. `sha256.json` records the delivered images' hashes. The requested canvas was 1024×1024; the tool returned 1254×1254 for every attempt. Those dimensions and the alpha channel are preserved, with no cropping, scaling, repositioning or recolouring.

| Picture             | Selected attempt | Drawn height | Drawn width | Root spread | Foot in source | Anchor in source | Outstanding tree failures |
| ------------------- | ---------------: | -----------: | ----------: | ----------: | -------------- | ---------------- | ------------------------- |
| tree-mangrove-1.png |                2 |           30 |       42.58 |       22.91 | 637, 950.5     | 637, 950.5       | None                      |
| tree-mangrove-2.png |                2 |           38 |       56.46 |       30.66 | 641, 994.5     | 641, 994.5       | None                      |
| tree-mangrove-3.png |                2 |           46 |       73.85 |       43.59 | 638, 1040      | 638, 1040        | None                      |
| tree-willow-1.png   |                3 |           40 |       52.57 |           — | 630, 1195      | 630, 1044.4783   | None                      |
| tree-willow-2.png   |                2 |           48 |       64.74 |           — | 623.5, 1199    | 623.5, 1070.4444 | None                      |
| tree-willow-3.png   |                2 |           54 |       73.73 |           — | 611.5, 1211    | 611.5, 1094.2    | None                      |

Widths and root spreads include the packer's 1.2 widening and runtime tree scale. Source feet and anchors are unrounded in `trees.json`. Mangrove 3 uses the visible root-tip ellipse center read by eye; willow 1 uses the central trunk foot rather than its lower projecting side root. Their automatic estimates, both measurement runs, reasons and final foot choices are retained in `prompts.json`.

Every selected painting has zero edge pixels, zero cursor-white pixels, zero selection-amber pixels, and zero cyan-water percentage. All widths, root spreads, center offsets and willow below-foot distances pass. The looks in `checks/` were inspected at zoom 1 and zoom 2 for species, placement, clusters, light, colour depth and absence of painted ground, water and shadows. Earlier attempts were retained because their highlights were too bright; young willow attempt 1 also failed the width range.

Run from the repository root with the existing pngjs development dependency available:

```sh
node assets/source/waterside-trees-2026-10-16/check-tree.mjs assets/source/waterside-trees-2026-10-16/tree-mangrove-3.png --kind mangrove --height 46 --foot 638,1040 --record
node assets/source/waterside-trees-2026-10-16/check-tree.mjs assets/source/waterside-trees-2026-10-16/tree-willow-1.png --kind willow --height 40 --foot 630,1195 --record
node assets/source/waterside-trees-2026-10-16/verify-set.mjs
```

For other selected trees, use their height above and omit `--foot`. `check-tree.mjs` reads the input path from the current directory and locates the atlas and output folder relative to itself. It writes a single JSON result and the paired zoom look. `verify-set.mjs` verifies the six selections, 13 RGBA raw images, dimensions, hashes, measurement records, numeric acceptance limits and visual-review records, then refreshes `sha256.json`.

The checker was calibrated before painting: round tree returned [1536,1024], box [371,85,1166,936], foot [800,935], anchor [800,828.75], width 53.9407, offset 2.1346, edge pixels 0, cursor-white 0, amber 57, luminance P99 223.014. Reeds foot [898,794.5], width 15.8768, root spread 9.5969. These match the requested tolerances.

Repository validation is not a green application gate. This fresh checkout has no installed dependencies, and the author's folder restriction was preserved. Existing tools in another checkout were reused through a temporary local module resolver, without installing packages or changing dependency files. Lint passed, Art scope passed, changed checker formatting passed and `git diff --check` passed. Full typecheck failed on missing `vite/client`; an additional run with explicit existing dependency paths exposed missing Node test types and assertion types in unchanged source tests. The application test run had 118 suites pass and 51 fail, with 2536 tests passing, 18 failing and 17 skipped; failures included dependency resolution, child-process resolver paths and an unchanged body.ts architecture assertion. The direct Vite build could not resolve pixi.js from the fresh checkout. Full repository formatting reported 467 unchanged files. These application checks do not validate the new artwork and have not been represented as passing. All tree-specific checks pass.

# Mountain headwater spring source paintings

Four independently painted source materials: `spring-ne.png`, `spring-se.png`,
`spring-sw.png`, `spring-nw.png`. Built-in image tool, guide edits with five inputs
per call; upper-left lighting retained in every direction. Base: origin/develop
at f691330d. Branch: art/344-mountain.

The requested canvas was 1024x1024; all six returned paintings are 1254x1254 RGBA.
The originals are preserved byte-for-byte without fitting, cropping, resizing,
padding, alpha cleanup or retouching. Two rejected framing attempts are retained
in `raw/`. `prompts.json` records each exact prompt, reference and decoded size.

These are source material for the later Art-role finishing pass, not packed game
tiles. Generated extents, pool positions, stone scale and edges approximate the
guides; the later finishing pass must validate them against `spring-geometry.json`,
replace the downstream river band, cut exact alpha and animate the upwelling.
Soft edges and coloured fringes have intentionally been left for that pass.

`git fetch origin art/343-water` failed because the remote branch did not exist.
The fifth reference was therefore the specified centre crop of terrain-water.png,
used only for hue. No local water-branch art was substituted.

Reproduce the guides and metadata with:

```sh
node assets/source/mountain-2026-10-11/make-spring-guides.mjs
node assets/source/mountain-2026-10-11/review-springs.mjs
```

Review copies in `review/` use the complete canvas downscaled to 128x128, where
the nominal tile is 64px wide. Visual inspection: the lighter pool/upwelling and
the upstream limestone/slate stone crescent remain readable in all four images.
`review/verification.json` records RGBA, alpha counts and SHA-256 for every painting.

Validation on 2026-10-11:

- Guide script, PNG checks and native-scale visual review passed.
- Repository typecheck, lint and build passed.
- Full test suite failed: 106 files failed, 6 passed; 183 tests failed, 117 passed.
  The environment reports missing `python` and a full C: drive; no existing source
  files were changed to resolve these unrelated failures.
- Repository formatting check failed on 374 existing files outside this folder.
  Those files were left unchanged.
- npm initially could not write C: cache logs (ENOSPC); lint, tests and formatting
  were retried using the worktree's ignored node_modules cache with logs disabled.

# Illustrated runtime sprites

This pass uses the approved source PNGs directly at four physical texels per logical
world pixel. It is based on `claude/nifty-bohr-vu1pko`, with changes on
`codex/illustrated-sprite-quality`. The source PNGs are unchanged.

Open [the comparison](index.html) or run the game (`npm run dev`). The game now loads
the four atlas pairs in `public/assets` automatically. Zoom reaches 3x and 4x;
high-DPI canvases use up to 2x resolution. No new runtime dependency is needed.

## What changed

- 67 source studies supply 207 high-resolution runtime frames: 43 props, 54 terrain,
  92 structures and 18 icons. `public/assets/illustrated-report.json` records every
  source-to-frame mapping and every deferred source.
- Texture UVs address the full-resolution atlas; logical texture dimensions and
  anchors retain the world coordinate system. Game footprints, track geometry and
  vehicle physics do not change.
- Edge cleanup removes the studies' faint alpha glow with a coverage ramp. Area
  resampling uses premultiplied alpha and preserves partial edge coverage, instead
  of turning every surviving pixel fully opaque.
- Ordinary ground and water use interior material from the studies, projected onto
  the game's exact 2:1 diamond. Their painted slab walls and rim shadows are excluded.
  Variants have different interior sampling and shared quiet edges. Water phases
  have a restrained periodic texture offset. Hills and mountains retain their
  illustrated silhouettes.
- Atlas gutters are extruded to protect linear filtering, and identical images are
  packed once even when several frame names reference them.
- `{resolution: 4, partial: true, frames: {...}}` extends the existing atlas format.
  Missing frames in a partial atlas come from that group's procedural generator.
  Legacy atlases without these fields still replace the whole group at resolution 1.
  Frame x/y/w/h/ax/ay remain physical texel coordinates. Logical dimensions are w/h
  divided by resolution; anchor ratios remain ax/w and ay/h.
- UI thumbnails use logical dimensions and smooth sampling for high-resolution art.

## What is deliberately not claimed complete

This is a working scenery/building/icon conversion, not a completed directional
railcraft art set. Eighty source studies are deferred, including every locomotive
and wagon, tracks, direction-dependent depot art, connected bridges, people,
semantic overlays and effects. They retain their working procedural frames.

The earlier importer reused a single picture for all facings and placed complete
locomotives inside engine/cradle slots. That cannot preserve rail motion. A source
picture has no pixels for an unseen rear side, and an assembled image is not a set
of independently moving bogies. The railcraft production step needs authored
multi-view art or reconstructed 3D models rendered into the 25 drawn facings,
with body/engine/tender/cradle/frame and bogie layers, consistent scale and anchors.
See `assets/source/base-v1/RAILCRAFT.md` for all 52 vehicle specifications.

Likewise, this pass does not invent unique upgrade-stage buildings from one study:
several level/variant keys still share an illustration. Runtime dimensions follow
their original frame envelopes, but distinct construction stages need more art.
The three full-chain mining station studies share existing quarry runtime keys;
separate per-definition art selection is still required to use them individually.

The source images cannot retain every full-size detail when shown as a small object
on a large map. This pass preserves detail for screen-sized sampling and closer
zoom instead of first discarding it into a 12–64 pixel source frame.

## Rebuild and verify

```sh
npm run art:illustrated
npm test
npm run typecheck
npm run lint
npm run build
npx prettier --check "src/**/*.{ts,json,css}" index.html
node scratchpad/verify-illustrated-hd.mjs
node scratchpad/verify-curves.mjs hd-after
node scratchpad/art-scene.mjs hd-after
```

The browser scripts require the dev server on localhost:5173 and the Playwright
runtime described in `scratchpad/runtime.mjs`. They run isolated headless browser
sessions and save images to the repo. `runtime-report.json` verifies 2,839 available
frames, all logical sizes and anchors, partial and legacy atlas loading, UI sizing,
and exclusion of unsafe single-view vehicle/overlay substitutions. Node tests cover
alpha math, halo cleanup, flat diamond extraction, deduplication and atlas gutters.

Review normal, close, wide and dusk scenes in `../shots/scene-hd-after/`. The old
pipeline's scene is retained in `../illustrated/shots/scene/village.png`. No images
are embedded in chat. Original studies, old pipeline outputs and game saves remain
available.

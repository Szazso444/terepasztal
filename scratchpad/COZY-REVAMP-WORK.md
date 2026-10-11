# Cozy revamp checkpoint · 2026-09-25

Implemented in production code; review fixture uses the real Game on generated
128×128 seed 7412 with no material, rail, scale or atlas overrides. Candidate
Rocket remains QA-only; production screenshots honestly show the current train.

- Original Pastoral Pulse first; three supplied genre arrangements in shuffled
  bags, no consecutive repeats. Browser decoded all four, verified ended-event
  advancement, gesture gating, mute and missing-file synth fallback. Copied MP3
  hashes match source downloads.
- Worker-painted world-coordinate terrain, irregular material boundaries, shared
  density-dependent hill relief, local excavation updates and animated ripples.
- Actual lower-silhouette blending, two tiny local ground scuffs, softer ballast.
- Three generated matching tree variants, trees 1.5×, taller tower supports,
  kiln .7×. Sources/prompts in assets/source/cozy-v3; production atlases packed.
- Common 11 px person / 1.75 m reference; six families calibrated by door aperture
  fractions across all levels, estimates explicitly registered for other equipment.
  Build ghosts use the same scale. Gate rejects new unregistered illustrated families.
- Building glass masks restricted to reviewed window regions; vehicle masks use
  explicit amber window pixels and follow all facing/mirroring transforms. Warm
  lamps, gentle rain, fog, corrected steam effect and separately adjustable ambience.
- Browser QA: 256 cached chunks; camera motion paints zero more; excavation 6
  local chunks; approximately 9.3 ms median CPU submission on headless software
  renderer (not a hardware FPS claim). Real Fleet.tick fixture exercised 48
  headings, curves, switches and reversal with zero centre displacement/errors.
- Complete: 164 tests pass; build/typecheck, lint and Prettier pass. Ten final
  generated-map stills plus production play screen are in the gallery. Sources and
  renders copied to G:/DEV/Terepasztal. RESUME.md and style guide updated.

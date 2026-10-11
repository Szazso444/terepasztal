

## 2026-10-07 — revision-v3 complete; STOP for owner review

Latest user: Rocket wheel diameters -20%; General wheel running surfaces dark grey; BM50 does not match workbook, rebuild; ICE1 accepted. ICE1 acceptance recorded in approved.json, unchanged. C50 unchanged. Do not begin other locomotives before review; batch has these three, max5 rule persists. GMAM reference question still unresolved, not part of this correction batch.

Installed complete bundles: Rocket 05b179f6f211cf9a, General e3000f8ce0fe2277, BM50 feb876ce0486a869. Sources/manifests/scripts in revision-v3; installed.json authoritative. Original models retained.

Rocket: all eight wheel phase meshes radially scaled0.8 around fixed axle positions; gauge and tyre width unchanged; body lowered0.13275m to suit smaller wheels, smoke anchor adjusted. Same metres-to-pixels scale confirmed. Animation travel-cycle ratio exactly0.8. General: all16 tyre materials (eight phases on engine and leading truck) set to dark grey linear RGB0.055,0.060,0.065; geometry/other materials unchanged.

BM50: entirely new geometry built from workbook v8 row6 front+rear images. Red apron now0.27..1.05high, low wide rounded bonnet1.055..1.89, width1.58; open padded seat and silver rear rail, no glazing; portholes, louvres, hatches, caps, yellow slatted end buffers, three mostly hidden wheels. Axle x=[-1.17,.16,1.40], radius.275; runtime rigid supports recalibrated. New profile bm50-reference-v3 is the accepted reference-colour style at resolution4 (density only), retaining no AO/cast shadows. Review-only resolution8 front/rear close-ups show geometry beside both workbook pictures.

Review: http://localhost:5182/scratchpad/models/handover-review/page/revision-v3.html ; mirrored to G:/DEV/Terepasztal/renders/engine-models/revision-v3.html. All three straight,32curveframes,reversed,night visually inspected. Browser completeness96headings/8phases and stopped-freeze pass; no browser errors. Pipeline197tests and game328tests pass. All unrelated locoFit entries unchanged, including approved ICE1/C50. Three production runs finished; no render workers left running. Old captured pass preserved in fleet-painted/before-v3. No commit/push/main-checkout changes.



## 2026-10-07 — reference-colour revision, STOPPED for owner review

New owner directions: use workbook pictures/guidelines as shape authority (not current game models), lighten approximately 30%, reduce baked shading because a separate system will own shadows, stop after every five locomotives. Policy saved in fleet-painted-2026-10-07/batch-policy.json.

Located G:/DEV/Terepasztal/locomotive-wheels-bogies-v8.xlsx. Extracted embedded images and text into reference-v8; provenance/hash in revision-v2/references.json. GMAM/Garratt is NOT in v8 (only Crocodile has a garratt body-plan reference). Asked user whether standalone assets/source/base-v1/loco-gmam.png should be used or Garratt skipped; no answer yet. Do not reinterpret a real Garratt or the current game geometry as the requested source. GMAM untouched this turn.

Four corrections completed and installed: ICE1 cd94485ea3b4b8cf, General 82c2bc3df986cad5, Rocket 2b41e3d15c548df7, BM50 be8e377ecbd7feeb. This is 4/5 of a review batch; stop here pending reference/review. Other six previously installed v1 fleet models remain v1; 18 others still unfinished. C50 and unrelated fits verified unchanged. No render worker left running.

New profile tools/asset-pipeline/painted/profiles/fleet-reference-v2.json: reference colour emission, shallow 10% normal ramp, Standard colour management, 2% paint variation, no added AO or cast/contact shadows. Original source-image shading remains. ICE1 facing0 luma +32.2%; four-facing averages vary (~31% BM50,39% General,45% ICE1/Rocket). Do not claim all models exactly +30%.

BM50 now has three axles, as workbook row6 specifies, with six rotating pivots and matching runtime rigid supports. Added side portholes, yellow grille, front lamp. New builder/source in revision-v2/models/bm50, original sources preserved. Still a simplified hand-built rendition, not a claim of identical reference detail. General/Rocket/ICE1 retained image-derived geometry checked against workbook rows18/5/28.

Review http://localhost:5182/scratchpad/models/handover-review/page/revision-v2.html shows workbook reference, previous pass, current pass, curves, reversed orientation, night for all four. Also mirrored to G:/DEV/Terepasztal/renders/engine-models/revision-v2.html. Before-v2 screenshots retained. All four 32-frame contact sheets visually inspected; complete 96 headings/8 wheel-phase presence and stationary freeze passed, no browser errors. ICE1 fresh-process sample repeat pixel-identical. Pipeline tests197 and game tests328 pass. Full production receipts validated by installer. No commit/push/main-checkout edits.

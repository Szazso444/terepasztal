# SW1 — visible centre tank and four front windows

Owner correction: the tank was visible in the orthographic side view but hidden
in game, and the cab front must have four windows, not five. Otherwise preserve v3.

The tank was too narrow/high behind the near chassis beam at the game camera
angle. Its width is now2.10 model units instead1.36; final centre height0.57
instead0.80; bottom0.20. Length stays2.10. This exposes the side below the walkway
without changing the model's length or wheel gauge. Four front panes replace the
five-pane row, with updated borders/reflections and generated window-light masks.

Original picture is references/01.png. The owner's annotated correction is saved
as references/02-owner-correction.png and hash-locked in project.json. The blue
circle is an annotation, not a livery input. Window count in observations.json
has been corrected. Recipe assertions guard the four-pane count and tank placement.

Both bogies' evaluated geometry/material hashes match v3 exactly. Shared pipeline,
style and all other locomotives are unchanged. Sample89641d4efaf9d6fb rendered
twice with identical pixels; fresh construction replay also matches.

Status: complete; stopped for owner review. Installed production bundle `12e66cb2e7099846`.

Verified actual game tank visibility, four front panes and night lighting, 32 curve
frames, reverse view and stationary freeze. Game tests: 329 passed; build/typecheck
passed. Other locomotives, both bogies and calibration remain unchanged.

Preview: http://localhost:5182/scratchpad/models/handover-review/page/sw1-picture-v4.html

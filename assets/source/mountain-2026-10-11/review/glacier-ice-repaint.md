# Glacier ice repaint (issue #371)

Selected `raw/glacier-ice-attempt-3.png`, copied byte for byte to `glacier-ice.png`.
The previous painting remains unchanged in `raw/glacier-ice-attempt-1.png`.
Attempts 2 and 4 are also retained. Attempt 2 was rejected conservatively for borderline
crack length; attempt 4 was darker but had strokes exceeding the length budget.
Three new ImageGen calls requested 1024×1024, and all returned 1254×1254.
No source painting was resized, cropped, recoloured or retouched.

The selected image's minimum alpha and border minimum alpha are both 255.
The fraction of pixels darker than #8E9EA7 is 0.00784030178389282 (0.784%).
The comparison uses Rec.709 encoded RGB luma; the reference shade has luma 155.2482.
Full-size inspection shows isolated short gently curved strokes in varied orientations,
no joined cracks or closed cells, and broad smooth ice across most of the surface.
At 199×199 the ice stays quiet and the cracks remain separate, matching strip-y's material.

Selected as the closest result after the three allowed new attempts. Some highlights
exceed the intended #C8D3D8 ice tone: 4.373% of pixels exceed that tone's luma. The brightest
RGB is [223, 228, 232], with luma 227.2258, below cursor-white luma 228.2568.
This palette limitation is recorded rather than retouching the original return.

`check-glacier-ice.mjs raw/glacier-ice-attempt-3.png` reproduces opacity, dark coverage,
dark-component box measurements and the 199×199 QA thumbnail. Component boxes assist
visual inspection and do not claim to measure curved crack length. Selected status and
visual review are recorded in `prompts.json`; each new prompt points to its raw painting.

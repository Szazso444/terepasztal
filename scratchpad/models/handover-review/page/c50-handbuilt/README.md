# C-50 Blender rebuild, 2026-10-07

Owner accepted rebuilding the selected reference with simple precise Blender
geometry after rejecting the ComfyUI result. `build.py` constructs an entirely
new editable model; it does not modify or reshape any earlier GLB.

Reference: ../c50-regenerated-2026-10-07/c50-reference-v2.png. Photo sources,
attribution and the generation prompts are retained in that folder's README.
Keep those reference credits with this interpretation (CC BY-SA 4.0).

## Deliverables

- c50-handbuilt.blend: editable, named components, materials, lights and camera.
- c50-handbuilt.glb: exported model with bevels and normals applied.
- front/rear/side/front-end/rear-end/top.png: six rendered review views.
- validation.json: equal hood widths, straight longitudinal alignment, wheel
  pivot count and component count.
- build.py: repeatable Blender construction and export.
- publish.py: reference comparison and preview-page publication.

Both hoods are 1.37 units wide. Deck width is 1.9008, cab width 1.7064 (both +8% at owner request). Central cab
length 1.72, each hood length 1.35; these are modeled proportions from the image,
not a certified dimensioned prototype drawing. Wheels have radius .43 and are
grouped under four independent axle-aligned pivots. Stationary chassis is separate.

Clean charcoal/red materials, opaque blue glazing with diagonal highlights,
rounded panels, pressed louvres, radiator, lamp housings, handles, hinges, steps,
couplers and wheel details replace the reconstructed lumpy surfaces. Small
fittings and shading remain simplified relative to the illustration. No projected
texture patches or invented pipes on the far-side cab.

This is a model review milestone, not an in-game atlas replacement. Runtime
wheel animation and in-game scale/gauge need integration on the new model;
the earlier renderer improvements remain in the demo checkout.

Review: http://localhost:5182/scratchpad/models/handover-review/page/#c50-handbuilt

Latest correction: two individually framed front windows AND two rear windows.
Cab, roof and chassis widened transversely by 8%, maintaining parallel edges;
hood widths and running gear unchanged. Earlier version saved in before-two-windows/.

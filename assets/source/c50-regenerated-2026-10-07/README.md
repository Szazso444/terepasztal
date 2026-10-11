# New C-50 reference, 2026-10-07

The owner rejected the widened/deformed C-50 candidate. Regenerate from a new
researched illustration rather than continuing the old mesh width edits.
The owner explicitly requested online research and image generation by the agent.

## References

- `reference-gv303.jpg`: NearEMPTiness, 16 June 2017, Wikimedia Commons,
  [original page](https://commons.wikimedia.org/wiki/File:Gyermekvas%C3%BAt_-_Children%27s_Railway_in_Budapest_04.jpg),
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
  Unmodified downloaded photo. Primary silhouette, cab position and livery reference.
- `reference-gv319.jpg`: Nbcee, 6 December 2009,
  [original page](https://commons.wikimedia.org/wiki/File:C50_GV319.JPG), public domain.
  Unmodified downloaded photo. Supplementary front grille and hood/cab width reference.
- [Lillafured railway type description](https://www.laev.hu/index.php/a-laev-jarmuvei-x/a-laev-vontatott-jarmuvei/szemely/33):
  confirms the Hungarian C-50 prototype and multiple gauge/bearing variants.

## Generated assets

Built-in imagegen used, with both photographs supplied as geometry references.
`prompt.txt` is the full original prompt; `prompt-edit.txt` is the targeted edit.
`c50-reference-v1.png` is the first result, superseded due to tight framing and
front/rear exhaust/louvre placement. `c50-reference-v2.png` is the selected source.
It is a new clean painted interpretation: text, weathering, surroundings removed;
three-quarter view, blue opaque glass, black body and bright red underframe.
Keep source attribution with derived artwork (CC BY-SA 4.0).

Visual observations: near-central tall cab, two low hoods of comparable length,
same nominal width, modest straight chassis ledges, two visible wheels/axles.
This is a stylized reference, not a dimensional engineering drawing. Hidden-side
details still need inspection after reconstruction; do not assert symmetry merely
from the generated input image.

## Reconstruction

`reconstruct.py` calls the established ComfyUI image-to-3D workflow without changing
global pipeline settings. Input is v2; output is local `models_raw/c50.glb` with
conditioning source/mask and prompt graph. Separate versioned directory protects
all previous models. No old +40% width correction is to be applied to this result.
ComfyUI prompt: d8e115e9-7e82-49a8-ac83-1de42b2092bb.

ComfyUI completed successfully in 332 seconds. GLB is 18,970,204 bytes;
SHA256 f97fe211d8d08ef6882a2f1db085bbed39be5b719f2d4c2bf3183480f0158586.
Conditioning source, mask and exact API prompt graph are saved alongside it.


## Review result

Four aligned views inspected (0,45,135,225 degrees). Source GLB and mesh/UV
hashes were verified unchanged by render_originals.py. Main silhouette follows
new source with central cab, comparable hoods and modest chassis. This is a FIRST
RECONSTRUCTION, not game-ready: hidden cab door has two invented tube-like
protrusions; far-side fittings and rear grille details are inferred; wheels and
small surface details are still irregular. These are visibly marked in the review.
No old width correction was applied. No game atlas was replaced in this step.
Current review: http://localhost:5182/scratchpad/models/handover-review/page/#c50-new

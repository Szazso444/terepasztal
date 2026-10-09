# Second images of the locomotives: brief for the image agent

The train models are 3D reconstructions of the studio images in this folder (`loco-<name>.png`). A studio image
shows the front and one side; the other side is rebuilt by mirroring, but the **rear end** is guessed and comes out
wrong (a plain brown wall on the F7). A second image of each locomotive, turned round, fixes that: the asset pipeline
finds its camera by fitting the model's outline to it and paints what only it shows.

## Inputs

`rear-view-prompts.json`, one entry per locomotive:

| Field | Meaning |
|---|---|
| `id` | the locomotive (`src/data/locomotives.json`) |
| `group`, `priority` | work groups; `pilot` (priority 1) first |
| `attach` | the studio image: attach it as the reference |
| `prompt` | the prompt: use it verbatim |
| `save_as` | where the result goes (the pipeline picks it up by this name) |
| `trucks` | optional truck-only images (diesel and electric): `save_as`, `prompt` each |

The prompts are the ones that made the studio images (`generation-prompts.json`) with only the view changed, plus
each locomotive's own rules (what its rear end looks like, wheel arrangement). Regenerate them with
`python tools/asset-pipeline/rear_view_prompts.py`; do not hand-edit the JSON.

## For each image

1. Generate it with the built-in image generation: the `attach` image as reference, the `prompt` verbatim.
2. Save the attempt outside the asset folder first (for example `tmp/rear/<id>-1.png`, not committed), check it with
   `python tools/asset-pipeline/check_rear_views.py <id> <file>` (add `--truck` for a truck image), and look at it
   beside the reference against the visual checklist below.
3. Up to three attempts. A retry may add one short sentence to the prompt naming what went wrong (for example
   "The rear end, not the nose, faces lower-right."); record the exact prompt used.
4. Only an image that passes (PASS or WARN) and the visual checklist goes to `save_as`. The last failed attempt goes
   next to it as `<save_as without .png>.rejected.png`, never under `save_as`: the pipeline would use it.
5. At the end run `python tools/asset-pipeline/check_rear_views.py` once: it checks every image in place and records
   the verdicts in `rear-view-check.json`.

## Visual checklist (the checker cannot see these)

- It is the locomotive **turned round**: the rear end faces lower-right, the front faces upper-left, and the
  **other side** shows. Not the studio image redrawn, not flipped left to right.
- Same wheel count and arrangement as the reference; the prompt names the real one.
- Same livery, colours and level of detail; roughly the same size in the frame.
- Nothing added or lost: no second nose or windscreen where the real one has a flat rear end (F7, TGV, ICE 1, and
  the long-hood end of the SD40-2 and DDA40X), no second cowcatcher (General, Jupiter, John Bull), the tender kept
  when the reference has one, all parts of an articulated engine kept (Big Boy, Garratt, Crocodile).
- Pantographs stay where they are along the roof (Taurus, Re 460, V63, Kandó V40).
- Transparent background; no shadow, ground, rails, smoke, text or numbers.

## What the checker fails

Wrong size, no transparency, opaque pixels on the border or a cropped vehicle, a long axis running the other way
(a flipped image), an image nearly identical to the studio image or to its mirror. It warns on a tight margin, a
different size in the frame and half-transparent areas (shadows, glow).

## Trucks (after all rear views)

Diesel and electric trucks sit in shadow under the body in the studio images, so the reconstructed trucks come out
lumpy. A truck on its own gives a clean one. Same procedure; the checker skips the turned-round tests for them.
The GG1 has two kinds (`-truck.png` driving, `-truck2.png` guiding). Steam engines need none: their wheels, rods and
bogies are built from measurements.

## Record

Every attempt goes into `rear-view-generation.json`, keyed by the file it was meant for:

```json
{
  "assets/source/base-v1/loco-f7-rear.png": {
    "id": "f7", "kind": "rear", "reference": "assets/source/base-v1/loco-f7.png",
    "method": "built-in image generation",
    "attempts": [{"prompt": "<exact prompt>", "verdict": "FAIL", "reasons": ["nose faces lower-right"]},
                 {"prompt": "<exact prompt>", "verdict": "PASS", "reasons": []}],
    "accepted": true
  }
}
```

## Do not

- Touch any file other than the new images, `rear-view-generation.json` and `rear-view-check.json`.
- Overwrite or edit a studio image, run the asset pipeline or change `public/assets`.
- Edit a prompt beyond the one retry sentence.

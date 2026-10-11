# Locomotive width adjustments

Inputs are preserved unchanged in `originals/`. ImageGen edit candidates are in `edited/`; each is 1536x1024 and retains the magenta background.

| Locomotive | Requested physical edit | Candidate |
| --- | --- | --- |
| C50 | Body +30% side-to-side across the rails; leave wheels and running gear unchanged. | `edited/loco-c50-body-width-plus-30.png` |
| MÁV 490 | Wheelset gauge and transverse axle span -30%; keep body, wheel diameters and fore-aft wheel spacing. | `edited/loco-mav490-wheelset-width-minus-30.png` |
| MK45 | Wheelset gauge, axle span and wheel tread width -30%; keep body, wheel-face diameter and fore-aft spacing. | `edited/loco-mk45-wheelset-width-minus-30.png` |
| Rezet | Same wheelset-only -30% transverse edit; retain four red wheel-face diameters, rod length and body. | `edited/loco-rezet-wheelset-width-minus-30.png` |

“Width” was interpreted as the real vehicle's transverse dimension, perpendicular to travel, not the sprite's screen-horizontal dimension. For the steam engines, “shaft” means the transverse axle span; longitudinal connecting rods remain unchanged. These are generative image-edit candidates, so the requested percentages are prompt targets rather than CAD-verified measurements. Review at full size before runtime integration.

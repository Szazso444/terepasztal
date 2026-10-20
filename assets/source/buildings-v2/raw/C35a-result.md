# C35a: narrow depot stage 1 stopped

No r0 attempt passed every test. Three calls were made with the built-in image tool, each editing the original guide with the printed prompt and all listed references plus depot a0 r0. All returned 1254 x 1254 RGBA; each raw file preserves the returned bytes. No picture was resized, moved, bent, sheared or cropped. No view was accepted. Attempt 2 is the closest overall in raw; `kept` is false for all three. Width is a measurement, never a refusal. Held width below is 706.56 guide px (865.26 at returned size); k maps to guide coordinates. Eaves were read by eye; base corners and camera were measured by building-fit/check. Footprint was tested in memory using uniform k with s aligned at (640,976.64), against plinth edges, without saving a transformed picture.

| Attempt | Base span | k | Left/right feet | Ratio | Eaves y | Wall height/base | Camera error | Overshoot guide px | White / amber |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 940 | .751660 | 567.8466 / 372.1534 | 1.525840 | 874 | .303370 | 4.1 deg | 36.0604 | 4053 / 0 |
| 2 | 916 | .771354 | 585.4307 / 330.5693 | 1.770978 | 852 | .321062 | 4.5 deg | 26.0556 | 1883 / 0 |
| 3 | 947 | .746103 | 623.8489 / 323.1511 | 1.930518 | 822 | .313180 | 6.4 deg | 27.9095 | 2221 / 0 |

Limits: ratio 1.82–2.46, height .32725–.44275, camera at most 2 degrees, footprint overshoot at most 16 guide px. Highlight reference, fitted depot-a0-r0: white 563, amber 2. Highlights are reported only and never caused refusal.

The shed has the family timber, brick, stone footing, slate roof and ridge vent, one portal on the lower-right end, and crew door/two windows on its lower-left long wall. Doorway hall interiors show in shadow and ground remains open. All three failed camera, height and footprint; attempts 1 and 2 also failed plan. The third passed plan only. No attempt is eligible to be retained for camera alone.

`set depot_narrow-a0-r0 rejected --attempts 3` recorded rejection. The rejected working picture is untracked/ignored and not committed; all three original returns are committed in raw. r1/r3/r2 remain pending and require stage 2 scaffolds after author accepts a future r0. C21a, C23a and C4e were not started because the group stopped.

Review sheet: assets/source/buildings-v2/review/depot_narrow.png (empty because r0 rejected).
`building-check --family depot_narrow`: 0 checked, 0 failed, 24 not made yet; this is not evidence of an accepted image. Each individual attempt check failed its camera. `building-sheets --family depot_narrow`: generated and visually inspected. No code changed; no application tests run.

Stop condition: "At most three attempts (3 calls in all). If none passes, keep the closest in raw/, run set <id> rejected --note <the test it failed and its number> ... never accept it quietly."

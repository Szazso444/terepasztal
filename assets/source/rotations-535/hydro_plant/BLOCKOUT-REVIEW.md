# Hydro blockout run: stopped at reference limit

Core review2 replaces the old free-stage fallback. Preflight passed: all12 inputs, metadata1024square/job/view, all3 required hashes, develop ancestor and clean lane. Old attempts1–6 and old measuring script retained. Four new images returned1254square; two accepted, two refused; r3 request rejected before generation, r2 unrun.

| View/attempt | IoU at s0 | f / dx / dy        | Best IoU | p95 picture / scaffold | Max      | Wall height / bare | Overall height / bare | Base width / k | White / amber | Transparent share | Result              |
| ------------ | --------- | ------------------ | -------- | ---------------------- | -------- | ------------------ | --------------------- | -------------- | ------------- | ----------------- | ------------------- |
| r0 #7        | 0.55739   | 0.85000 / 0 / 48   | 0.77429  | 54.99177 / 53.43192    | 61.86660 | 0.73525 / 0.78617  | 1.18480 / 1.21133     | 661 / 0.72346  | 2010 / 0      | 0.00000           | refused silhouette  |
| r0 #8        | 0.97451   | 0.99200 / -1 / -1  | 0.98200  | 9.18756 / 7.02532      | 23.08804 | 0.78367 / 0.78617  | 1.21303 / 1.21133     | 490 / 0.97594  | 993 / 0       | 0.00507           | accepted            |
| r1 #1        | 0.83112   | 0.94000 / -12 / 33 | 0.96529  | 10.04659 / 9.66563     | 13.90566 | 0.71780 / 0.79129  | 1.39305 / 1.40048     | 528 / 0.90570  | 941 / 0       | 0.01406           | refused wall height |
| r1 #2        | 0.86299   | 0.94000 / -4 / 24  | 0.97342  | 6.73744 / 6.78851      | 9.95350  | 0.75385 / 0.79129  | 1.38980 / 1.40048     | 520 / 0.91963  | 643 / 0       | 0.01132           | accepted            |

Limits: IoU .92, each p95 16, max32 canvaspx; wall and overall proportions within8% of bare. Width/highlights/transparency/light means reported only. r1#1 automatic corner landed on intake footing; by-eye house base excludes intake and projects obscured near corner from exposed foot lines. Both readings retained. Accepted copies are byte-identical to raw r0#8 and r1#2.

By eye, the tall brick turbine house, lantern, single arched window, diagonal penstock and intake distinguish it from the Water pump; no chimney, flywheel or strainer. The tailrace in accepted r0 has an opaque dark floor and sill, no transparent notch, and the rear r1 surfaces are opaque. Alpha-composited zooms show the correct lighter left wall and no painted glow, ground or extras; every surface is crisply repainted. r1 carries the same bricks, cream stone, slate and green iron as r0.

Stop: the exact required r3 request attached six files (lit render, style board, old hydro, power plant, accepted r0, accepted r1), but the built-in tool rejected it with “`referenced_image_paths` must contain at most 5 paths”. Exact prompt and all six absolute paths are in prompts.json. No r3 bytes exist; no retry, omission, combination or fallback was attempted. Core must supply a reference plan within tool maximum5 before r3/r2 resume.

Validation: new script syntax and scoped formatting, raw-output/accepted-copy integrity, JSON checks and staged diff checks. Old broad baseline failures are unchanged and were not repeatedly rerun for image records. No change outside hydro folder; no accepted-image processing; .look/scratch and blockout inputs uncommitted.

# DRG01 picture recipe status

## Sources and authority

- `references/01.png` is losslessly converted from workbook v9, `Locomotives` row 25, `drawing1-r25-c5.jpeg` (original SHA-256 `4bcf4fce358abd4334548ee612f89ea5ffe13b02eb053072b332cd2b7e0b19d4`). Workbook: `G:/DEV/Terepasztal/locomotive-wheels-bogies-v9.xlsx` (SHA-256 `e0da5a3fbd8680b6e50fc153d2b86cbae29ec787c9c0852ae9488f9541c4862e`). Row 25 identifies a 4-6-2 Pacific and four tender axles; appearance and part layout are read from the picture.
- `references/02.png` is the supplementary rear illustration `assets/source/base-v1/loco-drg01-rear.png` (original SHA-256 `fca9d76420f9e45e2236b9f2a472c6d2f31d01ef558e201`); use it only for hidden colour/surface cues.
- Workbook owner note (2026-10-08): driver and truck wheel diameters about 25% smaller than the earlier reconstruction; leading truck moved rearwards below the cylinder assembly. The blue-circle clipboard annotation confirms the leading truck location. Main engine body axes stay parallel to straight rails.
- `observations.json` records visible details, evidence regions, inferred hidden construction and omissions. The geometry recipe never imports a game/reconstruction mesh or reads game fit/gear tables.

## Construction

- Fresh C50-style editable primitives, using only the frozen primitive function definitions extracted from this project's `c50_primitives.py`; the C50 example geometry is never executed or loaded. Profile is the locked `c50-lighter-v2` style.
- Parts: `engine` (three rotating coupled drivers and animated side rods), `engine-t0` (two-axle leading truck), `engine-t1` (single-axle trailing truck), `tender`, `tender-t0`, and `tender-t1` (two two-axle trucks). Driver and truck wheels have authored animation/pivots. The cab side panes and spectacle glazing have explicit materials; lamp centres in `candidate.json` are measured from the actual authored lens surfaces.
- `length_tiles` for every part is calculated from its evaluated mesh X bounds divided by the shared tile length. The saved Blender parts open as normal self-contained scenes and renderer scale is 1.
- The source PNG hashes, code, helper, style, and observations are frozen by `recipe-lock.json`; the initial authored recipe and construction build succeeded.

## Pending review

- Awaiting the shared Blender render slot. Sample render, side/top/front/rear/isometric assembled gallery, visual corrections, production replay, and construction replay are pending.
- Once the sample and gallery pass picture comparison, update this file with paths and final evidence before reporting completion.

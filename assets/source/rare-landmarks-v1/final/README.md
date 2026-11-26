# Rare landmark artwork

Twelve separate RGBA PNGs generated with the built-in image_gen tool. Selected replacements were regenerated from exact game-coordinate guides; original images and discarded candidates remain in the parent directory. The seasonal house original was retained. No generated pixels were warped or resized.

Open [review.html](review.html) to inspect transparency, direction guides and approximate shared world scale.

## Projection and scale

The game uses 64×32 logical tiles: ground-axis steps are (32,16) and (-32,16). Ground slopes are ±0.5, screen angles ±26.565051°. The equivalent orthographic camera is azimuth45°, elevation30°. The 26.565° number is NOT camera elevation; some earlier prompts mixed these up. Exact historical prompts are retained for provenance; use this geometry contract as authority.

Physical dimensions below are proposed art targets using 4m per tile, 2m doors and 3m floors. They are not an existing game unit contract. PNG resolution is source detail, not tile footprint. Placement must use footprint and ground anchor calibration, not stretch every image into the same display box. The round observatory has a smaller visible horizontal envelope than the bounding square footprint.

These are selected illustrated source candidates, not mathematically exact 3D renders or integrated runtime sprites. Architectural line directions were reviewed using guides and a read-only line diagnostic. Curves, stairs and sloping roofs can confuse the diagnostic. Exact pixel-level grid alignment and in-game anchors remain to be calibrated; do not treat these as projection-certified exports.

## Assets

| Landmark | PNG | Footprint | Proposed W×D×H | Chance per 9 chunks |
|---|---|---|---|---|
| Merchant's Last Stop | [01-merchants-last-stop.png](01-merchants-last-stop.png) | 3×2 | 12×8×8m | 6% |
| Overgrown Bathhouse | [02-overgrown-bathhouse.png](02-overgrown-bathhouse.png) | 4×3 | 16×12×7m | 5% |
| Bellkeeper's Refuge | [03-bellkeepers-refuge.png](03-bellkeepers-refuge.png) | 1×1 | 4×4×14m | 4% |
| Flooded Archive | [04-flooded-archive.png](04-flooded-archive.png) | 4×4 | 16×16×10m | 3% |
| Rootbound Workshop | [05-rootbound-workshop.png](05-rootbound-workshop.png) | 2×2 | 8×8×8m | 3% |
| Cliffside Cable Station | [06-cliffside-cable-station.png](06-cliffside-cable-station.png) | 3×2 | 12×8×7m | 2.5% |
| Stormglass Observatory | [07-stormglass-observatory.png](07-stormglass-observatory.png) | 2×2 | 8×8×11m | 2% |
| Ashen Conservatory | [08-ashen-conservatory.png](08-ashen-conservatory.png) | 4×2 | 16×8×6m | 1.5% |
| Inverted Manor | [09-inverted-manor.png](09-inverted-manor.png) | 3×3 | 12×12×9m | 1% |
| Sleeping Foundry | [10-sleeping-foundry.png](10-sleeping-foundry.png) | 5×4 | 20×16×14m | 0.75% |
| Moonwell Pavilion | [11-moonwell-pavilion.png](11-moonwell-pavilion.png) | 2×2 | 8×8×7m | 0.5% |
| House Between Seasons | [12-house-between-seasons.png](12-house-between-seasons.png) | 4×4 | 16×16×10m | 0.25% |

Probabilities are before suitable-terrain and spacing checks. The cable station footprint excludes the ravine crossing.

[manifest.json](manifest.json) contains selected source provenance and the exact generation prompt for each asset. Earlier retry prompts remain verbatim, including incorrect camera wording; none certify the final projection. [alpha-report.json](alpha-report.json) verifies source resolution, alpha-zero pixels, unclipped solid silhouettes and content hashes. All files preserve their generated alpha channels.

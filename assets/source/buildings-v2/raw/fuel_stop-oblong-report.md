# Coaling stage oblong repaint attempts, issue #325

Nine built-in imagegen edit calls: r1 10–12, then r3 10–12, then r2 10–12. Every returned PNG is preserved byte for byte in raw/ and verified against its source by SHA-256. All returned sizes are 1254 × 1254.

Outcome: r1, r3 and r2 rejected. No new attempt kept as generated. Closest raw attempts: r1 11, r3 12, r2 11. r0 is unchanged; its SHA-256 remains 49f701ce3e2bd4a3c4b0a2a6194fd1470a56390dda9f241dd7a82c9a2e6c6ce4.

Oblong guides were extracted outside the repository from origin/claude/art-guides-windmill-coaling at 830d576b. All three are 1024 × 1024. They are not committed. Each edit attaches the oblong guide, style board, and fitted r0, in that order. No rejected painting was attached to another edit.

| View / attempt | Pier span (px of 1254) | LL / LR foot span | Ratio | box.top | Height | Camera off | White / amber | Kept |
| -------------- | ---------------------: | ----------------: | ----: | ------: | -----: | ---------: | ------------: | ---- |
| r1 / 10        |                    703 |               N/M |   N/M |     N/M |    N/M |        N/M |           N/M | No   |
| r1 / 11        |                    700 |               N/M |   N/M |     N/M |    N/M |        N/M |           N/M | No   |
| r1 / 12        |                    729 |               N/M |   N/M |     N/M |    N/M |        N/M |           N/M | No   |
| r3 / 10 †      |                    667 |     377.3 / 234.7 | 1.608 |   346.9 |  1.327 |       7.0° |      1169 / 2 | No   |
| r3 / 11        |                    741 |               N/M |   N/M |     N/M |    N/M |        N/M |           N/M | No   |
| r3 / 12        |                    638 |     376.0 / 261.0 | 1.441 |   368.3 |  1.279 |       7.2° |       688 / 1 | No   |
| r2 / 10        |                    707 |               N/M |   N/M |     N/M |    N/M |        N/M |           N/M | No   |
| r2 / 11        |                    661 |     239.7 / 420.3 | 0.570 |   428.9 |  1.145 |       6.7° |      890 / 19 | No   |
| r2 / 12        |                    696 |               N/M |   N/M |     N/M |    N/M |        N/M |           N/M | No   |

N/M: width refused, so no further measurements. Width limit is 600–663 px of 1254. Pier spans are outer stone-foot boundaries, excluding chute and chain; final close readings use opaque alpha >128. Initial visual estimates in correction prompts differ slightly from the final opaque-edge readings recorded here. Highlight counts use surface alpha >200, RGB channels ≥(236,228,208) for white, and Euclidean RGB distance ≤12 from (232,170,72) for amber. Fitted r0 baseline: 553 white, 0 amber.

† r3 attempt 10 was initially misread as 648 px wide. A tighter crop found the stone foot behind the chain, correcting it to 667 px (left boundary293, right boundary960). Its fit, camera and highlights were computed before this correction. They are retained as diagnostics only; it was refused for width and never accepted.

r3 attempt 12 passes width and plan, but height1.279 is below1.318, camera7.2° exceeds2°, and highlights688/1 exceed553/0. r2 attempt11 passes width but fails height1.145, plan0.570, camera6.7° and highlights890/19. All other new attempts fail width.

Family check: r0 ok; 1 checked, 0 failed, 3 not made. This does not certify the rejected views. Review sheet review/fuel_stop.png was regenerated and inspected: it shows r0 and three empty footprints. The requested four-view family could not be completed within three calls per view.

Full prompts are in raw/fuel_stop-a0-r*-prompt-10.txt through -12.txt. Exact sources, hashes, references, tests and measurements are in raw/returns.json.

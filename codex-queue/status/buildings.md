# buildings

## C35a (2026-10-20 22:05:08 UTC)
- Result: stopped
- Lane commit: a0a0fb0b014d6a079033e255ffeb9927214bf590 pushed to origin/art/325-buildings-v2
- Views accepted: none
- Refused attempts: r0 attempt 1: plan ratio 1.525840 outside 1.82-2.46, height/base .303370 below .32725, camera 4.1 degrees above 2, footprint overshoot 36.0604 guide px above 16; r0 attempt 2: ratio 1.770978 below 1.82, height .321062 below .32725, camera 4.5 degrees above 2, overshoot 26.0556 above 16; r0 attempt 3: ratio 1.930518 passes, height .313180 below .32725, camera 6.4 degrees above 2, overshoot 27.9095 above 16.
- Stop reason: "At most three attempts (3 calls in all). If none passes, keep the closest in raw/, run set <id> rejected --note <the test it failed and its number> ... never accept it quietly."
- Notes: Three built-in image edits, all returned 1254 x 1254, preserved byte for byte in assets/source/buildings-v2/raw/depot_narrow-a0-r0-attempt-{1,2,3}.png. Widths 940/916/947 px; k to held width 706.56 guide px = .751660/.771354/.746103. Closest overall raw attempt 2, no accepted view; all kept=false. White/amber counts 4053/0,1883/0,2221/0; fitted depot reference 563/2, reported only. Full measurements in raw/returns.json and raw/C35a-result.md. r0 rejected with attempts=3; r1/r3/r2 pending and await future stage-2 scaffolds after acceptance of a future r0. Review sheet assets/source/buildings-v2/review/depot_narrow.png is empty because rejected. Family check 0 checked,24 not made, individual checks failed cameras. Main checkout and existing worktrees untouched; tool-generated C: originals copied to G: and left alone per README. C21a,C23a,C4e not run because this group stopped. No code changed, no application tests run.

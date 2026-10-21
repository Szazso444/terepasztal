# C35a third queue launch: Blender blockout repaint

Prompt executed to its normal close, with four views REJECTED and zero accepted. This is not an art acceptance. Exactly twelve NEW built-in image edits ran in order r0 (attempts4–6), r1 (1–3), r3 (1–3), r2 (1–3); old r0 attempts1–3 were preserved and never attached. Every call asked1024x1024 transparent RGBA and returned1254x1254. Every original return is stored byte for byte in raw/; exact prompts, full fit scalars, base measurements, heights and highlights are in raw/returns.json. No result was resized, moved, cropped, bent, sheared or otherwise altered.

All twelve required scaffold inputs were present on origin/claude/art-scaffolds-review-2, every PNG was1024x1024, every JSON had job=depot_narrow, its expected view and canvas[1024,1024]. Exported inputs and measurement code stay outside the repository on G:. Required main-line-depot family reference exists. `set r0 pending` succeeded; no redo or next was run. C21a, C23a, C4e remained HOLD and were not run.

Silhouettes: JSON polygon filled; image alpha>128 with enclosed holes filled;2canvas-pixel disk opening; best uniform f in[.85,1.15] plus translation searched coarse-to-fine. Both directed boundary distance distributions use rank ceil(.95n), converted back to canvas pixels. Limits: IoU>=.90, both p95<=24canvas px, max<=48. Every best IoU passes; every image-to-scaffold p95 and maximum fails, concentrated at the transparent doorway-ground notch. No separate camera/foot-ratio/footprint refusal was used; foot slopes are reported only. Because all r0 best IoUs exceeded.80, the special stop-after-r0 condition did not fire; after rejection, the prompt explicitly required continuing to the next view. No `set generated` call was made for a failed silhouette.

| View | Attempt | Base span px | Held returned px | k | IoU at s0 | f | dx | dy | Best IoU | p95 picture | p95 scaffold | Max | Wall/base | White/amber | Closest raw |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r0 | 4 | 905 | 865.3090 | 0.956143 | 0.88075 | 1.004853 | -3.503 | -26.712 | 0.93679 | 72.325 | 13.229 | 130.472 | 0.34243 | 1373/0 | no |
| r0 | 5 | 889 | 865.3090 | 0.973351 | 0.89835 | 1.016018 | -10.444 | -31.313 | 0.94563 | 61.467 | 16.549 | 118.612 | 0.36130 | 1152/0 | no |
| r0 | 6 | 953 | 865.3090 | 0.907984 | 0.80699 | 1.070468 | -36.994 | -92.821 | 0.94511 | 62.090 | 14.494 | 118.039 | 0.35005 | 1415/0 | yes (still refused) |
| r1 | 1 | 878 | 865.3090 | 0.985546 | 0.92768 | 0.985179 | 16.966 | 7.200 | 0.94252 | 54.492 | 12.974 | 110.464 | 0.36754 | 1290/0 | yes (still refused) |
| r1 | 2 | 908 | 865.3090 | 0.952983 | 0.92413 | 1.007306 | 2.814 | -15.702 | 0.94309 | 55.470 | 16.213 | 112.124 | 0.35022 | 686/0 | no |
| r1 | 3 | 921 | 865.3090 | 0.939532 | 0.86056 | 1.021195 | 6.643 | -47.510 | 0.94276 | 56.146 | 14.393 | 110.859 | 0.34332 | 957/0 | no |
| r3 | 1 | 881 | 865.3090 | 0.982190 | 0.91755 | 0.979218 | 14.995 | 8.597 | 0.93237 | 91.389 | 12.729 | 145.446 | 0.33167 | 1205/0 | no |
| r3 | 2 | 902 | 865.3090 | 0.959323 | 0.88724 | 0.984641 | 26.437 | -10.170 | 0.93632 | 68.614 | 18.245 | 123.380 | 0.32018 | 457/0 | no |
| r3 | 3 | 887 | 865.3090 | 0.975546 | 0.91783 | 0.984857 | 13.171 | -1.923 | 0.93813 | 71.566 | 14.313 | 126.446 | 0.34160 | 717/0 | yes (still refused) |
| r2 | 1 | 885 | 865.3090 | 0.977750 | 0.95021 | 0.998910 | 3.459 | -3.576 | 0.95587 | 54.838 | 15.029 | 109.313 | 0.34768 | 2195/0 | no |
| r2 | 2 | 886 | 865.3090 | 0.976647 | 0.94162 | 1.000909 | 3.978 | -4.200 | 0.94773 | 59.473 | 17.152 | 114.930 | 0.35892 | 695/0 | yes (still refused) |
| r2 | 3 | 864 | 865.3090 | 1.001515 | 0.93795 | 1.007716 | 0.573 | -4.303 | 0.94249 | 64.872 | 13.584 | 120.217 | 0.36563 | 1730/0 | no |

Held base width706.6 guide px; s0=1.224609375; held returned width865.3090px. Width is a measurement only. Bare-scaffold wall height272px/base706.56px=.3849638, tolerance15percent (.3272192–.4427083). Heights are by-eye near-eaves readings paired with measured near foot; r3 attempt2=.320177 falls below the lower bound. Other reported heights are in range.

Additional refusals by eye: r0 attempts4/5 had brighter lower-right brick than lower-left green timber. r3 attempt1 painted the brick end as green timber; r2 attempt1 painted it as brown timber. r2 attempt2 light ordering was not clearly darker on the right. Later attempts corrected the end-wall material. Pictures otherwise show crisp replanked timber, brick/stone/slate, one visible arched portal with shadowed inner hall wall and transparent ground, ridge vent, chimney, roof vents, correct back/front windows and crew-door wall, without painted ground/plinth, rails, people or smoke. Passing overall overlap and plausible family identity never overrode failed outline distances.

Original depot-a0-r0 highlight reference:2123white/0amber. The new r0 entries4–6 initially record563white/2amber from the FITTED depot reference instead; these are fitted-reference counts, not the original reference. Both values are reported here to correct that label, and neither was a refusal criterion. All picture highlight counts above are their original RGBA pixels; highlights are reported only.

Each view was set rejected with its failures and attempt count (r0 cumulative6; other views3). All twelve new raw records have kept=false. Closest refused raw files retained: r0 attempt6, r1 attempt1, r3 attempt3, r2 attempt2; no picture was accepted. Working .rejected.png files remain ignored/uncommitted as GUIDE requires. Earlier failed views were not attached to later calls: the tool continued to list stale .fitted/r0 despite r0 rejection, and that reference was omitted under the explicit never-attach-failed/only-those-passed instruction. The back windows shown by r1/r2 blockouts were painted as shown under scaffold geometry wins; no crew door was added to the back. Main-line depot was used only for family materials/details.

Close checks: building-check --family depot_narrow reported0checked,0failed,24notmade; this reflects rejection and is not a pass. building-sheets --family depot_narrow generated review/depot_narrow.png, visually inspected and empty because all four views are rejected. No code changed, so no application tests were run; git diff --check validates scoped text.

Core/author next: inspect the repeated transparent doorway-ground contour mismatch against the blockout polygon and decide whether to requeue with revised inputs or acceptance criteria. No retry was started after the twelve-call limit.

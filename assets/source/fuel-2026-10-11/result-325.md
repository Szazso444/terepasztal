# Fuel Pump issue325 result

Branch art/325-fuel-pump. Built-in imagegen edits requested1024x1024; all returned1254x1254. Every native PNG retained byte for byte. Exact prompts, ordered references, automated corners and eye-read corners, heights, light boxes and observations are in prompts.json and metadata files.

R2 not accepted. Closest attempt4 retained raw only, camera and jib fail. R3 step1 failed; closest attempt14 retained raw only, footprint, plan and crane fail. R3 step2 was not run and therefore did not widen the house. Canonical r0,r1,r2,r3 remain unchanged; r1 remains byte-identical to raw attempt12.

|View/step|Attempt|Plan|Height|Camera|Brick luma L/R|Eye-read corners|
|---|---:|---:|---:|---|---|---|
|r2|4|2.573|0.443|Fail; left slope 0.636|119.35/68.84|{"w":[256,875],"s":[750,1164],"e":[942,1067]}|
|r2|5|2.813|0.426|Fail; left slope 0.595|121.40/73.54|{"w":[264,868],"s":[745,1151],"e":[916,1060]}|
|r2|6|2.600|0.375|Fail; left slope 0.582|119.27/69.78|{"w":[296,894],"s":[751,1150],"e":[926,1064]}|
|r3 step1|12|2.876|0.388|2.5 degrees|120.97/120.61|{"w":[386,1048],"s":[564,1147],"e":[1076,892]}|
|r3 step1|13|3.047|0.401|5.8 degrees|120.56/123.99|{"w":[373,1062],"s":[542,1163],"e":[1057,898]}|
|r3 step1|14|2.880|0.395|1.5 degrees|125.20/120.64|{"w":[386,1053],"s":[561,1149],"e":[1065,893]}|

R3 fixed corners were w(381,1009), s(562,1107), e(1057,846), width676. Each new step1 attempt misses the10px corner tolerance. Attempt14 width679, height.395, camera1.5, hose(713,873); post remains at x480 and jib reach230 exceeds210. No accepted S1.

R3 reference light measured118.7276/117.8576 with unchanged boxes(400,880,530,1000) and(850,760,1000,860); each attempt remains within8. No boxes moved.

Grass sheets for all6 attempts are in review/. Do not treat the closest sheets as accepted assets.

Verification: image measurements and canonical hashes checked; Art scope passed. Repository typecheck, lint, tests, build and format commands were attempted but cannot run because this worktree lacks tsc/eslint/vitest/prettier executables. No runtime code changed.

# Windmill C17c

Stopped after three permitted attempts. No accepted view. Closest attempt 3 is copied byte for byte to `windmill-a0-r0.png` as required, explicitly `kept: false`; its hub record is `hub.json`. C17d is unrun.

| Attempt              | Returned    | Foot ratio / degrees off | Apex / W | Stub slope | Hub offset / distance (game px) | Door position / height | Timber / white / amber |
| -------------------- | ----------- | ------------------------ | -------- | ---------- | ------------------------------- | ---------------------- | ---------------------- |
| 1                    | 1254 x 1254 | .482 / 1.2               | 1.31859  | .43077     | (-.324,-7.541) / 7.548          | -.24950 / .38767       | 1998 / 6666 / 0        |
| 2                    | 1254 x 1254 | .563 / 4.3               | 1.10897  | .32258     | (-.034,-.940) / .940            | -.32284 / .27739       | 8 / 1965 / 0           |
| 3 (closest, refused) | 1254 x 1254 | .478 / 1.5               | 1.11145  | .47727     | (.151,-.171) / .228             | -.34096 / .27711       | 99 / 2962 / 0          |

Attempt 1 fails tower proportions, hub height, door position and height, and timber. Attempt 2 fails camera and measured stub slope. Attempt 3 passes geometry and `checkFile` but fails the dark-orange timber limit (99 > 25). Near-white counts are recorded; they are waived only if they are the sole miss, which is not the case here. No fourth call was made.

By eye all returns show a round stone tower, slate cone, plain apex, no sails, no plinth, ground or loose objects, with door and shaft on the lower-left face and upper-left light. Attempt 3 stub edge was reread on a 4x inspection crop: points (537,633) and (493,654); the earlier point lay on the curved metal band rather than the shaft edge. This inspection crop is not a returned or accepted painting. Every raw returned PNG is unmodified.

The required merge of origin/develop completed without conflicts before painting. npm dependencies used G: temp and cache. Built-in imagegen saved its outputs autonomously to its default C: location; they were copied to raw/ on G: and originals left untouched, as the queue README instructs. All three prompts and corrections, reference order, coordinate readings, machine measurements and rejected flags are in prompts.json and raw/attempt-*-numbers.json. No atlas or queue tool was run.

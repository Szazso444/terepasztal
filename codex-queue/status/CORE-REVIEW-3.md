# Core review 3 (22 October 2026)

Five textured blockouts were blocked on review (broken turned views): TB2-grinder, TB2-quarry, TB2-colliery, TB2-ironworks, TB2-fuel_stop. They are fixed and `ready` again in `queue.json`. The fixed renders (r0 to r3, textured, bare and json, same paths) are on `claude/art-scaffolds-review-2` at 80cfaba3 (`assets/source/buildings-v2/scaffolds-textured/<building>/`; the README has a "Fix round 2" section).

| Building | What was wrong | Fix | r0 IoU at the painting camera (before) |
|---|---|---|---|
| Grinder | holes in walls and roof at r1 to r3: copies of the front wall (arch interiors, a hopper brace, a streak) on the back walls, hopper and rubble through the roof | roof cut round the hopper, plain-patch test for mirror sources, one non-manifold edge removed | 0.9545 (0.9554) |
| Quarry | winch house open on its two unseen sides | plank walls there, cleaner fill | 0.9291 (0.9286) |
| Colliery | head frame one flat plane (floats at r3), braces and a rung touching nothing, rope ending in the air | 3D head frame with back legs and footings, anchored braces, rope on the wheel rim and the cabin roof | 0.9272 (0.9320) |
| Ironworks | blocky unseen sides, roofs passing through each other | hall block and roofs closed off, valley at the tower, back wall with arched windows | 0.9324 (0.9305) |
| Coaling stage | flat yellow bin ends | planks copied from the painted long face, chains attached | 0.9245 (0.9250) |

Mesh check on all 17 textured blockouts: no open, inward or non-manifold parts after the fixes; one small floating part each (under 0.2 tile) remains in oil derrick, refinery, battery and town hall (left as they are). The prompts keep their text; only the STATUS banner of the five was changed from BLOCKED to READY.

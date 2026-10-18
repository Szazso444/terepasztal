# Bridges for roads and people: options

Read on develop at d1b5b50 through `git archive`; the checked-out tree is older (91b9437) and has no roads. Save version there is 20.

## What exists

**Track bridges.** A bridge is a building, `bridge_wood` or `bridge_stone` (src/data/buildings.json, capacity 180 and 650): a platform on a water tile, or on a dip in the land. Straight rail goes on it (`checkTrackTile`, src/sim/build.ts:448-460: water refuses all but a platform). `bridgeSpan` (src/sim/bridges.ts:24) joins neighbouring platforms of one material. No special save field: platforms are saved buildings. Default "textured" rendering builds decks, piers and arches as meshes from four repeating surfaces (`public/assets/bridge-surface-*.png`, src/render/bridgeMeshes.ts); `bridgeLayout.ts` picks parts per tile and merges decks only when both carry straight rail the same way. Supports end at `WATERLINE` (bridgeMeshes.ts:43, #434). Only the "kit" mode uses atlas frames (18 `bridgekit/*`, public/assets/bridges.json), so the default look needs none.

**Roads.** A road is a tile in a set (`Roads`, src/sim/roads.ts): no direction, no level. The save has `roads: [x,y][]` (v20; save.ts:583-586). `roadRules` (build.ts:1184-1193) refuses water, rock, mountain, any building (so any bridge platform) and anything but a plain track straight (a level crossing). `repairBuiltRoads` (src/engine/loadRepair.ts:137) deletes a saved road on water. The painter paints roads into the ground (roadShape.ts, roadPaint.ts), land only.

**People.** Walkers are not saved (save.ts:126). They walk on any land, roads only double the speed: `findWalk` (src/sim/people.ts:342) searches 8 directions in the ends' box plus `WALK_MARGIN` 4. `walkable` (people.ts:251) refuses water, so people cannot cross a river or a track bridge; `startWalk` just returns false (people.ts:626). So the need is a way over water, not a path network. #477 (unmerged) only draws the walker on the road's centre line (roadWalk.ts); no sim change.

**Art.** Codex kit v1 and v2 (assets/source/bridges-v1, bridges-v2: guides in the game's projection, PROMPTS.md) give decks, rails, pads, piers, posts, arches and trusses in stone and wood, none with a road surface. `base-v1` has `people-road-stone.png`. No footbridge art.

## Options

**A. Road bridge on the existing platforms.** A road may go on a water tile that has a platform and no track; a platform with rail refuses a road and the reverse.
- Gameplay: `roadRules` change, walkers' step. Save: no new field, so no version bump; `repairBuiltRoads` (Engine) must keep a road on a platform. Old saves load as they are.
- World/Gameplay: `findWalk` may step onto water only where a road is, orthogonally only; widen the search past `WALK_MARGIN` or a bridge off the straight line is never used.
- Rendering: road deck (gravel or setts top, parapets, no rail); `roadPaint` and `refreshGround` treat the tile as bridge; `bridgeLayout` never merges a road deck with a rail deck; deck height from the two banks.
- UI/UX: road tool preview and price on bridge tiles, refusal strings (bank levels, rails on platform).
- Art: a road-top surface; nothing in the atlas.
- Size: about 600 to 900 lines, three or four tasks.

**B. A plus footbridges.** A walkers-only narrow bridge where there is no road.
- All of A, plus a per-tile kind (v21 migration defaulting to "road", `KNOWN_SAVE_KEYS`), a second rule in `findWalk` (passable, no speed bonus), a narrow mesh, new art.
- Walkers already go anywhere on land, so this is only a shortcut over water. About 1500 lines and a save bump.

**C. Walkers cross track bridges.** `walkable` allows a tile with a platform. About 100 lines, no save or art, but people walk the rails and no road reaches the far bank. A stopgap.

## Risks

- Road over a rail bridge: one tile holds rail or road, never both. Grade separation is out of scope: roads have no levels.
- Bank levels: reuse `supportedDeck` (world/railProfile) or a gentler rule for roads, else `STR.build.deckLevels` refuses many river crossings.
- Map generation hashes and atlas frame counts do not move in A.
- The textured look is the default; check the kit and procedural modes still draw a plausible deck, or say road bridges need textured.

## Showing it first

As with the road look (option B approved on the art demo, 2026-10-12), make a Codex demo page on a fixed river: a wooden and a stone road bridge of 1, 3 and 5 tiles, walkers crossing, one rail bridge beside them, painted over the bridges-v2 guides with a new road-top prompt. For B add a footbridge row. The author picks look and width before any game code.

## Recommendation

A: demo, then Gameplay (rules, walk step), Rendering (road deck), UI (preview, strings). It serves roads and people together with no save bump. Hold B until the author wants walkers-only crossings; skip C.

## Only the author can answer

1. Materials: wood and stone as for rail, or a rope-and-plank third?
2. Maximum span: unlimited, or capped (say 6 tiles)?
3. Cost: platform price per tile, road price on top, and do road bridges have capacity and levels?
4. Footbridges away from roads (B): wanted?
5. Rail and road on one deck: ever?

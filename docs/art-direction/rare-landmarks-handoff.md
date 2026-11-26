# Rare landmarks: artwork and implementation handoff

Prepared on 2026-10-18 for Art task #528, under implementation epic #529. Asset branch:
`art/528-rare-landmarks-handoff`, based on `origin/develop`.
This is a source-art handoff and a record of proposed gameplay, not implemented game behavior.

## Start here

- `assets/source/rare-landmarks-v1/final/review.html`: the twelve selected images; checker,
  grass and dark backgrounds, direction grid, approximate common-scale comparison.
- `assets/source/rare-landmarks-v1/final/manifest.json`: stable source IDs, selected filenames,
  provenance, exact prompts, proposed footprint/rarity/dimensions.
- `assets/source/rare-landmarks-v1/final/alpha-report.json`: source sizes, alpha-zero pixel
  counts, unclipped solid bounds and SHA-256 hashes.
- `assets/source/rare-landmarks-v1/final/README.md`: projection contract and limitations.
- `assets/source/rare-landmarks-concepts-v1/`: initial approved twelve-panel concept sheet.
- `assets/source/rare-landmarks-v1/geometry/`: exact coordinate-derived blockouts and metadata.

The parent asset folder retains original drafts and rejected/replaced candidates.
**Select only the twelve files listed by final/manifest.json**, never glob every PNG.
`rare-landmarks-alpha-pngs.zip` is a convenience copy, not a second source of truth.

## Proposed landmarks

Probabilities are initial design proposals: one roll per nine newly generated chunks, before
terrain and spacing checks. They are not per-tile rates, per-nine-owned-chunk unlocks, or
guaranteed counts. Their final sampling policy is a design decision; see below.

| Landmark / source ID                                   | Tiles     | Chance per 9 chunks | Discovery and player choices                                                                                            | Lasting outcomes proposed                                                                                                         |
| ------------------------------------------------------ | --------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Merchant's Last Stop / `01-merchants-last-stop`        | 3×2       | 6%                  | Abandoned wagon inn; recover trade records, follow missing caravan, open cargo or restore trading sign.                 | Immediate supplies, rescued recurring merchant, or a restored trading stop and route map.                                         |
| Overgrown Bathhouse / `02-overgrown-bathhouse`         | 4×3       | 5%                  | Roots block spring channels; repair valves and choose which pools to restore with materials.                            | Rest stop and temporary recovery/environmental benefits.                                                                          |
| Bellkeeper's Refuge / `03-bellkeepers-refuge`          | 1×1, tall | 4%                  | Repair bells and learn sequences from notes; ringing can attract creatures.                                             | Reveal caves, clear fog briefly, or lure creatures for a local encounter.                                                         |
| Flooded Archive / `04-flooded-archive`                 | 4×4       | 3%                  | Flood threatens records; repair drainage or recover selected collections from submerged rooms.                          | Maps, optional recipes, historical clues; deeper archive unlocked by drainage.                                                    |
| Rootbound Workshop / `05-rootbound-workshop`           | 2×2       | 3%                  | Roots lift the workshop and jam machinery; prune for quick access or redirect growth.                                   | One-time materials or renewable living ladders/bridges.                                                                           |
| Cliffside Cable Station / `06-cliffside-cable-station` | 3×2       | 2.5%                | Recover stranded cargo, repair winch/crossing, or dismantle machinery.                                                  | Supplies, permanent travel/cargo shortcut, or construction parts. Crossing and opposite landing require additional clear terrain. |
| Stormglass Observatory / `07-stormglass-observatory`   | 2×2, tall | 2%                  | Restore lenses and charge instruments during a storm; choose when to stop taking risk.                                  | Local weather forecasts and charged stormglass; overload damages equipment or releases a hazard.                                  |
| Ashen Conservatory / `08-ashen-conservatory`           | 4×2       | 1.5%                | Restore irrigation, heat and ventilation; choose which surviving species to save.                                       | Seeds for luminous fruit, heat-resistant fibres or smoke pods; selected crop changes the site.                                    |
| Inverted Manor / `09-inverted-manor`                   | 3×3       | 1%                  | Upside-down manor with unstable gravity; secure objects, stabilize rooms and investigate inversion.                     | Limited traversal device, unusual shelter, or preserved gravity access to hidden rooms.                                           |
| Sleeping Foundry / `10-sleeping-foundry`               | 5×4       | 0.75%               | Restart generators carefully or quickly; repair, bypass or fight the waking mechanical guardian; alternatively salvage. | Specialized stationary crafting, a guardian protecting the grounds, or one-time components.                                       |
| Moonwell Pavilion / `11-moonwell-pavilion`             | 2×2       | 0.5%                | At night a reflected doorway appears; change objects in physical and reflected versions.                                | Permanent local passage to a hidden exit, or seal it and recover its power source.                                                |
| House Between Seasons / `12-house-between-seasons`     | 4×4       | 0.25%               | Four connected seasonal wings; transfer heat, water, wind and growth; balance seasons or favor one.                     | Changeable seasonal blessing or permanent local seasonal farming/survival zone.                                                   |

These are optional discoveries. Essential progression must remain available elsewhere.
Favor local, situational utility over universally stronger combat or production rewards.
Restored sites should give players a reason to route transport or establish an outpost nearby.

## Boundaries and unresolved product choices

The author approved the concepts, requested individual alpha PNGs, and requested regeneration
where camera/proportions did not match. This does not make every proposed mechanic an existing
system or a production-ready balance specification.

- Several ideas assume an on-foot avatar, air/stamina, combat, creatures or gravity traversal.
  The existing project is a railway logistics game. Core must specify whether encounters use
  resource deliveries and staged choices in a landmark panel, or require additional systems.
  Do not silently introduce avatar/combat/survival systems.
- Choose the nine-chunk sampling unit (for example a coordinate-stable 3×3 chunk region),
  independent versus mutually exclusive rolls, terrain eligibility, min spacing and the policy
  when the chosen footprint does not fit. Independent displayed probabilities sum to 29.5%;
  a total encounter chance plus weighted landmark selection is a different distribution.
- Use stable seeded placement, independent of exploration order, and never reroll rewards or
  regenerate existing stored chunks on load/expansion. Newly generated chunks alone may change.
- Define the smallest shared event/state contract before splitting implementation by role.
  Define discovery, activation, progress, choices, completed/salvaged state and repeatability.
- Costs, reward magnitudes, cooldowns, weather/night prerequisites and exact state transitions
  need a specification before implementation. The table records ideas, not approved numbers.
- Current sources depict one camera view and one discovered condition. There are no complete
  restored/salvaged state sprites, all four directional views, interiors or animation layers.
  Do not mirror asymmetric assets or invent unseen views from one PNG without art review.

## Art and geometry contract

The game uses 64×32 logical tiles. Ground-axis steps are (32,16) and (-32,16), slopes ±0.5.
Screen edge angles are ±26.565051 degrees. The matching orthographic camera has azimuth45 and
elevation30 degrees: at azimuth45 the edge slope is sin(elevation). Earlier retry prompts
incorrectly called26.565 a camera elevation; they remain verbatim only as generation history.

The guides use the correct coordinate formula. The illustrated outputs have been visually
reviewed and direction-diagnosed, but are **not pixel-exact, projection-certified 3D renders**.
Before runtime use, measure the actual ground-contact points, scale and depth/selection anchors;
test on grass, slopes, beside existing buildings and behind moving trains. A prompt's camera
numbers or the generic line diagnostic are not proof of ground fit.

Four metres per tile, two-metre doors and three-metre floors are proposed art conventions,
not a change to the engine's units. PNG resolution is source detail, not occupied tile size.
Keep footprints distinct from sprite overhang, height and special cable-crossing clearance.
Use the current fitting/atlas contracts in `tools/building-fit.mjs`,
`tools/pack-atlas.mjs`, `src/engine/atlas.ts` and `tools/illustrated-sprites.mjs`.
Do not change existing frame keys or introduce another writer of an existing atlas by accident.

All twelve selected files have RGBA alpha, fully transparent pixels and unclipped main
silhouettes. Narrow margins and low-alpha fringes remain on some sources; use the established
alpha-safe packing workflow and inspect against light/dark terrain. Copies preserve generated
bytes; no affine warp or resizing was applied. The author's latest direction is to regenerate
mismatches, not geometrically distort the artwork.

## Implementation seams for Core

This epic must be split into one-role tasks after a gameplay specification is approved.

1. Gameplay owns content IDs/data, event states, costs/rewards, progression and save migration.
2. World owns seeded new-chunk placement, footprint/terrain/clearance/spacing and persistence
   seams with chunk generation. Read `src/world/chunks.ts`, `src/world/mapgen.ts` and
   `src/world/tiles.ts`; CHUNK_TILES is currently32.
3. Art owns final ground-fit measurements, anchors, required extra views/states, sprite keys and
   atlas exports. Resolve projection gaps before calling these production exports.
4. Rendering owns elevation/depth/occlusion, visual state changes and landmark hit testing as
   appropriate to the approved contracts. UI/UX owns names, strings and encounter panels.
5. Engine owns only necessary wiring/registry seams. Verification adds deterministic coverage
   for seeded generation and save transitions; QA independently checks each task.

Name concrete paths and exported contracts in each brief after reviewing current develop.
Use `src/strings.ts` for all player-facing text. Content is data, tuning is
`src/sim/rules.ts`, and new save versions require migrations and KNOWN_SAVE_KEYS updates.
Preserve old stored chunks and obtain the author's agreement for any map-golden change.

## Acceptance for the eventual feature

- Deterministic tests cover the chosen nine-chunk roll semantics, seed repeatability, exploration
  order, terrain/footprint legality, spacing, expansion boundaries and rejection/no-fit behavior.
- Old stored terrain and landmark states survive load/expansion; migration and save round trips
  cannot duplicate a landmark or grant a one-time reward again.
- Costs/rewards and staged choices are tested against the approved state machine.
- A repeatable review scene includes all twelve types at intended size on legal terrain, with
  footprint outlines, depth/selection anchors and moving-train occlusion checks.
- UI exposes discovery, requirements, choices, progress and outcomes via translated strings.
- Every task uses `<role>/<issue>-<slug>` from develop, passes its role scope and local/CI gates,
  and receives independent QA; no direct push to develop/main or release tag for this handoff.

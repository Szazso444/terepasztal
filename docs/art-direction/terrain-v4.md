# Terrain v4: restore illustration, compare detail

The user rejected v3's colour-field terrain and smoothed hill masses. The game now
uses its illustrated terrain atlas again. `WorldRenderer` no longer constructs or
shows `Landscape`; hill/mountain offsets are again -10/-20 world pixels. Fractional
prop/person coordinates resolve to the containing tile; flattened hills stay at zero.
Music, contact patches, scale, larger trees, taller tower, smaller kiln and cozy
effects remain. The dormant `landscape*` prototype files are retained for reference.

## Review

`scratchpad/terrain-v4/gallery.html` contains eight Game/Pixi comparison screenshots,
three restored-world screenshots, and a separate generated hill concept. The first
eight use a controlled 48×48 map so the camera, buildings and vegetation are identical
between detail levels. Alternative ground is a preview-only canvas texture inserted
into the game's world layer. This CPU still-renderer is not a runtime implementation.
The three world images use normal `generateMap(7412, {w:128,h:128})`, production ground,
and the existing connected railway fixture. Terrain/biome/variant hashes are unchanged.

## Suggested detail budget

| Surface | Detail | Treatment |
| --- | --- | --- |
| Grass | Medium (recommended) | Visible clusters, directional blades, small colour changes and quiet gaps. |
| Forest floor | Medium-high | Dark leaf litter, roots and grass islands; keep contrast below tree silhouettes. |
| Sand/desert | Low | Fine grains, occasional stones; no large repeating dune stamp. |
| Water | Low-medium | Broad colour, sparse directional ripples; shoreline carries most detail. |
| Taiga | Medium | Short cool grass, needles and pale soil patches, matching existing trees. |
| Swamp | Medium | Irregular damp soil/grass islands; reeds supply vertical detail. |
| Rock | High locally | Readable facets and cracks concentrated in outcrops, quieter gaps. |
| Hills/mountains | Medium ground, high rock | Grass follows the slope; silhouette, ridge and exposed rock express height. |

The three screenshots use 48%, 78% and 100% source-texture contribution and roughly
5, 8 and 10 tuft clusters per tile. These are preview art controls, not player settings
or percentage coverage. Existing tree/bush/flower instances do not change.
Source samples are cropped from approved original art and overlapped independently
of tile borders. Small grass strokes restore a distinct middle scale of detail.

## Transitions

Two alternatives are shown at the identical grass/forest boundary:

1. **Interlocking patches (recommended direction):** coherent tuft-sized islands
   select one material or the other in a narrow irregular band. Texture remains
   visible to the edge. A final atlas should add authored leaf/grass edge clusters.
2. **Narrow winding fringe:** less breakup and a shallower irregular edge. Quieter,
   but the material boundary reads more strongly as a single line.

Grass/sand and sand/water close-ups show how the width changes by material pair.
Coastlines use a much narrower displacement to keep the visual shore close to the
actual tile's water/buildability boundary. The comparison still has high-contrast
material joins; it is a direction study, not final seamless transition art.
No map generation, collision or build rules changed for these proposals.

## Connected illustrated hills proposal

Use a shared corner-height lattice with integer levels 0–3 (initial art increment:
10 world pixels). A tile reads its four corners; neighbours must share exactly the
same heights on their common edge. Allow one level of rise across walkable slopes;
steeper edges select explicit cliff faces. A low ramp, outer shoulder, inner saddle,
ridge, plateau, rock face, high shoulder and peak become a family of connected pieces.
Several rotated orientations and 3–4 surface variants per family break repetition.
Keep upper-left lighting fixed: render each orientation instead of rotating shaded
sprites. Continue using the 64×32 footprint and a common ground anchor.

Only local maxima get peak caps. Elevated interiors use plateau/ridge/saddle pieces,
so a dense patch becomes one raised mass rather than dozens of repeated hill stamps.
Rails would need a separate slope/flattening policy and surface-height sampling before
this becomes gameplay. Start with terrain-only art, keeping current rail levels.
Any persistent elevation plane would need save migration and deliberate generator
versioning; neither has been introduced in this proposal.

`assets/source/terrain-v4/connected-hills-concept.png` is a built-in ImageGen concept,
not an atlas and not a game screenshot. Its tile studies illustrate families, not
verified edge profiles. Exact request and three style references are in `prompt.json`.
Actual edge matching must be constructed and tested before exporting production art.

## Validation

- `node scratchpad/terrain-v4/capture.mjs`: eight comparison stills, no browser errors.
- `node scratchpad/terrain-v4/verify-world.mjs`: three normal-world stills, native ground
  visible, no landscape replacement, fractional elevation, hill flattening and bounds.
- `npm test`: 164 tests pass; map generation golden hashes remain unchanged.
- Typecheck, lint and production build pass. Existing bundle-size warning remains.
- Gallery, renders and the concept are copied to `G:/DEV/Terepasztal/renders/terrain-v4/`.

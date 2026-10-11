# Illustrated house and station, first pass

Eight RGBA source PNGs generated with built-in imagegen, one call per facing.
prompts.json retains the exact prompts. The original cottage and station studies
in ../base-v1 supplied materials; scratchpad/building-poc/guides supplied geometry.
Each facing is a separately generated image, not a mirrored or rotated front bitmap.

house-0..3: one-tile cream sandstone cottage, green joinery, slate pitched roof,
one chimney. station-0..3: two-tile station with three chimneys, front canopy,
lanterns and benches; the two rear views omit the front canopy from the rear wall.
0/3 show the station front; 1/2 show the rear. Orientation matches rotatePoint.

Processing uses alpha cleanup, trimming and uniform area resampling. No shear,
piecewise warp or vertical stretch. Each crop is fitted within its geometry guide
silhouette bounds and aligned at the guide's ground reference. This controls the
display size, but does not prove identical camera angles, door heights or detail
locations across independently generated views. projectionVerified remains false.
These assets are ready for POC visual review, not certified final production art.

Rebuild: node scratchpad/building-poc/build-assets.mjs
Output: scratchpad/building-poc/sprites/*.png and manifest.json, 4x texture density.
Playable preview: /scratchpad/building-poc/index.html
All facings at common scale: /scratchpad/building-poc/assets.html
Collision and yard occupancy remain defined by the shared one/two-cell footprint;
the art never creates additional occupied cells. Production game atlases and saves
are not modified by this asset set.

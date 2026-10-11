# Passenger source v1

Tool: built-in image_gen.imagegen. One reference:
`assets/source/base-v1/people-walker.png` (the small passenger inside this station
illustration is the style/character reference, not the full station).

Output: `assets/passenger-source-v1.png`, subsequently packed into a static
11-logical-pixel-high frame by `prepare-person.mjs` using the existing atlas
resampler. The generated source remains unchanged.

## Exact prompt

Use case: stylized-concept. Create ONE isolated full-body adult railway passenger sprite, on a genuinely transparent background. Input image is STYLE AND HUMAN CHARACTER REFERENCE ONLY: the small adult passenger walking on the platform. Do not reproduce the station, train, rail, platform, floor, scene, text, border or sheet. Just one person. Match the existing crafted illustrated game artwork exactly: restrained forest green cap and waistcoat, warm ivory shirt, charcoal trousers, brown leather boots and small satchel. Adult realistic proportions, not cartoon or chibi, neutral standing pose with both feet level, face directed screen right, 3/4 view. Orthographic 2:1 isometric game camera: 30 degree elevation, verticals vertical, view azimuth 45 degrees. Upper-left soft light, broad stepped painterly colour clusters with selective dark occluded edges, crisp silhouette, no photo texture, no grey studio floor, no glow. Keep the silhouette simple enough to read at 11 logical pixels in height; no loose accessories or thin sticks. One whole adult centered with ample transparent margins. The supplied small passenger is the style authority.

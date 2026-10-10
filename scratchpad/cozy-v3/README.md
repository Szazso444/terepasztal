# Cozy game integration · v3

Open `gallery.html` for ten actual game screenshots from one normally generated
128×128 map (seed 7412), and one normal production-build screenshot. Open
`http://127.0.0.1:5190/` to play with the integrated changes and music. Music starts
only after a click or keypress.

The fixture uses production rendering and atlases throughout. It does not inject
the prior preview materials, rail sprites, scale overrides, reconstructed Rocket
or still-only passenger. `scene.js` places a review railway and buildings through
the real Builder, preserving all generated terrain/biome/variant planes.

Run `node scratchpad/cozy-v3/capture.mjs` with the 5190 Vite server running to capture
the 128-map views. `verify.mjs` checks audio and rendering behavior in an isolated
browser context; `motion.mjs` reuses the real Fleet fixture for 48-facing geometry.
`production.mjs` expects a Vite preview server on 5291. Paths to local Chrome and
Playwright in these review scripts are workstation-specific.

Detailed scope, scale calibration limits, render architecture and validation:
`../../docs/art-direction/cozy-v3.md`. JSON evidence is in `renders/`.
Delivery copy: `G:/DEV/Terepasztal/renders/cozy-v3/`.

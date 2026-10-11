# True-isometric station attempts

Requested: recreate station.png at 45-degree azimuth, 35.26438968-degree elevation,
orthographic projection, ground axes +/-30 degrees, genuine transparency with no halo.

Built-in image generation produced station-true-isometric-v6.png and v7.png using
the original source, then v8.png using the exact geometry guide plus original source.
All are retained under assets/source/base-v1. None passes the requested geometry:
the visible ground-axis edges remain too shallow. The surrounding halo also persists.
Do not treat the filename as projection certification or promote these to production.

The review shows v8, followed by the existing alpha cleanup and uniform resizing.
No affine correction, vertical stretching or piecewise warping was applied.
The adjacent game scene still uses its existing 64x32 grid, not the requested
true-isometric geometry. Projection verification remains false in metadata.json.

The guide uses x=(tx-ty)*160, y=(tx+ty)*160/sqrt(3)-z*160*sqrt(4/3),
giving equal projected lengths for unit axes and 120-degree axis separation.
Reproduce with node scratchpad/station-true-isometric-guide.mjs.

Exact geometry requires a controlled geometry/rendering pipeline; these raster
generation attempts do not establish that constraint despite explicit prompting.

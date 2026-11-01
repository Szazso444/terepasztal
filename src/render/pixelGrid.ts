/**
 * The renderer rounds every vertex it draws to a whole device pixel (`roundPixels: true`, in
 * game.ts), halves up. The pictures are packed four times their size in the world, so their
 * corners lie on quarter and eighth pixels, and at most zoom steps some corner of a small picture
 * (a flower, a stone, a bush) falls exactly half way between two pixels. Which way a vertex on
 * that tie rounds is decided by the rounding error of the frame's matrices, and the error changes
 * with the camera: while it pans or follows a train, such a picture grows, shrinks and shifts by a
 * pixel from one frame to the next, a flicker at any hour.
 *
 * The world's root is therefore placed a hair off its whole pixel, so no vertex lies on a tie and
 * each rounds the same way in every frame. A thirtieth of a pixel cannot be seen. It is not a
 * power of two, as a vertex a binary fraction short of a tie would then be put right on one (1/32
 * did that at zoom 3/4). Of the 4.1 million sums of a corner of the pictures of the day (29,600 of
 * them), a zoom step, a display scaling and a camera position, this leaves none nearer a tie than
 * 0.0002 of a device pixel, and the test below keeps the same clear of every corner on a 32nd of a
 * pixel. A frame's rounding error is under 0.0001.
 */
export const TIE_BREAK = 0.0304;

/** `v`, the world root's position along one axis in pixels, on a whole pixel plus `TIE_BREAK`. */
export const wholePixel = (v: number) => Math.round(v) + TIE_BREAK;

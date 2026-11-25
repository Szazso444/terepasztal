/**
 * How the generators are drawing right now: a picture as the game shows it today, or a turn of it.
 *
 * Until the art package draws every building in its four rotations, a building's placeholder
 * turns are today's picture redrawn (`structures.ts`): r2 seen from behind, with the front's door
 * and canopy left out; r3 mirrored, so the front moves to the lower-right wall; r1 both. A picture
 * that will be mirrored is drawn with the light from the upper right, so that once it is flipped
 * its light comes from the upper left like every other sprite's. The default is today's picture.
 */
let front = true;
let mirrored = false;

/** False while a building is drawn from behind: leave out its front's door and canopy. */
export function frontShown() {
  return front;
}

/**
 * Screen-x sign of the light: 1 for the usual upper-left light, -1 while a picture is drawn to
 * be mirrored afterwards. Shading that falls off from left to right multiplies its x by this.
 */
export function lightX() {
  return mirrored ? -1 : 1;
}

/** Runs `draw` drawing from behind and/or for a mirror, then restores today's view. */
export function drawTurned<T>(view: { behind: boolean; mirrored: boolean }, draw: () => T): T {
  const was = { front, mirrored };
  front = !view.behind;
  mirrored = view.mirrored;
  try {
    return draw();
  } finally {
    front = was.front;
    mirrored = was.mirrored;
  }
}

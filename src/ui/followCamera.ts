/**
 * The camera on a train: picking a train starts it, and it runs until the player takes the camera
 * back. DOM-free, so Node tests read its rules; the game tells it what the player did (`note`) and
 * moves the camera to where each frame's `step` says.
 */

export interface Point {
  x: number;
  y: number;
}

/** What the player can do to the camera. */
export type CameraEvent = 'pan' | 'alert' | 'overview' | 'jump' | 'tool' | 'zoom';

/** Whether each of those takes the camera off the train: a zoom keeps it there, nearer or further. */
const ENDS_FOLLOWING: Record<CameraEvent, boolean> = {
  pan: true,
  alert: true,
  overview: true,
  jump: true,
  tool: true,
  zoom: false,
};

/** How fast the camera closes on the train: the distance left falls by e in 1 / this seconds. */
export const FOLLOW_RATE = 6;
/** Nearer than this, in world pixels, the camera stands on the train. */
const SNAP = 0.5;

/** A frame's move of `camera` towards `at`, the same way at any frame rate. */
export function closeOn(camera: Point, at: Point, dt: number): Point {
  if (Math.hypot(at.x - camera.x, at.y - camera.y) <= SNAP) return { x: at.x, y: at.y };
  const f = 1 - Math.exp(-FOLLOW_RATE * dt);
  return { x: camera.x + (at.x - camera.x) * f, y: camera.y + (at.y - camera.y) * f };
}

/** Which train the camera follows, if any. */
export class FollowCamera {
  private id: number | null = null;

  /** The train followed; null with none. */
  get trainId() {
    return this.id;
  }
  start(trainId: number) {
    this.id = trainId;
  }
  stop() {
    this.id = null;
  }
  /** The eye button: on for this train, or off. */
  toggle(trainId: number) {
    this.id = this.id === trainId ? null : trainId;
  }
  /** The player did something to the camera. */
  note(event: CameraEvent) {
    if (ENDS_FOLLOWING[event]) this.stop();
  }
  /**
   * A frame: where the camera goes, or null to leave it. `find` says where a train stands: null
   * for a train not on the map yet, undefined for one that is gone, which ends the following.
   */
  step(camera: Point, find: (id: number) => Point | null | undefined, dt: number): Point | null {
    if (this.id === null) return null;
    const at = find(this.id);
    if (at === undefined) this.stop();
    return at ? closeOn(camera, at, dt) : null;
  }
}

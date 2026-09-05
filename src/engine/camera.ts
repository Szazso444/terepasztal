import { mapWorldBounds } from './iso';

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2] as const;

/** RTS camera: centre point in world pixels plus a discrete zoom. */
export class Camera {
  x = 0;
  y = 0;
  zoomIndex = 2;
  /** Animated zoom (lerps towards the step value). */
  zoom = 1;
  viewW = 1280;
  viewH = 720;
  private bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  setMapSize(w: number, h: number) {
    this.bounds = mapWorldBounds(w, h);
  }
  get targetZoom() {
    return ZOOM_STEPS[this.zoomIndex];
  }
  zoomBy(steps: number, anchorX?: number, anchorY?: number): boolean {
    const ni = Math.max(0, Math.min(ZOOM_STEPS.length - 1, this.zoomIndex + steps));
    if (ni === this.zoomIndex) return false;
    const before = anchorX !== undefined ? this.screenToWorld(anchorX, anchorY!) : null;
    this.zoomIndex = ni;
    // Snap zoom so that the anchor stays under the cursor; the lerp then eases the remainder.
    if (before && anchorX !== undefined) {
      const z = this.targetZoom;
      this.x = before.x - (anchorX - this.viewW / 2) / z;
      this.y = before.y - (anchorY! - this.viewH / 2) / z;
      this.zoom = z;
    }
    this.clamp();
    return true;
  }
  update(dt: number) {
    const tz = this.targetZoom;
    if (Math.abs(this.zoom - tz) > 0.001) {
      this.zoom += (tz - this.zoom) * Math.min(1, dt * 18);
      if (Math.abs(this.zoom - tz) < 0.002) this.zoom = tz;
    } else this.zoom = tz;
  }
  pan(dxScreen: number, dyScreen: number) {
    this.x += dxScreen / this.zoom;
    this.y += dyScreen / this.zoom;
    this.clamp();
  }
  centerOn(wx: number, wy: number) {
    this.x = wx;
    this.y = wy;
    this.clamp();
  }
  clamp() {
    const hw = this.viewW / 2 / this.zoom;
    const hh = this.viewH / 2 / this.zoom;
    const b = this.bounds;
    const margin = 64;
    const minX = b.minX + hw - margin;
    const maxX = b.maxX - hw + margin;
    const minY = b.minY + hh - margin;
    const maxY = b.maxY - hh + margin;
    this.x = minX > maxX ? (b.minX + b.maxX) / 2 : Math.max(minX, Math.min(maxX, this.x));
    this.y = minY > maxY ? (b.minY + b.maxY) / 2 : Math.max(minY, Math.min(maxY, this.y));
  }
  screenToWorld(sx: number, sy: number) {
    return {
      x: (sx - this.viewW / 2) / this.zoom + this.x,
      y: (sy - this.viewH / 2) / this.zoom + this.y,
    };
  }
  worldToScreen(wx: number, wy: number) {
    return {
      x: (wx - this.x) * this.zoom + this.viewW / 2,
      y: (wy - this.y) * this.zoom + this.viewH / 2,
    };
  }
  /** Visible rectangle in world pixels. */
  viewRect() {
    const hw = this.viewW / 2 / this.zoom;
    const hh = this.viewH / 2 / this.zoom;
    return { x: this.x - hw, y: this.y - hh, w: hw * 2, h: hh * 2 };
  }
}

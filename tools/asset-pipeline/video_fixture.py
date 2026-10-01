"""A synthetic turntable video for tests: a two-box vehicle (long hood, taller cab at the rear) turning on a
flat magenta background under the game camera, so every frame's true heading is known.

    python video_fixture.py out.avi [frames] [turn_direction +1|-1]
prints JSON: {"video": path, "frames": n, "facing_of_frame": [...], "asset": {...}}
"""
import json
import math
import sys

import cv2
import numpy as np

import game_rules
from video_stage import camera_axes

BG = (197, 91, 164)  # RGB, the magenta a generated video carries
ASSET = {"id": "fixture", "category": "vehicle", "plan": "rigid", "size_tiles": 1,
         "length_m": 9.0, "width_m": 2.6, "height_m": 3.6}
# boxes: (x0, x1, z0, z1, half width, RGB), x from the centre, + towards the nose
BOXES = [(-4.5, 4.5, 0.0, 1.0, 1.3, (60, 64, 70)),     # frame and running gear
         (-1.0, 4.4, 1.0, 2.7, 1.0, (178, 52, 34)),    # long hood, at the nose
         (-4.4, -1.0, 1.0, 3.6, 1.3, (150, 40, 30)),   # cab, at the rear
         (3.9, 4.4, 1.6, 2.2, 0.4, (230, 200, 90))]    # headlamp block on the nose


def render(yaw_deg, size=(640, 360), ppm=40.0, elevation=30.0, azimuth=45.0):
    right, up = camera_axes(elevation, azimuth)
    view = np.cross(right, up)  # towards the camera
    c, s = math.cos(math.radians(yaw_deg)), math.sin(math.radians(yaw_deg))
    rot = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
    img = np.zeros((size[1], size[0], 3), np.uint8)
    img[:] = BG[::-1]
    faces = []
    # whole boxes far to near (each box's own visible faces never overlap): exact for these stacked boxes
    order = sorted(BOXES, key=lambda b: float((rot @ np.array([(b[0] + b[1]) / 2, 0, (b[2] + b[3]) / 2])) @ view))
    for x0, x1, z0, z1, hw, rgb in order:
        corners = {(i, j, k): rot @ np.array([(x0, x1)[i], (-hw, hw)[j], (z0, z1)[k]])
                   for i in (0, 1) for j in (0, 1) for k in (0, 1)}
        quads = [[(i, j, k) for j, k in ((0, 0), (1, 0), (1, 1), (0, 1))] for i in (0, 1)]
        quads += [[(i, j, k) for i, k in ((0, 0), (1, 0), (1, 1), (0, 1))] for j in (0, 1)]
        quads += [[(i, j, k) for i, j in ((0, 0), (1, 0), (1, 1), (0, 1))] for k in (0, 1)]
        for q in quads:
            pts = np.array([corners[v] for v in q])
            normal = np.cross(pts[1] - pts[0], pts[3] - pts[0])
            centre = pts.mean(0)
            if np.dot(normal, centre - rot @ np.array([(x0 + x1) / 2, 0, (z0 + z1) / 2])) < 0:
                normal = -normal
            if np.dot(normal, view) <= 0:
                continue  # facing away
            light = 0.65 + 0.35 * max(0.0, float(np.dot(normal / np.linalg.norm(normal), [-0.4, 0.3, 0.87])))
            scr = np.stack([pts @ right * ppm + size[0] / 2, -(pts @ up) * ppm + size[1] * 0.62], 1)
            faces.append((scr, tuple(int(min(255, v * light)) for v in rgb)))
    for scr, rgb in faces:
        cv2.fillConvexPoly(img, scr.round().astype(np.int32), rgb[::-1], lineType=cv2.LINE_AA)
    return img


def main():
    out = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 120
    turn = int(sys.argv[3]) if len(sys.argv) > 3 else -1
    F = game_rules.FACINGS
    w = cv2.VideoWriter(out, cv2.VideoWriter_fourcc(*"MJPG"), 24, (640, 360))
    facing = []
    for i in range(n):
        f = (turn * F * i / n) % F  # one full turn, starting at facing 0
        w.write(render(-360.0 * f / F))  # facing f is a yaw of -7.5 f degrees (game_rules.directions)
        facing.append(f)
    w.release()
    print(json.dumps({"video": out, "frames": n, "facing_of_frame": facing, "asset": ASSET}))


if __name__ == "__main__":
    main()

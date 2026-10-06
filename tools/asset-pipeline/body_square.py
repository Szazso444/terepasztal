"""Squaring a box body up by its own straight lines.

A reconstruction from one picture gets a body's long lines nearly right, not exactly: its side walls
close in towards one end, its roof climbs against its sole, or the body as a whole lies a degree off
the line its wheels stand on. On a model railway those lines run beside the rails, so a degree shows.

This module reads the lines off the aligned model (points in metres: x along with + to the nose, y
across, z up) and says what puts them right:

  yaw    both side walls turn the same way: the body is turned about the vertical
  taper  both side walls close in towards the same end: widths scaled along the length
  pitch  the sole (the shell's lower edge) climbs: the body is turned nose up or down
  rise   the roof climbs against the sole: heights above the sole scaled along the length

Only for bodies that are boxes (diesel and electric engines): a boiler, a tender or a cab has no such
lines, and a steam engine stands on its wheels as they are. A line counts only where it is measured
the same in several ways (slice counts, tolerances) and runs over most of the body.

Pure numpy: the Blender stage calls it, and so does the measuring sheet outside Blender."""
import math

import numpy as np

SLICES = (64, 96, 128)


def line_fit(xs, zs, L, tol, max_deg=4.0):
    """The straight line most of a profile lies on: every pair of well separated points proposes one,
    the one with most points within tol wins, least squares over its points. Returns (slope, share of
    the points on it, share of the length they span, height at the middle) or None."""
    n = len(xs)
    if n < 10:
        return None
    lim = math.tan(math.radians(max_deg))
    best = None
    for i in range(0, n, 2):
        for j in range(i + 1, n):
            if xs[j] - xs[i] < 0.2 * L:
                continue
            k = (zs[j] - zs[i]) / (xs[j] - xs[i])
            if abs(k) > lim:
                continue
            on = np.abs(zs - (zs[i] + k * (xs - xs[i]))) < tol
            c = int(on.sum())
            if best is None or c > best[0]:
                best = (c, on)
    if best is None or best[0] < 8:
        return None
    on = best[1]
    kk, bb = np.polyfit(xs[on], zs[on], 1)
    on = np.abs(zs - (kk * xs + bb)) < tol
    if on.sum() < 8:
        return None
    kk, bb = np.polyfit(xs[on], zs[on], 1)
    return float(kk), float(on.sum() / n), float((xs[on].max() - xs[on].min()) / L), float(kk * np.mean(xs) + bb)


def profiles(P, zg, yc, n):
    """Per slice along the body: x, roof height, the shell's lower edge, and each side wall's distance
    from the centre plane (the body band's outer surface), NaN where a slice has too little."""
    x0, x1 = np.percentile(P[:, 0], [0.5, 99.5])
    L = x1 - x0
    z = P[:, 2] - zg
    H = float(np.percentile(z, 99.5))
    edges = np.linspace(x0 + 0.05 * L, x1 - 0.05 * L, n + 1)
    idx = np.digitize(P[:, 0], edges) - 1
    xs = (edges[:-1] + edges[1:]) / 2
    roof, sole = np.full(n, np.nan), np.full(n, np.nan)
    wall = {1: np.full(n, np.nan), -1: np.full(n, np.nan)}
    band = (z > 0.45 * H) & (z < 0.8 * H)
    for b in range(n):
        m = idx == b
        if m.sum() < 80:
            continue
        zb, yb = z[m], P[m, 1] - yc
        roof[b] = np.percentile(zb, 99)
        w = np.abs(yb)
        skin = zb[(w > np.percentile(w, 85)) & (zb > 0.22 * H)]
        if len(skin) > 30:
            sole[b] = np.percentile(skin, 2)
        for side in (1, -1):
            q = side * yb[band[m]]
            q = q[q > 0]
            if len(q) > 60:
                wall[side][b] = np.percentile(q, 92)
    return xs, roof, sole, wall, (x0 + x1) / 2, L, H


def lines(P, zg, yc):
    """Each line measured six ways. Returns {name: {"deg", "spread", "share", "span", "at", "ok"}} for
    roof, sole, wall+ and wall-; deg is the median slope (z or outward distance per x, + towards the
    nose), at the line's height (or distance) at the body's middle."""
    got = {k: [] for k in ("roof", "sole", "wall+", "wall-")}
    for n in SLICES:
        xs, roof, sole, wall, xm, L, H = profiles(P, zg, yc, n)
        for name, v, tols, lim in (("roof", roof, (0.025, 0.04), 4.0), ("sole", sole, (0.025, 0.04), 4.0),
                                   ("wall+", wall[1], (0.02, 0.035), 5.0), ("wall-", wall[-1], (0.02, 0.035), 5.0)):
            m = ~np.isnan(v)
            for tol in tols:
                ln = line_fit(xs[m], v[m], L, tol, lim)
                if ln:
                    got[name].append(ln)
    out = {"L": float(L), "H": float(H), "xm": float(xm)}
    for name, v in got.items():
        if len(v) < 4:
            out[name] = {"ok": False, "n": len(v)}
            continue
        degs = [math.degrees(math.atan(q[0])) for q in v]
        row = {"deg": float(np.median(degs)), "spread": float(max(degs) - min(degs)),
               "share": float(np.median([q[1] for q in v])), "span": float(np.median([q[2] for q in v])),
               "at": float(np.median([q[3] for q in v])), "n": len(v)}
        row["ok"] = row["spread"] <= 0.3 and row["share"] >= 0.25 and row["span"] >= 0.5
        out[name] = row
    return out


def decide(ln, seen, min_deg=0.15):
    """What squares the body up, from its lines. seen: +1 or -1, the side the source camera saw (the
    far side is rebuilt as its mirror, so the seen wall is the one that must run along the track).
    Returns {"yaw_deg", "taper", "pitch_deg", "rise", "sole_z", "why"}:
      yaw_deg    turn about the vertical that is in the model (+ = nose towards +y)
      taper      the seen wall's outward slope left after that turn (tan; + = wider at the nose)
      pitch_deg  the body's climb towards the nose
      rise       the roof's climb against the sole (tan), heights above sole_z"""
    out = {"yaw_deg": 0.0, "taper": 0.0, "pitch_deg": 0.0, "rise": 0.0, "sole_z": 0.0, "why": []}
    ws, wf = ln[f"wall{'+' if seen > 0 else '-'}"], ln[f"wall{'-' if seen > 0 else '+'}"]
    if ws["ok"] and wf["ok"]:
        # a wall's outward slope: +yaw on the +y side, -yaw on the other; the same taper on both
        yaw = seen * (ws["deg"] - wf["deg"]) / 2
        tap = (ws["deg"] + wf["deg"]) / 2
        if abs(yaw) >= min_deg:
            out["yaw_deg"] = yaw
        if abs(tap) >= min_deg:
            out["taper"] = math.tan(math.radians(tap))
        out["why"].append(f"walls {ws['deg']:+.2f} (seen) and {wf['deg']:+.2f} deg")
    elif ws["ok"] and abs(ws["deg"]) <= 1.5:
        if abs(ws["deg"]) >= min_deg:
            out["taper"] = math.tan(math.radians(ws["deg"]))
        out["why"].append(f"seen wall {ws['deg']:+.2f} deg (the far wall has no line)")
    else:
        out["why"].append("no wall line")
    r, s = ln["roof"], ln["sole"]
    if s["ok"]:
        if abs(s["deg"]) >= min_deg:
            out["pitch_deg"] = s["deg"]
        out["sole_z"] = s["at"]
        if r["ok"] and r["at"] - s["at"] > 1.0 and abs(r["deg"] - s["deg"]) >= 0.2:
            out["rise"] = math.tan(math.radians(r["deg"])) - math.tan(math.radians(s["deg"]))
        out["why"].append(f"sole {s['deg']:+.2f}" + (f", roof {r['deg']:+.2f} deg" if r["ok"] else " deg (no roof line)"))
    elif r["ok"]:
        if abs(r["deg"]) >= min_deg:
            out["pitch_deg"] = r["deg"]
        out["why"].append(f"roof {r['deg']:+.2f} deg (no sole line)")
    else:
        out["why"].append("no roof or sole line")
    out["why"] = "; ".join(out["why"])
    return out


def warp(V, fix, ln, yc, zg, x_mid=None):
    """The taper and the rise out of points V (N x 3, the aligned model in metres, after the turns):
    widths about the centre plane and heights above the sole, scaled along the length so the seen
    wall runs along x and the roof level with the sole. Returns new points."""
    V = np.array(V, dtype=np.float64)
    xm = ln["xm"] if x_mid is None else x_mid
    half = ln["L"] / 2
    u = np.clip(V[:, 0] - xm, -half, half)  # what overhangs the measured length scales as its end does
    if fix.get("taper"):
        wm = fix["wall_at"]
        V[:, 1] = yc + (V[:, 1] - yc) * wm / np.maximum(wm + fix["taper"] * u, 0.5 * wm)
    if fix.get("rise"):
        zs = zg + fix["sole_z"]
        hm = fix["roof_at"] - fix["sole_z"]
        up = V[:, 2] > zs
        V[up, 2] = zs + (V[up, 2] - zs) * hm / np.maximum(hm + fix["rise"] * u[up], 0.5 * hm)
    return V


def square(P, zg, yc, seen, max_turn=2.0, max_scale=0.12):
    """Measure, decide, and check on the points themselves. Returns (fix, lines before, lines after);
    fix carries what the caller applies: yaw_deg and pitch_deg (turns of the whole model: rz(-yaw),
    then ry so the nose comes down by pitch), then warp()'s taper and rise. A correction beyond
    max_turn degrees or max_scale end to end is not a finding and is left out."""
    ln = lines(P, zg, yc)
    fix = decide(ln, seen)
    left = []
    for key in ("yaw_deg", "pitch_deg"):
        if abs(fix[key]) > max_turn:
            left.append(f"{key} {fix[key]:+.2f}")
            fix[key] = 0.0
    ws = ln[f"wall{'+' if seen > 0 else '-'}"]
    if fix["taper"]:
        fix["wall_at"] = ws["at"]
        if abs(fix["taper"]) * ln["L"] / ws["at"] > max_scale * 2:
            left.append(f"taper {fix['taper']:+.4f}")
            fix["taper"] = 0.0
    if fix["rise"]:
        fix["roof_at"] = ln["roof"]["at"]
        if abs(fix["rise"]) * ln["L"] / (fix["roof_at"] - fix["sole_z"]) > max_scale * 2:
            left.append(f"rise {fix['rise']:+.4f}")
            fix["rise"] = 0.0
    if left:
        fix["why"] += "; left out as too large: " + ", ".join(left)
    Q = apply_turns(P, fix, ln["xm"], yc, zg)
    ln2 = lines(Q, zg, yc)
    # the warp is measured on the turned model: the walls' and the roof's places at the middle
    if fix["taper"]:
        fix["wall_at"] = ln2[f"wall{'+' if seen > 0 else '-'}"].get("at", fix["wall_at"])
    if fix["rise"]:
        fix["roof_at"] = ln2["roof"].get("at", fix["roof_at"])
        fix["sole_z"] = ln2["sole"].get("at", fix["sole_z"])
    fix["xm"], fix["L"] = ln2["xm"], ln2["L"]
    after = lines(warp(Q, fix, ln2, yc, zg), zg, yc)
    return fix, ln, after


def apply_turns(P, fix, xm, yc, zg):
    """The two turns on points, about the body's middle on the rail (for measuring; the Blender stage
    turns its own rotation matrix instead)."""
    Q = np.array(P, dtype=np.float64) - (xm, yc, zg)
    a = math.radians(-fix["yaw_deg"])
    c, s = math.cos(a), math.sin(a)
    Q = Q @ np.array([[c, -s, 0], [s, c, 0], [0, 0, 1.0]]).T
    b = math.radians(fix["pitch_deg"])
    c, s = math.cos(b), math.sin(b)
    # nose down by pitch: x' = c x + s z, z' = -s x + c z
    Q = Q @ np.array([[c, 0, s], [0, 1.0, 0], [-s, 0, c]]).T
    return Q + (xm, yc, zg)

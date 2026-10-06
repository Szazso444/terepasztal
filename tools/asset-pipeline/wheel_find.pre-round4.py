"""Where a reconstructed vehicle has its wheels (numpy only, so it can be tried outside Blender).

The gear table lists every axle as a share of the vehicle's length, measured on the source picture
between the buffer beams. The model is the master for where things are: its wheels are the lowest
bumps of its underside, they stand on one line (the rail), and they come in the table's order and
spacing. fit_wheels finds that line and the model's place of every axle the table lists; the built
wheels then go exactly where the model's own were, and the vehicle stands on that line."""
import math

import numpy as np


def lower_outline(P, x_lo, x_hi, step):
    """Underside of the model seen from the side: per slice of `step` along x, the height of its lowest
    points (1st percentile), inf where a slice is nearly empty."""
    edges = np.arange(x_lo, x_hi + step, step)
    idx = np.digitize(P[:, 0], edges) - 1
    n = len(edges) - 1
    z = np.full(n, np.inf)
    order = np.argsort(idx, kind="stable")
    idx_s, z_s = idx[order], P[order, 2]
    starts = np.searchsorted(idx_s, np.arange(n))
    ends = np.searchsorted(idx_s, np.arange(n), side="right")
    for b in range(n):
        if ends[b] - starts[b] >= 12:
            z[b] = np.percentile(z_s[starts[b]:ends[b]], 1)
    return (edges[:-1] + edges[1:]) / 2, z


def wheel_minima(xs, z, sep, rise, reach):
    """Bumps of the underside that reach down like a wheel does: the lowest slice within sep on either
    side, with the outline rising by at least `rise` within `reach` on both sides (or running out).
    Returns [(x, z)]."""
    step = float(xs[1] - xs[0])
    w, W = max(1, int(round(sep / step))), max(2, int(round(reach / step)))
    out = []
    n = len(xs)
    for i in range(n):
        if not np.isfinite(z[i]):
            continue
        a, b = max(0, i - w), min(n, i + w + 1)
        if z[i] > np.min(z[a:b]) + 1e-9:
            continue
        left, right = z[max(0, i - W):i], z[i + 1:min(n, i + W + 1)]
        up_l = (np.max(left[np.isfinite(left)]) - z[i]) if np.isfinite(left).any() else np.inf
        up_r = (np.max(right[np.isfinite(right)]) - z[i]) if np.isfinite(right).any() else np.inf
        if not np.isfinite(left).all():
            up_l = np.inf  # the model ends there
        if not np.isfinite(right).all():
            up_r = np.inf
        if up_l >= rise and up_r >= rise:
            if out and xs[i] - out[-1][0] < sep:  # a flat bottom: keep its middle
                if z[i] <= out[-1][1] + 1e-9:
                    out[-1] = ((out[-1][0] + xs[i]) / 2, z[i])
                continue
            out.append((float(xs[i]), float(z[i])))
    return out


def _match(found_x, expected, tol):
    """Table axles onto found wheels, both in order: (pairs [(i_expected, j_found)], sum of distances)."""
    pairs, used, total = [], -1, 0.0
    for i, e in enumerate(expected):
        best = None
        for j in range(used + 1, len(found_x)):
            d = abs(found_x[j] - e)
            if d <= tol and (best is None or d < best[1]):
                best = (j, d)
            if found_x[j] > e + tol:
                break
        if best:
            pairs.append((i, best[0]))
            used = best[0]
            total += best[1]
    return pairs, total


def fit_wheels(P, fracs, x_lo, x_hi, H, max_deg=8.0):
    """P: points (x along with the nose at +x, z up), fracs: the table's axles as shares of the length
    between the buffer beams (0 = rear), any order. H: the model's height, the yardstick for every
    tolerance (so the search works before the model has its scale).
    Returns None when fewer than two wheels can be told, else {
      slope, z_mid, x_mid : the line the wheels stand on (z = z_mid + slope * (x - x_mid)),
      x : the model's place of every axle, in the order of fracs (found, or from the fitted spacing),
      found : [bool], over_rear, over_front : what sticks out past the beams (buffers, couplers),
      wheels : [(x, z)] every wheel-like bump on the line }."""
    L = x_hi - x_lo
    order = np.argsort(fracs)
    f = np.asarray(fracs, dtype=float)[order]
    xs, z = lower_outline(P, x_lo, x_hi, 0.01 * H)
    mins = wheel_minima(xs, z, sep=0.085 * H, rise=0.02 * H, reach=0.16 * H)
    if len(mins) < 2:
        return None
    mx, mz = np.array([m[0] for m in mins]), np.array([m[1] for m in mins])
    tol_z, tol_x, band = 0.014 * H, 0.07 * H, 0.07 * H
    tmax = math.tan(math.radians(max_deg))
    lines = []
    for a in range(len(mins)):
        for b in range(a + 1, len(mins)):
            dx = mx[b] - mx[a]
            if dx < 0.12 * L:
                continue
            k = (mz[b] - mz[a]) / dx
            if abs(k) > tmax:
                continue
            r = mz - (mz[a] + k * (mx - mx[a]))
            on = np.abs(r) <= tol_z
            below = int((r < -tol_z).sum())
            lines.append((int(on.sum()) - 2 * below, a, b, k))
    if not lines:
        return None
    lines.sort(key=lambda t: -t[0])
    overs = np.arange(0.0, 0.45 * H + 1e-9, 0.02 * H)
    best = None
    for score, a, b, k in lines[:12]:
        r = mz - (mz[a] + k * (mx - mx[a]))
        # a reconstruction's wheels do not all reach the rail: a bump a little above the line the
        # others stand on is a wheel as well (a bogie's, a tender's that the model carries higher)
        on = (r >= -tol_z) & (r <= band)
        fx = mx[on]
        for o_r in overs:
            for o_f in overs:
                exp = x_lo + o_r + f * (L - o_r - o_f)
                pairs, total = _match(fx, exp, tol_x)
                # more axles matched first; then the line more wheels stand on exactly (a line through
                # a low step at one end and a wheel at the other matches as many, within the band);
                # then the closer fit
                key = (len(pairs), score, -round(abs(k), 3), -total, -(o_r + o_f))
                if best is None or key > best[0]:
                    best = (key, a, b, k, on.copy(), o_r, o_f, pairs)
    key, a, b, k, on, o_r, o_f, pairs = best
    if len(pairs) < 2:
        return None
    fx, fz = mx[on], mz[on]
    px, pz = np.array([fx[j] for _, j in pairs]), np.array([fz[j] for _, j in pairs])
    # the rail: the line through the bottoms of the found wheels that reach it (not of every low bump
    # on it: a tank or a step is no wheel), else the line of the pair that gave it
    r_m = pz - (mz[a] + k * (px - mx[a]))
    low = np.abs(r_m) <= tol_z
    if low.sum() >= 2 and px[low].max() - px[low].min() > 0.1 * L:
        k, c = np.polyfit(px[low], pz[low], 1)
    else:
        c = float(mz[a] - k * mx[a])
    x_mid = (x_lo + x_hi) / 2
    # axles the model hides take their place from the found ones' spacing
    ef = np.array([f[i] for i, _ in pairs])
    if len(pairs) >= 2 and ef.max() - ef.min() > 1e-6:
        sa, sb = np.polyfit(ef, px, 1)
    else:
        sa, sb = (L - o_r - o_f), x_lo + o_r
    x_sorted = sa * f + sb
    found_sorted = np.zeros(len(f), bool)
    for i, j in pairs:
        x_sorted[i] = fx[j]
        found_sorted[i] = True
    # two found wheels much closer than the table has them are not two axles: the one further from
    # its fitted place is not a wheel
    fitted = sa * f + sb
    for _ in range(len(f)):
        got = np.nonzero(found_sorted)[0]
        bad = None
        for i0, i1 in zip(got, got[1:]):
            want = sa * (f[i1] - f[i0])
            if want > 1e-6 and x_sorted[i1] - x_sorted[i0] < 0.6 * want:
                bad = i0 if abs(x_sorted[i0] - fitted[i0]) > abs(x_sorted[i1] - fitted[i1]) else i1
                break
        if bad is None or found_sorted.sum() <= 2:
            break
        found_sorted[bad] = False
    # a hidden axle: the table's spacing from the nearest found one (its own truck's other axle)
    got = np.nonzero(found_sorted)[0]
    for i in np.nonzero(~found_sorted)[0]:
        n = got[np.argmin(np.abs(f[got] - f[i]))]
        x_sorted[i] = x_sorted[n] + sa * (f[i] - f[n])
    x = np.empty(len(f))
    found = np.zeros(len(f), bool)
    x[order] = x_sorted
    found[order] = found_sorted
    zb = np.full(len(f), np.nan)  # each found wheel's own bottom
    zb_sorted = np.full(len(f), np.nan)
    for i, j in pairs:
        if found_sorted[i]:
            zb_sorted[i] = fz[j]
    zb[order] = zb_sorted
    return {"slope": float(k), "z_mid": float(c + k * x_mid), "x_mid": float(x_mid), "x": x.tolist(),
            "found": found.tolist(), "bottom": zb.tolist(), "over_rear": float(o_r), "over_front": float(o_f),
            "share": [float(sa), float(sb)],  # x of a share f between the beams: sa * f + sb
            "wheels": [(float(u), float(v)) for u, v in zip(fx, fz)], "matched": int(found_sorted.sum())}


def wheel_radius(P, x0, z0, d_guess, rise=0.12):
    """Radius of the model's own wheel standing at x0 with its bottom at z0, from how fast the underside
    rises either side of it: a circle of radius r is `rise` up at sqrt(2 r rise - rise^2) from its
    bottom. None when the outline there is not a wheel's (a frame hangs as low)."""
    r0 = d_guess / 2
    h = min(rise, 0.3 * r0)
    xs, z = lower_outline(P[np.abs(P[:, 0] - x0) < 1.3 * r0], x0 - 1.3 * r0, x0 + 1.3 * r0, 0.02)
    ok = np.isfinite(z)
    if ok.sum() < 8:
        return None
    half = []
    for side in (-1, 1):
        sel = ok & ((xs - x0) * side > 0)
        d, zz = np.abs(xs[sel] - x0), z[sel] - z0
        o = np.argsort(d)
        d, zz = d[o], zz[o]
        up = np.nonzero(zz >= h)[0]
        if len(up):
            i = up[0]
            if i > 0 and zz[i] > zz[i - 1]:
                half.append(float(d[i - 1] + (h - zz[i - 1]) / (zz[i] - zz[i - 1]) * (d[i] - d[i - 1])))
            else:
                half.append(float(d[i]))
    if not half:
        return None
    dx = float(np.mean(half))
    return (dx * dx + h * h) / (2 * h)


def fit_parts(P, parts, x_lo, x_hi, H, max_deg=8.0):
    """A vehicle of several bodies (engine and tender): the reconstruction may carry one a little higher
    than the other, so a line through every wheel tilts by the step between them. parts:
    [{"from", "to", "fracs"}] (shares between the beams of the whole vehicle). Returns None, or the fit
    over all axles with "main": the line of the longest body with found wheels, fitted on that body's
    stretch of the model alone (the vehicle is stood on that one)."""
    fr = [f for p in parts for f in p["fracs"]]
    if len(fr) < 2:
        return None
    g = fit_wheels(P, fr, x_lo, x_hi, H, max_deg)
    if not g:
        return None
    g["main"] = {"slope": g["slope"], "z_mid": g["z_mid"], "x_mid": g["x_mid"], "matched": g["matched"]}
    if len(parts) < 2:
        return g
    sa, sb = g["share"]
    srt = sorted(parts, key=lambda p: p["from"])
    best = None
    for i, p in enumerate(srt):
        if len(p["fracs"]) < 2 or not all(p["from"] - 1e-6 <= f <= p["to"] + 1e-6 for f in p["fracs"]):
            continue
        lo = x_lo if i == 0 else sa * (srt[i - 1]["to"] + p["from"]) / 2 + sb
        hi = x_hi if i == len(srt) - 1 else sa * (p["to"] + srt[i + 1]["from"]) / 2 + sb
        Q = P[(P[:, 0] >= lo) & (P[:, 0] <= hi)]
        if len(Q) < 2000:
            continue
        pf = fit_wheels(Q, [(f - p["from"]) / (p["to"] - p["from"]) for f in p["fracs"]], lo, hi, H, max_deg)
        if pf and pf["matched"] >= 2 and (best is None or p["to"] - p["from"] > best_len):
            best, best_len = pf, p["to"] - p["from"]
    if best and best["matched"] >= 2:
        g["main"] = {"slope": best["slope"], "z_mid": best["z_mid"], "x_mid": best["x_mid"], "matched": best["matched"]}
    return g

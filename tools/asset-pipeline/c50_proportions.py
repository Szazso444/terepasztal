"""Explicit owner-requested C-50 width correction in aligned metres."""
import numpy as np


def ramp(v, low, high):
    t = np.clip((v-low)/(high-low), 0, 1)
    return t*t*(3-2*t)


def correct_widths(p):
    """Only transverse coordinates change; the roof/cab and rail geometry stay put."""
    x, y, z = p.T
    out = p.copy()
    front = (x > .55) & (x < 1.65) & (z > 1.2) & (z < 1.6)
    rear = (x > -2.3) & (x < -1.9) & (z > 1.2) & (z < 1.6)
    f0, f1 = np.percentile(y[front], [2, 98])
    r0, r1 = np.percentile(y[rear], [2, 98])
    ratio = (r1-r0)/(f1-f0)
    weight = ramp(x, .27, .46) * ramp(z, 1.015, 1.06) * (1-ramp(z, 1.97, 2.1))
    target = (y-(f0+f1)/2)*ratio+(r0+r1)/2
    out[:, 1] += weight*(target-y)
    # The red solebar/deck extends down at its ends, above the wheel openings
    # between them. A short shoulder joins the unchanged upper body to the deck.
    end = np.maximum(1-ramp(x, -1.62, -1.45), ramp(x, 1.4, 1.6))
    lower = .70*(1-end)+.26*end
    deck = ramp(z, lower, lower+.045)*(1-ramp(z, 1.015, 1.055))
    deck *= ramp(np.abs(y-.05), .30, .62)
    out[:, 1] += .4*(y-.05)*deck
    assert np.array_equal(out[:, [0, 2]], p[:, [0, 2]])
    cab = (x > -1.4) & (x < .2) & (z > 1.06)
    assert np.array_equal(out[cab], p[cab])
    return out, {'front_width_before': float(f1-f0), 'rear_width': float(r1-r0),
                 'front_width_after': float((f1-f0)*ratio), 'front_width_factor': float(ratio),
                 'deck_width_factor': 1.4, 'cab_unchanged': True, 'length_height_unchanged': True}



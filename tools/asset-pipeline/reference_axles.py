"""Reference-authoritative wheel layout, independent of Blender and mesh detection."""
def authored_axles(x_min, x_max, fractions, diameters):
    if len(fractions) != len(diameters) or x_max <= x_min:
        raise ValueError('Invalid reference axle layout')
    result = [{'x': x_min + u * (x_max-x_min), 'd': d} for u,d in zip(fractions,diameters)]
    if any(not 0 <= u <= 1 or d <= 0 for u,d in zip(fractions,diameters)):
        raise ValueError('Invalid reference wheel dimension')
    ordered=sorted(result,key=lambda a:a['x'])
    for a,b in zip(ordered,ordered[1:]):
        if b['x']-a['x'] <= (a['d']+b['d'])/2+.02:
            raise ValueError('Reference wheels overlap: correct axle layout, do not shrink wheels')
    return result

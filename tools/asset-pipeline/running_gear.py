"""Wheels and bogies built from measurements, and the flat painted shading every render uses.
Runs inside Blender (bpy + bmesh + numpy).

Reconstructed meshes get running gear wrong in the ways that show most: wheels come out uneven,
soft and at the wrong gauge. So the pipeline cuts the model's own wheels away and builds round ones
here, at the landmarks measured on the source (axle positions, wheel diameters) and exactly on the
game's rails (tread centres at +-HALF_GAUGE_TILES of a tile, bottoms on the rail plane z = 0).

Frame: metres in the final game frame, X along the track (front +X), Y across, Z up.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HALF_GAUGE_TILES = 0.16  # src/art/track.ts: rails at +-0.16 of a tile from the centre line


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


# ---------------- shading ----------------
def light_vector(cam_ob, light_cam):
    """World direction towards the light, given in camera axes (right, up, back)."""
    m = cam_ob.matrix_world.to_3x3()
    v = m @ Vector(light_cam)
    v.normalize()
    return v


def shaded_material(name, shading, color=None, image=None):
    """Painted look: the colour itself, times ambient + light * max(0, N.L) with L fixed to the
    camera, so every facing is lit from the same side of the screen. Emission, so the source's own
    painted shading is not lit a second time by a physical light."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    if image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        tex.interpolation = "Linear"
        col = tex.outputs["Color"]
    else:
        rgb = nt.nodes.new("ShaderNodeRGB")
        lin = srgb_to_linear(color)
        rgb.outputs[0].default_value = (float(lin[0]), float(lin[1]), float(lin[2]), 1.0)
        col = rgb.outputs[0]
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    dot.inputs[1].default_value = tuple(shading["light_world"])
    nt.links.new(geo.outputs["Normal"], dot.inputs[0])
    clamp = nt.nodes.new("ShaderNodeMath")
    clamp.operation = "MAXIMUM"
    clamp.inputs[1].default_value = 0.0
    nt.links.new(dot.outputs["Value"], clamp.inputs[0])
    lit = nt.nodes.new("ShaderNodeMath")
    lit.operation = "MULTIPLY_ADD"
    lit.inputs[1].default_value = shading["light"]
    lit.inputs[2].default_value = shading["ambient"]
    nt.links.new(clamp.outputs["Value"], lit.inputs[0])
    mul = nt.nodes.new("ShaderNodeVectorMath")
    mul.operation = "SCALE"
    nt.links.new(col, mul.inputs[0])
    nt.links.new(lit.outputs["Value"], mul.inputs["Scale"])
    nt.links.new(mul.outputs["Vector"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


def repaint(obj, shading):
    """Swap every material of obj for the painted shading, keeping its base colour image or colour."""
    for slot in obj.material_slots:
        m = slot.material
        if not (m and m.node_tree):
            continue
        image, color = None, (0.5, 0.5, 0.5)
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                links = n.inputs["Base Color"].links
                if links and links[0].from_node.type == "TEX_IMAGE":
                    image = links[0].from_node.image
                else:
                    c = n.inputs["Base Color"].default_value
                    color = tuple((float(x) ** (1 / 2.2)) for x in c[:3])
        slot.material = shaded_material(f"{m.name}_painted", shading, color=color, image=image)


# ---------------- mesh helpers ----------------
class Builder:
    """Collects faces into one bmesh with one material per named colour."""

    def __init__(self, name, colors, shading):
        self.name = name
        self.bm = bmesh.new()
        self.mats = {}
        self.colors = colors
        self.shading = shading

    def mat(self, key):
        if key not in self.mats:
            self.mats[key] = len(self.mats)
        return self.mats[key]

    def _face(self, vs, key):
        f = self.bm.faces.new([self.bm.verts.new(v) for v in vs])
        f.material_index = self.mat(key)
        return f

    def box(self, c, size, key, rot_y=0.0):
        """Axis box centred at c, size (dx, dy, dz), turned rot_y radians about Y through c."""
        hx, hy, hz = (s / 2 for s in size)
        R = Matrix.Rotation(rot_y, 3, "Y")
        pts = [Vector(c) + R @ Vector((sx * hx, sy * hy, sz * hz))
               for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
        idx = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        for q in idx:
            self._face([pts[i] for i in q], key)

    def tube(self, c, r_out, r_in, y0, y1, key, n=48, key_face=None):
        """Annulus between radii, axis along Y from y0 to y1, centred at c (x, z)."""
        x0, z0 = c
        ang = [2 * math.pi * i / n for i in range(n)]
        ring = lambda r, y: [Vector((x0 + r * math.cos(a), y, z0 + r * math.sin(a))) for a in ang]
        oa, ob = ring(r_out, y0), ring(r_out, y1)
        for i in range(n):
            j = (i + 1) % n
            self._face([oa[i], oa[j], ob[j], ob[i]], key)
        fk = key_face or key
        if r_in > 0:
            ia, ib = ring(r_in, y0), ring(r_in, y1)
            for i in range(n):
                j = (i + 1) % n
                self._face([ia[j], ia[i], ib[i], ib[j]], key)
                self._face([oa[j], oa[i], ia[i], ia[j]], fk)
                self._face([ob[i], ob[j], ib[j], ib[i]], fk)
        else:
            self._face(list(reversed(oa)), fk)
            self._face(ob, fk)

    def post(self, c, r, z0, z1, key, n=16):
        """Upright cylinder (a coil spring, a hanger) at c = (x, y) from z0 to z1."""
        x0, y0 = c
        ang = [2 * math.pi * i / n for i in range(n)]
        lo = [Vector((x0 + r * math.cos(a), y0 + r * math.sin(a), z0)) for a in ang]
        hi = [Vector((x0 + r * math.cos(a), y0 + r * math.sin(a), z1)) for a in ang]
        for i in range(n):
            j = (i + 1) % n
            self._face([lo[i], lo[j], hi[j], hi[i]], key)
        self._face(list(reversed(lo)), key)
        self._face(hi, key)

    def barrel(self, c, r, x0, x1, key, n=16):
        """Cylinder along X (a steam cylinder, a brake cylinder) at c = (y, z) from x0 to x1."""
        y0, z0 = c
        ang = [2 * math.pi * i / n for i in range(n)]
        lo = [Vector((x0, y0 + r * math.cos(a), z0 + r * math.sin(a))) for a in ang]
        hi = [Vector((x1, y0 + r * math.cos(a), z0 + r * math.sin(a))) for a in ang]
        for i in range(n):
            j = (i + 1) % n
            self._face([lo[i], lo[j], hi[j], hi[i]], key)
        self._face(list(reversed(lo)), key)
        self._face(hi, key)

    def rod(self, a, b, thick, key):
        """A flat bar between points a and b (x, z) at y, thick = (width along Y, height)."""
        (xa, ya, za), (xb, _, zb) = a, b
        length = math.hypot(xb - xa, zb - za)
        ang = math.atan2(zb - za, xb - xa)
        self.box(((xa + xb) / 2, ya, (za + zb) / 2), (length, thick[0], thick[1]), key, rot_y=-ang)

    def finish(self):
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.to_mesh(me)
        self.bm.free()
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        order = sorted(self.mats.items(), key=lambda kv: kv[1])
        for key, _ in order:
            me.materials.append(shaded_material(f"{self.name}_{key}", self.shading, color=self.colors[key]))
        for p in me.polygons:
            p.use_smooth = False
        return ob


# ---------------- wheels ----------------
def wheel(b, x, radius, y_tread, outward, w, spokes=0, crank=0.0):
    """One wheel on the rail at (x, y_tread); outward = +1 on the +Y side. Spoked wheels are see-through
    between their spokes; disc wheels are solid. crank > 0 adds a crank boss that far from the hub."""
    zc = radius
    t = 0.16 * w["scale"]  # tread width
    y_in, y_out = y_tread - outward * t / 2, y_tread + outward * t / 2
    y0, y1 = min(y_in, y_out), max(y_in, y_out)
    rim_in = radius * (0.88 if spokes else 0.8)  # a thin steel tyre round a painted wheel centre
    b.tube((x, zc), radius, rim_in, y0, y1, "tyre", key_face="tyre")
    # flange on the inner side, a little proud of the tread
    fy0, fy1 = (y0, y0 + t * 0.3) if outward > 0 else (y1 - t * 0.3, y1)
    b.tube((x, zc), radius * 1.05, radius * 0.95, fy0, fy1, "tyre")
    face_y = y_out - outward * t * 0.25
    if spokes:
        felloe = rim_in * 0.86
        b.tube((x, zc), rim_in, felloe, y0 + t * 0.1, y1 - t * 0.1, "wheel")
        hub = radius * 0.2
        for k in range(spokes):
            a = 2 * math.pi * (k + 0.5) / spokes
            r0, r1 = hub * 0.8, felloe * 1.02
            cx, cz = x + math.cos(a) * (r0 + r1) / 2, zc + math.sin(a) * (r0 + r1) / 2
            b.box((cx, face_y, cz), (r1 - r0, t * 0.45, radius * 0.13), "wheel", rot_y=-a)
        b.tube((x, zc), hub, 0, face_y - t * 0.3, face_y + t * 0.3, "hub")
    else:
        b.tube((x, zc), rim_in, 0, face_y - t * 0.2, face_y + t * 0.2, "wheel")
        b.tube((x, zc), radius * 0.22, 0, face_y - t * 0.3 + outward * t * 0.15,
               face_y + t * 0.3 + outward * t * 0.15, "hub")
    if crank:
        b.tube((x + crank, zc), radius * 0.12, 0, face_y, face_y + outward * t * 0.6, "hub")


def half_gauge_m(tile_m):
    return HALF_GAUGE_TILES * tile_m


def wheelset(name, axles, tile_m, colors, shading, scale=1.0):
    """Loose wheelsets on the rails: axles = [{x, d, spokes}] in final metres. Returns the object."""
    b = Builder(name, colors, shading)
    g = half_gauge_m(tile_m)
    w = {"scale": scale}
    for ax in axles:
        for side in (-1, 1):
            wheel(b, ax["x"], ax["d"] / 2, side * g, side, w, spokes=ax.get("spokes", 0))
        # axle between the wheels
        b.tube((ax["x"], ax["d"] / 2), ax["d"] * 0.07, 0, -g, g, "hub", n=12)
    return b.finish()


def skirts(name, items, tile_m, shading):
    """Inboard frame plates, rigid with the body: [{x: [x0, x1], bottom, top, inset, color}] in final metres."""
    g = half_gauge_m(tile_m)
    lat = g / REAL_HALF_RAILS
    b = Builder(name, {f"k{i}": np.array(it["color"]) / 255 for i, it in enumerate(items)}, shading)
    for i, it in enumerate(items):
        x0, x1 = it["x"]
        y = g - it.get("inset", 0.3) * lat
        for side in (-1, 1):
            b.box(((x0 + x1) / 2, side * y, (it["bottom"] + it["top"]) / 2),
                  (x1 - x0, 0.08 * lat, it["top"] - it["bottom"]), f"k{i}")
        b.box(((x0 + x1) / 2, 0, it["top"] - 0.05), (x1 - x0, 2 * y, 0.1), f"k{i}")
    return b.finish()


def cut_box(ob, x0, x1, z_top):
    """Delete ob's faces whose centre lies between x0 and x1 and below z_top (mesh frame, all across)."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    dead = [f for f in bm.faces
            if x0 <= (c := f.calc_center_median()).x <= x1 and c.z < z_top]
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bm.to_mesh(me)
    bm.free()
    return len(dead)


def cut_wheels(ob, axles, y_inner, y_center=0.0, margin=1.15):
    """Delete the faces of ob's own wheels: everything outboard of |y - y_center| = y_inner within a
    box of margin wheel radii round each axle (a reconstructed wheel is often tilted or off its
    measured circle, so a tight cylinder leaves slivers of it). axles = [{x, z, d}] in ob's frame."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    dead = []
    for f in bm.faces:
        c = f.calc_center_median()
        if abs(c.y - y_center) < y_inner:
            continue
        for ax in axles:
            r = ax["d"] / 2 * margin
            if abs(c.x - ax["x"]) < r and c.z < ax["z"] + r:
                dead.append(f)
                break
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bm.to_mesh(me)
    bm.free()
    return len(dead)


# ---------------- bogies ----------------
REAL_HALF_RAILS = 0.7525  # half the real rail-centre spacing, m (1435 mm gauge + one rail head)


def bogie(name, spec, tile_m, colors, shading):
    """A bogie or wheel group from its spec (bogies.json: real metres, x from the group's middle axle
    or centre, + towards the vehicle's front), built in the final game frame with the pivot the game
    hangs it at as origin. Along the track everything is scaled by x_scale (the compression of the
    vehicles it rides under), heights and wheel sizes by scale, so wheels stay round; across, the wheels
    sit on the game's rails and every other part keeps its real distance from them, widened as the
    gauge is. offset_m (final metres) draws the group that far ahead of its pivot."""
    s, sx = spec["scale"], spec["x_scale"]
    off = spec.get("offset_m", 0.0)
    g = half_gauge_m(tile_m)
    lat = g / REAL_HALF_RAILS
    b = Builder(name, colors, shading)

    def X(x):
        return off + x * sx

    def Y(dy):  # real metres outboard of the rail centre -> final y on the +Y side
        return g + dy * lat

    w = {"scale": s}
    axles = spec["axles"]
    def D(ax):  # wheel diameter in the game frame: given (d_f) or real times scale
        return ax.get("d_f", ax.get("d", 0) * s)

    for ax in axles:
        r = D(ax) / 2
        for side in (-1, 1):
            wheel(b, X(ax["x"]), r, side * g, side, w, spokes=ax.get("spokes", 0))
        b.tube((X(ax["x"]), r), max(r * 0.12, 0.05), 0, -g, g, "hub", n=12)

    fr = spec.get("frame")
    if fr:
        x0, x1 = X(fr["x0"]), X(fr["x1"])
        zb = fr["bottom_f"] if "bottom_f" in fr else fr["bottom"] * s
        zt = fr["top_f"] if "top_f" in fr else fr["top"] * s
        th = fr.get("thick", 0.08) * lat
        kind = fr["type"]
        if kind == "plate_inside":
            # steam: plate frames inboard of the wheels, from the axles up to the running plate
            y = Y(-fr.get("inset", 0.28))
            for side in (-1, 1):
                b.box(((x0 + x1) / 2, side * y, (zb + zt) / 2), (x1 - x0, th, zt - zb), "frame")
            for side in (-1, 1):  # frame stretchers show between the wheels
                b.box(((x0 + x1) / 2, 0, zt - 0.08 * s), (x1 - x0, 2 * y, 0.1 * s), "frame")
        else:
            y = Y(fr.get("out", 0.2))
            for side in (-1, 1):
                if kind == "cast_side":
                    # cast side frame: bottom and top chords, pedestals at the axles
                    hb = fr.get("chord", 0.16) * s
                    b.box(((x0 + x1) / 2, side * y, zb + hb / 2), (x1 - x0, th, hb), "frame")
                    b.box(((x0 + x1) / 2, side * y, zt - hb / 2), ((x1 - x0) * 0.9, th, hb), "frame")
                    for ax in axles:
                        b.box((X(ax["x"]), side * y, (zb + zt) / 2), (0.34 * s, th, zt - zb), "frame")
                    for xm in fr.get("posts", []):
                        b.box((X(xm), side * y, (zb + zt) / 2), (0.26 * s, th, zt - zb), "frame")
                else:  # plate_outside: a solid outside frame plate with cut-outs left to the wheels
                    b.box(((x0 + x1) / 2, side * y, zt - (zt - zb) * 0.3), (x1 - x0, th, (zt - zb) * 0.6), "frame")
                    for ax in axles:
                        b.box((X(ax["x"]), side * y, (zb + zt) / 2), (0.3 * s, th, zt - zb), "frame")
            # transoms / bolster across between the side frames
            for xm in fr.get("cross", [0.0]):
                b.box((X(xm), 0, (zb + zt) / 2), (0.34 * s, 2 * y, (zt - zb) * 0.55), "frame")

    bx = spec.get("boxes")  # axle boxes outside the wheels
    if bx:
        for ax in axles:
            r = D(ax) / 2
            for side in (-1, 1):
                b.box((X(ax["x"]), side * Y(bx.get("out", 0.2) + 0.02), r),
                      (bx["w"] * s, bx.get("depth", 0.14) * lat, bx["h"] * s), "detail")
    sp = spec.get("springs")
    if sp:
        for x, z0, z1 in sp.get("coil", []):
            for side in (-1, 1):
                for k in (-1, 1):
                    b.post((X(x) + k * sp.get("pair", 0.12) * s, side * Y(sp.get("out", 0.2) + 0.03)),
                           sp.get("r", 0.09) * s, z0 * s, z1 * s, "spring")
        for x, z, length in sp.get("leaf", []):
            for side in (-1, 1):
                for k in range(3):  # a stack of leaves, shortest on top
                    b.box((X(x), side * Y(sp.get("out", 0.2) + 0.03), (z + 0.045 * k) * s),
                          ((length - 0.25 * k) * sx, 0.1 * lat, 0.05 * s), "spring")

    rods = spec.get("rods")
    if rods:
        # coupled wheels: crank pins at the same angle, a coupling rod through them, a connecting rod
        # from the crosshead behind the cylinder to one driver, the cylinder outside the frames
        drivers = [ax for ax in axles if ax.get("driver")]
        th = math.radians(rods.get("crank_deg", -40))
        c = rods["crank"] * s
        pins = [(X(ax["x"]) + c * math.cos(th), D(ax) / 2 + c * math.sin(th)) for ax in drivers]
        for side in (-1, 1):
            yp, yc, yr = side * Y(0.16), side * Y(0.24), side * Y(0.3)
            for px, pz in pins:
                b.tube((px, pz), 0.07 * s, 0, min(yp, yc), max(yp, yc), "rod", n=12)
            (pa, za), (pb, zb2) = pins[0], pins[-1]
            b.rod((pa, yc, za), (pb, yc, zb2), (0.06 * lat, 0.13 * s), "rod")
            xh = rods.get("crosshead")
            if xh:
                # the cylinder stays with the body; the crosshead, slide bar and connecting rod swing here
                hx, hz = X(xh["x"]), xh["z_f"]
                b.rod((hx, yr, hz + 0.1 * s), (hx + xh.get("bar", 0.9) * sx, yr, hz + 0.1 * s),
                      (0.05 * lat, 0.06 * s), "rod")
                b.box((hx, yr, hz), (0.24 * s, 0.08 * lat, 0.24 * s), "rod")
                tx, tz = pins[rods.get("connect", 1)]
                b.rod((hx, yr, hz), (tx, yr, tz), (0.06 * lat, 0.14 * s), "rod")
            cyl = rods.get("cylinder")
            if cyl:
                cz = cyl["z"] * s
                cx0, cx1 = X(cyl["x"] - cyl["len"] / 2), X(cyl["x"] + cyl["len"] / 2)
                b.barrel((side * Y(cyl.get("out", 0.32)), cz), cyl["d"] / 2 * s, cx0, cx1, "detail")
                # slide bars and crosshead, then the connecting rod to its driver
                head = X(cyl["x"] - cyl["len"] / 2 - rods.get("stroke", 0.9))
                b.rod((cx0, yr, cz + 0.08 * s), (head, yr, cz + 0.08 * s), (0.05 * lat, 0.05 * s), "rod")
                b.box((head, yr, cz), (0.22 * s, 0.08 * lat, 0.22 * s), "rod")
                tx, tz = pins[rods.get("connect", 1)]
                b.rod((head, yr, cz), (tx, yr, tz), (0.06 * lat, 0.14 * s), "rod")
    return b.finish()

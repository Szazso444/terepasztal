"""Shared asset kit: the style, as code.

Every asset program imports this module and builds from it, so consistency is structural rather
than judged. The palette mirrors src/art/palette.ts, the camera is the rig documented in
docs/mcp-setup.md section 6.3, and the light is one warm key from screen upper-left with a cool
sky fill. Change the look here, once, and every asset follows.

Only the Blender data API is used, never operators, so the programs run the same under the `bpy`
pip module and under `blender --background`. Geometry is built from explicit vertices; materials
are looked up by node type, never by localised name.
"""

import math

import bpy


# --- palette (src/art/palette.ts), sRGB 0-255 -> linear -----------------------------------------
def _lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def srgb(r, g, b):
    return (_lin(r), _lin(g), _lin(b), 1.0)


PAL = {
    "limestone": srgb(188, 169, 139),
    "trim": srgb(206, 190, 162),
    "slate": srgb(98, 107, 108),
    "roof": srgb(154, 88, 62),
    "timber": srgb(158, 116, 70),
    "timber_dark": srgb(112, 80, 50),
    "iron": srgb(86, 96, 102),
    "brass": srgb(214, 172, 92),
    "amber": srgb(232, 170, 72),
    "copper": srgb(163, 107, 66),
    "brick": srgb(166, 96, 66),
    "ballast": srgb(152, 146, 134),
    "rail": srgb(128, 132, 136),
    "grass": srgb(122, 146, 76),
    "white": srgb(236, 228, 208),
}

# roughness per material; anything glowing lists an emission strength
_ROUGH = {"iron": 0.5, "rail": 0.35, "slate": 0.7, "trim": 0.8, "white": 0.8, "grass": 1.0}
_EMIT = {"amber": 1.6}


class Kit:
    """One kit instance per render: owns the scene, the collection and the material cache."""

    def __init__(self):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.scene = bpy.context.scene
        self.coll = self.scene.collection
        self._mats = {}

    # -- materials -------------------------------------------------------------------------------
    def mat(self, name):
        if name in self._mats:
            return self._mats[name]
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bsdf.inputs["Base Color"].default_value = PAL[name]
        bsdf.inputs["Roughness"].default_value = _ROUGH.get(name, 0.85)
        if name in _EMIT:
            bsdf.inputs["Emission Color"].default_value = PAL[name]
            bsdf.inputs["Emission Strength"].default_value = _EMIT[name]
        self._mats[name] = m
        return m

    # -- primitives, built from explicit verts (data API only) -----------------------------------
    def box(self, name, size, loc, mat):
        """Axis-aligned box of (x,y,z) size, centred on loc in x/y and sitting on loc.z."""
        sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
        cx, cy, cz = loc[0], loc[1], loc[2] + sz
        v = [
            (cx + dx * sx, cy + dy * sy, cz + dz * sz)
            for dz in (-1, 1)
            for dy in (-1, 1)
            for dx in (-1, 1)
        ]
        f = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        return self._mesh(name, v, f, mat)

    def roof(self, name, length, width, base_z, ridge, loc, mat):
        """Pitched roof: two slopes meeting a ridge along +x, its eaves at base_z on loc."""
        hl, hw = length / 2, width / 2
        z = loc[2] + base_z
        v = [
            (loc[0] - hl, loc[1] - hw, z),
            (loc[0] + hl, loc[1] - hw, z),
            (loc[0] + hl, loc[1] + hw, z),
            (loc[0] - hl, loc[1] + hw, z),
            (loc[0] - hl, loc[1], z + ridge),
            (loc[0] + hl, loc[1], z + ridge),
        ]
        f = [(0, 1, 5, 4), (3, 2, 5, 4), (0, 4, 3), (1, 2, 5)]
        return self._mesh(name, v, f, mat)

    def cylinder(self, name, cx, cy, r, base_z, h, mat, seg=16):
        """Upright prism approximating a cylinder: chimney, tank, windmill tower."""
        ring = [(cx + r * math.cos(a), cy + r * math.sin(a)) for a in _angles(seg)]
        v = [(x, y, base_z) for x, y in ring] + [(x, y, base_z + h) for x, y in ring]
        f = [(i, (i + 1) % seg, seg + (i + 1) % seg, seg + i) for i in range(seg)]
        f.append(tuple(range(seg)))  # bottom
        f.append(tuple(range(2 * seg - 1, seg - 1, -1)))  # top
        return self._mesh(name, v, f, mat)

    def panel(self, name, center, u, v, mat):
        """A flat quad centred on `center`, spanning center +-u +-v (u, v world half-edges).

        Unlike box/roof this takes an arbitrary orientation, so a sail or blade can be built in the
        camera's picture plane rather than aligned to the world axes.
        """
        cx, cy, cz = center
        ux, uy, uz = u
        vx, vy, vz = v
        verts = [
            (cx - ux - vx, cy - uy - vy, cz - uz - vz),
            (cx + ux - vx, cy + uy - vy, cz + uz - vz),
            (cx + ux + vx, cy + uy + vy, cz + uz + vz),
            (cx - ux + vx, cy - uy + vy, cz - uz + vz),
        ]
        return self._mesh(name, verts, [(0, 1, 2, 3)], mat)

    def _mesh(self, name, verts, faces, mat):
        me = bpy.data.meshes.new(name)
        me.from_pydata(verts, [], faces)
        me.validate()
        me.polygons.foreach_set("use_smooth", [False] * len(me.polygons))
        ob = bpy.data.objects.new(name, me)
        self.coll.objects.link(ob)
        ob.data.materials.append(self.mat(mat))
        return ob

    # -- the fixed rig ---------------------------------------------------------------------------
    def light(self, sun_deg=150.0, elev_deg=48.0, fill=0.5, energy=7.5):
        """One warm key from screen upper-left, plus a cool sky fill so shadows read, not go black.

        The defaults light the camera-facing walls; slate roofs stay dark, as slate should.
        """
        d = bpy.data.lights.new("key", type="SUN")
        d.energy = energy
        d.angle = math.radians(6)
        d.color = (1.0, 0.96, 0.88)
        ob = bpy.data.objects.new("key", d)
        self.coll.objects.link(ob)
        ob.rotation_euler = (math.radians(elev_deg), 0.0, math.radians(sun_deg))
        w = bpy.data.worlds.new("sky")
        w.use_nodes = True
        bg = w.node_tree.nodes["Background"]
        # a warm-neutral sky bounce: a cold blue fill greys the limestone and slate out of the
        # pastoral warmth the boards carry, so the fill leans to daylight, not to shade.
        bg.inputs[0].default_value = srgb(196, 194, 182)
        bg.inputs[1].default_value = fill
        self.scene.world = w

    def camera(self, px_per_tile, render_px):
        """The 2:1 iso rig from docs/mcp-setup.md 6.3: one Blender unit projects to one tile."""
        d = bpy.data.cameras.new("iso")
        d.type = "ORTHO"
        d.ortho_scale = render_px * math.sqrt(2) / px_per_tile
        ob = bpy.data.objects.new("iso", d)
        self.coll.objects.link(ob)
        ob.rotation_euler = (math.radians(60), 0.0, math.radians(45))
        ob.location = (12, -12, 9.8)
        self.scene.camera = ob
        return ob

    def render(self, out, render_px, samples=160):
        s = self.scene
        s.render.engine = "CYCLES"
        s.cycles.device = "CPU"
        s.cycles.samples = samples
        s.cycles.use_denoising = True
        s.render.resolution_x = render_px
        s.render.resolution_y = render_px
        s.render.film_transparent = True
        s.render.filepath = out
        s.render.image_settings.file_format = "PNG"
        s.render.image_settings.color_mode = "RGBA"
        s.view_settings.view_transform = "Standard"  # keep the palette exactly as authored
        bpy.ops.render.render(write_still=True)


def _angles(n):
    return [2 * math.pi * i / n for i in range(n)]

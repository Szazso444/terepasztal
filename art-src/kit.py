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

# bmesh is a submodule of the Blender runtime: importable only once bpy has loaded it, so this
# import stays below bpy and out of the alphabetical block above.
import bmesh  # noqa: E402


# --- palette (src/art/palette.ts), sRGB 0-255 -> linear -----------------------------------------
def _lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def srgb(r, g, b):
    return (_lin(r), _lin(g), _lin(b), 1.0)


def _srgb8(c):
    c = 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
    return max(0, min(255, round(c * 255)))


def to_srgb8(rgba):
    """The inverse of `srgb`: a linear colour back to the sRGB triple it was authored as."""
    return [_srgb8(rgba[0]), _srgb8(rgba[1]), _srgb8(rgba[2])]


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
    # vegetation and stone, from PAL.leaf / PAL.pine / PAL.trunk / PAL.rock in src/art/palette.ts
    "leaf": srgb(90, 134, 68),
    "leaf_pale": srgb(132, 172, 94),
    "conifer": srgb(54, 98, 78),
    "conifer_dark": srgb(42, 80, 66),
    "bark": srgb(112, 80, 50),
    "bark_dark": srgb(78, 54, 34),
    "rock": srgb(140, 136, 126),
}

# roughness per material; anything glowing lists an emission strength
_ROUGH = {
    "iron": 0.5,
    "rail": 0.35,
    "slate": 0.7,
    "trim": 0.8,
    "white": 0.8,
    "grass": 1.0,
    "leaf": 1.0,
    "leaf_pale": 1.0,
    "conifer": 1.0,
    "conifer_dark": 1.0,
    "bark": 0.95,
    "bark_dark": 0.95,
    "rock": 0.9,
}
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

    def blob(self, name, center, r, mat, seg=14, rings=6, squash=1.0, rough=0.0, seed=1):
        """A lumpy sphere: one canopy mass.

        `squash` flattens it in z, `rough` jitters each vertex's radius so a crown reads as
        foliage rather than a billiard ball. The jitter is seeded, so a variant's lumps are the
        same on every machine and every run -- the deterministic variation the art direction asks
        for, expressed once here instead of per asset.
        """
        cx, cy, cz = center
        rng = Rng(seed)

        def j():
            return 1.0 + (rng.f() - 0.5) * 2.0 * rough

        verts = [(cx, cy, cz + r * squash * j())]
        for i in range(1, rings):
            phi = math.pi * i / rings
            sp, cp = math.sin(phi), math.cos(phi)
            for t in _angles(seg):
                m = r * j()
                verts.append((cx + m * sp * math.cos(t), cy + m * sp * math.sin(t), cz + m * squash * cp))
        verts.append((cx, cy, cz - r * squash * j()))

        faces = []
        bot = len(verts) - 1
        for x in range(seg):
            faces.append((0, 1 + x, 1 + (x + 1) % seg))
        for i in range(rings - 2):
            a, b = 1 + i * seg, 1 + (i + 1) * seg
            for x in range(seg):
                y = (x + 1) % seg
                faces.append((a + x, b + x, b + y, a + y))
        a = 1 + (rings - 2) * seg
        for x in range(seg):
            faces.append((bot, a + (x + 1) % seg, a + x))
        return self._mesh(name, verts, faces, mat, recalc=True)

    def cone(self, name, cx, cy, base_z, r, h, mat, seg=14):
        """An upright cone: one tier of a conifer, or a whole spruce."""
        ring = [(cx + r * math.cos(a), cy + r * math.sin(a)) for a in _angles(seg)]
        verts = [(x, y, base_z) for x, y in ring] + [(cx, cy, base_z + h)]
        apex = seg
        faces = [(i, (i + 1) % seg, apex) for i in range(seg)]
        faces.append(tuple(range(seg)))
        return self._mesh(name, verts, faces, mat, recalc=True)

    def taper(self, name, base, r0, r1, h, mat, seg=10, lean=(0.0, 0.0)):
        """A tapered prism from `base`, narrowing r0 -> r1 over height h.

        `lean` offsets the top ring in x/y, which is how a trunk bends: a palm's curve, a dead
        tree's tilt, or simply a trunk that is not a perfect post.
        """
        cx, cy, cz = base
        lo = [(cx + r0 * math.cos(a), cy + r0 * math.sin(a), cz) for a in _angles(seg)]
        hi = [
            (cx + lean[0] + r1 * math.cos(a), cy + lean[1] + r1 * math.sin(a), cz + h)
            for a in _angles(seg)
        ]
        verts = lo + hi
        faces = [(i, (i + 1) % seg, seg + (i + 1) % seg, seg + i) for i in range(seg)]
        faces.append(tuple(range(seg)))
        faces.append(tuple(range(2 * seg - 1, seg - 1, -1)))
        return self._mesh(name, verts, faces, mat, recalc=True)

    def _mesh(self, name, verts, faces, mat, recalc=False):
        me = bpy.data.meshes.new(name)
        me.from_pydata(verts, [], faces)
        me.validate()
        if recalc:
            # blob/cone/taper wind their faces from a loop rather than a hand-checked table, so
            # let bmesh settle the normals outward. The hand-wound primitives are left alone.
            bm = bmesh.new()
            bm.from_mesh(me)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.to_mesh(me)
            bm.free()
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
        # The frame has to be square before anything measures against it: world_to_camera_view
        # corrects for the render aspect ratio, so the snap below would read a point's position
        # against Blender's default 16:9 frame if the resolution waited for render().
        self.scene.render.resolution_x = render_px
        self.scene.render.resolution_y = render_px
        ob = bpy.data.objects.new("iso", d)
        self.coll.objects.link(ob)
        ob.rotation_euler = (math.radians(60), 0.0, math.radians(45))
        ob.location = (12, -12, 9.8)
        self.scene.camera = ob
        self._snap_to_pixel(ob, render_px)
        return ob

    def _snap_to_pixel(self, cam, render_px):
        """Nudge the camera so the world origin projects onto a whole pixel.

        The rig's rotation and ortho_scale set the projection; where the camera sits only chooses
        what is centred, and that freedom is otherwise spent on nothing. The hand-picked position
        misses the origin by a sixth of a pixel, which is enough to give every baked frame a
        fractional anchor while every procedural frame's is a whole number. Spending the freedom
        here lands it on the grid instead.
        """
        from bpy_extras.object_utils import world_to_camera_view
        from mathutils import Vector

        self.scene.view_layers[0].update()
        ndc = world_to_camera_view(self.scene, cam, Vector((0.0, 0.0, 0.0)))
        px, py = ndc.x * render_px, (1.0 - ndc.y) * render_px
        u = cam.data.ortho_scale / render_px  # world units per rendered pixel
        q = cam.matrix_world.to_quaternion()
        # moving the camera right pushes the projected origin left, and up pushes it down
        cam.location += (q @ Vector((1.0, 0.0, 0.0))) * ((px - round(px)) * u)
        cam.location -= (q @ Vector((0.0, 1.0, 0.0))) * ((py - round(py)) * u)
        self.scene.view_layers[0].update()

    def id_render(self, out, render_px):
        """Render a flat material pass: every material a solid emitter of its own index.

        The snap that turns a render into pixel art has to know which material each pixel came
        from. Guessing it from the lit colour is what makes a sunlit leaf snap to cream and a
        shadowed limestone wall snap to slate; docs/art-pipeline.md asks for the lighting rules to
        be read from a material pass rather than guessed from colour, and this is that pass.

        Destroys the materials it encodes, so it runs after the beauty render and nothing else
        runs after it. Returns the index -> material name mapping.
        """
        names = list(self._mats)
        for i, n in enumerate(names, start=1):
            nt = self._mats[n].node_tree
            nt.nodes.clear()
            em = nt.nodes.new("ShaderNodeEmission")
            em.inputs[0].default_value = srgb(i, 0, 0)  # inputs by index: names are localised
            em.inputs[1].default_value = 1.0
            mo = nt.nodes.new("ShaderNodeOutputMaterial")
            nt.links.new(em.outputs[0], mo.inputs[0])

        # no key and no sky: only the emitters contribute, so an index survives the render exactly
        for ob in [o for o in self.coll.objects if o.type == "LIGHT"]:
            self.coll.objects.unlink(ob)
        if self.scene.world:
            bg = next(n for n in self.scene.world.node_tree.nodes if n.type == "BACKGROUND")
            bg.inputs[1].default_value = 0.0

        s = self.scene
        s.cycles.samples = 1
        s.cycles.use_denoising = False
        # emitters would otherwise light each other, and a leaf lit by a paler leaf decodes as an
        # index that does not exist; with no bounces a ray reports the emission it hit, nothing else
        s.cycles.max_bounces = 0
        s.cycles.diffuse_bounces = 0
        s.cycles.glossy_bounces = 0
        s.cycles.transmission_bounces = 0
        # dithering is +-1 on every 8-bit channel, which is +-1 on every index
        s.render.dither_intensity = 0.0
        # no pixel filter: a blended edge pixel would decode as a material that is not there
        s.render.filter_size = 0.01
        s.render.filepath = out
        bpy.ops.render.render(write_still=True)
        return {i: n for i, n in enumerate(names, start=1)}

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


class Rng:
    """A tiny deterministic LCG, so seeded variation is reproducible across machines and runs.

    Python's `random` would do, but its stream is an implementation detail; this one is the
    contract, in the same spirit as the golden hashes in src/world/mapgen.test.ts.
    """

    def __init__(self, seed):
        self.s = (int(seed) * 1103515245 + 12345) & 0x7FFFFFFF

    def f(self):
        """The next float in [0, 1)."""
        self.s = (self.s * 1103515245 + 12345) & 0x7FFFFFFF
        return self.s / 0x80000000

    def r(self, a, b):
        """The next float in [a, b)."""
        return a + (b - a) * self.f()

    def pick(self, seq):
        return seq[int(self.f() * len(seq)) % len(seq)]

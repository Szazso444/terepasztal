"""Bring an existing mesh into the kit, so a model becomes an asset the game can bake.

The pipeline only ever accepted programs. This is the other door: a mesh from anywhere -- an
image-to-3D generator run locally, a CC0 download, something modelled by hand -- normalised onto
the tile and repainted in the palette, after which every stage downstream works unchanged, because
they only ever cared about material names.

A mesh asset is still a program, and still the tracked source:

    from mesh_asset import mesh

    MESH = "art-src/meshes/oak.glb"
    SHADOW_R = 0.3

    def build(k, v=0):
        mesh(k, MESH, size=0.72, yaw=35, materials=["leaf", "leaf_pale", "bark", "bark_dark"])

What the program records is everything about the mesh that is a decision: how big it is on the
tile, which way it faces, and which part of the palette it is allowed to use. The mesh file itself
is an input, like a reference image.

Two things this does not do. It does not decimate: Cycles renders a dense mesh fine at 512 px, and
throwing away triangles before the silhouette is baked can only lose. And it does not guess the
up axis -- the importers handle their own conventions, and `yaw` is for the one decision they
cannot make, which is where the front is.
"""

import math
from pathlib import Path

import bpy

import bmesh  # noqa: E402  (bmesh loads with the Blender runtime, so it follows bpy)

import kit as kitmod  # noqa: E402

from mathutils import Matrix  # noqa: E402

_IMPORTERS = {
    ".glb": lambda p: bpy.ops.import_scene.gltf(filepath=p),
    ".gltf": lambda p: bpy.ops.import_scene.gltf(filepath=p),
    ".obj": lambda p: bpy.ops.wm.obj_import(filepath=p),
    ".fbx": lambda p: bpy.ops.import_scene.fbx(filepath=p),
    ".ply": lambda p: bpy.ops.wm.ply_import(filepath=p),
    ".stl": lambda p: bpy.ops.wm.stl_import(filepath=p),
}


def mesh(k, path, size=1.0, yaw=0.0, materials=None, lift=0.0):
    """Import `path`, stand it on the tile origin and repaint it in the kit palette.

    `size` is the footprint in tiles: the mesh's larger horizontal extent becomes this, scaled
    uniformly so the subject keeps its own proportions. `yaw` turns it about the tile's vertical
    axis in degrees. `materials` is the part of the palette this asset may use -- a tree that can
    only resolve to leaf and bark cannot come out with a slate crown, which is the same guarantee
    the material pass gives a program. `lift` raises it off the ground, for something that hangs.
    """
    before = set(bpy.data.objects)
    ext = Path(path).suffix.lower()
    if ext not in _IMPORTERS:
        raise ValueError(f"mesh_asset: no importer for {ext} ({path})")
    if not Path(path).exists():
        raise FileNotFoundError(f"mesh_asset: {path}")
    _IMPORTERS[ext](str(Path(path).resolve()))

    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == "MESH"]
    if not meshes:
        raise ValueError(f"mesh_asset: {path} contained no mesh")
    for o in imported:
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)

    for ob in meshes:
        _bake_transform(ob)
    _place(meshes, size, yaw, lift)
    for ob in meshes:
        _repaint(k, ob, materials)
        if ob.name not in k.coll.objects:
            k.coll.objects.link(ob)
    return meshes


def _bake_transform(ob):
    """Fold the object's transform into its vertices, so later maths is in world coordinates.

    bpy.ops.object.transform_apply needs a context this process does not have in background, and
    bmesh does the same job from the data API.
    """
    if ob.matrix_world == Matrix.Identity(4):
        return
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.transform(bm, matrix=ob.matrix_world, verts=bm.verts)
    bm.to_mesh(ob.data)
    bm.free()
    ob.matrix_world = Matrix.Identity(4)


def _place(meshes, size, yaw, lift):
    """Turn, scale and stand the mesh: footprint `size` tiles, ground contact on the tile origin."""
    rot = Matrix.Rotation(math.radians(yaw), 4, "Z")
    for ob in meshes:
        _apply(ob, rot)

    lo, hi = _bounds(meshes)
    span = max(hi[0] - lo[0], hi[1] - lo[1])
    if span <= 0:
        raise ValueError("mesh_asset: the mesh has no horizontal extent")
    s = size / span
    # scale about the world origin, then move the footprint centre to it and the base onto z = 0.
    # The origin is where the render measures its anchor, so this is what pins the asset to a tile.
    for ob in meshes:
        _apply(ob, Matrix.Scale(s, 4))
    lo, hi = _bounds(meshes)
    shift = Matrix.Translation(
        (-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2] + lift)
    )
    for ob in meshes:
        _apply(ob, shift)


def _apply(ob, matrix):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    bm.to_mesh(ob.data)
    bm.free()


def _bounds(meshes):
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for ob in meshes:
        for v in ob.data.vertices:
            for i in range(3):
                lo[i] = min(lo[i], v.co[i])
                hi[i] = max(hi[i], v.co[i])
    return lo, hi


# --- repainting ---------------------------------------------------------------------------------
def _repaint(k, ob, allowed):
    """Assign every face a kit material, chosen from the colour the mesh already carries.

    This is the step that lets an imported mesh through the rest of the pipeline. The material
    pass in kit.id_render needs every surface to belong to a named palette material; a generated
    mesh arrives with one textured material, or a handful of arbitrary colours, and neither is in
    the palette.

    Reading the colour off the mesh's own albedo is not the failure the banding used to have.
    That one guessed a material from a *lit* pixel, after shading had already moved it. This reads
    the flat surface colour the model was authored with, once per face, before any light exists.
    """
    names = list(allowed or kitmod.PAL)
    unknown = [n for n in names if n not in kitmod.PAL]
    if unknown:
        raise ValueError(f"mesh_asset: not palette materials: {', '.join(unknown)}")

    samplers = [_sampler(m) for m in ob.data.materials] or [lambda uv: (128, 128, 128)]
    me = ob.data
    uv = me.uv_layers.active
    vcol = me.color_attributes.active_color if me.color_attributes else None

    # one kit material per family, in a fixed order, so face indices below line up with the slots
    me.materials.clear()
    for n in names:
        me.materials.append(k.mat(n))
    slot = {n: i for i, n in enumerate(names)}

    for poly in me.polygons:
        sample = samplers[min(poly.material_index, len(samplers) - 1)]
        rgb = sample(_face_uv(me, poly, uv)) if uv else sample(None)
        if rgb is None and vcol is not None:
            rgb = _face_vcol(me, poly, vcol)
        poly.material_index = slot[_nearest(rgb or (128, 128, 128), names)]


def _face_uv(me, poly, uv):
    """The face's UV centroid, which is a fair stand-in for a face this small on screen."""
    u = v = 0.0
    for li in poly.loop_indices:
        c = uv.data[li].uv
        u += c[0]
        v += c[1]
    n = len(poly.loop_indices)
    return (u / n, v / n)


def _face_vcol(me, poly, vcol):
    acc = [0.0, 0.0, 0.0]
    for li in poly.loop_indices:
        c = vcol.data[li].color
        for i in range(3):
            acc[i] += c[i]
    n = len(poly.loop_indices)
    return kitmod.to_srgb8([x / n for x in acc])


def _sampler(mat):
    """A function(uv) -> sRGB triple for one of the imported mesh's materials.

    Looked up by node type, never by name: node names are localised, and a mesh from someone
    else's Blender is exactly where that bites.
    """
    if mat is None or not mat.use_nodes:
        base = getattr(mat, "diffuse_color", (0.5, 0.5, 0.5, 1.0)) if mat else (0.5, 0.5, 0.5, 1.0)
        rgb = kitmod.to_srgb8(base)
        return lambda uv: rgb

    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        emit = next((n for n in mat.node_tree.nodes if n.type == "EMISSION"), None)
        rgb = kitmod.to_srgb8(emit.inputs[0].default_value) if emit else (128, 128, 128)
        return lambda uv: rgb

    base_in = bsdf.inputs["Base Color"] if "Base Color" in bsdf.inputs else bsdf.inputs[0]
    if base_in.is_linked:
        node = base_in.links[0].from_node
        if node.type == "TEX_IMAGE" and node.image:
            return _image_sampler(node.image)
    rgb = kitmod.to_srgb8(base_in.default_value)
    return lambda uv: rgb


def _image_sampler(img):
    """Point-sample an image by UV. The pixels are read once; a 2k texture is 16M floats."""
    import numpy as np

    w, h = img.size
    if w == 0 or h == 0:
        return lambda uv: (128, 128, 128)
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    buf = buf.reshape(h, w, 4)  # row 0 is the bottom of the image, as Blender stores it

    def sample(uv):
        if uv is None:
            return None
        x = min(w - 1, max(0, int(uv[0] % 1.0 * w)))
        y = min(h - 1, max(0, int(uv[1] % 1.0 * h)))
        return kitmod.to_srgb8(buf[y, x, :3])

    return sample


def _oklab(rgb):
    """sRGB 0-255 to OKLab, for a colour distance that is about colour rather than brightness.

    Straight RGB distance is dominated by lightness, and it gets this exact job wrong: a light
    brown trunk sits nearer a bright green than it does to dark bark, so an imported tree comes out
    with a green trunk. OKLab separates lightness from hue, which is the whole reason to pay for
    the conversion. Coefficients are Ottosson's.
    """
    c = []
    for v in rgb[:3]:
        v /= 255.0
        c.append(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4)
    r, g, b = c
    lo = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    mo = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    so = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    lo, mo, so = lo ** (1 / 3), mo ** (1 / 3), so ** (1 / 3)
    return (
        0.2104542553 * lo + 0.7936177850 * mo - 0.0040720468 * so,
        1.9779984951 * lo - 2.4285922050 * mo + 0.4505937099 * so,
        0.0259040371 * lo + 0.7827717662 * mo - 0.8086757660 * so,
    )


# Lightness counts for less than hue: which family a surface belongs to is a question about its
# colour, and the render decides its lightness afterwards anyway.
_L_WEIGHT = 0.5


def _nearest(rgb, names):
    """The palette family owning the shade closest to `rgb`.

    Every shade competes, not just the base, so a dark green finds the conifer family through its
    shadow shade rather than being pulled to whichever base happens to be nearest in lightness.
    """
    q = _oklab(rgb)
    best = names[0]
    bd = float("inf")
    for n in names:
        for shade in kitmod.PAL[n]:
            p = _oklab(shade)
            d = (_L_WEIGHT * (q[0] - p[0])) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2
            if d < bd:
                bd = d
                best = n
    return best

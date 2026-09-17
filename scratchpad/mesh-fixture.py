"""Stand in for an image-to-3D generator's output, so art-src/mesh_asset.py can be tested without one.

    <bpy python> scratchpad/mesh-fixture.py art-src/meshes

then point a mesh asset program at art-src/meshes/tree_tex.glb and bake it as usual. The point is
that the import path can be exercised on a machine with no GPU and no generator installed, and
that what it is exercised on is hostile in the ways real generator output is hostile.

Two files, the two shapes this kind of tool actually emits:
  tree_tex.glb  one UV-mapped mesh with a baked colour texture   (Hunyuan3D with its texture stage)
  tree_mat.glb  several plainly coloured materials, no texture   (an untextured gen, Poly Pizza)

Both are deliberately hostile to the pipeline: metres-scale, origin floating well off the ground,
turned to a random yaw, and coloured nowhere near the game palette.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "art-src"))
import kit as kitmod

import bpy
import bmesh

OUT = Path(sys.argv[1])
GARISH = {"canopy": (0.15, 0.62, 0.11), "canopy2": (0.36, 0.78, 0.20), "trunk": (0.42, 0.26, 0.12)}


def flat_mat(name, rgb):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*rgb, 1.0)
    return m


def band_texture():
    """A tiny image: brown at the bottom, two greens above. Colours no palette family owns."""
    w = h = 64
    img = bpy.data.images.new("bark_leaf", w, h)
    px = []
    for y in range(h):
        for _ in range(w):
            c = GARISH["trunk"] if y < h * 0.35 else (GARISH["canopy"] if y < h * 0.7 else GARISH["canopy2"])
            px.extend([*c, 1.0])
    img.pixels.foreach_set(px)
    return img


def build_tree(k):
    k.taper("trunk", (0.0, 0.0, 0.0), 0.06, 0.04, 0.30, "bark", seg=10)
    k.blob("crown", (0.0, 0.0, 0.52), 0.26, "leaf", seg=18, rings=8, squash=0.9, rough=0.12, seed=5)
    k.blob("crown2", (0.10, -0.06, 0.62), 0.17, "leaf", seg=16, rings=7, squash=0.9, rough=0.14, seed=9)


def mangle(scale=3.7, yaw=37.0, lift=1.9):
    """Metres, a random turn and a floating origin: the state a generated asset arrives in."""
    from mathutils import Matrix
    m = Matrix.Translation((0.4, -0.7, lift)) @ Matrix.Rotation(math.radians(yaw), 4, "Z") @ Matrix.Scale(scale, 4)
    for ob in list(bpy.data.objects):
        if ob.type != "MESH":
            continue
        bm = bmesh.new(); bm.from_mesh(ob.data)
        bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
        bm.to_mesh(ob.data); bm.free()


def export(path):
    for o in bpy.data.objects:
        o.select_set(o.type == "MESH")
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=True)


# --- the plain-materials variant --------------------------------------------------------------
k = kitmod.Kit()
build_tree(k)
for ob in bpy.data.objects:
    if ob.type != "MESH":
        continue
    ob.data.materials.clear()
    ob.data.materials.append(flat_mat(ob.name, GARISH["trunk" if "trunk" in ob.name else "canopy"]))
mangle()
export(OUT / "tree_mat.glb")

# --- the textured variant ----------------------------------------------------------------------
k = kitmod.Kit()
build_tree(k)
img = band_texture()
m = bpy.data.materials.new("baked")
m.use_nodes = True
nt = m.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
tex = nt.nodes.new("ShaderNodeTexImage")
tex.image = img
nt.links.new(tex.outputs[0], bsdf.inputs["Base Color"])
for ob in bpy.data.objects:
    if ob.type != "MESH":
        continue
    me = ob.data
    me.materials.clear()
    me.materials.append(m)
    # UV from world height, so the texture's bands land on trunk and canopy the way a bake would
    zs = [v.co.z for v in me.vertices]
    lo, hi = min(zs), max(zs)
    uvl = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li in poly.loop_indices:
            z = me.vertices[me.loops[li].vertex_index].co.z
            uvl.data[li].uv = (0.5, (z - lo) / max(1e-6, hi - lo) * 0.98 + 0.01)
mangle()
export(OUT / "tree_tex.glb")
print("WROTE", OUT)

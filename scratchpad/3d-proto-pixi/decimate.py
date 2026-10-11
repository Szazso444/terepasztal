# Blender: raw GLB -> decimated GLBs in the SAME (raw, camera) frame, geometry + uv + normals only.
import bpy, sys, os
args = sys.argv[sys.argv.index("--") + 1:]
src, out_dir = args[0], args[1]
ratios = [float(x) for x in args[2:]]
for ratio in ratios:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    obj = next(o for o in bpy.data.objects if o.type == "MESH")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    n0 = len(obj.data.polygons)
    mod = obj.modifiers.new("dec", "DECIMATE")
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    mod.delimit = {"UV"} if hasattr(mod, "delimit") else set()
    bpy.ops.object.modifier_apply(modifier=mod.name)
    n1 = len(obj.data.polygons)
    name = os.path.splitext(os.path.basename(src))[0]
    out = os.path.join(out_dir, f"{name}.d{int(round(ratio * 100)):02d}.glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_materials="NONE",
                              export_normals=True, export_texcoords=True, export_tangents=False,
                              export_yup=True, use_selection=True, export_apply=True)
    print(f"[decimate] ratio {ratio}: {n0} -> {n1} faces -> {out} ({os.path.getsize(out)} bytes)", flush=True)

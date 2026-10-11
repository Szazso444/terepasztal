"""Scratch: run the pipeline's own Blender stage up to the point where it would render, and export
each sprite set (the processed, cut, symmetrised, proportioned part with its built wheels) as a GLB
instead. Nothing under tools/ or pipeline-out* is written: every output path of the job is redirected.
  blender -b --factory-startup -noaudio --python-exit-code 1 -P export_parts.py -- <job.json> <outdir> [ratios]
"""
import json, os, sys, time
PIPE = "C:/Users/Zso/terepasztal-local/tools/asset-pipeline"
sys.path.insert(0, PIPE)
args = sys.argv[sys.argv.index("--") + 1:]
src_job, outdir = args[0], args[1]
ratios = [float(x) for x in (args[2].split(",") if len(args) > 2 else [])]
os.makedirs(outdir, exist_ok=True)
job = json.load(open(src_job, encoding="utf-8"))
aid = job["asset"]["id"]
job["meta_path"] = f"{outdir}/{aid}.meta.json"
job["sprites_raw_dir"] = outdir
job["debug_dir"] = outdir
if job.get("source"):
    job["source"]["texture"] = f"{outdir}/{aid}_texture.png"
job["render"]["debug_views"] = False
job_path = f"{outdir}/{aid}.job.json"
json.dump(job, open(job_path, "w", encoding="utf-8"))
sys.argv = sys.argv[:sys.argv.index("--") + 1] + [job_path]

import bpy
import numpy as np
from mathutils import Matrix
import blender_stage as bs

T0 = time.time()

def simple_material(m):
    image, color = None, (0.5, 0.5, 0.5, 1.0)
    backface = getattr(m, "use_backface_culling", False)
    if m.node_tree:
        for n in m.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image:
                image = n.image
            if n.type == "RGB":
                color = tuple(n.outputs[0].default_value)
    mat = bpy.data.materials.new(m.name + "_x")
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 1.0
    if image is not None:
        tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = image
        mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = color
    mat.use_backface_culling = backface
    return mat

def export(objs, path, materials=True):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.hide_set(False); o.hide_viewport = False; o.hide_render = False
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=False,
                              export_apply=True, export_tangents=False, export_normals=True, export_texcoords=True,
                              export_materials="EXPORT" if materials else "NONE", export_animations=False)

def fake_render_sets(job, renders, scene_objs, shadow, L, k_px, ss, res_x):
    prep_s = time.time() - T0
    out, report = [], {"id": aid, "prep_seconds": round(prep_s, 1), "tile_m": job["grid"]["tile_m"], "k_px": k_px, "parts": []}
    mats = {}
    for rd in renders:
        part = rd["part"] or "body"
        objs = []
        for ob, M in [(rd["ob"], rd["M"])] + list(rd.get("extras", [])):
            ob.data = ob.data.copy()
            ob.data.transform(Matrix(M))
            ob.matrix_world = Matrix.Identity(4)
            for slot in ob.material_slots:
                if slot.material:
                    if slot.material.name not in mats:
                        mats[slot.material.name] = simple_material(slot.material)
                    slot.material = mats[slot.material.name]
            objs.append(ob)
        bpy.context.view_layer.update()
        path = f"{outdir}/{aid}_{part}.glb"
        export(objs, path)
        tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
        verts = sum(len(o.data.vertices) for o in objs)
        info = {"part": part, "glb": path, "objects": [o.name for o in objs], "tris": tris, "verts": verts,
                "lo": [float(x) for x in rd["lo"]], "hi": [float(x) for x in rd["hi"]], "tiles": rd["tiles"],
                "footprint_m": rd["footprint_m"], "comp": [float(x) for x in rd["comp"]], "variants": []}
        for ratio in ratios:
            dup = []
            for o in objs:
                d = o.copy(); d.data = o.data.copy()
                bpy.context.scene.collection.objects.link(d)
                # only the reconstructed mesh is heavy; built wheels are already light
                if len(d.data.polygons) > 4000:
                    mod = d.modifiers.new("dec", "DECIMATE")
                    mod.ratio = ratio
                    mod.use_collapse_triangulate = True
                dup.append(d)
            vp = f"{outdir}/{aid}_{part}_r{int(ratio * 100):03d}.glb"
            export(dup, vp)
            dg = bpy.context.evaluated_depsgraph_get()
            vt = sum(len(d.evaluated_get(dg).data.polygons) for d in dup)
            info["variants"].append({"ratio": ratio, "glb": vp, "tris": vt})
            for d in dup:
                bpy.data.objects.remove(d)
        report["parts"].append(info)
        out.append({"part": rd["part"], "tiles": rd["tiles"], "footprint_m": rd["footprint_m"], "gear": rd.get("gear"),
                    "profile": rd.get("profile"), "compression": np.asarray(rd["comp"]).round(4).tolist(),
                    "final_dims_m": (rd["hi"] - rd["lo"]).round(3).tolist(), "canvas_px": [0, 0], "anchor_px": [0, 0], "dirs": []})
    report["export_seconds"] = round(time.time() - T0 - prep_s, 1)
    json.dump(report, open(f"{outdir}/{aid}.parts.json", "w"), indent=1)
    bs.log("exported", json.dumps(report)[:400])
    return out

bs.render_sets = fake_render_sets
bs.main()

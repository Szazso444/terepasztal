"""Blender-only renderer for curated, self-contained locomotive parts."""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector


def render(job):
    profile, part = job['profile'], job['part']
    if bpy.app.version_string != profile['blender_version'] or bpy.app.build_hash.decode() != profile['blender_build']:
        raise ValueError('Blender version/build differs from the locked style profile')
    source = Path(part['source'])
    if hashlib.sha256(source.read_bytes()).hexdigest() != part['source_sha256']:
        raise ValueError('Source changed after job preparation')
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene = bpy.context.scene
    # Reset engine-wide settings to defaults of the locked Blender build. A
    # model's saved preview samples, GI or motion blur must not redefine style.
    defaults = bpy.data.scenes.new('Pipeline render defaults')
    for prop in defaults.eevee.bl_rna.properties:
        if prop.type in {'BOOLEAN', 'INT', 'FLOAT', 'ENUM'} and not getattr(prop, 'is_array', False) and not prop.is_readonly:
            setattr(scene.eevee, prop.identifier, getattr(defaults.eevee, prop.identifier))
    bpy.data.scenes.remove(defaults)
    if len(scene.view_layers) != 1:
        raise ValueError('Prepare a single render view layer per model part')
    scene.view_layers[0].material_override = None
    for image in bpy.data.images:
        if image.source == 'FILE' and not image.packed_file:
            raise ValueError(f'Pack external image into the blend: {image.name}')
    if any(c.library for c in bpy.data.collections) or any(o.library for o in bpy.data.objects):
        raise ValueError('Linked libraries must be made local before rendering')
    if any(o.modifiers and any(m.type in {'CLOTH', 'FLUID', 'PARTICLE_SYSTEM'} for m in o.modifiers) for o in scene.objects):
        raise ValueError('Bake simulations into approved geometry first')
    scene.frame_set(part.get('animation_start', 1))
    meshes = [o for o in scene.objects if o.type == 'MESH' and not o.hide_render]
    if not meshes:
        raise ValueError('No renderable mesh in source')
    points = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    length = max(p.x for p in points) - min(p.x for p in points)
    scale = part['length_tiles'] * profile['tile_m'] / length
    root = bpy.data.objects.new('Pipeline heading', None)
    scene.collection.objects.link(root)
    for obj in list(scene.objects):
        if obj.type in {'MESH', 'EMPTY', 'ARMATURE'} and obj != root and obj.parent is None:
            matrix = obj.matrix_world.copy()
            obj.parent = root
            obj.matrix_world = matrix
    root.scale = (scale,) * 3
    wheel = part.get('wheel')
    pivots = []
    if wheel and wheel['mode'] == 'pivots':
        pivots = [o for o in scene.objects if o.name.startswith(wheel['prefix'])]
        if len(pivots) != wheel['count']:
            raise ValueError('Wheel pivot count does not match manifest')
        if any(o.animation_data for o in pivots):
            raise ValueError('Pivot wheels must not have animation; use timeline mode')
    initial = {o.name: o.rotation_euler.y for o in pivots}
    # Preserve texture inputs; modulate paint rather than replacing source colours.
    for material in bpy.data.materials:
        if not material.use_nodes:
            continue
        nodes, links = material.node_tree.nodes, material.node_tree.links
        bsdf = nodes.get('Principled BSDF')
        if bsdf is None:
            raise ValueError(f'Expected Principled paint material: {material.name}')
        base = tuple(bsdf.inputs['Base Color'].default_value)
        upstream = bsdf.inputs['Base Color'].links[0].from_socket if bsdf.inputs['Base Color'].is_linked else None
        bsdf.inputs['Roughness'].default_value = profile['roughness']
        bsdf.inputs['Metallic'].default_value = min(bsdf.inputs['Metallic'].default_value, profile['metallic_cap'])
        bsdf.inputs['Specular IOR Level'].default_value = profile['specular']
        bsdf.inputs['Emission Strength'].default_value = 0
        for key in ['Roughness', 'Metallic', 'Specular IOR Level', 'Emission Strength']:
            for link in list(bsdf.inputs[key].links):
                links.remove(link)
        noise = nodes.new('ShaderNodeTexNoise')
        for key, value in [('Scale', 'paint_noise_scale'), ('Detail', 'paint_noise_detail'), ('Roughness', 'paint_noise_roughness')]:
            noise.inputs[key].default_value = profile[value]
        ramp = nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color = tuple(v * profile['paint_low'] for v in base[:3]) + (1,)
        ramp.color_ramp.elements[1].color = base
        links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
        colour = ramp.outputs['Color']
        if upstream:
            ramp.color_ramp.elements[0].color = (profile['paint_low'],) * 3 + (1,)
            ramp.color_ramp.elements[1].color = (1,) * 4
            paint = nodes.new('ShaderNodeMixRGB'); paint.blend_type = 'MULTIPLY'
            paint.inputs[0].default_value = 1
            links.new(upstream, paint.inputs[1]); links.new(colour, paint.inputs[2])
            colour = paint.outputs[0]
        ao = nodes.new('ShaderNodeAmbientOcclusion')
        ao.inputs['Distance'].default_value = profile['ao_distance']
        tint = nodes.new('ShaderNodeMixRGB'); tint.blend_type = 'MULTIPLY'
        tint.inputs[0].default_value = profile['ao_strength']
        links.new(colour, tint.inputs[1]); links.new(ao.outputs['Color'], tint.inputs[2])
        links.new(tint.outputs[0], bsdf.inputs['Base Color'])
        if profile.get('surface_mode') == 'reference_colour':
            # Source illustrations already contain modelling cues. A shallow
            # normal ramp keeps solids readable without baking contact/cast
            # shadows into sprites; runtime lighting owns those shadows.
            geometry = nodes.new('ShaderNodeNewGeometry')
            dot = nodes.new('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'
            dot.inputs[1].default_value = Vector(profile['normal_light']).normalized()
            links.new(geometry.outputs['Normal'], dot.inputs[0])
            positive = nodes.new('ShaderNodeMath'); positive.operation = 'MAXIMUM'
            positive.inputs[1].default_value = 0
            links.new(dot.outputs['Value'], positive.inputs[0])
            ramp_value = nodes.new('ShaderNodeMath'); ramp_value.operation = 'MULTIPLY_ADD'
            ramp_value.inputs[1].default_value = profile['normal_contrast']
            ramp_value.inputs[2].default_value = 1 - profile['normal_contrast']
            links.new(positive.outputs[0], ramp_value.inputs[0])
            soft = nodes.new('ShaderNodeMixRGB'); soft.blend_type = 'MULTIPLY'
            soft.inputs[0].default_value = 1
            links.new(colour, soft.inputs[1]); links.new(ramp_value.outputs[0], soft.inputs[2])
            emission = nodes.new('ShaderNodeEmission')
            emission.inputs['Strength'].default_value = profile['colour_gain']
            links.new(soft.outputs[0], emission.inputs['Color'])
            output = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
            links.new(emission.outputs[0], output.inputs['Surface'])
    # Recreate the approved rig, independent of lights/camera stored in each model.
    for obj in list(scene.objects):
        if obj.type in {'LIGHT', 'CAMERA', 'LIGHT_PROBE'}:
            bpy.data.objects.remove(obj, do_unlink=True)
    scene.world = bpy.data.worlds.new('Pipeline world')
    scene.world.color = profile['world_color']
    scene.view_settings.view_transform = profile['view_transform']
    scene.view_settings.look = profile['look']
    scene.view_settings.exposure = profile.get('exposure', 0); scene.view_settings.gamma = 1
    scene.view_settings.use_curve_mapping = False
    scene.render.engine = profile['engine']
    scene.render.use_motion_blur = False; scene.render.use_border = False
    scene.render.use_crop_to_border = False; scene.render.dither_intensity = 1
    scene.render.film_transparent = True
    scene.render.use_compositing = False; scene.render.use_sequencer = False
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.render.resolution_x = scene.render.resolution_y = part['canvas'] * profile['supersample']
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = scene.render.pixel_aspect_y = 1
    camera = bpy.data.objects.new('Pipeline camera', bpy.data.cameras.new('Pipeline camera'))
    scene.collection.objects.link(camera); scene.camera = camera
    camera.data.type = 'ORTHO'
    camera.rotation_euler = (math.pi / 3, 0, math.pi / 4)
    bpy.context.view_layer.update()
    axes = camera.matrix_world.to_3x3()
    radius = max(p.length for p in points) * scale
    distance = max(20, radius + 2)
    camera.location = axes.col[2] * distance
    camera.data.clip_start = .1; camera.data.clip_end = distance + radius + 10
    camera.data.ortho_scale = part['canvas'] / (profile['tile_px'] / (profile['tile_m'] * math.sqrt(2)) * profile['resolution'])
    for i, spec in enumerate(profile['lights']):
        data = bpy.data.lights.new(f'Pipeline light {i}', 'AREA')
        data.energy = spec['energy']; data.shape = 'DISK'; data.size = spec['size']
        data.color = profile['light_color']
        data.use_shadow = profile.get('cast_shadows', True)
        light = bpy.data.objects.new(data.name, data); scene.collection.objects.link(light)
        target = Vector(profile['light_target'])
        light.location = axes @ Vector(spec['position']) + target
        light.rotation_euler = (target - light.location).to_track_quat('-Z', 'Y').to_euler()
    out = Path(job['output']); out.mkdir(parents=True, exist_ok=True)
    names = []
    painted = {o: [s.material for s in o.material_slots] for o in scene.objects if o.type == 'MESH'}
    masks = {}
    mask_spec = part.get('window_mask')
    mask_image = bpy.data.images.load(mask_spec['path']) if mask_spec else None
    for material in {m for materials in painted.values() for m in materials}:
        mask = bpy.data.materials.new('Window pass'); mask.use_nodes = True
        nodes = mask.node_tree.nodes; nodes.clear()
        output = nodes.new('ShaderNodeOutputMaterial'); emission = nodes.new('ShaderNodeEmission')
        emission.inputs['Color'].default_value = (0, 0, 0, 1)
        if mask_image and any(n.type == 'TEX_IMAGE' for n in material.node_tree.nodes):
            texture = nodes.new('ShaderNodeTexImage'); texture.image = mask_image
            mask.node_tree.links.new(texture.outputs['Color'], emission.inputs['Color'])
        elif any(s.lower() in material.name.lower() for s in part.get('window_materials', [])):
            emission.inputs['Color'].default_value = (1, 1, 1, 1)
        mask.node_tree.links.new(emission.outputs[0], output.inputs['Surface']); masks[material] = mask
    for facing in job['facings']:
        for phase in job['phases'] if wheel else [0]:
            if wheel and wheel['mode'] == 'timeline':
                frame = wheel['start'] + phase * wheel['period_frames'] / profile['phases']
                scene.frame_set(math.floor(frame), subframe=frame % 1)
            root.rotation_euler.z = -math.tau * facing / job['heading_count']
            for pivot in pivots:
                pivot.rotation_euler.y = initial[pivot.name] + phase * math.tau / (profile['phases'] * wheel['symmetry'])
            name = f"{part['frame_prefix']}_w{phase}_f{facing}.png" if wheel else f"{part['frame_prefix']}_f{facing}.png"
            scene.render.filepath = str(out / name)
            bpy.ops.render.render(write_still=True); names.append(name)
        if mask_image or part.get('window_materials'):
            for obj, materials in painted.items():
                for slot, material in zip(obj.material_slots, materials): slot.material = masks[material]
            name = f"{part['frame_prefix']}_lit_f{facing}.png"
            scene.render.filepath = str(out / name)
            bpy.ops.render.render(write_still=True); names.append(name)
            for obj, materials in painted.items():
                for slot, material in zip(obj.material_slots, materials): slot.material = material
    cycle = math.tau * wheel['radius'] * scale / profile['tile_m'] / wheel['symmetry'] if wheel else None
    (out / 'meta.json').write_text(json.dumps({'frames': names, 'scale': scale, 'cycle': cycle,
        'blender': bpy.app.version_string, 'build': bpy.app.build_hash.decode()}, indent=2))


if __name__ == '__main__':
    render(json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text()))

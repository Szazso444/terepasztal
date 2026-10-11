"""Blender diagnostic: replay a recipe and compare evaluated geometry/materials."""
import bpy
import hashlib
import json
from pathlib import Path
import runpy
import sys

path=Path(sys.argv[sys.argv.index('--')+1]).resolve()
root=path.parent;project=json.loads(path.read_text(encoding='utf-8'))
original=root/project['output'];repeat=root/'.verification/construction-repeat'
repeat.mkdir(parents=True,exist_ok=True)
runpy.run_path(str(root/project['recipe']),init_globals={
    'PROJECT':project,'PROJECT_ROOT':root,'OUTPUT':repeat})

def digest_model(file):
    bpy.ops.wm.open_mainfile(filepath=str(file))
    deps=bpy.context.evaluated_depsgraph_get();records=[]
    for ob in sorted(bpy.context.scene.objects,key=lambda x:x.name):
        record={'name':ob.name,'type':ob.type,'matrix':[round(v,7) for row in ob.matrix_world for v in row],
                'parent':ob.parent.name if ob.parent else None}
        if ob.type=='MESH':
            evaluated=ob.evaluated_get(deps);mesh=evaluated.to_mesh()
            record['vertices']=[[round(v,7) for v in p.co] for p in mesh.vertices]
            record['faces']=[list(p.vertices) for p in mesh.polygons]
            record['face_materials']=[p.material_index for p in mesh.polygons]
            record['smooth']=[p.use_smooth for p in mesh.polygons]
            record['materials']=[]
            for material in ob.data.materials:
                record['materials'].append({'name':material.name,'colour':list(material.diffuse_color),
                    'inputs':{i.name: list(i.default_value) if hasattr(i.default_value,'__len__') else i.default_value
                              for i in material.node_tree.nodes.get('Principled BSDF').inputs if hasattr(i,'default_value')}})
            evaluated.to_mesh_clear()
        records.append(record)
    meshes=sum(r['type']=='MESH' for r in records)
    assert meshes>0 and any(r.get('vertices') for r in records),'Cannot verify an empty scene'
    return hashlib.sha256(json.dumps(records,sort_keys=True).encode()).hexdigest(),meshes

manifest=json.loads((original/'candidate.json').read_text());report={}
for part in manifest['parts']:
    name=part['name']+'.blend';a,count=digest_model(original/name);b,other=digest_model(repeat/name)
    report[name]={'original':a,'replayed':b,'meshes':count,'match':a==b and count==other}
assert all(p['match'] for p in report.values()),'Rebuilt model geometry/materials differ'
assert (original/'calibration.json').read_bytes()==(repeat/'calibration.json').read_bytes(),'Rebuilt calibration differs'
(root/'construction-repeat.json').write_text(json.dumps({'parts':report,'calibration_match':True},indent=2)+'\n')
print('Recipe replay: evaluated geometry, materials, pivots and calibration match for all parts')

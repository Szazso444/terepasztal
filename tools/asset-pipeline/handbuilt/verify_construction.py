"""Blender diagnostic: replay a recipe and compare evaluated geometry/materials.

Run by `run.py verify` through ../blender_runner.py: `-- <project.json>`. Replays into
<project>/.verification/construction-repeat, never over the production model, and writes
<project>/construction-repeat.json. Names, parents, topology, materials and smoothing must be
equal; transforms and vertices may differ by TOLERANCE model units, the float rounding between
a Windows and a Linux build of the same Blender release (about 1e-7 on the SW1).
"""
import bpy
import hashlib
import json
from pathlib import Path
import runpy
import sys

TOLERANCE=1e-6
path=Path(sys.argv[sys.argv.index('--')+1]).resolve()
root=path.parent;project=json.loads(path.read_text(encoding='utf-8'))
original=root/project['output'];repeat=root/'.verification/construction-repeat'
repeat.mkdir(parents=True,exist_ok=True)
runpy.run_path(str(root/project['recipe']),init_globals={
    'PROJECT':project,'PROJECT_ROOT':root,'OUTPUT':repeat})

def read_model(file):
    bpy.ops.wm.open_mainfile(filepath=str(file))
    deps=bpy.context.evaluated_depsgraph_get();records=[]
    for ob in sorted(bpy.context.scene.objects,key=lambda x:x.name):
        record={'name':ob.name,'type':ob.type,'matrix':[v for row in ob.matrix_world for v in row],
                'parent':ob.parent.name if ob.parent else None}
        if ob.type=='MESH':
            evaluated=ob.evaluated_get(deps);mesh=evaluated.to_mesh()
            record['vertices']=[list(p.co) for p in mesh.vertices]
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
    return records,meshes

def rounded_digest(records):
    """The digest earlier reports carry: coordinates rounded to 7 decimals."""
    def rounded(record):
        record=dict(record,matrix=[round(v,7) for v in record['matrix']])
        if 'vertices' in record:record['vertices']=[[round(v,7) for v in p] for p in record['vertices']]
        return record
    return hashlib.sha256(json.dumps([rounded(r) for r in records],sort_keys=True).encode()).hexdigest()

def compare(a,b):
    """Largest coordinate difference, or None when anything but coordinates differs."""
    if len(a)!=len(b):return None
    worst=0.0
    for x,y in zip(a,b):
        exact=[k for k in x if k not in ('matrix','vertices')]
        if set(x)!=set(y) or any(x[k]!=y[k] for k in exact):return None
        if len(x.get('vertices',[]))!=len(y.get('vertices',[])):return None
        pairs=list(zip(x['matrix'],y['matrix']))+[(p,q) for u,w in zip(x.get('vertices',[]),y.get('vertices',[])) for p,q in zip(u,w)]
        worst=max([worst]+[abs(p-q) for p,q in pairs])
    return worst

manifest=json.loads((original/'candidate.json').read_text(encoding='utf-8'));report={}
for part in manifest['parts']:
    name=part['name']+'.blend';a,count=read_model(original/name);b,other=read_model(repeat/name)
    worst=compare(a,b)
    report[name]={'original':rounded_digest(a),'replayed':rounded_digest(b),'meshes':count,'replayed_meshes':other,
                  'max_difference':worst,'match':worst is not None and worst<=TOLERANCE and count==other}
calibration=[json.loads((folder/'calibration.json').read_text(encoding='utf-8')) for folder in (original,repeat)]
def close(x,y):
    if isinstance(x,dict):return isinstance(y,dict) and x.keys()==y.keys() and all(close(x[k],y[k]) for k in x)
    if isinstance(x,list):return isinstance(y,list) and len(x)==len(y) and all(close(p,q) for p,q in zip(x,y))
    if isinstance(x,float) or isinstance(y,float):return isinstance(x,(int,float)) and isinstance(y,(int,float)) and abs(x-y)<=TOLERANCE
    return x==y
summary={'tolerance':TOLERANCE,'parts':report,'calibration_match':close(*calibration)}
(root/'construction-repeat.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
assert all(p['match'] for p in report.values()),'Rebuilt model geometry/materials differ'
assert summary['calibration_match'],'Rebuilt calibration differs'
print('Recipe replay: evaluated geometry, materials, pivots and calibration match for all parts')

import bpy,json
from pathlib import Path
R=Path(__file__).resolve().parent; report={}
for id in ['mav375','class08','sw1','drg01','m62']:
    m=json.loads((R/'prepared'/id/'candidate.json').read_text()); report[id]={}
    for p in m['parts']:
        if not p.get('wheel'):continue
        bpy.ops.wm.open_mainfile(filepath=p['source']);bpy.context.scene.frame_set(1)
        treads=[]
        for o in bpy.context.scene.objects:
            if o.type!='MESH' or o.hide_render:continue
            materials={i for i,s in enumerate(o.material_slots) if s.material and any(k in s.material.name.lower() for k in ['tyre','tread','running surface'])}
            verts=set(v for poly in o.data.polygons if poly.material_index in materials for v in poly.vertices)
            ys=[(o.matrix_world@o.data.vertices[v].co).y for v in verts]
            if ys:treads.extend(ys)
        if treads:
            centres=[]
            for sign in [-1,1]:
                side=[y for y in treads if y*sign>0]
                centres.append((max(side)+min(side))/2)
            target=[-.12*6.235064799811727,.12*6.235064799811727]
            assert max(abs(a-b) for a,b in zip(centres,target))<.001, (id,p['name'],centres)
            report[id][p['name']]={'tread_band_centres_m':centres,'target_m':target}
        else:
            raise ValueError('No tread geometry found: '+id+'/'+p['name'])
(R/'tread-audit.json').write_text(json.dumps(report,indent=2))
print('Measured tread centres on standard rails:',sum(len(p) for p in report.values()),'wheel-bearing parts')


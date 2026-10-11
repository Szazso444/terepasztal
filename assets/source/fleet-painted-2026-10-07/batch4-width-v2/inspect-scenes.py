import bpy,json
from pathlib import Path
R=Path(__file__).resolve().parent; result={}
for id in ['mav375','class08','sw1','drg01']:
    m=json.loads((R/'prepared'/id/'candidate.json').read_text()); result[id]={}
    for p in m['parts']:
        bpy.ops.wm.open_mainfile(filepath=p['source']); bpy.context.scene.frame_set(1)
        obs=[]
        for o in bpy.context.scene.objects:
            if o.type!='MESH' or o.hide_render: continue
            pts=[o.matrix_world@v.co for v in o.data.vertices]
            obs.append({'name':o.name,'vertices':len(pts),'bounds':[[round(min(v[a] for v in pts),4),round(max(v[a] for v in pts),4)] for a in range(3)],'animated':bool(o.animation_data)})
        result[id][p['name']]=obs
(R/'scene-audit.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result))

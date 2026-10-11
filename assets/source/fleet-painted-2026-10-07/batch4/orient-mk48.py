import bpy,json,hashlib,math
from pathlib import Path
from mathutils import Matrix
R=Path(__file__).resolve().parent;P=R/'prepared/mk48';m=json.loads((P/'candidate.json').read_text());cal=json.loads((P/'calibration.json').read_text());turn=Matrix.Rotation(math.pi,4,'Z')
for p in m['parts']:
 bpy.ops.wm.open_mainfile(filepath=p['source'])
 for o in bpy.context.scene.objects:
  if o.parent is None:o.matrix_world=turn@o.matrix_world
 bpy.context.view_layer.update();bpy.ops.wm.save_as_mainfile(filepath=p['source']);p['source_sha256']=hashlib.sha256(Path(p['source']).read_bytes()).hexdigest();m['reference']['prepared_sources'][p['name']]=p['source_sha256']
 for k,items in p.get('effects',{}).items():p['effects'][k]=[[-x,-y,z] for x,y,z in items]
for c in cal:
 for a in c['axles']:a['x_m']=-a['x_m']
 for g in c['gear']:
  if 'centre_m' in g:g['centre_m']=-g['centre_m']
m['reference']['guidelines']+='; Rigid 180-degree orientation correction: workbook specifies short hood as front. No mesh reshaping.'
(P/'candidate.json').write_text(json.dumps(m,indent=2)+'\n');(P/'calibration.json').write_text(json.dumps(cal,indent=2)+'\n')
s=R/'specs/mk48.json';c=json.loads(s.read_text());c['projection'].pop('nose_px',None);s.write_text(json.dumps(c,indent=2)+'\n')

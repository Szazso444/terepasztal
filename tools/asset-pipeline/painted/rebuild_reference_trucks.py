"""Replace reconstruction fragments with round reference-authored bogies.
Run in Blender -- batch-directory locomotive-id. Uses reference spec + measured
part attachment points; never reads runtime gear or existing game sprites.
"""
import bpy,math,json,hashlib,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from reference import rail_half_m
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from reference_axles import authored_axles
args=sys.argv[sys.argv.index('--')+1:];R=Path(args[0]);id=args[1];P=R/'prepared'/id
M=json.loads((P/'candidate.json').read_text());cal=json.loads((P/'calibration.json').read_text());spec=json.loads((R/'specs'/f'{id}.json').read_text())
gauge=rail_half_m(spec['geometry'].get('gauge','standard'))
refs={p[0]:g for p,g in zip(spec['geometry']['parts'],spec['geometry']['gear'])}
def mat(n,c):
 rgb=[v/255 for v in c];rgb=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
 m=bpy.data.materials.new(n);m.use_nodes=True;m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*rgb,1);return m
def box(n,loc,size,m):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=n;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m);return o
def cyl(n,loc,r,d,m):
 bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=r,depth=d,location=loc,rotation=(math.pi/2,0,0));o=bpy.context.object;o.name=n;o.data.materials.append(m);return o
for part in M['parts']:
 name=part['name']
 if '-t' not in name or (id=='drg01' and name.startswith('tender')) or id=='m62':continue
 body,ti=name.split('-t');ti=int(ti);ref=refs[body]['wheels']['trucks'][ti]
 c=next(q for q in cal if q['part']==name);axles=c['axles'];count=len(axles)
 # Keep the measured attachment, arrange the authored reference's axle group symmetrically.
 diameter=ref['d'] if isinstance(ref['d'],(int,float)) else sum(ref['d'])/count
 body_length=next(p for p in M['parts'] if p['name']==body)['length_tiles']*6.235064799811727
 authored=authored_axles(-body_length/2,body_length/2,refs[body]['trucks'][ti],[diameter]*count)
 attachment=sum(a['x'] for a in authored)/count
 xs=[a['x']-attachment for a in authored];centre=0
 span=max(xs)-min(xs) if count>1 else 0
 c['gear'][0].update(centre_m=attachment,model_off_m=0)
 spokes=ref['spokes'] if isinstance(ref['spokes'],int) else ref['spokes'][0]
 bpy.ops.wm.read_factory_settings(use_empty=True);paint=mat('Reference bogie paint',ref['color']);tread=mat('Dark wheel running surface',[65,68,72]);hub=mat('Hub metal',[46,50,53])
 r=diameter/2
 for y in [-(gauge-.099),gauge-.099]:
  box('Bogie longitudinal frame',(centre,y,r+.15),(span+diameter*.8,.15,.18),paint)
  for x in xs:
   box('Axlebox',(x,y,r),(.24,.22,.23),paint)
   for k in range(3):box('Leaf spring',(x,y,r+.22+k*.035),(.48-k*.08,.15,.025),paint)
 for axle,x in enumerate(xs):
  cyl('Axle',(x,0,r),.08,2*gauge,hub)
  for side in [-1,1]:
   pivot=bpy.data.objects.new(f'Wheelpivot{axle}_{side}',None);bpy.context.collection.objects.link(pivot);pivot.location=(x,side*gauge,r);bpy.context.view_layer.update()
   objs=[cyl('Tyre',(x,side*gauge,r),r,.12,tread),cyl('Wheel face',(x,side*(gauge+.069),r),r*.80,.028,hub)]
   if spokes:
    for k in range(spokes):
     a=k*math.tau/spokes;o=box('Painted spoke',(x+math.sin(a)*r*.5,side*(gauge+.094),r+math.cos(a)*r*.5),(.04,.023,r*.65),paint);o.rotation_euler.y=a;objs.append(o)
   else:
    for k in range(5):
     a=k*math.tau/5;objs.append(cyl('Wheel bolt',(x+math.sin(a)*r*.43,side*(gauge+.095),r+math.cos(a)*r*.43),.023,.02,paint))
   for o in objs:o.parent=pivot;o.matrix_parent_inverse=pivot.matrix_world.inverted()
 bpy.context.view_layer.update();path=P/(name+'.blend');bpy.data.libraries.write(str(path),{bpy.context.scene},fake_user=True,compress=True)
 part.update(source_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),length_tiles=(span+diameter)/6.235064799811727,wheel={'mode':'pivots','prefix':'Wheelpivot','count':count*2,'radius':r,'symmetry':spokes or 5},effects={})
 # Renderer uses exact mesh bounds; frames may extend beyond the tyre on a single axle.
 pts=[o.matrix_world@v.co for o in bpy.context.scene.objects if o.type=='MESH' for v in o.data.vertices];part['length_tiles']=(max(p.x for p in pts)-min(p.x for p in pts))/6.235064799811727
 part.pop('window_mask',None);M['reference']['prepared_sources'][name]=part['source_sha256']
 c['axles']=[{'x_m':x,'d_m':diameter} for x in xs]
M['reference']['guidelines']+='; Reconstructed truck fragments replaced by clean reference-authored axle groups, fixed technical rail gauge, dark treads. No runtime geometry used.'
(P/'candidate.json').write_text(json.dumps(M,indent=2)+'\n');(P/'calibration.json').write_text(json.dumps(cal,indent=2)+'\n');print('Reference bogies rebuilt',id)

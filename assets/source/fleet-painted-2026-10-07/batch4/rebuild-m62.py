"""Clean M62 geometry authored against workbook row30, replacing patchy reconstruction."""
import bpy,math,json,hashlib
from pathlib import Path
R=Path(__file__).resolve().parent;P=R/'prepared/m62';M=json.loads((P/'candidate.json').read_text());cal=json.loads((P/'calibration.json').read_text())
def mat(n,c):
 m=bpy.data.materials.new(n);m.use_nodes=True;m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*c,1);return m
def box(n,loc,size,m,bevel=.03):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=n;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m)
 if bevel:
  b=o.modifiers.new('Edges','BEVEL');b.width=bevel;b.segments=2;o.modifiers.new('Normals','WEIGHTED_NORMAL')
 return o
def cyl(n,loc,r,d,m,axis='Z'):
 bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=r,depth=d,location=loc);o=bpy.context.object;o.name=n
 if axis=='X':o.rotation_euler.y=math.pi/2
 if axis=='Y':o.rotation_euler.x=math.pi/2
 o.data.materials.append(m);return o
def finish(name,wheel=None):
 scene=bpy.context.scene;path=P/(name+'.blend');bpy.context.view_layer.update();bpy.data.libraries.write(str(path),{scene},fake_user=True,compress=True)
 p=next(p for p in M['parts'] if p['name']==name);p['source_sha256']=hashlib.sha256(path.read_bytes()).hexdigest();p.pop('window_mask',None);p['window_materials']=['Cab glazing'] if name=='body' else [];p['effects']={};p['canvas']=320 if name=='body' else 256
 pts=[o.matrix_world@v.co for o in scene.objects if o.type=='MESH' for v in o.data.vertices];p['length_tiles']=(max(v.x for v in pts)-min(v.x for v in pts))/6.235064799811727
 if wheel:p['wheel']=wheel
 else:p.pop('wheel',None)
 M['reference']['prepared_sources'][name]=p['source_sha256']
bpy.ops.wm.read_factory_settings(use_empty=True)
green=mat('Forest green paint',(.035,.105,.061));darkgreen=mat('Recessed green',(.022,.06,.035));cream=mat('Cream lining',(.67,.61,.34));roof=mat('Grey roof',(.19,.23,.23));edge=mat('Roof panels',(.12,.15,.16));black=mat('Underframe',(.024,.033,.035));grille=mat('Radiator recess',(.018,.033,.029));glass=mat('Cab glazing',(.025,.13,.17));lamp=mat('Lamp lens',(.82,.77,.50));steel=mat('Buffers',(.055,.061,.065))
box('Main underframe',(0,0,1.10),(14.6,2.85,.45),black,.07)
box('Green locomotive body',(0,0,2.45),(14.35,2.88,2.5),green,.22)
box('Broad grey roof',(0,0,3.81),(13.95,2.92,.34),roof,.22)
for side in [-1,1]:
 y=side*1.452
 for z in [1.48,2.45]:box('Cream side stripe',(0,y,z),(14.15,.035,.075),cream,.008)
 for x in [-6.35,6.35]:
  box('Cab side window cream rim',(x,y,3.15),(1.35,.065,.83),cream,.06)
  box('Cab side glass',(x,y+side*.04,3.15),(1.23,.045,.71),glass,.04)
  box('Window divider',(x,y+side*.07,3.15),(.045,.04,.77),cream,.004)
  box('Cab door seam',(x-side*.85,y,2.18),(.045,.04,1.46),darkgreen,.006)
  for z in [.60,.85,1.10]:box('Cab access step',(x,y+side*.12,z),(.7,.42,.06),steel)
 for x in [-4.75,-3.45,3.1,4.55]:
  box('Side ventilation panel',(x,y,2.96),(1.12,.05,1.05),grille,.015)
  for k in range(7):box('Vent slat',(x,y+side*.04,2.55+k*.13),(1.04,.025,.045),roof,.004)
 for x in [-1.9,-.4,1.1]:
  box('Machine-room side panel',(x,y,2.93),(1.40,.026,1.02),darkgreen,.01)
  for k in range(8):box('Panel louvre',(x,y+side*.03,2.55+k*.11),(1.27,.03,.024),green,.002)
 for x in [-5.1,-2.65,2.4,5.1]:box('Body seam',(x,y,2.12),(.025,.03,1.55),darkgreen,.004)
for sign in [-1,1]:
 x=sign*7.2
 for y in [-.64,.64]:
  box('End window cream frame',(x,y,3.18),(.065,1.12,.78),cream,.07)
  box('End windscreen',(x+sign*.045,y,3.18),(.05,1.00,.66),glass,.05)
  cyl('Lower headlight rim',(x+sign*.05,y*.95,1.98),.17,.08,cream,'X');cyl('Lower headlight lens',(x+sign*.11,y*.95,1.98),.115,.05,lamp,'X')
  box('End buffer',(x+sign*.28,y*1.65,.96),(.30,.4,.34),steel,.05)
 for z in [1.48,2.45]:box('End cream line',(x,0,z),(.055,2.48,.08),cream,.01)
 cyl('Upper headlight',(x+sign*.04,0,3.70),.19,.08,cream,'X');cyl('Upper headlight lens',(x+sign*.1,0,3.70),.135,.04,lamp,'X')
 box('Coupler',(x+sign*.45,0,.9),(.45,.23,.20),black)
for x in [-4.8,-3.2,3.8]:
 box('Roof radiator housing',(x,0,4.015),(1.4,2.3,.11),edge,.035)
 for k in range(10):box('Roof grille bar',(x-.59+k*.13,0,4.09),(.04,2.12,.04),roof,.005)
for x in [.4,1.75]:
 cyl('Cooling fan rim',(x,0,4.04),.53,.10,edge);cyl('Fan dark centre',(x,0,4.10),.44,.025,black)
 for k in range(8):
  a=k*math.tau/8;sp=box('Fan blade',(x+math.cos(a)*.24,math.sin(a)*.24,4.135),(.40,.045,.025),roof,.005);sp.rotation_euler.z=a
box('Exhaust hatch',(-1.3,0,4.08),(1.15,1.15,.22),roof,.055)
finish('body')
M['parts'][0]['effects']={'smoke':[[-1.3,0,4.25]],'lamps':[[7.3,-.61,1.98],[7.3,.61,1.98]]}
for ti,centre in [(0,-4.0),(1,4.0)]:
 bpy.ops.wm.read_factory_settings(use_empty=True);dark=mat('Bogie dark grey',(.04,.048,.052));steel=mat('Treads',(.065,.073,.082));hub=mat('Wheel hubs',(.025,.033,.037))
 for side in [-1,1]:
  box('Three axle bogie frame',(0,side*.44,.73),(3.9,.22,.27),dark)
  for x in [-1.3,0,1.3]:box('Axlebox',(x,side*.57,.58),(.36,.22,.30),dark)
 for axle,x in enumerate([-1.3,0,1.3]):
  cyl('Axle',(x,0,.52),.10,1.0,dark,'Y')
  for side in [-1,1]:
   pivot=bpy.data.objects.new(f'Wheelpivot{axle}_{side}',None);bpy.context.collection.objects.link(pivot);pivot.location=(x,side*.499,.52);bpy.context.view_layer.update()
   for o in [cyl('Wheel tread',(x,side*.499,.52),.52,.14,steel,'Y'),cyl('Dark wheel face',(x,side*.58,.52),.41,.035,hub,'Y')]:o.parent=pivot;o.matrix_parent_inverse=pivot.matrix_world.inverted()
   for k in range(5):
    a=k*math.tau/5;o=cyl('Wheel bolt',(x+math.sin(a)*.23,side*.61,.52+math.cos(a)*.23),.026,.025,steel,'Y');o.parent=pivot;o.matrix_parent_inverse=pivot.matrix_world.inverted()
 finish(f'body-t{ti}',{'mode':'pivots','prefix':'Wheelpivot','count':6,'radius':.52,'symmetry':5})
 c=next(q for q in cal if q['part']==f'body-t{ti}');c.update(axles=[{'x_m':x,'d_m':1.04} for x in [-1.3,0,1.3]],gear=[{'truck':ti,'centre_m':centre,'model_off_m':0,'d_m':[1.04]*3,'wheel_scale':1,'frame':'outside'}])
M['reference']['guidelines']+='; Clean M62 body and two three-axle bogies freshly built from row30 picture; original reconstruction had patchy side surfaces. Green/cream livery, two end cabs, grey roof with vents/fans retained.'
(P/'candidate.json').write_text(json.dumps(M,indent=2)+'\n');(P/'calibration.json').write_text(json.dumps(cal,indent=2)+'\n');print('M62 rebuilt')

"""M62: fresh C50-method geometry authored from workbook PNG; no game inputs."""
import bpy, math, json, hashlib
from pathlib import Path
from mathutils import Vector
ROOT=OUTPUT; TILE=6.235064799811727
helpers=(PROJECT_ROOT/PROJECT['helpers']).read_text()
def setup():
 exec(helpers,globals())
 globals()['green']=mat('Reference olive green',(.105,.165,.069))
 globals()['trim']=mat('Olive panel edges',(.15,.205,.10))
 globals()['roof']=mat('Reference grey roof',(.205,.225,.205))
 globals()['cream']=mat('Warm cream stripes',(.83,.72,.45))
 globals()['glass']=mat('Opaque painted blue glass',(.035,.145,.17),.05,.4)
 globals()['glint']=mat('Painted window reflection',(.09,.22,.23),.05,.4)
 globals()['framepaint']=mat('Bogie grey',(.105,.12,.12))
 globals()['tyre']=mat('Dark steel tread',(.072,.079,.080),.15)
 globals()['copper']=mat('Copper fittings',(.45,.23,.07),.2)
def poly(name,verts,material):
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],[tuple(range(len(verts)))]);me.update()
 ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);return finish(ob,name,material)
def shell(name,rings,material):
 # ring x, half-width, bottom, shoulder, top, roof-half-width
 verts=[]
 for x,w,b,sh,t,rw in rings:verts.extend([(x,-w,b),(x,w,b),(x,w,sh),(x,rw,t),(x,-rw,t),(x,-w,sh)])
 faces=[tuple(range(5,-1,-1)),tuple(range((len(rings)-1)*6,len(rings)*6))]
 for j in range(len(rings)-1):
  for i in range(6):faces.append((j*6+i,j*6+(i+1)%6,(j+1)*6+(i+1)%6,(j+1)*6+i))
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);return finish(ob,name,material,.025)
def saved(name):
 bpy.context.view_layer.update();scene=bpy.context.scene;deps=bpy.context.evaluated_depsgraph_get()
 pts=[o.matrix_world@Vector(v) for o in scene.objects if o.type=='MESH' for v in o.evaluated_get(deps).bound_box]
 length=max(v.x for v in pts)-min(v.x for v in pts);path=ROOT/f'{name}.blend'
 bpy.data.libraries.write(str(path),{scene},fake_user=True,compress=True)
 return {'name':name,'source':str(path),'source_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'frame_prefix':'loco_m62_'+name,'length_tiles':length/TILE,'canvas':768 if name=='body' else 384,'effects':{}}
setup();ROOT.mkdir(parents=True,exist_ok=True)
box('Main straight chassis',(0,0,1.18),(15.8,2.84,.27),green,.05)
box('Visible centre fuel tank',(0,0,.65),(3.55,2.38,.90),framepaint,.14)
for side in [-1,1]:
 box('Tank inset panel',(0,side*1.198,.65),(2.95,.025,.56),roof,.04)
 rod('Tank strap',(-.82,side*1.225,.92),(-.82,side*1.225,.62),.025,boltmat)
box('Main engine compartment',(0,0,2.38),(11.28,2.80,2.15),green,.045)
shell('Long chamfered grey roof',[(-5.64,1.40,3.39,3.45,4.13,1.00),(5.64,1.40,3.39,3.45,4.13,1.00)],roof)
for end in [-1,1]:
 shell('Cab shell',[(end*5.57,1.4,1.31,3.46,4.13,1.0),(end*7.27,1.4,1.31,3.46,4.13,1.0),(end*7.88,1.27,1.31,3.43,3.91,.93)],green)
 # Front plane: paired blue windscreens, three physical lamp lenses.
 for y in [-.64,.64]:
  box('Front windscreen surround',(end*7.91,y,3.12),(.047,1.10,.72),dark,.045)
  box('Front blue windscreen',(end*7.942,y,3.12),(.018,1.00,.62),glass,.035)
  reflection([(end*7.956,y-.42,3.35),(end*7.956,y-.42,2.88),(end*7.956,y+.10,3.35)])
  rod('Windscreen wiper',(end*7.98,y-.12,2.86),(end*7.98,y+.04,3.16),.018,boltmat)
 for y,z,r in [(0,3.76,.18),(-.96,1.86,.145),(.96,1.86,.145)]:
  cyl('Lamp dark housing',(end*7.94,y,z),r+.055,.10,dark,'X')
  cyl('Lamp brass rim',(end*8.002,y,z),r+.026,.033,copper,'X')
  cyl('Ivory lamp lens',(end*8.028,y,z),r,.014,lamp,'X')
 # Cream nose band dips into a central V, matching the picture.
 for side in [-1,1]:
  poly('Cream nose chevron',[(end*7.968,side*1.26,2.54),(end*7.968,side*.49,2.54),(end*7.968,0,2.31),(end*7.968,0,2.14),(end*7.968,side*.53,2.38),(end*7.968,side*1.26,2.38)],cream)
 poly('Copper nose badge',[(end*7.975,-.36,2.61),(end*7.975,.36,2.61),(end*7.975,0,2.43)],copper)
 box('Front lower cream pinstripe',(end*7.96,0,1.58),(.02,2.49,.055),cream,.004)
 for side in [-1,1]:
  box('Cab side glazing surround',(end*7.03,side*1.407,3.10),(.91,.035,.73),dark,.035)
  box('Cab side blue glass',(end*7.03,side*1.432,3.10),(.80,.016,.63),glass,.025)
  box('Cab side mullion',(end*7.01,side*1.448,3.10),(.035,.018,.63),green,.002)
  box('Door seam',(end*5.97,side*1.42,2.43),(.64,.023,2.13),dark,.016)
  box('Cab door',(end*5.97,side*1.438,2.43),(.57,.024,2.06),green,.01)
  box('Door glass surround',(end*5.97,side*1.457,3.10),(.40,.020,.59),dark,.02)
  box('Door blue glass',(end*5.97,side*1.475,3.10),(.32,.014,.50),glass,.014)
  for x in [5.61,6.31]:rod('Cab vertical brass grab',(end*x,side*1.49,1.45),(end*x,side*1.49,3.15),.025,copper)
  box('Cab side stripe',(end*6.97,side*1.44,2.44),(1.50,.025,.13),cream,.004)
  for z in [.38,.70,1.01]:box('Cab access step',(end*6.02,side*1.39,z),(.64,.25,.065),boltmat,.015)
 for side in [-1,1]:
  cyl('Buffer shank',(end*8.10,side*.99,1.05),.115,.29,boltmat,'X')
  box('Oval buffer head',(end*8.27,side*.99,1.05),(.12,.51,.33),framepaint,.10)
 box('Coupler',(end*8.22,0,.95),(.43,.27,.28),boltmat,.035)
 rod('Hanging coupling',(end*8.39,0,.95),(end*8.39,0,.54),.045,boltmat)
 box('Pilot',(end*7.85,0,.65),(.17,2.45,.59),green,.055)
 for y in [-.63,.63]:rod('Front hose',(end*8.04,y,1.02),(end*8.09,y,.46),.04,bronze)
 box('Small cab roof cover',(end*7.03,0,4.19),(.48,.61,.14),roof,.025)
# Side grille rhythm read from the workbook: large radiator at -X, five small vents.
for side in [-1,1]:
 box('Continuous side cream stripe',(0,side*1.416,2.39),(11.23,.025,.115),cream,.004)
 box('Lower sill cream lining',(0,side*1.43,1.39),(15.68,.022,.055),cream,.003)
 for x,w,h in [(-4.67,1.00,1.23),(-3.51,1.00,1.23),(-1.95,.94,.72),(-.68,.94,.72),(.60,.94,.72),(1.87,.94,.72),(3.14,.94,.72),(4.40,.94,.72)]:
  z=2.89
  box('Side vent border',(x,side*1.421,z),(w+.09,.035,h+.09),trim,.012)
  box('Recessed vent',(x,side*1.448,z),(w,.025,h),dark,.01)
  for i in range(int(h/.075)):box('Horizontal olive vent slat',(x,side*1.47,z-h/2+.04+i*.075),(w-.03,.025,.029),green,.003)
 for x in [-5.32,-2.77,-.03,2.54,5.19]:box('Vertical panel joint',(x,side*1.417,2.46),(.016,.018,2.01),trim,.002)
# Two radiator grilles on each sloping rear roof shoulder visible in the PNG.
for side in [-1,1]:
 for x in [-4.67,-3.51]:
  a=.37;yl=side*1.345;yu=side*1.068;zl=3.55;zu=4.02
  poly('Sloping roof radiator recess',[(x-a,yl,zl),(x+a,yl,zl),(x+a,yu,zu),(x-a,yu,zu)],dark)
  for j in range(10):
   t=(j+.5)/10;yy=yl+(yu-yl)*t+side*.012;zz=zl+(zu-zl)*t+.008
   rod('Sloping roof radiator slat',(x-a,yy,zz),(x+a,yy,zz),.012,boltmat)
# Roof hatches and twin fans, actual geometry rather than baked source shading.
for x,w in [(-5.0,.93),(3.0,.93),(4.27,1.25)]:box('Roof rectangular hatch',(x,0,4.20),(w,1.83,.14),roof,.025)
box('Large roof radiator border',(-3.55,0,4.23),(1.88,1.85,.14),roof,.025)
box('Large roof radiator dark grille',(-3.55,0,4.31),(1.65,1.62,.035),dark,.005)
for i in range(19):box('Roof radiator slat',(-4.33+i*.086,0,4.335),(.018,1.60,.025),boltmat,.002)
for y in [-.40,0,.40]:box('Roof grille crossbar',(-3.55,y,4.354),(1.68,.025,.024),roof,.002)
for x in [-.65,.73]:
 cyl('Circular fan rim',(x,0,4.25),.48,.23,roof)
 cyl('Fan black recess',(x,0,4.372),.413,.015,dark)
 for j in range(12):
  a=j*math.tau/12;rod('Fan grille spokes',(x,0,4.39),(x+.403*math.cos(a),.403*math.sin(a),4.39),.014,boltmat)
 cyl('Fan centre',(x,0,4.40),.09,.03,roof)
for x in [-2.04,2.05]:box('Low roof access hatch',(x,0,4.195),(.67,1.03,.13),roof,.018)
parts=[saved('body')]
parts[0]['effects']={'lamps':[[end*8.04,y,z] for end in [-1,1] for y,z in [(0,3.76),(-.96,1.86),(.96,1.86)]]}
parts[0]['window_materials']=['Opaque painted blue glass']
cal=[{'part':'body','tiles':[parts[0]['length_tiles'],1],'gear':[],'axles':[]}]
for ti,centre in enumerate([-5.05,5.05]):
 setup();G=.12*TILE;r=.53
 for side in [-1,1]:
  y=side*1.17
  box('Complete bogie sideframe',(0,y,.73),(4.60,.23,.36),framepaint,.06)
  for x in [-1.48,0,1.48]:
   box('Axlebox',(x,y,.57),(.43,.35,.41),framepaint,.055)
   box('Copper bearing cover',(x,side*1.36,.57),(.20,.035,.21),copper,.018)
   for dx in [-.38,.38]:
    cyl('Suspension spring',(x+dx,y,.68),.125,.43,boltmat)
    for zz in [.51,.58,.65,.72,.79,.86]:cyl('Spring coil',(x+dx,y,zz),.133,.025,framepaint)
  box('Bogie top rail',(0,y,1.00),(4.61,.20,.16),framepaint,.03)
 for x in [-2.23,2.23]:box('Bogie front and rear crossmember',(x,0,.85),(.20,2.34,.28),framepaint,.035)
 box('Bogie central bolster',(0,0,.97),(.64,2.28,.20),framepaint,.04)
 for x in [-1.48,0,1.48]:
  cyl('Full axle',(x,0,r),.10,2.29,boltmat,'Y');box('Traction motor',(x,0,.65),(.69,.9,.45),dark,.06)
  for side in [-1,1]:
   y=side*G;pivot=bpy.data.objects.new('Wheel pivot',None);bpy.context.collection.objects.link(pivot);pivot.location=(x,y,r)
   pieces=[cyl('Dark wheel tread',(x,y,r),r,.17,tyre,'Y',64),cyl('Steel wheel disc',(x,y+side*.095,r),.445,.035,framepaint,'Y',64),cyl('Wheel hub',(x,y+side*.12,r),.14,.04,boltmat,'Y')]
   for j in range(6):
    a=j*math.tau/6;pieces.append(cyl('Wheel disc recess',(x+.31*math.sin(a),y+side*.119,r+.31*math.cos(a)),.045,.009,dark,'Y',16))
   bpy.context.view_layer.update()
   for o in pieces:world=o.matrix_world.copy();o.parent=pivot;o.matrix_world=world
 p=saved(f'body-t{ti}');p['wheel']={'mode':'pivots','prefix':'Wheel pivot','count':6,'radius':r,'symmetry':6};p['max_phase_bounds_drift']=1;parts.append(p)
 cal.append({'part':p['name'],'tiles':None,'gear':[{'truck':ti,'centre_m':centre,'model_off_m':0}],'axles':[{'x_m':x,'d_m':2*r} for x in [-1.48,0,1.48]]})
reference={'schema':1,'authority':'png-pictures-and-owner-notes','pictures':[dict(p,path=str(PROJECT_ROOT/p['path'])) for p in PROJECT['pictures']],'observations':{'path':str(PROJECT_ROOT/PROJECT['observations']),'sha256':hashlib.sha256((PROJECT_ROOT/PROJECT['observations']).read_bytes()).hexdigest()},'guidelines':'Workbook row30 PNG geometry/livery authority; supplementary rear only where consistent. Fresh C50-method geometry; complete Co-Co bogies. No game model inputs.'}
reference['prepared_sources']={p['name']:p['source_sha256'] for p in parts}
(ROOT/'candidate.json').write_text(json.dumps({'schema':1,'id':PROJECT['id'],'profile':str(PROJECT_ROOT/PROJECT['profile']),'parts':parts,'reference':reference},indent=2)+'\n')
(ROOT/'calibration.json').write_text(json.dumps(cal,indent=2)+'\n')
(ROOT/'validation.json').write_text(json.dumps({'axes_parallel':True,'body_width':2.8,'gauge_half_m':.12*TILE,'bogies':2,'axles_per_bogie':3,'shape_authority':'PNG-only authored geometry'},indent=2)+'\n')
print('M62 fresh authored body and complete Co-Co bogies saved')

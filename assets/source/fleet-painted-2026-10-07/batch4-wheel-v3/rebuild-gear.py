"""Reference-authored axle coordinates, no automatic axle search or wheel shrinking.
Creates eight actual 3D phases and checks non-overlapping tyres. Owner gauge .24 tile.
"""
from pathlib import Path
import bpy,bmesh,json,math,hashlib,sys
R=Path(__file__).resolve().parent;REPO=R.parents[3];TILE=6.235064799811727;G=.12*TILE
sys.path.insert(0,str(REPO/'tools/asset-pipeline/painted'))
from prepare_existing import principled
import running_gear as rg
from blender_stage import wheel_cycle,wheel_colours,rod_spec
SHADING={'light_world':(0,0,1),'light':0,'ambient':1}
ids=sys.argv[sys.argv.index('--')+1:];audit={}
def values(v,n):return v if isinstance(v,list) else [v]*n
def add_gear(name,xs,ref,outside=False):
    ds=values(ref['d'],len(xs));sp=values(ref['spokes'],len(xs));drivers=ref.get('drivers',[])
    for i in range(len(xs)-1):
        assert xs[i+1]-xs[i]>(ds[i]+ds[i+1])/2+.02,(name,'overlapping wheels',xs,ds)
    _,turn,shares,cycle=wheel_cycle(ds,sp,drivers,bool(ref.get('rods')))
    axes=[{'x':x,'d_f':d,'spokes':s,'driver':i in drivers,'turn':shares[i]} for i,(x,d,s) in enumerate(zip(xs,ds,sp))]
    colours=wheel_colours(None,ref);colours['tyre']=rg.np.array([65,68,72])/255
    colours['rod']=rg.np.array([143,133,111] if name.startswith(('mav375','class08')) else [145,150,154])/255
    base={'scale':1,'x_scale':1,'gauge_half':G,'axles':axes,'colors':colours}
    if ref.get('rods'):base['rods']=rod_spec(ref['rods'],axes,drivers,1,1)
    if outside:
        base['frame']={'type':'cast_side','x0':xs[0]-.30,'x1':xs[-1]+.30,'bottom':.30,'top':max(ds)*.83,'out':.12,'thick':.10,'chord':.10}
        base['boxes']={'out':.13,'w':.23,'h':.22,'depth':.12}
        base['springs']={'out':.13,'leaf':[(x,d*.79,.54) for x,d in zip(xs,ds)]}
    else:
        base['frame']={'type':'plate_inside','x0':xs[0]-.2,'x1':xs[-1]+.2,'bottom':max(ds)*.58,'top':max(ds)*.80,'inset':.18,'thick':.07}
    for phase in range(8):
        o=rg.bogie(f'{name}_w{phase}',{**base,'turn':turn*phase/8},TILE,colours,SHADING)
        for slot in o.material_slots:slot.material=principled(slot.material)
        for frame in range(1,10):
            o.hide_render=(frame-1)%8!=phase;o.keyframe_insert(data_path='hide_render',frame=frame)
        o.hide_render=phase!=0
    return {'mode':'timeline','start':1,'period_frames':8,'radius':cycle/math.tau,'symmetry':1}
def clear_arches(o,axles):
    bm=bmesh.new();bm.from_mesh(o.data);matrix=o.matrix_world
    remove=[]
    for f in bm.faces:
        c=matrix@f.calc_center_median()
        if abs(c.y)<G-.22:continue
        if any((c.x-x)**2+(c.z-d/2)**2<(d/2+.075)**2 for x,d in axles):remove.append(f)
    bmesh.ops.delete(bm,geom=remove,context='FACES');bm.to_mesh(o.data);bm.free()
    return len(remove)
for id in ids:
    P=R/'prepared'/id;mp=P/'candidate.json';m=json.loads(mp.read_text());spec=json.loads((R/'specs'/f'{id}.json').read_text());cal=json.loads((P/'calibration.json').read_text());audit[id]=[]
    for layout,gear in zip(spec['geometry']['parts'],spec['geometry']['gear']):
        body=layout[0];part=next(p for p in m['parts'] if p['name']==body)
        bpy.ops.wm.open_mainfile(filepath=part['source']);scene=bpy.context.scene;scene.frame_set(1)
        if scene.get('reference_gear_v3'):raise ValueError('Already rebuilt')
        # Keep textured reference body; replace old wheels and solid filler skirts only.
        for o in list(scene.objects):
            if o.name.startswith(('wheels_','skirt_')):bpy.data.objects.remove(o,do_unlink=True)
        meshes=[o for o in scene.objects if o.type=='MESH']
        pts=[o.matrix_world@v.co for o in meshes for v in o.data.vertices];lo=min(v.x for v in pts);hi=max(v.x for v in pts);length=hi-lo
        def x(u):return lo+u*length
        rigid=gear['rigid'];rr=gear['wheels'].get('rigid');all_axles=[];groups=[]
        if rigid:
            xs=[x(u) for u in rigid];ds=values(rr['d'],len(xs));all_axles+=list(zip(xs,ds))
        for ti,us in enumerate(gear['trucks']):
            ref=gear['wheels']['trucks'][ti];tx=[x(u) for u in us];ds=values(ref['d'],len(tx));centre=sum(tx)/len(tx)
            groups.append((ti,[a-centre for a in tx],ref,centre));all_axles+=list(zip(tx,ds))
        cut=sum(clear_arches(o,all_axles) for o in meshes)
        bc=next(c for c in cal if c['part']==body)
        if rigid:
            part['wheel']=add_gear(id+'_'+body,xs,rr);part['max_phase_bounds_drift']=3
            bc['axles']=[{'x_m':a,'d_m':d} for a,d in zip(xs,values(rr['d'],len(xs)))]
        scene.frame_set(1);scene['reference_gear_v3']=True
        bpy.context.view_layer.update()
        visible=[o.matrix_world@v.co for o in scene.objects if o.type=='MESH' and not o.hide_render for v in o.data.vertices]
        part['length_tiles']=(max(v.x for v in visible)-min(v.x for v in visible))/TILE
        bpy.data.libraries.write(part['source'],{scene},fake_user=True,compress=True)
        part['source_sha256']=hashlib.sha256(Path(part['source']).read_bytes()).hexdigest();m['reference']['prepared_sources'][body]=part['source_sha256']
        audit[id].append({'part':body,'axles':all_axles,'body_faces_cleared_for_wheels':cut})
        for ti,xs,ref,centre in groups:
            name=body+'-t'+str(ti);p=next(p for p in m['parts'] if p['name']==name)
            bpy.ops.wm.read_factory_settings(use_empty=True)
            p['wheel']=add_gear(id+'_'+name,xs,ref,outside=ref.get('frame')=='outside');p['max_phase_bounds_drift']=3
            bpy.context.scene.frame_set(1);bpy.context.view_layer.update()
            pts=[o.matrix_world@v.co for o in bpy.context.scene.objects if o.type=='MESH' and not o.hide_render for v in o.data.vertices]
            p['length_tiles']=(max(v.x for v in pts)-min(v.x for v in pts))/TILE;p.pop('window_mask',None);p['effects']={}
            bpy.data.libraries.write(p['source'],{bpy.context.scene},fake_user=True,compress=True)
            p['source_sha256']=hashlib.sha256(Path(p['source']).read_bytes()).hexdigest();m['reference']['prepared_sources'][name]=p['source_sha256']
            c=next(c for c in cal if c['part']==name);c['axles']=[{'x_m':a,'d_m':d} for a,d in zip(xs,values(ref['d'],len(xs)))];c['gear'][0].update(centre_m=centre,model_off_m=0)
    m['reference']['guidelines']+='; 2026-10-08 owner: standard rail gauge reduced25% to0.24tile. Axles and diameters now authored from workbook proportions, no automatic detector or shrink-to-fit. Body wheel apertures cleared; original M62 body preserved.'
    mp.write_text(json.dumps(m,indent=2)+'\n');(P/'calibration.json').write_text(json.dumps(cal,indent=2)+'\n')
(R/'gear-audit.json').write_text(json.dumps(audit,indent=2)+'\n');print('Rebuilt reference wheels',','.join(ids))

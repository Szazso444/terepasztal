"""Owner-requested transverse-only correction; preserves length, height, wheel radii.
Run once on the isolated copies from setup.py. Original batch4 stays unchanged.
"""
import bpy,json,hashlib,sys
from pathlib import Path
R=Path(__file__).resolve().parent
HALF=6.235064799811727*.16; OLD=.499; DELTA=HALF-OLD
ids=sys.argv[sys.argv.index('--')+1:]
report={}
def gear_y(y):
    return y+DELTA if y>=.30 else y-DELTA if y<=-.30 else y*(.30+DELTA)/.30
for id in ids:
    P=R/'prepared'/id; path=P/'candidate.json'; m=json.loads(path.read_text())
    report[id]=[]
    for p in m['parts']:
        bpy.ops.wm.open_mainfile(filepath=p['source']);scene=bpy.context.scene; scene.frame_set(1)
        if scene.get('width_revision'): raise ValueError('Already corrected: '+p['source'])
        truck='-t' in p['name']; is_new=id=='m62'
        before=[]; after=[]
        for o in scene.objects:
            if o.type=='MESH' and not o.hide_render: before.extend([o.matrix_world@v.co for v in o.data.vertices])
        # Pivot children move rigidly with their pivot, retaining circular wheel rotation.
        if truck and not is_new:
            for o in scene.objects:
                if o.type=='EMPTY' and o.name.startswith('Wheelpivot'): o.location.y=gear_y(o.location.y)
            bpy.context.view_layer.update()
        for o in scene.objects:
            if o.type!='MESH': continue
            if o.parent and o.parent.name.startswith('Wheelpivot'): continue
            wheel=o.name.startswith('wheels_') or o.name.startswith('skirt_')
            matrix=o.matrix_world.copy(); inv=matrix.inverted()
            for v in o.data.vertices:
                co=matrix@v.co
                if truck or wheel:
                    if not is_new: co.y=gear_y(co.y)
                else: co.y*=.85
                v.co=inv@co
        if not truck:
            for points in p.get('effects',{}).values():
                if isinstance(points,list):
                    for pt in points:
                        if isinstance(pt,list) and len(pt)==3: pt[1]*=.85
        bpy.context.view_layer.update()
        for o in scene.objects:
            if o.type=='MESH' and not o.hide_render: after.extend([o.matrix_world@v.co for v in o.data.vertices])
        def dims(pts):return [max(v[a] for v in pts)-min(v[a] for v in pts) for a in range(3)]
        a,b=dims(before),dims(after)
        assert abs(a[0]-b[0])<1e-4 and abs(a[2]-b[2])<1e-4, 'Length or height drift'
        scene['width_revision']='2026-10-08 owner: body width -15%, standard track wheel centres'
        bpy.data.libraries.write(p['source'],{scene},fake_user=True,compress=True)
        p['source_sha256']=hashlib.sha256(Path(p['source']).read_bytes()).hexdigest()
        m['reference']['prepared_sources'][p['name']]=p['source_sha256']
        report[id].append({'part':p['name'],'before_dimensions':a,'after_dimensions':b,'rail_half_m':HALF})
    m['reference']['guidelines']+='; 2026-10-08 owner width correction: body transverse width reduced 15%; standard gauge wheel tread centres +/-0.99761036797m; length/height unchanged. M62 retains original picture reconstruction, simplified replacement rejected.'
    path.write_text(json.dumps(m,indent=2)+'\n')
(R/('width-audit-'+('-'.join(ids))+'.json')).write_text(json.dumps(report,indent=2))
print('Corrected',','.join(ids))

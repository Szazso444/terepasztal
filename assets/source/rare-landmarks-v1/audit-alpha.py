from pathlib import Path
from PIL import Image
import json
root=Path(__file__).parent
records=[]
for p in sorted(root.glob('*.png')):
    im=Image.open(p)
    alpha=im.getchannel('A') if 'A' in im.getbands() else None
    h=alpha.histogram() if alpha else []
    bounds=alpha.point(lambda v:255 if v>128 else 0).getbbox() if alpha else None
    records.append(dict(file=p.name,size=list(im.size),mode=im.mode,alpha_range=list(alpha.getextrema()) if alpha else None,transparent_pixels=h[0] if h else 0,solid_bounds=bounds,solid_touches_canvas=bool(bounds and (bounds[0]==0 or bounds[1]==0 or bounds[2]==im.width or bounds[3]==im.height)),projection_status='not-certified'))
(root/'alpha-report.json').write_text(json.dumps(records,indent=2))
assert len([p for p in root.glob('*.png') if '-grid-' not in p.name])==12
assert all(r['mode']=='RGBA' and r['transparent_pixels']>0 and not r['solid_touches_canvas'] for r in records)
print(json.dumps({'pngs_checked':len(records),'original_landmarks':12,'rgba_and_transparent':True,'solid_silhouettes_unclipped':True,'projection':'not-certified'}))

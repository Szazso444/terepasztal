from pathlib import Path
from PIL import Image
import json, shutil, hashlib, zipfile
root=Path(__file__).parent
final=root/'final'
manifest=json.loads((final/'manifest.json').read_text())
report=[]
for a in manifest['assets']:
    src=(final/a['source_candidate']).resolve()
    dst=final/a['file']
    shutil.copyfile(src,dst)
    assert hashlib.sha256(src.read_bytes()).digest()==hashlib.sha256(dst.read_bytes()).digest()
    im=Image.open(dst)
    assert im.mode=='RGBA'
    alpha=im.getchannel('A')
    hist=alpha.histogram()
    bounds=alpha.point(lambda v:255 if v>128 else 0).getbbox()
    assert hist[0]>0 and bounds and bounds[0]>0 and bounds[1]>0 and bounds[2]<im.width and bounds[3]<im.height
    a['source_resolution_pixels']=list(im.size)
    a['solid_alpha_bounds_pixels']=list(bounds)
    report.append(dict(file=a['file'],resolution=list(im.size),alpha_range=list(alpha.getextrema()),transparent_pixels=hist[0],solid_bounds=list(bounds),solid_silhouette_unclipped=True,source_sha256=hashlib.sha256(dst.read_bytes()).hexdigest()))
(final/'manifest.json').write_text(json.dumps(manifest,indent=2))
(final/'alpha-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'selected_pngs':len(report),'all_rgba':True,'all_have_alpha_zero':True,'all_solid_silhouettes_unclipped':True,'images_warped_or_resized':False}))

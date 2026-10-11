"""Refine M62 glazing mask and rerender only its affected window frames."""
from pathlib import Path
import json,sys,hashlib,shutil,copy
import numpy as np
from PIL import Image,ImageFilter
R=Path(__file__).resolve().parent;REPO=R.parents[3]
sys.path.insert(0,str(REPO/'tools/asset-pipeline/painted'))
from run import load_manifest,signature,cached,write,digest,blender_render,pack
BLENDER='C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';mp=R/'prepared/m62/candidate.json'
installed=json.loads((R.parent/'installed.json').read_text())['m62'];old=Path(installed['bundle']);receipt=json.loads((old/'receipt.json').read_text());key=receipt['key'];assert cached(old,key)
oldinputs=json.loads((old/'inputs.json').read_text());spec=copy.deepcopy(oldinputs['manifest']);profile=oldinputs['profile']
part=spec['parts'][0];old_mask=Path(part['window_mask']['path'])
colour=np.array(Image.open(R/'m62-colour-uv.png').convert('RGB')).astype(float);mask=np.array(Image.open(old_mask).convert('RGB'))
r,g,b=colour[:,:,0],colour[:,:,1],colour[:,:,2]
# Glass in the locked source is blue/teal. Green paint, cream surrounds and roof
# must not become emissive merely because a projected polygon crosses them.
glass=(b>=g*.93)&(b>=r*1.16)&(g>r*1.10)
keep=Image.fromarray((glass*255).astype('uint8')).filter(ImageFilter.MinFilter(3))
filtered=mask.copy();filtered[np.array(keep)==0]=0
new_mask=old_mask.with_name('body-window-glazing-v4.png');Image.fromarray(filtered).save(new_mask)
part['window_mask']={'path':str(new_mask),'sha256':digest(new_mask)}
write(mp,spec);spec,profile=load_manifest(mp);newkey,inputs=signature(spec,profile,BLENDER);newkey=hashlib.sha256((newkey+str(False)).encode()).hexdigest()
expected=copy.deepcopy(oldinputs);expected['manifest']['parts'][0]['window_mask']=part['window_mask'];assert inputs==expected
work=R/'window-refresh-m62';work.mkdir(exist_ok=True);frames=work/'frames'
if not frames.exists():shutil.copytree(old/'frames',frames)
job={'profile':profile,'part':part,'facings':list(range(96)),'heading_count':96,'phases':[]}
raw=work/'window-raw'
if not (raw/'meta.json').exists():blender_render(BLENDER,job,raw)
meta=json.loads((raw/'meta.json').read_text());names=[n for n in meta['frames'] if '_lit_f' in n];assert len(names)==96
for name in names:
 with Image.open(raw/name) as im:
  im=im.convert('RGBA').resize((part['canvas'],)*2,Image.Resampling.BOX)
  pixels=np.asarray(im).copy();level=pixels[:,:,:3].max(axis=2).astype('float32')/255
  pixels[:,:,3]=(pixels[:,:,3]*level).astype('uint8');pixels[:,:,:3]=(255,211,137)
  Image.fromarray(pixels).save(frames/name)
pages=pack(frames,work/'atlas',profile['resolution']);report=json.loads((old/'report.json').read_text());report['pages']=pages
write(work/'report.json',report);write(work/'inputs.json',inputs);shutil.copy2(old/'fit-patch.json',work/'fit-patch.json')
assert digest(old/'fit-patch.json')==digest(work/'fit-patch.json')
for f in frames.glob('*.png'):
 if '_body_lit_' not in f.name:assert digest(f)==digest(old/'frames'/f.name)
outputs=list((work/'atlas').glob('*'))+list(frames.glob('*.png'))+[work/'fit-patch.json',work/'report.json',work/'inputs.json']
write(work/'receipt.json',{'key':newkey,'files':{str(p.relative_to(work)):digest(p) for p in outputs}})
dest=old.parent/newkey[:16];assert not dest.exists();shutil.move(str(work),dest);assert cached(dest,newkey)
write(R/'window-correction.json',{'id':'m62','previous_key':key[:16],'key':newkey[:16],'affected_frames':96,'body_and_bogie_frames_unchanged':True,'old_mask_pixels':int((mask.max(2)>0).sum()),'new_mask_pixels':int((filtered.max(2)>0).sum()),'rule':'Restrict source UV window mask to blue/teal glazing, inset one texture pixel.'})
print('M62 window mask refreshed',newkey[:16])

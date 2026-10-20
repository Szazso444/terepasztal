import json,sys
from pathlib import Path
from PIL import Image,ImageDraw,ImageFilter
import numpy as np
from collections import deque
root=Path('G:/DEV/wt/codex-fuelpump/assets/source/fuel-2026-10-11')
v=sys.argv[1]; k=int(sys.argv[2]); p=root/f'raw/fuel_pump-a1-{v}-attempt-{k}.png'
im=Image.open(p); w,h=im.size;s0=w/1024
j=json.loads(Path(f'G:/DEV/wt/codex-tmp/fuelpump/scaffolds/fuel_pump-{v}.json').read_text())
def filled(a):
 a=np.asarray(a)>128;bg=~a; seen=np.zeros(a.shape,bool);q=deque()
 for x in range(a.shape[1]):
  for y in [0,a.shape[0]-1]:
   if bg[y,x] and not seen[y,x]:seen[y,x]=1;q.append((y,x))
 for y in range(a.shape[0]):
  for x in [0,a.shape[1]-1]:
   if bg[y,x] and not seen[y,x]:seen[y,x]=1;q.append((y,x))
 while q:
  y,x=q.popleft()
  for yy,xx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
   if 0<=yy<a.shape[0] and 0<=xx<a.shape[1] and bg[yy,xx] and not seen[yy,xx]:seen[yy,xx]=1;q.append((yy,xx))
 return ~seen
raw=filled(im.getchannel('A')); ref=Image.new('L',(w,h));d=ImageDraw.Draw(ref)
for poly in j['outline_polygon_px']:d.polygon([(x*s0,y*s0) for x,y in poly],fill=255)
target=np.asarray(ref)>128
# Transform reference to painting; fixed scale s0 and uniform fit f plus returned-pixel translation.
small=256; scale=small/w
src=ref.resize((small,round(h*scale)),Image.Resampling.NEAREST);tar=np.asarray(Image.fromarray(raw).resize(src.size,Image.Resampling.NEAREST))>0
def iou(f,dx,dy,full=False):
 source=ref if full else src;t=target if full else tar; paint=raw if full else tar
 # paint compared with transformed reference
 fac=1 if full else scale
 mask=np.asarray(source.transform(source.size,Image.Transform.AFFINE,(1/f,0,-dx*fac/f,0,1/f,-dy*fac/f),Image.Resampling.NEAREST))>128
 return np.count_nonzero(mask&paint)/np.count_nonzero(mask|paint)
ry,rx=np.nonzero(target);py,px=np.nonzero(raw)
best=(0,1,0,0)
for f in np.arange(.85,1.1501,.025):
 dx=float(px.mean()-rx.mean()*f);dy=float(py.mean()-ry.mean()*f)
 for ox in [-40,-20,0,20,40]:
  for oy in [-40,-20,0,20,40]:
   val=iou(f,dx+ox,dy+oy)
   if val>best[0]:best=(val,float(f),dx+ox,dy+oy)
for fs,ds in [(.01,10),(.004,4),(.001,1)]:
 old=best
 for f in [old[1]-fs,old[1],old[1]+fs]:
  if not .85<=f<=1.15:continue
  for dx in [old[2]-ds,old[2],old[2]+ds]:
   for dy in [old[3]-ds,old[3],old[3]+ds]:
    val=iou(f,dx,dy)
    if val>best[0]:best=(val,float(f),dx,dy)
_,f,dx,dy=best
trans=np.asarray(ref.transform(ref.size,Image.Transform.AFFINE,(1/f,0,-dx/f,0,1/f,-dy/f),Image.Resampling.NEAREST))>128
rad=max(1,round(2*s0*f));opened=np.asarray(Image.fromarray(raw).convert('L').filter(ImageFilter.MinFilter(rad*2+1)).filter(ImageFilter.MaxFilter(rad*2+1)))>0
def boundary(a):
 er=np.asarray(Image.fromarray(a).convert('L').filter(ImageFilter.MinFilter(3)))>0
 return np.argwhere(a&~er)
a=boundary(opened);b=boundary(trans)
def hd(a,b):
 worst=0
 for chunk in np.array_split(a,max(1,len(a)//100)):
  diff=chunk[:,None,:].astype(float)-b[None,:,:]
  worst=max(worst,float(np.sqrt((diff*diff).sum(2).min(1)).max()))
 return worst
out={'returned':[w,h],'silhouette':{'iouAtS0':iou(1,0,0,True),'f':f,'dx':dx,'dy':dy,'bestFitIou':iou(f,dx,dy,True),'boundaryDeviationCanvasPx':max(hd(a,b),hd(b,a))/(s0*f)}}
out['silhouette']['pass']=out['silhouette']['bestFitIou']>=.9 and out['silhouette']['boundaryDeviationCanvasPx']<=24
print(json.dumps(out,default=lambda o:o.item())); Path(f'G:/DEV/wt/codex-tmp/fuelpump/{v}-{k}-measure.json').write_text(json.dumps(out,indent=2,default=lambda o:o.item()))
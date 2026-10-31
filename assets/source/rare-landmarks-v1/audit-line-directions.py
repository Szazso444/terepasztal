"""Read-only line-direction diagnostic; roof slopes and irregular ruins require visual review."""
from pathlib import Path
from PIL import Image
import numpy as np, json
root=Path(__file__).parent
results=[]
for f in sorted(root.glob('*.png')):
    if '-grid-v2' in f.name: continue
    im=Image.open(f).convert('RGBA')
    im.thumbnail((768,768))
    a=np.asarray(im).astype(float)
    gray=a[:,:,:3].mean(axis=2)
    gy,gx=np.gradient(gray)
    mag=np.hypot(gx,gy)
    yy,xx=np.indices(gray.shape)
    mask=(mag>28)&(a[:,:,3]>200)&(yy>gray.shape[0]*.38)&(yy<gray.shape[0]*.95)
    y,x=yy[mask],xx[mask]
    dx,dy=gx[mask],gy[mask]
    scans=[]
    for sign in [-1,1]:
        scores=[]
        for slope in np.arange(.25,.76,.005)*sign:
            align=np.abs(dx+slope*dy)/(np.hypot(dx,dy)*np.sqrt(1+slope*slope)+1e-6)
            take=align<.16
            bins=np.rint(y[take]-slope*x[take]+1024).astype(int)
            h=np.bincount(bins,minlength=3072)
            conv=np.convolve(h,np.ones(4),mode='valid')
            score=float(conv.max()) if len(conv) else 0
            scores.append((score,float(slope)))
        scans.append(sorted(scores,reverse=True)[:5])
    results.append({'file':f.name,'strong_line_candidates':scans,'note':'Diagnostic only: sloped roofs and detailed trim can dominate.'})
(root/'line-direction-diagnostic.json').write_text(json.dumps(results,indent=2))
for r in results: print(r['file'],[round(s[0][1],3) for s in r['strong_line_candidates']])

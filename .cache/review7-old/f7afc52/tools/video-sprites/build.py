import numpy as np, cv2, glob, os, sys
from PIL import Image
exec(open('match.py').read().split("files=sorted")[0])
S=0.24
files=sorted(glob.glob('vf/*.png')); score=np.load('score.npy')
drawn=[f for f in range(48) if f<=(12-f)%48]
for d in ('game','x4'): os.makedirs(f'final2/{d}',exist_ok=True)
pick={}
for f in drawn:
    i,fl=np.unravel_index(score[:,:,f].argmax(),score.shape[:2]); pick[f]=(int(i),int(fl),float(score[i,fl,f]))
print({f:(v[0],v[1],round(v[2],2)) for f,v in pick.items()})
C=384
for f,(i,fl,sc) in pick.items():
    im,m=vmask(files[i])
    if fl: im,m=im[:,::-1],m[:,::-1]
    bg=np.median(np.concatenate([im[:20].reshape(-1,3),im[-20:].reshape(-1,3)]),0)
    m2=ndi.binary_erosion(m,iterations=1)
    x0,y0,x1,y1=bbox(m2)
    rgb=im[y0:y1,x0:x1]*m2[y0:y1,x0:x1,None]; a=m2[y0:y1,x0:x1].astype(np.float32)
    w=round((x1-x0)*S); h=round((y1-y0)*S)
    prgb=cv2.resize(rgb,(w,h),interpolation=cv2.INTER_AREA); pa=cv2.resize(a,(w,h),interpolation=cv2.INTER_AREA)
    sx0,sy0,sx1,sy1=sb[f]; cx=(sx0+sx1)/2; cy=(sy0+sy1)/2
    ox=int(round(cx-w/2)); oy=int(round(cy-h/2))
    canvas=np.zeros((C,C,4),np.float32)
    ys0,xs0=max(oy,0),max(ox,0); ys1,xs1=min(oy+h,C),min(ox+w,C)
    canvas[ys0:ys1,xs0:xs1,:3]=prgb[ys0-oy:ys1-oy,xs0-ox:xs1-ox]   # premultiplied
    canvas[ys0:ys1,xs0:xs1,3]=pa[ys0-oy:ys1-oy,xs0-ox:xs1-ox]*255
    def save(c,path):
        al=c[...,3:4]/255; rgb=np.where(al>1e-3,c[...,:3]/np.maximum(al,1e-3),0)
        Image.fromarray(np.dstack([rgb.clip(0,255),c[...,3:4]]).round().astype(np.uint8),'RGBA').save(path)
    save(canvas,f'final2/x4/mk48_f{f}.png')
    g=canvas.reshape(96,4,96,4,4).mean((1,3)); save(g,f'final2/game/mk48_f{f}.png')
def sheet(d,scale,path,bg=(205,106,165,255)):
    ims=[Image.open(f'final2/{d}/mk48_f{f}.png') for f in drawn]
    w,h=ims[0].size; w2,h2=w*scale,h*scale
    sh=Image.new('RGBA',(w2*5,h2*5),bg)
    for k,im in enumerate(ims):
        im=im.resize((w2,h2),Image.NEAREST if scale>1 else Image.LANCZOS); sh.alpha_composite(im,((k%5)*w2,(k//5)*h2))
    sh.convert('RGB').save(path)
sheet('x4',1,'final2/sheet_x4.png'); sheet('game',4,'final2/sheet_game_x4.png')

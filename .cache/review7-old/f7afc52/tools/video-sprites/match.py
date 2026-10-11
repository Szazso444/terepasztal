import numpy as np, cv2, glob, json
from scipy import ndimage as ndi
def vmask(p):
    im=cv2.imread(p)[...,::-1].astype(np.float32)
    bg=np.median(np.concatenate([im[:20].reshape(-1,3),im[-20:].reshape(-1,3)]),0)
    # local bg: blur of border-ish pixels is overkill; use global bg with generous threshold
    d=np.sqrt(((im-bg)**2).sum(-1))
    m=d>45
    m=ndi.binary_opening(m,iterations=1)
    lab,n=ndi.label(m)
    if n==0: return im,m
    sz=ndi.sum(m,lab,range(1,n+1)); m=lab==(1+int(np.argmax(sz)))
    m=ndi.binary_fill_holes(ndi.binary_closing(m,iterations=2))
    return im,m
sil=[]
for f in range(48):
    a=cv2.imread(f'sil/mk48_f{f}.png',cv2.IMREAD_UNCHANGED)[...,3]>128
    sil.append(a)
def bbox(m):
    ys,xs=np.where(m); return xs.min(),ys.min(),xs.max()+1,ys.max()+1
sb=[bbox(s) for s in sil]
def crop_to_canvas(m,S,box):
    x0,y0,x1,y1=box
    c=m[y0:y1,x0:x1].astype(np.uint8)
    w=max(1,round((x1-x0)*S)); h=max(1,round((y1-y0)*S))
    return cv2.resize(c,(w,h),interpolation=cv2.INTER_AREA)>0.5
def iou_at(vm,sm,sbox):
    # align bbox centres
    H,W=sm.shape
    cx=(sbox[0]+sbox[2])/2; cy=(sbox[1]+sbox[3])/2
    h,w=vm.shape
    x0=int(round(cx-w/2)); y0=int(round(cy-h/2))
    canvas=np.zeros_like(sm)
    xs0,ys0=max(x0,0),max(y0,0); xs1,ys1=min(x0+w,W),min(y0+h,H)
    if xs1<=xs0 or ys1<=ys0: return 0
    canvas[ys0:ys1,xs0:xs1]=vm[ys0-y0:ys1-y0,xs0-x0:xs1-x0]
    i=(canvas&sm).sum(); u=(canvas|sm).sum()
    return i/u
files=sorted(glob.glob('vf/*.png'))[::3]
masks=[vmask(p)[1] for p in files]
boxes=[bbox(m) for m in masks]
best_S=None
for S in (0.17,0.19,0.2,0.21,0.22,0.23,0.25):
    tot=0
    for m,b in zip(masks,boxes):
        vm=crop_to_canvas(m,S,b)
        tot+=max(iou_at(vm,sil[f],sb[f]) for f in range(48))
    print(S,tot/len(masks))
print('refine')
for S in (0.235,0.24,0.245,0.25,0.255,0.26,0.27):
    tot=0
    for m,b in zip(masks,boxes):
        vm=crop_to_canvas(m,S,b)
        tot+=max(iou_at(vm,sil[f],sb[f]) for f in range(48))
    print(S,tot/len(masks))

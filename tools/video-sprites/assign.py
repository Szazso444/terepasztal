import numpy as np, cv2, glob, json, sys
sys.argv=['x']
exec(open('match.py').read().split("files=sorted")[0])
S=0.24
files=sorted(glob.glob('vf/*.png'))
rows=[]   # (frame_idx, flip, best facing list of ious)
score=np.zeros((len(files),2,48))
for i,p in enumerate(files):
    im,m=vmask(p)
    for fl in (0,1):
        mm=m[:,::-1] if fl else m
        vm=crop_to_canvas(mm,S,bbox(mm))
        for f in range(48): score[i,fl,f]=iou_at(vm,sil[f],sb[f])
np.save('score.npy',score)
seq=[(int(score[i].max(0).argmax()),round(float(score[i].max()),2)) for i in range(0,len(files),6)]
print(seq)

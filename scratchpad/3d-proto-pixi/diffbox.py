import sys
import numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(int)
b = np.asarray(Image.open(sys.argv[2]).convert("RGB")).astype(int)
d = np.abs(a - b).max(2); d[:50, :] = 0
ys, xs = np.nonzero(d)
print("bbox", xs.min(), ys.min(), xs.max(), ys.max())
# split by x columns of 100px
for x0 in range(0, d.shape[1], 100):
    print(x0, int((d[:, x0:x0+100] > 0).sum()), end=" | ")
print()
out = np.zeros_like(a, dtype=np.uint8); out[...] = (a * 0.4).astype(np.uint8); out[d > 0] = (255, 0, 255)
Image.fromarray(out).save(sys.argv[3])

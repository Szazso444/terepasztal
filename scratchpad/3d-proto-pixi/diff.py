import sys
import numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(int)
for p in sys.argv[2:]:
    b = np.asarray(Image.open(p).convert("RGB")).astype(int)
    d = np.abs(a - b).max(2)
    # ignore the label strip
    d[:50, :] = 0
    print(p, "differing px:", int((d > 0).sum()), "of", d.size, "| >16:", int((d > 16).sum()), "| max", int(d.max()))

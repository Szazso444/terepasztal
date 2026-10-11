from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import subprocess,sys
R=Path(__file__).resolve().parent;repo=R.parents[3]
def one(id):
 with (R/f'production-{id}.log').open('w') as log:
  code=subprocess.run([sys.executable,str(repo/'tools/asset-pipeline/painted/run.py'),str(R/'prepared'/id/'candidate.json'),'--blender','C:/Program Files/Blender Foundation/Blender 5.2/blender.exe','--out',str(R/'production')],stdout=log,stderr=subprocess.STDOUT).returncode
 print(id,code,flush=True);return code
with ThreadPoolExecutor(max_workers=2) as pool:codes=list(pool.map(one,sys.argv[1:]))
raise SystemExit(1 if any(codes) else 0)

from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import subprocess
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[3]
BLENDER='C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
def one(spec):
 id=spec.stem
 with (ROOT/f'prepare-{id}.log').open('w') as log:
  p=subprocess.run([BLENDER,'-b','--factory-startup','--python-exit-code','1','--python',str(REPO/'tools/asset-pipeline/painted/prepare_reference.py'),'--',str(spec)],stdout=log,stderr=subprocess.STDOUT)
 print(id,p.returncode,flush=True)
 return p.returncode
if __name__=='__main__':
 with ThreadPoolExecutor(max_workers=2) as pool: codes=list(pool.map(one,[p for p in sorted((ROOT/'specs').glob('*.json'))]))
 raise SystemExit(1 if any(codes) else 0)

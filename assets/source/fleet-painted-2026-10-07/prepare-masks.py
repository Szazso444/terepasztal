from pathlib import Path
import json,subprocess,concurrent.futures
r=Path('assets/source/fleet-painted-2026-10-07').resolve()
def one(p):
 c=json.loads(p.read_text());id=p.stem.removeprefix('prepare-')
 if id in ['bm50','gmam','c50']:return
 c['masks_only']=True;q=r/('masks-'+id+'.json');q.write_text(json.dumps(c))
 with (r/('masks-'+id+'.log')).open('w') as f:
  result=subprocess.run(['C:/Program Files/Blender Foundation/Blender 5.2/blender.exe','-b','--factory-startup','--python-exit-code','1','--python','tools/asset-pipeline/painted/prepare_existing.py','--',str(q)],stdout=f,stderr=subprocess.STDOUT)
 print(id,result.returncode,flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as e:list(e.map(one,r.glob('prepare-*.json')))

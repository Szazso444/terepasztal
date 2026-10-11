"""Render the frozen fleet manifests; preparation remains a separate stage."""
from pathlib import Path
import json,subprocess,sys,concurrent.futures,time
r=Path(__file__).resolve().parent
ids=[x['id'] for x in json.loads((r/'inventory.json').read_text(encoding='utf-8')) if x['id'] not in ['c50','bm50','gmam']]
profile=str(Path('tools/asset-pipeline/painted/profiles/fleet-painted-v1.json').resolve())
results=[];pending=set(ids);active={}
def render(id):
 source=r/'prepared'/id/'candidate.json';data=json.loads(source.read_text());data['profile']=profile
 for part in data['parts']:part['canvas']//=2
 target=r/'production-manifests'/f'{id}.json';target.write_text(json.dumps(data,indent=2))
 with (r/('production-'+id+'.log')).open('w',encoding='utf-8') as f:
  p=subprocess.run([sys.executable,'tools/asset-pipeline/painted/run.py',str(target),'--blender','C:/Program Files/Blender Foundation/Blender 5.2/blender.exe','--out',str(r/'production')],stdout=f,stderr=subprocess.STDOUT)
 return {'id':id,'exit':p.returncode}
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
 while pending or active:
  for id in ids:
   if len(active)>=2:break
   if id in pending and (r/'prepared'/id/'calibration.json').exists():
    pending.remove(id);active[executor.submit(render,id)]=id;print('Rendering',id,flush=True)
  done=[f for f in active if f.done()]
  for f in done:
   result=f.result();results.append(result);del active[f];print(result,flush=True)
   (r/'production-report.json').write_text(json.dumps(results,indent=2))
  if pending or active:time.sleep(5)

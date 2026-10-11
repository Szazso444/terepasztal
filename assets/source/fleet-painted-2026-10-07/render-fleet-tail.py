from pathlib import Path
import json,subprocess,sys,time,concurrent.futures
r=Path(__file__).resolve().parent
ids=[x['id'] for x in reversed(json.loads((r/'inventory.json').read_text(encoding='utf-8'))) if x['id'] not in ['c50','bm50','gmam']]
def one(id):
 while not (r/'prepared'/id/'calibration.json').exists():time.sleep(5)
 log=r/('production-'+id+'.log')
 if log.exists():return
 data=json.loads((r/'prepared'/id/'candidate.json').read_text());data['profile']=str(Path('tools/asset-pipeline/painted/profiles/fleet-painted-v1.json').resolve())
 for part in data['parts']:part['canvas']//=2
 target=r/'production-manifests'/f'{id}.json';target.write_text(json.dumps(data,indent=2))
 print('Rendering',id,flush=True)
 with log.open('w',encoding='utf-8') as f:
  code=subprocess.run([sys.executable,'tools/asset-pipeline/painted/run.py',str(target),'--blender','C:/Program Files/Blender Foundation/Blender 5.2/blender.exe','--out',str(r/'production')],stdout=f,stderr=subprocess.STDOUT).returncode
 print(id,code,flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as e:list(e.map(one,ids))

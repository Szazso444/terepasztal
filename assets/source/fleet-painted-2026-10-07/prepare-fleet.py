from pathlib import Path
import json,subprocess,concurrent.futures,time
root=Path(__file__).resolve().parent
blender='C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
script=Path('tools/asset-pipeline/painted/prepare_existing.py').resolve()
rows=json.loads((root/'inventory.json').read_text(encoding='utf-8'))
def one(row):
 id=row['id'];log=root/('prepare-'+id+'.log')
 if (root/'prepared'/id/'candidate.json').exists():return {'id':id,'status':'cached-candidate'}
 with log.open('w',encoding='utf-8') as f:
  result=subprocess.run([blender,'-b','--factory-startup','--python-exit-code','1','--python',str(script),'--',str(root/('prepare-'+id+'.json'))],stdout=f,stderr=subprocess.STDOUT)
 return {'id':id,'status':'prepared' if result.returncode==0 else 'failed','code':result.returncode}
results=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 futures=[pool.submit(one,r) for r in rows if r['id'] not in ['c50','gmam']]
 for future in concurrent.futures.as_completed(futures):
  result=future.result();results.append(result);print(result,flush=True);(root/'preparation-report.json').write_text(json.dumps(results,indent=2))

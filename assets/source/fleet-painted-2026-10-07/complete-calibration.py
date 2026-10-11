from pathlib import Path
import json,subprocess,concurrent.futures
r=Path(__file__).resolve().parent
ids=['big_boy','black_five','class08','crocodile','daylight','dda40x','deltic','drg01','general','gg1']
def one(id):
 c=json.loads((r/('prepare-'+id+'.json')).read_text());c['masks_only']=True;q=r/('calibration-'+id+'.json');q.write_text(json.dumps(c))
 with (r/('calibration-'+id+'.log')).open('w') as f:
  result=subprocess.run(['C:/Program Files/Blender Foundation/Blender 5.2/blender.exe','-b','--factory-startup','--python-exit-code','1','--python','tools/asset-pipeline/painted/prepare_existing.py','--',str(q)],stdout=f,stderr=subprocess.STDOUT)
 print(id,result.returncode,flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as e:list(e.map(one,ids))

from pathlib import Path
import json,subprocess,sys
root=Path(__file__).resolve().parent
rows=json.loads((root/'inventory.json').read_text(encoding='utf-8'))
selected=[]
for row in rows:
 id=row['id']
 if id=='c50':continue
 p=root/'handbuilt'/id/'manifest.json' if id in ['bm50','gmam'] else root/'prepared'/id/'candidate.json'
 data=json.loads(p.read_text(encoding='utf-8'))
 for part in data['parts']:
  effects=part.get('effects',{})
  if 'headlamps' in effects:effects['lamps']=effects.pop('headlamps')
 p.write_text(json.dumps(data,indent=2),encoding='utf-8');selected.append(str(p))
(root/'rollout-manifests.json').write_text(json.dumps(selected,indent=2),encoding='utf-8')
results=[]
for p in selected:
 id=json.loads(Path(p).read_text())['id']
 with (root/('sample-'+id+'.log')).open('w',encoding='utf-8') as log:
  r=subprocess.run([sys.executable,'tools/asset-pipeline/painted/run.py',p,'--blender','C:/Program Files/Blender Foundation/Blender 5.2/blender.exe','--out',str(root/'samples'),'--sample'],stdout=log,stderr=subprocess.STDOUT)
 item={'id':id,'exit':r.returncode};results.append(item);print(item,flush=True)
 (root/'sample-report.json').write_text(json.dumps(results,indent=2))

from pathlib import Path
import json,subprocess,sys
R=Path(__file__).resolve().parent;REPO=R.parents[3]
ids=sys.argv[1:]
for id in ids:
 p=R/'prepared'/id/'candidate.json'
 if not p.exists():continue
 m=json.loads(p.read_text())
 for q in m['parts']:q['canvas']=320 if q['length_tiles']>2 else 256
 p.write_text(json.dumps(m,indent=2)+'\n')
 with (R/f'sample-{id}.log').open('w') as log:
  code=subprocess.run([sys.executable,str(REPO/'tools/asset-pipeline/painted/run.py'),str(p),'--blender','C:/Program Files/Blender Foundation/Blender 5.2/blender.exe','--out',str(R/'samples'),'--sample'],stdout=log,stderr=subprocess.STDOUT).returncode
 print(id,code,flush=True)

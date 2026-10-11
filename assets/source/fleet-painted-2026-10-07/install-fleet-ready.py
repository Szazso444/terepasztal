"""Install only completed, hash-verified bundles matching the current fleet manifests."""
from pathlib import Path
import json,sys,hashlib
r=Path(__file__).resolve().parent
sys.path.insert(0,str(Path('tools/asset-pipeline/painted').resolve()))
from run import load_manifest,signature
from install import install
status_path=r/'installed.json';status=json.loads(status_path.read_text()) if status_path.exists() else {'bm50':{'key':'44a843da286d2023'},'gmam':{'key':'19eaaa1026148c46'}}
for manifest in sorted((r/'production-manifests').glob('*.json')):
 spec,profile=load_manifest(manifest);key,_=signature(spec,profile,'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe');key=hashlib.sha256((key+'False').encode()).hexdigest()[:16]
 id=spec['id'];bundle=r/'production'/id/key
 if not (bundle/'receipt.json').exists() or status.get(id,{}).get('key')==key:continue
 result=install(bundle,'C:/Users/Zso/terepasztal-playtest',apply=True);status[id]={'key':key,'bundle':str(bundle),'backup':result['backup']};status_path.write_text(json.dumps(status,indent=2));print('Installed',id,key,flush=True)
print('Installed total',len(status))

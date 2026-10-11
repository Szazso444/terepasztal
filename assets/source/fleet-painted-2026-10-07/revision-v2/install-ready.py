from pathlib import Path
import json, sys, hashlib
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[3]
sys.path.insert(0,str(REPO/'tools/asset-pipeline/painted'))
from run import load_manifest,signature,cached
from install import install
GAME=Path('C:/Users/Zso/terepasztal-playtest')
ids=['ice1','general','rocket','bm50']
assert len(ids)<=5
registry=ROOT.parent/'installed.json';installed=json.loads(registry.read_text())
for id in ids:
 spec,profile=load_manifest(ROOT/f'{id}.json')
 key,_=signature(spec,profile,'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe')
 key=hashlib.sha256((key+str(False)).encode()).hexdigest()
 bundle=ROOT/'production'/id/key[:16]
 if not bundle.exists() or not cached(bundle,key):continue
 if installed[id]['key']==key[:16]:continue
 result=install(bundle,GAME,True)
 if id=='bm50':
  gearfile=GAME/'src/data/gear.json';gear=json.loads(gearfile.read_text())
  fits=json.loads((GAME/'src/data/locoFit.json').read_text());length=fits[id]['tiles']
  report=json.loads((bundle/'report.json').read_text());scale=report['parts'][0]['scale']
  gear[id]['parts'][0]['rigid']=[round(.5+x*scale/(6.235064799811727*length),7) for x in [-1.6,-.125,1.35]]
  gearfile.write_text(json.dumps(gear,indent=2)+'\n')
 installed[id]={'key':key[:16],'bundle':str(bundle),'backup':result['backup'],'revision':'reference-v2'}
 registry.write_text(json.dumps(installed,indent=2)+'\n')
 print('Installed',id,key[:16])

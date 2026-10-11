"""Install only complete batch4 bundles; runtime geometry is measured output."""
from pathlib import Path
import hashlib,json,sys
R=Path(__file__).resolve().parent;REPO=R.parents[3];GAME=Path('C:/Users/Zso/terepasztal-playtest')
sys.path.insert(0,str(REPO/'tools/asset-pipeline/painted'))
from run import load_manifest,signature,cached
from install import install
TILE=6.235064799811727
for id in sys.argv[1:]:
 spec,profile=load_manifest(R/'prepared'/id/'candidate.json')
 key,_=signature(spec,profile,'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe');key=hashlib.sha256((key+str(False)).encode()).hexdigest()
 bundle=R/'production'/id/key[:16]
 if not cached(bundle,key):raise ValueError('Incomplete production bundle: '+id)
 report=json.loads((bundle/'report.json').read_text())
 if any(abs(p['scale']-1)>1e-4 for p in report['parts']):raise ValueError('Unexpected model scale; recalibrate explicitly')
 cal=json.loads((R/'prepared'/id/'calibration.json').read_text());bodies=[p for p in cal if '-t' not in p['part']]
 total=sum(p['tiles'][0] for p in bodies);done=0;parts=[];trucks={};offsets={}
 for b in bodies:
  n=b['part'];length=b['tiles'][0];a=1-(done+length)/total;z=1-done/total;done+=length;mid=(a+z)/2
  part={'part':n,'from':a,'to':z}
  def frac(x):return round(mid+x/(TILE*total),7)
  if b['axles']:part['rigid']=sorted(frac(q['x_m']) for q in b['axles'])
  owned=sorted([q for q in cal if q['part'].startswith(n+'-t')],key=lambda q:int(q['part'].split('-t')[1]))
  if owned:
   part['trucks']=[sorted(frac(q['gear'][0]['centre_m']+ax['x_m']) for ax in q['axles']) for q in owned]
   trucks[n]=list(range(len(owned)))
   offsets.update({q['part']:sum(ax['x_m'] for ax in q['axles'])/len(q['axles'])/TILE for q in owned})
  parts.append(part)
 gearpath=GAME/'src/data/gear.json';fitpath=GAME/'src/data/locoFit.json'
 gear=json.loads(gearpath.read_text());fits=json.loads(fitpath.read_text())
 backup=R/'runtime-before'/id;backup.mkdir(parents=True,exist_ok=True)
 for p in [gearpath,fitpath]:
  if not (backup/p.name).exists():(backup/p.name).write_bytes(p.read_bytes())
 result=install(bundle,GAME,True)
 gear[id]['parts']=parts;fits=json.loads(fitpath.read_text());fits[id].update(tiles=round(total,7),trucks=trucks,truckOffsets=offsets)
 gearpath.write_text(json.dumps(gear,indent=2)+'\n');fitpath.write_text(json.dumps(fits,indent=2)+'\n')
 registry=R.parent/'installed.json';data=json.loads(registry.read_text());data[id]={'key':key[:16],'bundle':str(bundle),'backup':result['backup'],'revision':'reference-batch4-width-v2'};registry.write_text(json.dumps(data,indent=2)+'\n')
 print('Installed',id,key[:16],flush=True)

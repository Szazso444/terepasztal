"""Derive runtime sockets from the actual prepared wheel coordinates."""
from pathlib import Path
import json,sys
ROOT=Path(__file__).resolve().parent
GAME=Path('C:/Users/Zso/terepasztal-playtest');TILE=6.235064799811727
gear=json.loads((GAME/'src/data/gear.json').read_text());fits=json.loads((GAME/'src/data/locoFit.json').read_text())
changes={}
for row in json.loads((ROOT/'inventory.json').read_text(encoding='utf-8')):
 id=row['id']
 if id in ['c50','bm50','gmam']:continue
 source=ROOT/'prepared'/id/'calibration.json'
 if not source.exists():continue
 cal={p['part']:p for p in json.loads(source.read_text())}
 if any('axles' not in p for p in cal.values()):continue
 ordered=sorted(gear[id]['parts'],key=lambda p:-p['to'])
 lengths=[cal[p['part']]['tiles'][0] for p in ordered];L=sum(lengths)
 done=0;parts=[];trucks={};offsets={}
 for old,length in zip(ordered,lengths):
  name=old['part'];p={k:v for k,v in old.items() if k not in ['from','to','rigid','trucks']};p.update(to=1-done/L,from_=1-(done+length)/L);p['from']=p.pop('from_');done+=length
  mid=(p['from']+p['to'])/2;sign=-1 if p.get('mirror') else 1
  def global_fraction(x):return round(mid+sign*x/(TILE*L),7)
  fixed=cal[name]['axles']
  if id=='mav375':fixed=[{'x_m':x} for x in json.loads((ROOT/'prepared'/id/'axle-repair.json').read_text())['x_m']]
  if fixed:p['rigid']=sorted(global_fraction(a['x_m']) for a in fixed)
  owned=sorted([q for q in cal.values() if q['part'].startswith(name+'-t')],key=lambda q:int(q['part'].split('-t')[1]))
  if owned:
   p['trucks']=[sorted(global_fraction(q['gear'][0]['centre_m']+a['x_m']) for a in q['axles']) for q in owned]
   assert all(p['trucks']),id
   trucks[name]=list(range(len(owned)))
   for q in owned:offsets[q['part']]=sum(a['x_m'] for a in q['axles'])/len(q['axles'])/TILE
  parts.append(p)
 gear[id]['parts']=parts;fits[id]['tiles']=round(L,7);fits[id]['trucks']=trucks;fits[id]['truckOffsets']=offsets
 changes[id]={'length_tiles':L,'parts':parts,'trucks':trucks}
# Hand-built candidates use a uniform scale, measured in the sample report.
L=fits['bm50']['tiles'];scale=.823028523956236
gear['bm50']['parts'][0]['rigid']=[round(.5+x*scale/(TILE*L),7) for x in [-1.6,1.35]]
fits['bm50']['trucks']={};changes['bm50']=gear['bm50']
L=3.27;engine=.99;cradle=1.29;scale=.9774441994705945
front=(engine+cradle)/L
front_axles=[(front+1)/2+x*scale/(TILE*L) for x in [-2.55,-1.62,-.54,.54,1.62,2.55]]
gear['gmam']={'dbSize':3,'gauge':'regular','parts':[
 {'part':'engine','from':front,'to':1,'rigid':front_axles},
 {'part':'cradle','from':engine/L,'to':front},
 {'part':'engine','from':0,'to':engine/L,'rigid':sorted(1-x for x in front_axles),'mirror':True}]}
fits.setdefault('gmam',{}).update({'tiles':L,'sprite':True,'trucks':{}})
changes['gmam']=gear['gmam']
(ROOT/'calibration-plan.json').write_text(json.dumps(changes,indent=2))
print('Calibrated',len(changes),'of 28',list(changes))
if '--apply' in sys.argv:
 only=next((x.split('=',1)[1].split(',') for x in sys.argv if x.startswith('--only=')),None)
 if only:
  for filename,data in [('gear.json',gear),('locoFit.json',fits)]:
   original=json.loads((GAME/'src/data'/filename).read_text());original.update({id:data[id] for id in only});data.clear();data.update(original)
 else:assert len(changes)==28,'Wait for all geometry calibration reports'
 for filename,data in [('gear.json',gear),('locoFit.json',fits)]:
  src=GAME/'src/data'/filename;backup=ROOT/('before-'+filename)
  if not backup.exists():backup.write_bytes(src.read_bytes())
  src.write_text(json.dumps(data,indent=2)+'\n')

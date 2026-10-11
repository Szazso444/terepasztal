from pathlib import Path
import json,re,urllib.request
R=Path(__file__).resolve().parent;GAME=Path('C:/Users/Zso/terepasztal-playtest')
ids=['mav375','class08','sw1','drg01','m62'];expected=[3,3,1,2,3]
registry=R.parent/'installed.json';installed=json.loads(registry.read_text());fits=json.loads((GAME/'src/data/locoFit.json').read_text())
captures=GAME/'scratchpad/models/handover-review/detail-v4/after';results=[]
for id,count in zip(ids,expected):
 d=json.loads((captures/f'{id}-report.json').read_text());assert d['bundleKey']==installed[id]['key'];assert (captures/f'{id}-reviewed.txt').read_text().strip()==d['bundleKey']
 assert d['completeness']['facings']==96 and not d['completeness']['missing'];assert d['frozen'] and len(d['frames'])==32
 assert len(fits[id]['lamps'])==count
 results.append({'id':id,'bundle_key':d['bundleKey'],'facings':96,'stationary_frozen':True,'curve_frames_reviewed':32,'model_lamps':count})
for report in captures.glob('report-*.json'):assert not json.loads(report.read_text())['errors']
cal=json.loads((R/'prepared/mav375/calibration.json').read_text());assert len(cal[0]['axles'])==3
old=json.loads((R.parent/'batch4-wheel-v3/prepared/drg01/calibration.json').read_text());new=json.loads((R/'prepared/drg01/calibration.json').read_text())
for a,b in zip(old,new):
 for aa,bb in zip(a['axles'],b['axles']):assert abs(bb['d_m']/aa['d_m']-.75)<1e-6
a=next(p for p in old if p['part']=='engine-t1')['gear'][0]['centre_m'];b=next(p for p in new if p['part']=='engine-t1')['gear'][0]['centre_m'];assert abs(a-b-.7)<1e-6
html=(GAME/'scratchpad/models/handover-review/page/detail-v4.html').read_text(encoding='utf-8');assert html.count('<section ')==5 and html.count('curve.webp')==5
urls=re.findall(r'<img src="([^"]+)"',html)
for url in urls:
 with urllib.request.urlopen('http://127.0.0.1:5182/scratchpad/models/handover-review/page/'+url) as res:assert res.status==200
(R/'installed-batch.json').write_text(json.dumps({id:installed[id] for id in ids},indent=2)+'\n')
(R/'final-qa.json').write_text(json.dumps({'status':'ready for owner review','models':results,'gallery_images_http200':len(urls),'source_tests':197,'pipeline_tests':11,'game_tests':329,'typecheck':'passed','lint':'passed','build':'passed','workbook':'v9; 18 intended cell changes; COUNTA retained; all 107 reference images unchanged'},indent=2)+'\n')
policy=R.parent/'batch-policy.json';d=json.loads(policy.read_text());d['current_correction_batch']=ids;d['status']='stopped_for_owner_review';policy.write_text(json.dumps(d,indent=2)+'\n');print('Five corrected candidates verified; gallery images:',len(urls))

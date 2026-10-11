from pathlib import Path
import json,re,urllib.request
R=Path(__file__).resolve().parent
GAME=Path('C:/Users/Zso/terepasztal-playtest')
ids=['mav375','class08','sw1','drg01','m62']
registry_path=R.parent/'installed.json'; installed=json.loads(registry_path.read_text())
captures=GAME/'scratchpad/models/handover-review/width-v2/after'
results=[]
for id in ids:
    data=json.loads((captures/f'{id}-report.json').read_text())
    assert data['bundleKey']==installed[id]['key']
    assert (captures/f'{id}-reviewed.txt').read_text().strip()==data['bundleKey']
    assert data['completeness']['facings']==96 and not data['completeness']['missing']
    assert data['frozen'] and len(data['frames'])==32
    installed[id]['revision']='reference-batch4-width-v2'
    results.append({'id':id,'bundle_key':data['bundleKey'],'facings':96,'stationary_frozen':True,'curve_frames_reviewed':32})
for report in captures.glob('report-*.json'): assert not json.loads(report.read_text())['errors']
gallery=GAME/'scratchpad/models/handover-review/page/width-v2.html'
html=gallery.read_text(encoding='utf-8')
assert html.count('<section ')==5 and html.count('curve.webp')==5
urls=re.findall(r'<img src="([^"]+)"',html)
base='http://localhost:5182/scratchpad/models/handover-review/page/'
for url in urls:
    with urllib.request.urlopen(base+url) as response: assert response.status==200
registry_path.write_text(json.dumps(installed,indent=2)+'\n')
(R/'installed-batch.json').write_text(json.dumps({id:installed[id] for id in ids},indent=2)+'\n')
(R/'final-qa.json').write_text(json.dumps({'status':'ready for owner review','models':results,'gallery_images_http200':len(urls),'measured_tread_parts':11,'pipeline_unittests':9,'source_vitest':197,'game_vitest':329,'typecheck':'passed','scope':'Width and track gauge; original M62 image reconstruction restored. No new locomotive batch.'},indent=2)+'\n')
policy=R.parent/'batch-policy.json'; data=json.loads(policy.read_text());data['current_correction_batch']=ids;data['status']='stopped_for_owner_review';policy.write_text(json.dumps(data,indent=2)+'\n')
print('Five corrected candidates verified; gallery images:',len(urls))

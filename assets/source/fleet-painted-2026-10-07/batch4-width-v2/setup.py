from pathlib import Path
import json, shutil
R=Path(__file__).resolve().parent; old=R.parent/'batch4'
ids=['mav375','class08','sw1','drg01','m62']
for folder in ['specs','prepared']: (R/folder).mkdir(exist_ok=True)
for p in (old/'specs').glob('*.json'):
    s=json.loads(p.read_text()); s['geometry']['gauge']='narrow' if p.stem in ['muki','mav490','mk45','mk48','rezet'] else 'standard'
    p.write_text(json.dumps(s,indent=2)+'\n')
    if p.stem not in ids: continue
    s['output']=str(R/'prepared'/p.stem)
    (R/'specs'/p.name).write_text(json.dumps(s,indent=2)+'\n')
    if p.stem=='m62': continue
    dest=R/'prepared'/p.stem
    shutil.copytree(old/'prepared'/p.stem,dest,dirs_exist_ok=True)
    mp=dest/'candidate.json'; m=json.loads(mp.read_text())
    for part in m['parts']:
        part['source']=str(dest/Path(part['source']).name)
        if part.get('window_mask'): part['window_mask']['path']=str(dest/Path(part['window_mask']['path']).name)
    mp.write_text(json.dumps(m,indent=2)+'\n')
for name in ['sample-batch.py','production-batch.py','install-ready.py','contact.py']:
    shutil.copy2(old/name,R/name)
print('Isolated five correction candidates; previous batch preserved')

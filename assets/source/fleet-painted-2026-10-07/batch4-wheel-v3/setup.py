from pathlib import Path
import json,shutil
R=Path(__file__).resolve().parent;old=R.parent/'batch4-width-v2'
ids=['mav375','class08','sw1','drg01','m62']
for folder in ['prepared','specs']:(R/folder).mkdir(exist_ok=True)
for id in ids:
    dest=R/'prepared'/id
    if dest.exists():raise ValueError('Do not overwrite a prepared revision')
    shutil.copytree(old/'prepared'/id,dest)
    m=json.loads((dest/'candidate.json').read_text())
    for p in m['parts']:
        p['source']=str(dest/Path(p['source']).name)
        if p.get('window_mask'):p['window_mask']['path']=str(dest/Path(p['window_mask']['path']).name)
    (dest/'candidate.json').write_text(json.dumps(m,indent=2)+'\n')
    s=json.loads((old/'specs'/f'{id}.json').read_text());s['output']=str(dest)
    (R/'specs'/f'{id}.json').write_text(json.dumps(s,indent=2)+'\n')
for name in ['sample-batch.py','production-batch.py','contact.py','install-ready.py']:
    text=(old/name).read_text().replace('reference-batch4-width-v2','reference-batch4-wheel-v3')
    (R/name).write_text(text)

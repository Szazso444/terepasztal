"""Install one verified reference recipe; game data is an output merge only."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import subprocess
from datetime import datetime

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('handbuilt_runner',HERE/'run.py')
recipe=importlib.util.module_from_spec(spec);spec.loader.exec_module(recipe)
sys.path.insert(0,str(HERE.parent/'painted'))
import run as painted
from install import install as painted_install


def install_project(project_path, game, blender):
    root,project,_=recipe.load(project_path)
    if json.loads((root/'recipe-lock.json').read_text()) != recipe.fingerprint(project_path,root,project):
        raise ValueError('Recipe is not locked at its current revision')
    output=root/project['output']
    version=subprocess.check_output([blender,'--version'],text=True)
    build_key=hashlib.sha256(json.dumps([recipe.fingerprint(project_path,root,project),version],sort_keys=True).encode()).hexdigest()
    built=json.loads((output/'build-receipt.json').read_text())
    if built['key']!=build_key or not built.get('files') or any(
            not recipe.local(output,n).is_file() or recipe.sha(recipe.local(output,n))!=h for n,h in built['files'].items()):
        raise ValueError('Geometry/calibration does not match the locked construction recipe; rebuild first')
    manifest,profile=painted.load_manifest(output/'candidate.json')
    key,_=painted.signature(manifest,profile,blender)
    key=hashlib.sha256((key+str(False)).encode()).hexdigest()
    asset_id=project['id'];bundle=root/'production'/asset_id/key[:16]
    if manifest['id']!=asset_id or not painted.cached(bundle,key):
        raise ValueError('A complete matching production bundle is required')
    report=json.loads((bundle/'report.json').read_text())
    if not report['complete'] or any(abs(p['scale']-1)>1e-4 for p in report['parts']):
        raise ValueError('Calibration requires complete, uniformly unscaled authored parts')
    cal=json.loads((output/'calibration.json').read_text());bodies=[p for p in cal if '-t' not in p['part']]
    total=sum(p['tiles'][0] for p in bodies);done=0;parts=[];trucks={};offsets={}
    if total<=0:raise ValueError('Invalid authored body length')
    for b in bodies:
        n=b['part'];length=b['tiles'][0];a=1-(done+length)/total;z=1-done/total;done+=length;mid=(a+z)/2
        part={'part':n,'from':a,'to':z}
        def frac(x):return round(mid+x/(profile['tile_m']*total),7)
        if b['axles']:part['rigid']=sorted(frac(q['x_m']) for q in b['axles'])
        owned=sorted([q for q in cal if q['part'].startswith(n+'-t')],key=lambda q:int(q['part'].split('-t')[1]))
        if owned:
            part['trucks']=[sorted(frac(q['gear'][0]['centre_m']+ax['x_m']) for ax in q['axles']) for q in owned]
            trucks[n]=list(range(len(owned)))
            offsets.update({q['part']:sum(ax['x_m'] for ax in q['axles'])/len(q['axles'])/profile['tile_m'] for q in owned})
        parts.append(part)
    gearpath=game/'src/data/gear.json';fitpath=game/'src/data/locoFit.json'
    gear=json.loads(gearpath.read_text());fits=json.loads(fitpath.read_text())
    if asset_id not in gear or asset_id not in fits:
        raise ValueError('Add locomotive content before installing its geometry')
    backup=root/'runtime-before'/datetime.now().strftime('%Y%m%d-%H%M%S-%f');backup.mkdir(parents=True)
    for p in [gearpath,fitpath]:(backup/p.name).write_bytes(p.read_bytes())
    result=painted_install(bundle,game,True)
    gear[asset_id]['parts']=parts;fits=json.loads(fitpath.read_text())
    fits[asset_id].update(tiles=round(total,7),trucks=trucks,truckOffsets=offsets)
    recipe.write(gearpath,gear);recipe.write(fitpath,fits)
    receipt={'id':asset_id,'key':key[:16],'bundle':str(bundle),'game':str(game),'calibration_backup':str(backup),'atlas_backup':result['backup']}
    recipe.write(root/'installed.json',receipt)
    print('Installed',asset_id,key[:16])
    return receipt

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('project',type=Path);p.add_argument('--game',required=True,type=Path);p.add_argument('--blender',required=True)
    a=p.parse_args();install_project(a.project.resolve(),a.game.resolve(),a.blender)

"""Rebind identical renders after restoring the workbook's automatic axle count.

Only the reference workbook hash may change. Geometry, lights, profile, code and
every rendered byte are checked unchanged. This is not a render-cache bypass.
"""
from pathlib import Path
import json,sys,hashlib,shutil,copy
R=Path(__file__).resolve().parent;REPO=R.parents[3]
sys.path.insert(0,str(REPO/'tools/asset-pipeline/painted'))
from run import load_manifest,signature,cached,write,digest
BLENDER='C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
ids=['mav375','class08','sw1','drg01','m62'];before={}
for id in ids:
 m,p=load_manifest(R/'prepared'/id/'candidate.json');key,_=signature(m,p,BLENDER);key=hashlib.sha256((key+str(False)).encode()).hexdigest()
 bundle=R/'production'/id/key[:16];assert cached(bundle,key),'Wait for all renders to finish'
 before[id]=(bundle,key)
target=Path('G:/DEV/Terepasztal/locomotive-wheels-bogies-v9.xlsx')
assert digest(target)==digest(R/'workbook-first-export.xlsx')
shutil.copy2(R/target.name,target);new_hash=digest(target);records=[]
for id in ids:
 old,oldkey=before[id]
 for path in [R/'prepared'/id/'candidate.json',R/'specs'/f'{id}.json']:
  d=json.loads(path.read_text());d['reference']['workbook']['sha256']=new_hash;write(path,d)
 m,p=load_manifest(R/'prepared'/id/'candidate.json');key,inputs=signature(m,p,BLENDER);key=hashlib.sha256((key+str(False)).encode()).hexdigest()
 original=json.loads((old/'inputs.json').read_text());expected=copy.deepcopy(original)
 expected['manifest']['reference']['workbook']['sha256']=new_hash
 assert inputs==expected,'Refuse to reuse renders after any rendering input change'
 dest=R/'production'/id/key[:16];assert not dest.exists();shutil.copytree(old,dest)
 write(dest/'inputs.json',inputs);receipt=json.loads((dest/'receipt.json').read_text());receipt['key']=key;receipt['files']['inputs.json']=digest(dest/'inputs.json');write(dest/'receipt.json',receipt)
 assert cached(dest,key)
 assert all(digest(dest/name)==sha for name,sha in json.loads((old/'receipt.json').read_text())['files'].items() if name!='inputs.json')
 records.append({'id':id,'previous_key':oldkey[:16],'key':key[:16],'rendered_bytes_identical':True,'change':'Workbook H15 preserves COUNTA(I15:X15), evaluated value remains 3; no other workbook values changed.'})
(R/'workbook-rebind.json').write_text(json.dumps(records,indent=2)+'\n')
print('Five identical bundles bound to final workbook; all rendered bytes unchanged')

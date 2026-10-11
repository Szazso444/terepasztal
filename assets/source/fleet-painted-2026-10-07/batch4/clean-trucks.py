from pathlib import Path
import subprocess,sys
R=Path(__file__).resolve().parent;repo=R.parents[3]
for id in ['drg01','mk45','mk48','sw1']:
 with (R/f'rebuild-trucks-{id}.log').open('w') as log:subprocess.run(['C:/Program Files/Blender Foundation/Blender 5.2/blender.exe','-b','--factory-startup','--python-exit-code','1','--python',str(repo/'tools/asset-pipeline/painted/rebuild_reference_trucks.py'),'--',str(R),id],stdout=log,stderr=subprocess.STDOUT,check=True)
 subprocess.run([sys.executable,str(R/'sample-batch.py'),id],check=True)

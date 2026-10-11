"""Isolated original-art reconstruction using the user's recovered Comfy workflow."""
import json
import shutil
import sys
import time
from pathlib import Path
sys.path.insert(0, 'G:/DEV/Terepasztal/files')
from comfy_client import Comfy, prepare_graph, find_model_file, format_exec_error

root = Path('G:/DEV/Terepasztal/poc/rocket-original-v1')
root.mkdir(parents=True, exist_ok=True)
source = Path('C:/Users/Zso/terepasztal/assets/source/base-v1/loco-rocket.png')
shutil.copy2(source, root/'original.png')
base = json.loads(Path('C:/Users/Zso/terepasztal/scratchpad/poc-recovered-workflow.json').read_text(encoding='utf-8-sig'))
comfy = Comfy('http://127.0.0.1:8188', log=lambda s: print(s, flush=True))
if (root/'raw.glb').exists():
    print('Existing reconstruction preserved.', flush=True)
    sys.exit(0)
q = comfy.get_json('/queue')
if q.get('queue_running') or q.get('queue_pending'):
    raise RuntimeError('ComfyUI busy; existing jobs preserved. Retry when idle.')
uploaded = comfy.upload_image(source, subfolder='terepasztal-poc-rocket-original-v1')
cfg = {'model':'keep','set':{'288.value':2048,'186.target_face_count':100000}}
graph, save_id = prepare_graph(base, uploaded, 'terepasztal-poc/rocket-original-v1', cfg)
# Execute only the saved model and its upstream dependencies, excluding UI-only previews.
needed = set()
def add(n):
    if n in needed: return
    needed.add(n)
    for v in graph[n]['inputs'].values():
        if isinstance(v,list) and len(v)==2 and isinstance(v[0],str) and v[0] in graph: add(v[0])
add(save_id)
graph = {k:v for k,v in graph.items() if k in needed}
(root/'workflow-api.json').write_text(json.dumps(graph,indent=2),encoding='utf8')
pid = comfy.queue(graph)
(root/'reconstruction.json').write_text(json.dumps({'prompt_id':pid,'source':str(source),'status':'running','style':'original unchanged','workflow_history':'1cb7d367-11f9-441f-8758-c4329a49ad07'},indent=2),encoding='utf8')
print(f'Queued {pid}',flush=True)
t0=time.time()
last=0
while time.time()-t0<1800:
    hist=comfy.get_json('/history/'+pid)
    if pid in hist:
        entry=hist[pid]
        (root/'history.json').write_text(json.dumps(entry,indent=2),encoding='utf8')
        errs=[m[1] for m in entry.get('status',{}).get('messages',[]) if m[0] in ('execution_error','execution_interrupted')]
        if errs: raise RuntimeError(format_exec_error(errs))
        comfy.download(find_model_file(entry.get('outputs',{}),save_id),root/'raw.glb')
        print('Saved '+str(root/'raw.glb'),flush=True)
        break
    if time.time()-last>30:
        print(f'Waiting for reconstruction: {int(time.time()-t0)}s',flush=True)
        last=time.time()
    time.sleep(5)
else:
    raise RuntimeError('Wait deadline reached; job was NOT interrupted. Inspect recorded prompt_id.')

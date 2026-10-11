"""Run the established ComfyUI pipeline on the new researched C-50 reference."""
from pathlib import Path
import sys
import tomllib

root = Path(__file__).resolve().parents[3]
pipeline = root / 'tools/asset-pipeline'
sys.path.insert(0, str(pipeline))
from comfy_client import Comfy, load_api_workflow, run_asset

cfg = tomllib.loads((pipeline / 'pipeline.toml').read_text())['comfy']
c = Comfy(cfg['url'], timeout_s=cfg['timeout_s'], poll_s=cfg['poll_s'])
c.check()
here = Path(__file__).parent
run_asset(c, load_api_workflow(pipeline / 'workflows/image_to_3d_api.json'),
          'c50-reference-v2-20261007', here / 'c50-reference-v2.png',
          here / 'models_raw/c50.glb', cfg)

"""Blender-only construction stage; inputs are the frozen reference project."""
import json
from pathlib import Path
import runpy
import sys

path=Path(sys.argv[sys.argv.index('--')+1]).resolve()
project=json.loads(path.read_text(encoding='utf-8'))
root=path.parent
output=(root/project['output']).resolve()
runpy.run_path(str(root/project['recipe']), init_globals={
    'PROJECT':project, 'PROJECT_ROOT':root, 'OUTPUT':output})

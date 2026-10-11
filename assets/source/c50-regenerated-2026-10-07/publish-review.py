"""Publish the new reference and unchanged reconstructed-model review views."""
from pathlib import Path
import shutil
import json

root = Path(__file__).parent
meta = json.loads((root / 'review/c50.json').read_text())
assert meta['mesh_unchanged']
for dest in [Path('C:/Users/Zso/terepasztal-playtest/scratchpad/models/handover-review/page'),
             Path('G:/DEV/Terepasztal/renders/engine-models')]:
    out = dest / 'c50-new'
    for image in (root / 'review').glob('*.png'):
        shutil.copy2(image, out / image.name)
    shutil.copy2(root / 'models_raw/c50.glb', out / 'c50.glb')
    shutil.copy2(root / 'README.md', out / 'README.md')
    page = dest / 'index.html'
    html = page.read_text(encoding='utf-8')
    html = html.replace('ComfyUI reconstruction is in progress.', 'The new ComfyUI reconstruction is complete; see its unmodified geometry below.')
    gallery = '<h3>New reconstructed model: four views</h3><p>Only whole-object alignment and uniform scale. No width warping, no old geometry corrections. Original generated material shown here; these are model previews, not in-game captures.</p><div class="grid">'
    for degrees in [0, 45, 135, 225]:
        gallery += f'<figure><img src="c50-new/c50-rigid-{degrees:03d}.png" alt="New C-50 model at {degrees} degrees"><figcaption>View {degrees} degrees</figcaption></figure>'
    gallery += '</div><p><a href="c50-new/c50.glb">New GLB model</a></p>'
    start = html.index('<section id="c50-new">')
    end = html.index('</section>', start)
    html = html[:end] + gallery + html[end:]
    page.write_text(html, encoding='utf-8')
print('Published reconstructed model and four unchanged-geometry views.')

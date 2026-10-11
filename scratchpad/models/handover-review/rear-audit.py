"""Attach existing rear references and evidence of where they enter the pipeline."""
from pathlib import Path
import json
import shutil
from PIL import Image, ImageDraw

HERE = Path(__file__).parent
PAGE = Path('G:/DEV/Terepasztal/renders/engine-models')
ids = ['c50', 'black_five', 'drg01', 'daylight']
names = ['4 C-50', '18 Black Five', '21 DRG 01', '32 Daylight']
dest = HERE / 'page' / 'rear-reference-audit'
dest.mkdir(exist_ok=True)
records, figures = [], []
sheet = Image.new('RGB', (1200, 800), '#dce4df')
draw = ImageDraw.Draw(sheet)
for i, (eid, name) in enumerate(zip(ids, names)):
    job = json.loads(Path(f'G:/DEV/Terepasztal/pipeline-out-std/jobs/{eid}.json').read_text())
    meta = json.loads(Path(f'G:/DEV/Terepasztal/pipeline-out-std/meta/{eid}.json').read_text())
    rear = Path(job['views'][0])
    target = dest / f'{eid}-rear.png'
    shutil.copy2(rear, target)
    im = Image.open(target).convert('RGBA')
    im.thumbnail((590, 365))
    x, y = i % 2 * 600, i // 2 * 400
    sheet.paste(im, (x+(600-im.width)//2, y+30+(365-im.height)//2), im)
    draw.text((x+12,y+8), name + ': existing rear reference', fill='black')
    records.append({'id':eid, 'rear_image':str(rear), 'reconstruction_inputs':1,
                    'rear_used_for_geometry':False,
                    'rear_texture_fit':meta['source']['extras'],
                    'source_job':f'pipeline-out-std/jobs/{eid}.json'})
    figures.append(f'<figure><a href="rear-reference-audit/{eid}-rear.png"><img src="rear-reference-audit/{eid}-rear.png" alt="{name}, existing rear reference"></a><figcaption>{name}: existing rear reference, used for texture projection after reconstruction.</figcaption></figure>')
sheet.save(HERE/'rear-reference-check.jpg', quality=94)
(dest/'evidence.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
section='''<!-- rear-audit-start --><section id="rear-reference-audit"><h2>Why the rear images did not fix the shape</h2>
<p>The four rear images below already exist. The previous Blender logs confirm that all four were accepted for texture projection. The reconstruction workflow, however, uploads only one image: the rear views never constrain the generated 3D shape. Painting them onto the finished mesh cannot add a missing volume or separate fused wheels.</p>
<p>The original-model panels below intentionally omit this later repainting. Their colours can therefore look worse than the current game's colours even when the geometry is more faithful to the reconstruction.</p>
<div class="grid">'''+''.join(figures)+'''</div>
<p><strong>Multi-view implementation found:</strong> local Pixal3DMultiViewConditioning supports several images, but its camera rig hardcodes zero elevation and 90-degree azimuth steps. These references are elevated three-quarter views. Connecting them to that fixed rig without calibration would give the reconstruction incorrect camera information. The existing texture-fit angles are estimates against the old mesh, not independent ground truth.</p>
<p><strong>First repair target:</strong> C-50. Check agreement between its front and rear references, fit their camera poses and framing, then attempt reconstruction with both views constraining shape. Preserve the one-view original for comparison. Mesh improvement has not yet been demonstrated; no replacement model, symmetry change or gauge change was made during this audit.</p></section><!-- rear-audit-end -->'''
for root in [HERE/'page', PAGE]:
    if root != HERE/'page': shutil.copytree(dest,root/dest.name,dirs_exist_ok=True)
    index=root/'index.html'
    content=index.read_text(encoding='utf-8')
    if '<!-- rear-audit-start -->' in content:
        a=content.index('<!-- rear-audit-start -->'); b=content.index('<!-- rear-audit-end -->')+len('<!-- rear-audit-end -->')
        content=content[:a]+section+content[b:]
    else:
        content=content.replace('<section id="c50">', section+'<section id="c50">')
    index.write_text(content,encoding='utf-8')
print('Four existing rear references and pipeline evidence added to both review copies.')

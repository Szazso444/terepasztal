"""Compare the previous original-material pilot with the source-painted pilot."""
import json
from pathlib import Path
import re
import shutil
from PIL import Image, ImageDraw

root = Path(__file__).parent
captures = root / 'c50-fix'
out = root / 'c50-style'
out.mkdir(exist_ok=True)
before = json.loads((captures / 'after/report.json').read_text())
after = json.loads((captures / 'painted/report.json').read_text())
assert before == after and not after['errors']
old = json.loads((root / 'rigid-c50/raw/meta.json').read_text())
new = json.loads((root / 'painted-c50/raw/meta.json').read_text())
for key in ['mesh_sha256', 'source_sha256', 'rigid_matrix', 'anchor', 'resolution']:
    assert old[key] == new[key], key
for side in ['front', 'rear']:
    pairs = []
    for i in range(24):
        im = Image.new('RGB', (1440, 510), '#192821')
        d = ImageDraw.Draw(im)
        for k, (folder, label) in enumerate([('after', 'PREVIOUS: original material'),
                                            ('painted', 'NOW: source-painted material')]):
            im.paste(Image.open(captures / folder / f'{side}-{i:02}.png'), (k * 720, 30))
            d.text((k * 720 + 12, 8), f'{label} / {i:02}', fill='white')
        pairs.append(im)
    pairs[0].save(out / f'{side}.webp', save_all=True, append_images=pairs[1:], duration=133, loop=0, quality=92)
    pairs[0].save(out / f'{side}.png')
    for start in range(0, 24, 8):
        sheet = Image.new('RGB', (1600, 1600), '#192821')
        d = ImageDraw.Draw(sheet)
        for j in range(8):
            i, x, y = start + j, j % 2 * 800, j // 2 * 400
            for k, folder in enumerate(['after', 'painted']):
                im = Image.open(captures / folder / f'{side}-{i:02}.png').crop((160, 80, 560, 455))
                sheet.paste(im, (x + k * 400, y + 25))
                d.text((x + k * 400 + 5, y + 5), f'{side} {i:02} {folder}', fill='white')
        sheet.save(out / f'qa-{side}-{start:02}.jpg')
for start in [0, 24]:
    sheet = Image.new('RGB', (800, 1200), '#21312c')
    d = ImageDraw.Draw(sheet)
    for j in range(24):
        f = start + j
        im = Image.open(root / 'painted-c50/frames' / f'loco_c50_body_f{f}.png')
        im = im.crop(im.getbbox())
        im.thumbnail((180, 170))
        x, y = j % 4 * 200, j // 4 * 200
        sheet.paste(im, (x + (200-im.width)//2, y+25), im)
        d.text((x+6, y+5), str(f), fill='white')
    sheet.save(out / f'qa-headings-{start}.jpg')

section = '''<!-- c50-style-start --><section id="c50-style">
<h2>C-50: match the reference's painted style</h2>
<p>The original-material pilot fixed the displaced rear details but lost the approved illustration's
colours and surface treatment. This update keeps exactly the same model, orientation, scale and
48 real headings. It restores source colours and details on surfaces visible in the conditioning
image, and uses painted shading instead of relighting an already shaded illustration.</p>
<p>Unseen surfaces retain their own texture details with a colour transfer learned from the source.
No separate rear image or mirrored source image is projected onto them. No vertices, UVs, gauge,
anchors or proportions changed in this style pass; hashes and transforms match the previous pilot.</p>
<div class="grid"><figure><img src="../originals-2026-10-06/c50-source.png" alt="Approved C-50 style reference">
<figcaption>Style target: approved source illustration.</figcaption></figure>
<figure><img src="c50-style/front.png" alt="Previous material and new painted material in the game">
<figcaption>Same game pose: previous material / source-painted material.</figcaption></figure></div>
<h3>Front: previous material / source-painted material</h3>
<img style="width:100%" src="c50-style/front.webp" alt="Synchronized front style comparison">
<h3>Rear: previous material / source-painted material</h3>
<img style="width:100%" src="c50-style/rear.webp" alt="Synchronized rear style comparison">
<p>Two 24-frame matched game captures, zoom 7. Original wheels remain static in this pilot.
Hidden-side line detail is still less faithful than the source-visible side; this is the next
material refinement, not a reason to distort the geometry. Other engines are unchanged.</p>
</section><!-- c50-style-end -->'''
# Both delivered pages have the original reference in their own child directory.
section = section.replace('../originals-2026-10-06/', 'originals-2026-10-06/')
for dest in [root / 'page', Path('G:/DEV/Terepasztal/renders/engine-models')]:
    target = dest / 'c50-style'
    target.mkdir(exist_ok=True)
    for name in ['front.png', 'front.webp', 'rear.webp']:
        shutil.copy2(out / name, target / name)
    path = dest / 'index.html'
    html = path.read_text(encoding='utf-8')
    html = re.sub(r'<!-- c50-style-start -->.*?<!-- c50-style-end -->', '', html, flags=re.S)
    if 'href="#c50-style"' not in html:
        html = html.replace('<nav>', '<nav><a href="#c50-style">C-50 painted style</a>', 1)
    at = html.index('<!-- c50-fix-start -->')
    html = html[:at] + section + '\n' + html[at:]
    path.write_text(html, encoding='utf-8')
print('Style review built; identical geometry, anchors and game poses verified.')

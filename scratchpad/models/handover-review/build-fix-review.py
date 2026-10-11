"""Matched game captures and numbered sheets for visual inspection."""
import json
from pathlib import Path
import re
import shutil
from PIL import Image, ImageDraw

root = Path(__file__).parent
p = root / 'c50-fix'
before = json.loads((p / 'before/report.json').read_text())
after = json.loads((p / 'after/report.json').read_text())
assert before == after and not before['errors'], 'Mismatched game poses or browser errors'
for side in ['front', 'rear']:
    for start in range(0, 24, 8):
        sheet = Image.new('RGB', (1600, 1400), '#192821')
        d = ImageDraw.Draw(sheet)
        for j in range(8):
            i, x, y = start + j, j % 2 * 800, j // 2 * 350
            for k, label in enumerate(['before', 'after']):
                im = Image.open(p / label / f'{side}-{i:02}.png').crop((160, 80, 560, 405))
                sheet.paste(im, (x + k * 400, y + 25))
                d.text((x + k * 400 + 5, y + 5), f'{side} {i:02} {label}', fill='white')
        sheet.save(p / f'qa-{side}-{start:02}.jpg')
    pairs = []
    for i in range(24):
        im = Image.new('RGB', (1440, 510), '#192821')
        d = ImageDraw.Draw(im)
        for k, label in enumerate(['before', 'after']):
            im.paste(Image.open(p / label / f'{side}-{i:02}.png'), (k * 720, 30))
            d.text((k * 720 + 12, 8), f'{label.upper()} / frame {i:02}', fill='white')
        pairs.append(im)
    pairs[0].save(p / f'{side}-comparison.webp', save_all=True, append_images=pairs[1:],
                  duration=133, loop=0, quality=92)
    pairs[0].save(p / f'{side}-comparison.png')

section = '''<!-- c50-fix-start -->
<section id="c50-fix"><h2>C-50: repaired in-game rear image</h2>
<p>The old rear sprite already contained displaced cabin/window details across the hood.
This was present in the atlas itself, before the game bent the image. The new sprites use the
original reconstructed mesh, UVs and materials, with one whole-model rigid orientation and
uniform scale. Source and mesh hashes are unchanged.</p>
<p>All 48 headings are actual renders, including the opposite side. The game now draws intact
images, without the proxy-box image bending. The existing train length and rail gauge are unchanged.</p>
<p><b>Choices for review:</b> the original wheels remain part of the model and are currently static;
the old separately animated wheel layer and projected window-light mask were removed for C-50.
Original texture colours are retained. Other engines keep their existing atlases.
Their image bending is disabled too; 7.5-degree heading steps can still be visible.</p>
<h3>Rear orientation — identical game poses, before / after</h3>
<img style="width:100%" src="c50-fix/rear-comparison.png" alt="C-50 rear image before and after">
<img style="width:100%" src="c50-fix/rear-comparison.webp" alt="Synchronized rear comparison clip">
<h3>Front orientation — identical game poses, before / after</h3>
<img style="width:100%" src="c50-fix/front-comparison.webp" alt="Synchronized front comparison clip">
<p>Captured from the running game at zoom 7. Each clip has 24 frames, 8 simulation ticks apart.
The rear pass reverses the displayed locomotive orientation at the same sampled track poses;
it is a renderer comparison, not a separate reversing-physics test.</p>
<p>The older rear-reference investigation below is historical. The current fix preserves the
original model rather than regenerating it from more reference images.</p></section>
<!-- c50-fix-end -->'''
for dest in [root / 'page', Path('G:/DEV/Terepasztal/renders/engine-models')]:
    target = dest / 'c50-fix'
    target.mkdir(exist_ok=True)
    for name in ['rear-comparison.png', 'rear-comparison.webp', 'front-comparison.webp']:
        shutil.copy2(p / name, target / name)
    path = dest / 'index.html'
    html = path.read_text(encoding='utf-8')
    html = html.replace('<nav><a href="#c50">', '<nav><a href="#c50-fix">C-50 repair</a><a href="#c50">')
    html = re.sub(r'<p><strong>Not yet replaced:</strong>.*?</p>',
                  '<p><strong>Current update:</strong> C-50 now uses the original whole model in all 48 headings. '
                  'Game image bending is disabled. Other original-model panels below remain the preserved baseline.</p>', html)
    html = html.replace('Current game, 3x zoom. Previous pipeline and sprite bending are still present.',
                        'Before this repair: game at 3x zoom, previous pipeline and sprite bending.')
    html = html.replace('Current game clip, 3x zoom, 32 frames', 'Baseline game clip, 3x zoom, 32 frames')
    html = re.sub(r'<!-- c50-fix-start -->.*?<!-- c50-fix-end -->', '', html, flags=re.S)
    # Place the current repair ahead of the historical reference/reconstruction review.
    at = html.find('<!-- rear-audit-start -->')
    assert at >= 0
    html = html[:at] + section + '\n' + html[at:]
    path.write_text(html, encoding='utf-8')
print('Built synchronized comparisons and six numbered QA sheets; matched poses verified.')

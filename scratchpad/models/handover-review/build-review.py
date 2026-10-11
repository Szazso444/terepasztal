"""Build the owner's original-model checkpoint without replacing earlier evidence."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json
import shutil
import html

HERE=Path(__file__).parent
PAGE=Path('G:/DEV/Terepasztal/renders/engine-models')
DEST=PAGE/'originals-2026-10-06'
DEST.mkdir(exist_ok=True)
FONT=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',20)
ENGINES=[(4,'c50','C-50'),(18,'black_five','Black Five'),(21,'drg01','DRG 01'),(32,'daylight','Daylight')]
pieces=[]
for n,eid,name in ENGINES:
    source=Path('G:/DEV/Terepasztal/pipeline-out/models_raw')/f'{eid}.source.png'
    shutil.copy2(source,DEST/f'{eid}-source.png')
    for file in (HERE/'originals').glob(f'{eid}-*.png'):
        shutil.copy2(file,DEST/file.name)
    shutil.copy2(HERE/'originals'/f'{eid}.json',DEST/f'{eid}.json')
    before=HERE/'game-before'/f'{eid}-straight.png'
    shutil.copy2(before,DEST/before.name)
    frames=[Image.open(HERE/'game-before'/f'{eid}-{i:03d}.png').convert('RGB') for i in range(32)]
    frames[0].save(DEST/f'{eid}-before.webp',save_all=True,append_images=frames[1:],duration=133,loop=0,quality=90)
    # Every clip frame appears in a numbered sheet for human inspection.
    for start in range(0,32,8):
        sheet=Image.new('RGB',(1440,1008),'#17221f')
        draw=ImageDraw.Draw(sheet)
        for k,im in enumerate(frames[start:start+8]):
            x=(k%2)*720; y=(k//2)*252
            # Crop only the empty top/bottom; preserve source pixels and full width.
            sheet.paste(im.crop((0,130,720,360)),(x,y+22))
            draw.text((x+8,y),f'{name}, frame {start+k:02d}',font=FONT,fill='white')
        sheet.save(HERE/f'qa-{eid}-{start:02d}.jpg',quality=93)
    overview=Image.new('RGB',(1600,920),'#dce4df')
    draw=ImageDraw.Draw(overview)
    panels=[('Source picture',source),('Raw GLB, imported pose',HERE/'originals'/f'{eid}-raw-000.png'),
            ('Current game, zoom 3',before),('Whole-model rigid candidate',HERE/'originals'/f'{eid}-rigid-000.png')]
    for k,(title,path) in enumerate(panels):
        x=(k%2)*800;y=(k//2)*460
        im=Image.open(path).convert('RGBA'); im.thumbnail((790,420))
        overview.paste(im,(x+(800-im.width)//2,y+35+(420-im.height)//2),im)
        draw.text((x+15,y+7),f'{n} {name}: {title}',font=FONT,fill='black')
    overview.save(HERE/f'qa-overview-{eid}.jpg',quality=95)
    figures=''.join(f'<figure><a href="originals-2026-10-06/{eid}-{suffix}"><img src="originals-2026-10-06/{eid}-{suffix}" alt="{name}: {caption}"></a><figcaption>{caption}</figcaption></figure>' for suffix,caption in [('source.png','Source picture'),('raw-000.png','Original reconstructed GLB. Imported pose; original mesh, UVs and materials.'),('straight.png','Current game, 3x zoom. Previous pipeline and sprite bending are still present.'),('rigid-000.png','Candidate: whole-model rotation and one uniform scale. Original mesh and materials.')])
    views=''.join(f'<figure><img src="originals-2026-10-06/{eid}-{mode}-{angle:03d}.png" alt="{name}, {mode}, {angle} degrees"><figcaption>{mode}, turn {angle} degrees</figcaption></figure>' for mode in ['raw','rigid'] for angle in [45,135,225])
    pieces.append(f'<section id="{eid}"><h2>{n}. {name}</h2><div class="grid">{figures}</div><details><summary>More original 3D views and rigid candidates</summary><div class="views">{views}</div></details><details><summary>Current game clip, 3x zoom, 32 frames</summary><img class="clip" src="originals-2026-10-06/{eid}-before.webp" alt="Current game clip of {name}"><p>Recorded from the running demo before any rendering changes. This is baseline evidence, not a corrected model.</p></details></section>')
old=PAGE/'index-before-originals-2026-10-06.html'
if not old.exists(): shutil.copy2(PAGE/'index.html',old)
document='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Terepasztal: original train models</title>
<style>body{margin:0;background:#15211e;color:#e9eee9;font:16px/1.55 system-ui}main{max-width:1500px;margin:auto;padding:30px}h1,h2{line-height:1.2}h1{font-size:32px}h2{margin:0 0 22px}a{color:#9dd9cf}section{border-top:1px solid #63756d;padding:32px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.views{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}figure{margin:0;background:#25362f;border-radius:6px;overflow:hidden}figure img{width:100%;height:360px;object-fit:contain;background:#dce4df;display:block}figcaption{padding:12px 16px}p{max-width:105ch}details{margin:22px 0}summary{cursor:pointer;padding:12px;background:#2b4138}.clip{width:min(720px,100%)}.note{border-left:3px solid #b8c998;padding:4px 20px;background:#22332b}nav{display:flex;gap:24px;flex-wrap:wrap;margin:25px 0}@media(max-width:800px){.grid,.views{grid-template-columns:1fr}main{padding:18px}figure img{height:280px}}</style>
<main><h1>Original train models</h1><p>Review checkpoint, 2026-10-06. Four requested engines, before a fleet rerender.</p>
<nav><a href="#c50">4 C-50</a><a href="#black_five">18 Black Five</a><a href="#drg01">21 DRG 01</a><a href="#daylight">32 Daylight</a><a href="index-before-originals-2026-10-06.html">Previous review, preserved</a><a href="http://localhost:5182/scratchpad/models/load-save.html">Try the existing demo save</a></nav>
<div class="note"><p><strong>What is original:</strong> raw panels use the imported GLB geometry, normals, UVs and materials unchanged. The first view keeps its imported pose. Additional views rotate the whole object. Camera: orthographic, 30-degree elevation and 45-degree azimuth, as in the game. Neutral scene lighting makes the original material visible. No source repainting, perspective removal, mesh squaring, mirroring, gauge widening, cuts or replacement wheels.</p><p><strong>What the candidate does:</strong> one whole-model orientation from the original surface normals, followed by one uniform scale from its height. It does not reshape or split the model. Automatic orientation, front direction and wheel contact still need visual judgment. Camera framing fits each complete object for inspection; panel sizes are not a physical-scale comparison.</p><p><strong>Decision still open:</strong> keep the raw far side or rebuild it from the seen side? First inspect the original wheel positions against the unchanged game gauge, before deciding whether any gear adjustment is acceptable. Neither setting has been changed in the legacy production pipeline.</p><p><strong>Not yet replaced:</strong> production atlases and the current game's sprite-bending renderer. The new render path is an isolated inspection stage. Direction density, moving wheels, bogie separation and cut repairs follow after this review. No full-fleet rerender has started.</p></div>
<p><strong>Roster:</strong> J94, Jupiter, F7, Flying Scotsman, K4s, V63, MAV 424 and 9F are now retired, joining Adler and John Bull. Existing saved copies remain compatible. Workbook v8 retains all 107 embedded image files.</p>
'''+''.join(pieces)+'''<section><h2>Next decision</h2><p>Review whether each original reconstruction is usable, and whether the rigid candidate points and stands correctly. Then settle far-side symmetry and wheel placement before integrating real 3D headings into the game. Later engine-specific requests are recorded in workbook v8.</p></section></main></html>'''
(PAGE/'index.html').write_text(document,encoding='utf-8')
# Keep a self-contained repository copy alongside the external review delivery.
local=HERE/'page'
local.mkdir(exist_ok=True)
shutil.copytree(DEST,local/DEST.name,dirs_exist_ok=True)
shutil.copy2(old,local/old.name)
shutil.copytree(PAGE/'img',local/'img',dirs_exist_ok=True)
(local/'index.html').write_text(document,encoding='utf-8')
print(f'Review saved: {PAGE / "index.html"}')

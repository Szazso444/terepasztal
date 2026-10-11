from pathlib import Path
import json,shutil,re
from PIL import Image,ImageDraw
root=Path(__file__).parent
out=root/'c50-handbuilt-game'
captures=root/'c50-fix/handbuilt'
assert not json.loads((captures/'report.json').read_text())['errors']
assert not json.loads((out/'wheel-report.json').read_text())['errors']
assert not json.loads((out/'fleet-report.json').read_text())['errors']
for side in ['front','rear']:
    frames=[Image.open(captures/f'{side}-{i:02}.png').convert('RGB') for i in range(24)]
    frames[0].save(out/f'{side}.webp',save_all=True,append_images=frames[1:],duration=133,loop=0,quality=93)
    for start in [0,12]:
        sheet=Image.new('RGB',(1600,1200),'#21332b');d=ImageDraw.Draw(sheet)
        for j in range(12):
            x,y=j%4*400,j//4*400
            im=frames[start+j].crop((160,120,560,395));sheet.paste(im,(x,y+25))
            d.text((x+5,y+5),f'{side} {start+j:02}',fill='white')
        sheet.save(out/f'qa-{side}-{start}.jpg')
wheels=[Image.open(out/f'wheel-{i:02}.png').convert('RGB') for i in range(48)]
wheels[0].save(out/'wheels.webp',save_all=True,append_images=wheels[1:],duration=33,loop=0,quality=93)
for start in [0,12,24,36]:
    sheet=Image.new('RGB',(1600,1200),'#21332b');d=ImageDraw.Draw(sheet)
    for j in range(12):
        x,y=j%4*400,j//4*400
        sheet.paste(wheels[start+j].crop((160,120,560,495)),(x,y+25))
        d.text((x+5,y+5),f'wheel {start+j:02}',fill='white')
    sheet.save(out/f'qa-wheels-{start}.jpg')
frames=Path('C:/Users/Zso/terepasztal-local/assets/source/c50-handbuilt-2026-10-07/sprites/frames')
for start in [0,24,48,72]:
    sheet=Image.new('RGB',(800,1200),'#21332b');d=ImageDraw.Draw(sheet)
    for j in range(24):
        f=start+j;im=Image.open(frames/f'loco_c50_body_w0_f{f}.png');im=im.crop(im.getbbox());im.thumbnail((180,170))
        x,y=j%4*200,j//4*200;sheet.paste(im,(x+(200-im.width)//2,y+25),im);d.text((x+4,y+4),str(f),fill='white')
    sheet.save(out/f'qa-headings-{start}.jpg')
section='''<section id="c50-in-game"><h2>C-50: shaded game sprites</h2>
<p>The accepted Blender model now runs in the demo. Its proportions and two windows at each end are preserved. Whole-model uniform scale fits the C-50 footprint; the game's 2:1 orthographic camera, shared pixel density, matte paint, warm directional shading, contact shadows and antialiasing make it readable beside the other locomotives.</p>
<img style="width:100%" src="c50-handbuilt-game/fleet.png" alt="C50 beside Black Five, DRG01 and Daylight in the running game">
<div class="grid"><figure><img src="c50-handbuilt-game/before-shading.png" alt="Previous shading"><figcaption>Previous studio shading</figcaption></figure><figure><img src="c50-handbuilt-game/straight.png" alt="Matte shaded version"><figcaption>Matte paint and warmer shadows</figcaption></figure></div><p>Same game zoom: the small narrow-gauge C-50 beside the large mainline locomotives. Each stands on its own gauge.</p>
<div class="grid"><figure><img src="c50-handbuilt-game/straight.png" alt="Integrated C50 close-up"><figcaption>In-game close-up</figcaption></figure><figure><img src="c50-handbuilt-game/wheels.webp" alt="Travel-driven wheel rotation"><figcaption>Wheels rotate with travel and freeze when stopped</figcaption></figure><figure><img src="c50-handbuilt-game/front.webp" alt="C50 travelling through a curve"><figcaption>Curve, front orientation</figcaption></figure><figure><img src="c50-handbuilt-game/rear.webp" alt="C50 rear orientation on the same curve"><figcaption>Same route positions, reversed display orientation</figcaption></figure></div>
<p>96 actual headings, 8 integrated wheel phases, no separate wheel overlay. Frame anchors are shared across phases. Lamp and exhaust positions follow this model. The finer heading and position steps remain enabled.</p>
<p><a href="http://localhost:5182/scratchpad/models/?rows=c50,black_five,drg01,daylight&amp;zoom=3">Open the live game comparison</a></p></section>'''
for dest in [root/'page',Path('G:/DEV/Terepasztal/renders/engine-models')]:
    target=dest/'c50-handbuilt-game';target.mkdir(exist_ok=True)
    shutil.copy2(out/'before-shading/straight.png',target/'before-shading.png')
    for name in ['fleet.png','straight.png','front.webp','rear.webp','wheels.webp']:shutil.copy2(out/name,target/name)
    page=dest/'index.html';html=page.read_text(encoding='utf-8')
    html=re.sub(r'<section id="c50-in-game">.*?</section>','',html,flags=re.S)
    at=html.index('<section id="c50-handbuilt">');html=html[:at]+section+html[at:]
    if 'href="#c50-in-game"' not in html:html=html.replace('<nav>','<nav><a href="#c50-in-game">C-50 in game</a>',1)
    html=html.replace('This review has not replaced the game atlas.','This model is now integrated; see the game comparison above.')
    page.write_text(html,encoding='utf-8')
print('Game review, clips and QA sheets built.')

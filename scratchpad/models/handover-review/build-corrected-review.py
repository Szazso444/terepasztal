"""Final review and numbered QA sheets for widths, wheel motion and dense facings."""
import json
from pathlib import Path
import re
import shutil
from PIL import Image, ImageDraw

root=Path(__file__).parent
out=root/'c50-corrected';out.mkdir(exist_ok=True)
captures=root/'c50-fix'
before=json.loads((captures/'painted/report.json').read_text())
after=json.loads((captures/'corrected/report.json').read_text())
assert before==after and not after['errors']
for side in ['front','rear']:
    pairs=[]
    for i in range(24):
        im=Image.new('RGB',(1440,510),'#192821');d=ImageDraw.Draw(im)
        for k,(folder,label) in enumerate([('painted','BEFORE'),('corrected','CORRECTED')]):
            im.paste(Image.open(captures/folder/f'{side}-{i:02}.png'),(k*720,30))
            d.text((k*720+12,8),f'{label} / frame {i:02}',fill='white')
        pairs.append(im)
    pairs[0].save(out/f'{side}.webp',save_all=True,append_images=pairs[1:],duration=133,loop=0,quality=92)
    pairs[0].save(out/f'{side}.png')
    for start in range(0,24,8):
        sheet=Image.new('RGB',(1600,1600),'#192821');d=ImageDraw.Draw(sheet)
        for j in range(8):
            i,x,y=start+j,j%2*800,j//2*400
            for k,folder in enumerate(['painted','corrected']):
                im=Image.open(captures/folder/f'{side}-{i:02}.png').crop((160,80,560,455))
                sheet.paste(im,(x+k*400,y+25));d.text((x+k*400+5,y+5),f'{side} {i:02} {folder}',fill='white')
        sheet.save(out/f'qa-{side}-{start:02}.jpg')
wheels=[Image.open(out/f'wheel-{i:02}.png').convert('RGB') for i in range(48)]
wheels[0].save(out/'wheels.webp',save_all=True,append_images=wheels[1:],duration=33,loop=0,quality=92)
for start in range(0,48,12):
    sheet=Image.new('RGB',(1600,1200),'#192821');d=ImageDraw.Draw(sheet)
    for j in range(12):
        i,x,y=start+j,j%4*400,j//4*400
        im=wheels[i].crop((160,120,560,495));sheet.paste(im,(x,y+25));d.text((x+5,y+5),f'wheel {i:02}',fill='white')
    sheet.save(out/f'qa-wheels-{start:02}.jpg')
frames=root/'corrected-c50/frames'
for start in range(0,96,24):
    sheet=Image.new('RGB',(800,1200),'#21312c');d=ImageDraw.Draw(sheet)
    for j in range(24):
        f=start+j;im=Image.open(frames/f'loco_c50_body_w0_f{f}.png');im=im.crop(im.getbbox());im.thumbnail((180,170))
        x,y=j%4*200,j//4*200;sheet.paste(im,(x+(200-im.width)//2,y+25),im);d.text((x+6,y+5),str(f),fill='white')
    sheet.save(out/f'qa-headings-{start}.jpg')

section='''<!-- c50-corrected-start --><section id="c50-corrected">
<h2>C-50: equal hood widths, wider base and rolling wheels</h2>
<p>The front hood is widened from 1.272 to 1.562 model metres, matching the rear hood.
The supporting base is widened 40%. The cab, overall length, height and track gauge are retained.
These are explicit, owner-requested edits to a derived 3D model; the source GLB is preserved.</p>
<p>The accepted source-painted style is retained. Wheel rings have been rebuilt as circular
rotating rings at the measured original centres and radius; axleboxes remain stationary.
All parts are rendered together in every frame, eliminating separate wheel/body alignment.</p>
<p>96 real headings replace 48, halving the angular step (7.5 to 3.75 degrees).
Screen placement rounding is halved from one-third to one-sixth pixel. There is no added
vertical bounce animation; this reduces the actual sources of stepping without image bending.</p>
<h3>Before / corrected, same game poses</h3>
<img style="width:100%" src="c50-corrected/front.png" alt="C-50 widths before and after">
<img style="width:100%" src="c50-corrected/front.webp" alt="Matched front curve comparison">
<img style="width:100%" src="c50-corrected/rear.webp" alt="Matched rear curve comparison">
<h3>Wheel rotation in the running game</h3>
<img style="max-width:100%" src="c50-corrected/wheels.webp" alt="Moving C-50 wheels, 48 frames">
<p>Eight wheel phases are driven by travelled distance; stopping freezes the phase and reverse
travel reverses it. The complete vehicle is drawn once, with no extra wheel overlay.
The wider base naturally hides more of the wheel tops from the elevated camera.</p>
<p>Review choices: the existing wider rear hood is the width reference; the wheel rings retain
measured size but use clean circular geometry. Only C-50 receives these new model/heading frames.
The finer screen-position rounding also applies to the other trains.</p>
</section><!-- c50-corrected-end -->'''
for dest in [root/'page',Path('G:/DEV/Terepasztal/renders/engine-models')]:
    target=dest/'c50-corrected';target.mkdir(exist_ok=True)
    for name in ['front.png','front.webp','rear.webp','wheels.webp']:shutil.copy2(out/name,target/name)
    path=dest/'index.html';html=path.read_text(encoding='utf-8')
    html=re.sub(r'<!-- c50-corrected-start -->.*?<!-- c50-corrected-end -->','',html,flags=re.S)
    if 'href="#c50-corrected"' not in html:html=html.replace('<nav>','<nav><a href="#c50-corrected">C-50 widths and wheels</a>',1)
    at=html.index('<!-- c50-style-start -->');html=html[:at]+section+'\n'+html[at:]
    path.write_text(html,encoding='utf-8')
print('Corrected review built with synchronized clips and numbered QA sheets.')

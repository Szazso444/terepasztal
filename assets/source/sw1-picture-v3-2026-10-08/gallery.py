"""Publish reviewed game captures and source orthographic views locally."""
from pathlib import Path
import json, shutil
from PIL import Image, ImageOps, ImageDraw
R=Path(__file__).resolve().parent
GAME=Path('C:/Users/Zso/terepasztal-playtest')
REVIEW=GAME/'scratchpad/models/handover-review'
OUT=REVIEW/'page/sw1-picture-v3';OUT.mkdir(parents=True,exist_ok=True)
CAP=REVIEW/'sw1-picture-v3/after'
report=json.loads((CAP/'sw1-report.json').read_text());key=report['bundleKey']
for name in ['straight','detail','lights','reversed','night']:
 shutil.copy2(CAP/f'sw1-{name}.png',OUT/f'{name}.png')
shutil.copy2(CAP/'c50-sw1.png',OUT/'c50-sw1.png')
for name in ['top','side','front','rear']:
 shutil.copy2(R/f'{name}.png',OUT/f'{name}.png')
shutil.copy2(R/'references/01.png',OUT/'reference.png')
shutil.copy2(REVIEW/'page/sw1-picture-v2/detail.png',OUT/'previous.png')
frames=[Image.open(CAP/f'sw1-{n:03}.png').convert('RGB') for n in range(32)]
sheet=Image.new('RGB',(4*360,8*260),'#15211e');draw=ImageDraw.Draw(sheet)
for n,im in enumerate(frames):
 x=n%4*360;y=n//4*260;sheet.paste(im.resize((360,240)),(x,y));draw.text((x+8,y+242),str(n),fill='white')
sheet.save(R/'curve-contact.jpg',quality=92)
if not (CAP/'sw1-reviewed.txt').exists():
 print('Contact sheet ready; visually review before publication');raise SystemExit(0)
assert key in (CAP/'sw1-reviewed.txt').read_text(), 'Review marker does not match bundle'
frames[0].save(OUT/'curve.webp',save_all=True,append_images=frames[1:],duration=160,loop=0,quality=90)
cards=[('reference.png','Only shape/livery reference — original picture'),('detail.png','SW1 — third picture-based pass, in game'),('previous.png','Previous picture-based version'),('straight.png','Current game view'),('c50-sw1.png','Alongside the accepted C-50'),('curve.webp','Articulated bogies and wheel motion'),('lights.png','Lamp and window light alignment'),('top.png','Top: constant width and parallel sides'),('side.png','Body side view'),('front.png','Body front: arched cab glazing and lamp'),('rear.png','Body rear: minimal closure, no invented glazing')]
html="""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SW1 — third picture-based pass</title><style>body{margin:0;background:#15211e;color:#e9eee9;font:16px/1.55 system-ui}main{max-width:1440px;margin:auto;padding:28px}a{color:#a5dfc5}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;background:#25362f;border-radius:8px;overflow:hidden}img{width:100%;display:block}figcaption{padding:10px 16px}p{max-width:100ch}@media(max-width:760px){.grid{grid-template-columns:1fr}}</style><main><h1>SW1 — one more reference-picture pass</h1><p>Rebuilt cast bogie sideframes with rounded openings, wider axle spacing and more clearance below the walkway. Taller cab-front windows follow the arched roof; restrained glass reflections, darker fan covers, curved bell, larger dimensional headlamp and hood panel joins bring the visible details closer to the picture.</p><p>Only SW1 changed. Shape and livery are still authored from the saved reference PNG. Wheel treads retain the chosen rail gauge. Hidden-side symmetry remains an explicit assumption; the unseen rear wall remains a minimal closure.</p><p><a href="/scratchpad/models/?rows=sw1&zoom=4">Live SW1</a> · <a href="sw1-picture-v2.html">Previous pass</a></p><div class="grid">"""
for file,label in cards:html+=f'<figure><img src="sw1-picture-v3/{file}?v={key}"><figcaption>{label}</figcaption></figure>'
html+=f'</div><p>Verified bundle: {key}. 96 headings, eight wheel phases per bogie.</p></main></html>'
(REVIEW/'page/sw1-picture-v3.html').write_text(html,encoding='utf-8')
old=REVIEW/'page/sw1-picture-v2.html';text=old.read_text(encoding='utf-8')
banner='<p><strong>Latest SW1:</strong> <a href="sw1-picture-v3.html">third picture-based pass</a>.</p>'
if 'sw1-picture-v3.html' not in text:old.write_text(text.replace('<main>','<main>'+banner,1),encoding='utf-8')
mirror=Path('G:/DEV/Terepasztal/renders/engine-models')
shutil.copytree(OUT,mirror/'sw1-picture-v3',dirs_exist_ok=True)
shutil.copy2(REVIEW/'page/sw1-picture-v3.html',mirror/'sw1-picture-v3.html')
print('Published',key)

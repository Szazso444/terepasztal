"""Build a local review gallery after checking each model in the actual game."""
from pathlib import Path
from PIL import Image,ImageDraw
import json,shutil
ROOT=Path(__file__).resolve().parent;SOURCE=ROOT.parent
GAME=Path('C:/Users/Zso/terepasztal-playtest');REVIEW=GAME/'scratchpad/models/handover-review'
CAP=REVIEW/'four-handbuilt-v1/after';OUT=REVIEW/'page/four-handbuilt-v1';OUT.mkdir(parents=True,exist_ok=True)
IDS={'mav375':'MÁV 375','class08':'Class 08','drg01':'DRG 01','m62':'M62'}
html="""<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Négy mozdony — C-50 / SW1 módszer</title><style>body{margin:0;background:#15211e;color:#e9eee9;font:16px/1.55 system-ui}main{max-width:1500px;margin:auto;padding:28px}a{color:#a5dfc5}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;background:#25362f;border-radius:8px;overflow:hidden}img{width:100%;display:block}figcaption{padding:10px 16px}section{margin-top:48px;border-top:1px solid #496250}nav{display:flex;gap:24px;flex-wrap:wrap}@media(max-width:760px){.grid{grid-template-columns:1fr}}</style><main><h1>Négy mozdony — a C-50 és az SW1 módszerével</h1><p>Új, szerkeszthető 3D geometria az Excel referenciaképei alapján, az elfogadott világosabb C-50 árnyalással. Teljes futóművek és forgó kerekek; az ablakfények és lámpapontok a megépített részletekből származnak. Az SW1 változatlan.</p><nav>"""
html+=' '.join(f'<a href="#{k}">{v}</a>' for k,v in IDS.items())+'</nav>'
ready=True
for id,title in IDS.items():
 project=SOURCE/f'{id}-picture-2026-10-09';dest=OUT/id;dest.mkdir(exist_ok=True)
 report=json.loads((CAP/f'{id}-report.json').read_text());key=report['bundleKey']
 assert report['frozen'] and not report['completeness']['missing'] and report['completeness']['facings']==96
 for name in ['straight','detail','lights','reversed','night']:shutil.copy2(CAP/f'{id}-{name}.png',dest/f'{name}.png')
 shutil.copy2(project/'references/01.png',dest/'reference.png')
 for name in ['top','side','front','rear','iso']:
  candidates=[project/f'{name}.png',project/'orthos'/f'{name}.png',project/'orthographic'/f'{name}.png']
  file=next((f for f in candidates if f.exists()),None)
  if file:shutil.copy2(file,dest/f'{name}.png')
 frames=[Image.open(CAP/f'{id}-{n:03}.png').convert('RGB') for n in range(32)]
 sheet=Image.new('RGB',(1440,2080),'#15211e');draw=ImageDraw.Draw(sheet)
 for n,im in enumerate(frames):
  x=n%4*360;y=n//4*260;sheet.paste(im.resize((360,240)),(x,y));draw.text((x+8,y+242),str(n),fill='white')
 sheet.save(ROOT/f'{id}-curves.jpg',quality=92)
 marker=CAP/f'{id}-reviewed.txt'
 if not marker.exists() or key not in marker.read_text():ready=False;continue
 frames[0].save(dest/'curve.webp',save_all=True,append_images=frames[1:],duration=160,loop=0,quality=90)
 html+=f'<section id="{id}"><h2>{title}</h2><p><a href="/scratchpad/models/?rows={id}&zoom=4">Élő játékbeli nézet</a> · <a href="/scratchpad/models/?rows={id},sw1&gap=2&zoom=3">Az SW1 mellett</a></p><div class="grid">'
 cards=[('reference.png','Eredeti referenciakép'),('detail.png','Új modell — a játékban'),('straight.png','Játékbeli méret'),('curve.webp','Kanyarodás és kerékmozgás'),('lights.png','Lámpák és ablakfények'),('reversed.png','Fordított menet'),('top.png','Felülnézet'),('side.png','Oldalnézet'),('front.png','Elölnézet'),('rear.png','Hátulnézet')]
 for name,label in cards:
  if (dest/name).exists():html+=f'<figure><img loading="lazy" src="four-handbuilt-v1/{id}/{name}?v={key}"><figcaption>{label}</figcaption></figure>'
 html+=f'</div><p>Verzió: {key}. 96 irány, nyolc kerékfázis. Véleményezésre vár.</p></section>'
if not ready:print('Contact sheets prepared; inspect and write matching review markers.');raise SystemExit(0)
html+='</main></html>'
page=REVIEW/'page/four-handbuilt-v1.html';page.write_text(html,encoding='utf-8')
mirror=Path('G:/DEV/Terepasztal/renders/engine-models');shutil.copytree(OUT,mirror/'four-handbuilt-v1',dirs_exist_ok=True);shutil.copy2(page,mirror/page.name)
print('Published four-locomotive review')

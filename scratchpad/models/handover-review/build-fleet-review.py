"""Build a local review gallery from verified in-game captures."""
from pathlib import Path
from html import escape
import json,shutil
from PIL import Image,ImageDraw
root=Path(__file__).resolve().parent
page=root/'page'/'fleet-painted';page.mkdir(parents=True,exist_ok=True)
source=root/'fleet-painted';defs=json.loads(Path('src/data/locomotives.json').read_text(encoding='utf-8'))
ids=[d for d in defs if not d.get('retired') and d['id']!='c50']
sections=[]
shown=[]
for d in ids:
 id=d['id'];report=source/'after'/f'{id}-report.json'
 if not report.exists():continue
 shown.append(d)
 record=json.loads(report.read_text());assert record['frozen'] and not record['completeness']['missing']
 dest=page/id;dest.mkdir(exist_ok=True)
 for suffix in ['straight','reversed','night']:
  shutil.copy2(source/'after'/f'{id}-{suffix}.png',dest/(suffix+'.png'))
 shutil.copy2(source/'before'/f'{id}-straight.png',dest/'before.png')
 frames=[Image.open(source/'after'/f'{id}-{n:03}.png').convert('RGB') for n in range(32)]
 # The contact sheet is the review gate; publish animation only after it is inspected.
 contact=Image.new('RGB',(1440,1920),'#25362f');draw=ImageDraw.Draw(contact)
 for n,im in enumerate(frames):
  thumb=im.copy();thumb.thumbnail((360,240));contact.paste(thumb,(n%4*360,n//4*240));draw.text((n%4*360+5,n//4*240+5),str(n),fill='white')
 contact.save(source/'after'/f'{id}-contact.jpg')
 reviewed=(source/'after'/f'{id}-reviewed.txt').exists()
 if reviewed:frames[0].save(dest/'curve.webp',save_all=True,append_images=frames[1:],duration=133,loop=0,quality=90)
 name=escape(d['name']);label=escape(id)
 if not reviewed:name+=' · képi ellenőrzés folyamatban'
 clip=f'<figure><img loading="lazy" src="fleet-painted/{label}/curve.webp"><figcaption>Kanyarban, menetarányos kerékforgással</figcaption></figure>' if reviewed else ''
 sections.append(f'<section id="{label}"><h2>{name}</h2><div class="grid"><figure><img loading="lazy" src="fleet-painted/{label}/before.png"><figcaption>Korábbi változat · 3× játéknagyítás</figcaption></figure><figure><img loading="lazy" src="fleet-painted/{label}/straight.png"><figcaption>Javított változat · 3× játéknagyítás</figcaption></figure>{clip}<figure><img loading="lazy" src="fleet-painted/{label}/night.png"><figcaption>Éjszakai ellenőrzés</figcaption></figure></div><p><a href="http://localhost:5182/scratchpad/models/?rows={label}&amp;zoom=3">Megnyitás a tesztjátékban</a></p></section>')
nav=' '.join(f'<a href="#{escape(d["id"])}">{escape(d["name"])}</a>' for d in shown)
html='''<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Terepasztal — javított mozdonyok</title><style>body{margin:0;background:#15211e;color:#e9eee9;font:16px/1.55 system-ui}main{max-width:1440px;margin:auto;padding:28px}a{color:#a5dfc5}nav{display:flex;flex-wrap:wrap;gap:8px 22px}section{padding:28px 0;border-top:1px solid #526b5c}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;background:#25362f;border-radius:8px;overflow:hidden}img{width:100%;display:block}figcaption{padding:10px 16px}p{max-width:100ch}@media(max-width:760px){.grid{grid-template-columns:1fr}}</style><main><h1>Mozdonyok — eddigi eredmény</h1><p><strong>A munka szünetel.</strong> A jóváhagyott C-50 mellett 10 mozdony új sprite-jai kerültek a tesztjátékba. Itt 9 előtte–utána összehasonlítás látható; 6 teljes képi ellenőrzése kész. A DRG 01, MÁV 490 és Muki képei még ellenőrzésre várnak. A TGV már telepítve van, de még nincs róla új összehasonlítás. A további 18 mozdony feldolgozása nincs kész.</p><p>A jóváhagyott C-50 festése és megvilágítása alapján. Egységes árnyalás, sűrűbb irányváltások, menetarányos kerékforgás és a feltárt modellhibák javítása. A képek a futó tesztjátékból származnak.</p><p><a href="index.html#c50-in-game">A jóváhagyott C-50</a></p><nav>'''+nav+'</nav>'+''.join(sections)+'</main></html>'
(root/'page/fleet.html').write_text(html,encoding='utf-8')
print('Gallery entries',len(sections))

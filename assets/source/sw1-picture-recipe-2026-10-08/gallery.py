"""Publish reviewed game captures and source orthographic views locally."""
from pathlib import Path
import json, shutil
from PIL import Image, ImageOps, ImageDraw
R=Path(__file__).resolve().parent
GAME=Path('C:/Users/Zso/terepasztal-playtest')
REVIEW=GAME/'scratchpad/models/handover-review'
OUT=REVIEW/'page/sw1-picture-v2';OUT.mkdir(parents=True,exist_ok=True)
CAP=REVIEW/'sw1-picture-v2/after'
report=json.loads((CAP/'sw1-report.json').read_text());key=report['bundleKey']
for name in ['straight','detail','lights','reversed','night']:
 shutil.copy2(CAP/f'sw1-{name}.png',OUT/f'{name}.png')
shutil.copy2(CAP/'c50-sw1.png',OUT/'c50-sw1.png')
for name in ['top','side','front','rear']:
 shutil.copy2(R/f'{name}.png',OUT/f'{name}.png')
shutil.copy2(R/'references/01.png',OUT/'reference.png')
shutil.copy2(REVIEW/'page/sw1-handbuilt/detail.png',OUT/'previous.png')
frames=[Image.open(CAP/f'sw1-{n:03}.png').convert('RGB') for n in range(32)]
sheet=Image.new('RGB',(4*360,8*260),'#15211e');draw=ImageDraw.Draw(sheet)
for n,im in enumerate(frames):
 x=n%4*360;y=n//4*260;sheet.paste(im.resize((360,240)),(x,y));draw.text((x+8,y+242),str(n),fill='white')
sheet.save(R/'curve-contact.jpg',quality=92)
if not (CAP/'sw1-reviewed.txt').exists():
 print('Contact sheet ready; visually review before publication');raise SystemExit(0)
assert key in (CAP/'sw1-reviewed.txt').read_text(), 'Review marker does not match bundle'
frames[0].save(OUT/'curve.webp',save_all=True,append_images=frames[1:],duration=160,loop=0,quality=90)
cards=[('reference.png','Az egyetlen képi referencia (PNG)'),('detail.png','Pontosított kézi modell a játékban'),('previous.png','Előző, jó irányként elfogadott kézi modell'),('straight.png','Új modell normál játéknézetben'),('curve.webp','Kanyar, teljes forgóvázak és forgó kerekek'),('lights.png','Geometriához kötött lámpa- és ablakfények'),('top.png','Felülnézet — párhuzamos oldalak, állandó motorházszélesség'),('side.png','Oldalnézet — a karosszéria külön'),('front.png','Elölnézet — a karosszéria külön'),('rear.png','Hátulnézet — a karosszéria külön')]
cards.insert(4,('c50-sw1.png','Az elfogadott C-50 és az új SW1 együtt a játékban'))
html='''<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SW1 — a C-50 építési módszerével</title><style>body{margin:0;background:#15211e;color:#e9eee9;font:16px/1.55 system-ui}main{max-width:1440px;margin:auto;padding:28px}a{color:#a5dfc5}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;background:#25362f;border-radius:8px;overflow:hidden}img{width:100%;display:block}figcaption{padding:10px 16px}p{max-width:100ch}@media(max-width:760px){.grid{grid-template-columns:1fr}}</style><main><h1>SW1 — a referenciakép részleteihez pontosítva</h1><p>A kézzel épített SW1 pontosítása kizárólag a mellékelt PNG alapján: semlegesebb szürke festés, lekerekített motorház, öt oldalsó panel, áthelyezett és nagyobb ventilátorok, keresztrács, tölcséres kürt, részletesebb harang és öntött forgóvázkeret. Ugyanazok a modellezési segédfüggvények, anyagkezelés és világosított renderprofil, mint az elfogadott C-50-nél. A motorház végig azonos szélességű; a fülke és az alváz középvonala egyezik. Külön modellezett ablakok, lámpák és két teljes, elforduló forgóváz.</p><p>A képen nem látható hátfal egyszerű lezárás: a kitalált hátsó ablakok és csíkozás eltávolítva. A takart oldal szerkezeti szimmetriája továbbra is dokumentált feltételezés. A forrásképből nem megállapítható részleteket nem állítjuk biztosnak. A wide sín a választott 25%-kal keskenyebb változat. A többi mozdony ebben a körben változatlan.</p><p><a href="/scratchpad/models/?rows=sw1&zoom=4">SW1 az élő tesztjátékban</a> · <a href="/scratchpad/models/?rows=c50,sw1&zoom=3">C-50 és SW1 együtt</a> · <a href="detail-v4.html">Előző ellenőrzési oldal</a></p><div class="grid">'''
for file,label in cards:html+=f'<figure><img src="sw1-picture-v2/{file}?v={key}"><figcaption>{label}</figcaption></figure>'
html+=f'</div><p>Ellenőrzött rendercsomag: {key}. 96 irány; forgóvázanként 8 kerékfázis.</p></main></html>'
(REVIEW/'page/sw1-picture-v2.html').write_text(html,encoding='utf-8')
old=REVIEW/'page/sw1-handbuilt.html';text=old.read_text(encoding='utf-8')
banner='<p><strong>Az SW1 referenciához pontosított változata:</strong> <a href="sw1-picture-v2.html">megnyitás — C-50 módszer</a>. Az alábbi képek a korábbi kézi változatot mutatják.</p>'
if 'sw1-picture-v2.html' not in text:old.write_text(text.replace('<main>','<main>'+banner,1),encoding='utf-8')
mirror=Path('G:/DEV/Terepasztal/renders/engine-models')
shutil.copytree(OUT,mirror/'sw1-picture-v2',dirs_exist_ok=True)
shutil.copy2(REVIEW/'page/sw1-picture-v2.html',mirror/'sw1-picture-v2.html')
print('Published',key)

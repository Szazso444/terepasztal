from pathlib import Path
from html import escape
import json, shutil
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parent
source=root/'fleet-painted'
local=Path('C:/Users/Zso/terepasztal-local/assets/source/fleet-painted-2026-10-07')
page=root/'page/batch4';page.mkdir(parents=True,exist_ok=True)
rows={'muki':(7,'Muki'),'mav490':(9,'MÁV 490'),'mk45':(10,'Mk45'),'mk48':(11,'Mk48'),'rezet':(12,'Rezet'),'mav375':(15,'MÁV 375'),'class08':(17,'Class 08'),'sw1':(21,'SW1'),'drg01':(25,'DRG 01'),'m62':(30,'M62')}
sections=[]
for id,(row,name) in rows.items():
 report=source/'after'/f'{id}-report.json'
 if not report.exists():continue
 data=json.loads(report.read_text())
 installed=json.loads((local/'installed.json').read_text())
 if installed[id].get('revision')!='reference-batch4' or data['bundleKey']!=installed[id]['key']:continue
 dest=page/id;dest.mkdir(exist_ok=True)
 shutil.copy2(local/'reference-v8'/f'drawing1-r{row}-c5.jpeg',dest/'reference.jpeg')
 shutil.copy2(source/'before'/f'{id}-straight.png',dest/'before.png')
 for suffix in ['straight','night','reversed']:
  shutil.copy2(source/'after'/f'{id}-{suffix}.png',dest/(suffix+'.png'))
 frames=[Image.open(source/'after'/f'{id}-{n:03}.png').convert('RGB') for n in range(32)]
 contact=Image.new('RGB',(1440,1920),'#25362f');draw=ImageDraw.Draw(contact)
 for n,im in enumerate(frames):
  thumb=im.copy();thumb.thumbnail((360,240));contact.paste(thumb,(n%4*360,n//4*240));draw.text((n%4*360+5,n//4*240+5),str(n),fill='white')
 contact.save(source/'after'/f'{id}-contact.jpg')
 reviewed=(source/'after'/f'{id}-reviewed.txt').exists()
 if reviewed:frames[0].save(dest/'curve.webp',save_all=True,append_images=frames[1:],duration=133,loop=0,quality=90)
 clip=f'<figure><img src="batch4/{id}/curve.webp"><figcaption>Kanyar és kerékforgás</figcaption></figure>' if reviewed else ''
 extra=' Új előkészítés a képből rekonstruált eredeti modellből; az Excel a forma alapja. Egységes, enyhe formaárnyalás, külön ráfestett vetett árnyék nélkül.'
 if id=='m62': extra=' Újraépített, tiszta felületű modell az Excel képe alapján: zöld-krém festés, két végfülke, szürke tető és két háromtengelyes forgóváz.'
 if id=='drg01': extra=' Az Excel alapján újraépített szénszerkocsi és tiszta forgóvázak; a mozdonytest eredeti képrekonstrukciója mereven igazítva.'
 sections.append(f'<section id="{id}"><h2>{escape(name)}</h2><p>Excel v8, Locomotives, {row}. sor.{extra}</p><div class="grid"><figure><img src="batch4/{id}/reference.jpeg"><figcaption>Referencia az Excelből</figcaption></figure><figure><img src="batch4/{id}/before.png"><figcaption>Előző kör</figcaption></figure><figure><img src="batch4/{id}/straight.png"><figcaption>Javított modell a játékban</figcaption></figure>{clip}<figure><img loading="lazy" src="batch4/{id}/night.png"><figcaption>Éjszakai nézet</figcaption></figure><figure><img loading="lazy" src="batch4/{id}/reversed.png"><figcaption>Megfordított mozdony</figcaption></figure></div><p><a href="/scratchpad/models/?rows={id}&zoom=3">Megnyitás a tesztjátékban</a></p></section>')
html='<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mozdonyok — tízes referenciacsomag</title><style>body{margin:0;background:#15211e;color:#e9eee9;font:16px/1.55 system-ui}main{max-width:1440px;margin:auto;padding:28px}a{color:#a5dfc5}section{padding:24px 0;border-top:1px solid #526b5c}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;background:#25362f;border-radius:8px;overflow:hidden}img{width:100%;display:block}figcaption{padding:10px 16px}p{max-width:105ch}@media(max-width:760px){.grid{grid-template-columns:1fr}}</style><main><h1>Tíz mozdony — referencia alapján</h1><p>A forma alapja az Excel v8 képe és útmutatója. A játékadatok az elkészült modellek illesztését szolgálják. Mind a tíz mozdonyt az elfogadott világosabb stílussal készítettem elő.</p><p>Ennél a tízes csomagnál megálltam ellenőrzésre.</p><p><a href="fleet.html">Előző kör teljes galériája</a> · <a href="index.html#c50-in-game">Jóváhagyott C-50</a></p>'+''.join(sections)+'</main></html>'
(root/'page/batch4.html').write_text(html,encoding='utf-8')
print('Revision gallery entries',len(sections))

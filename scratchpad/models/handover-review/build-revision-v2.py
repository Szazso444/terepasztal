from pathlib import Path
from html import escape
import json, shutil
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parent
source=root/'fleet-painted'
local=Path('C:/Users/Zso/terepasztal-local/assets/source/fleet-painted-2026-10-07')
page=root/'page/revision-v2';page.mkdir(parents=True,exist_ok=True)
rows={'ice1':(28,'ICE 1'),'bm50':(6,'BM-50'),'general':(18,'The General'),'rocket':(5,"Stephenson’s Rocket")}
sections=[]
for id,(row,name) in rows.items():
 report=source/'after'/f'{id}-report.json'
 if not report.exists():continue
 data=json.loads(report.read_text())
 installed=json.loads((local/'installed.json').read_text())
 if installed[id].get('revision')!='reference-v2' or data['bundleKey']!=installed[id]['key']:continue
 dest=page/id;dest.mkdir(exist_ok=True)
 shutil.copy2(local/'reference-v8'/f'drawing1-r{row}-c5.jpeg',dest/'reference.jpeg')
 shutil.copy2(source/'before-v2'/f'{id}-straight.png',dest/'before.png')
 for suffix in ['straight','night','reversed']:
  shutil.copy2(source/'after'/f'{id}-{suffix}.png',dest/(suffix+'.png'))
 frames=[Image.open(source/'after'/f'{id}-{n:03}.png').convert('RGB') for n in range(32)]
 contact=Image.new('RGB',(1440,1920),'#25362f');draw=ImageDraw.Draw(contact)
 for n,im in enumerate(frames):
  thumb=im.copy();thumb.thumbnail((360,240));contact.paste(thumb,(n%4*360,n//4*240));draw.text((n%4*360+5,n//4*240+5),str(n),fill='white')
 contact.save(source/'after'/f'{id}-contact.jpg')
 reviewed=(source/'after'/f'{id}-reviewed.txt').exists()
 if reviewed:frames[0].save(dest/'curve.webp',save_all=True,append_images=frames[1:],duration=133,loop=0,quality=90)
 clip=f'<figure><img src="revision-v2/{id}/curve.webp"><figcaption>Kanyar és kerékforgás</figcaption></figure>' if reviewed else ''
 extra=' Három tengely, a referencia szerinti oldalsó kerek nyílások és sárga hűtőrács.' if id=='bm50' else ''
 sections.append(f'<section id="{id}"><h2>{escape(name)}</h2><p>Excel v8, Locomotives, {row}. sor.{extra}</p><div class="grid"><figure><img src="revision-v2/{id}/reference.jpeg"><figcaption>Referencia az Excelből</figcaption></figure><figure><img src="revision-v2/{id}/before.png"><figcaption>Előző kör</figcaption></figure><figure><img src="revision-v2/{id}/straight.png"><figcaption>Világosabb változat, enyhe formaárnyalással</figcaption></figure>{clip}<figure><img loading="lazy" src="revision-v2/{id}/night.png"><figcaption>Éjszakai nézet</figcaption></figure><figure><img loading="lazy" src="revision-v2/{id}/reversed.png"><figcaption>Megfordított mozdony</figcaption></figure></div><p><a href="/scratchpad/models/?rows={id}&zoom=3">Megnyitás a tesztjátékban</a></p></section>')
html='<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mozdonyok — első javítási kör</title><style>body{margin:0;background:#15211e;color:#e9eee9;font:16px/1.55 system-ui}main{max-width:1440px;margin:auto;padding:28px}a{color:#a5dfc5}section{padding:24px 0;border-top:1px solid #526b5c}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;background:#25362f;border-radius:8px;overflow:hidden}img{width:100%;display:block}figcaption{padding:10px 16px}p{max-width:105ch}@media(max-width:760px){.grid{grid-template-columns:1fr}}</style><main><h1>Első javítási kör</h1><p>Az Excel v8 képei mellett láthatók az előző és az új játékbeli változatok. Világosabb festés, sokkal enyhébb formaárnyalás; új vetett vagy kontaktárnyék nincs a sprite-okba égetve. A forrásképek saját árnyalása megmarad.</p><p>A Garratt referenciája még tisztázandó: a v8-as Excelben nincs GMAM/Garratt sor. Ezt a modellt ebben a körben még nem módosítottam. Legfeljebb öt mozdony után ellenőrzési szünet következik.</p><p><a href="fleet.html">Előző kör teljes galériája</a> · <a href="index.html#c50-in-game">Jóváhagyott C-50</a></p>'+''.join(sections)+'</main></html>'
(root/'page/revision-v2.html').write_text(html,encoding='utf-8')
print('Revision gallery entries',len(sections))

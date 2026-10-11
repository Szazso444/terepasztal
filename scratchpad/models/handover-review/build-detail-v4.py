from pathlib import Path
from html import escape
import json, shutil
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parent
source=root/'detail-v4/after'
local=Path('C:/Users/Zso/terepasztal-local/assets/source/fleet-painted-2026-10-07')
page=root/'page/detail-v4';page.mkdir(parents=True,exist_ok=True)
rows={'mav375':(15,'MÁV 375'),'class08':(17,'Class 08'),'sw1':(21,'SW1'),'drg01':(25,'DRG 01'),'m62':(30,'M62')}
installed=json.loads((local/'installed.json').read_text());sections=[]
for id,(row,name) in rows.items():
    if not (source/f'{id}-report.json').exists(): continue
    data=json.loads((source/f'{id}-report.json').read_text())
    assert data['bundleKey']==installed[id]['key']
    dest=page/id;dest.mkdir(exist_ok=True)
    shutil.copy2(local/'reference-v8'/f'drawing1-r{row}-c5.jpeg',dest/'reference.jpeg')
    shutil.copy2(root/'wheel-v3/after'/f'{id}-straight.png',dest/'previous.png')
    for suffix in ['straight','night','reversed']:
        shutil.copy2(source/f'{id}-{suffix}.png',dest/(suffix+'.png'))
    if (source/f'{id}-detail.png').exists():shutil.copy2(source/f'{id}-detail.png',dest/'detail.png')
    frames=[Image.open(source/f'{id}-{n:03}.png').convert('RGB') for n in range(32)]
    contact=Image.new('RGB',(1440,1920),'#25362f');draw=ImageDraw.Draw(contact)
    for n,im in enumerate(frames):
        thumb=im.copy();thumb.thumbnail((360,240));contact.paste(thumb,(n%4*360,n//4*240));draw.text((n%4*360+5,n//4*240+5),str(n),fill='white')
    contact.save(source/f'{id}-contact.jpg')
    reviewed=source/f'{id}-reviewed.txt'
    if reviewed.exists():
        assert reviewed.read_text().strip()==installed[id]['key']
        frames[0].save(dest/'curve.webp',save_all=True,append_images=frames[1:],duration=133,loop=0,quality=90)
    extra={'mav375':'A nem létező hátsó kerékpár eltávolítva: három hajtott tengely.','class08':'A test tengelye a sínhez igazítva.','sw1':'Középre igazított, szélesebb és szimmetrikus motorház.','drg01':'25%-kal kisebb kerekek, hátrébb helyezett első forgóváz, sínhez igazított test.','m62':'Teljes forgóvázkeret: első és hátsó keresztmerevítő, hossztartók, középső tartó és vontatómotorok.'}[id]+' Pontosított lámpafények és ellenőrzött ablakfények.'
    if id=='m62':extra+=' A leegyszerűsített modell helyett ismét az eredeti referenciaképből rekonstruált forma szerepel.'
    def figure(file,label):return f'<figure><img src="detail-v4/{id}/{file}?v={installed[id]["key"]}"><figcaption>{label}</figcaption></figure>'
    pictures=figure('reference.jpeg','Referencia az Excelből')+figure('previous.png','Előző változat (wheel-v3)')+figure('straight.png','Javított modell')
    if reviewed.exists():pictures+=figure('curve.webp','Kanyar és kerékforgás')
    pictures+=figure('night.png','Éjszakai nézet')+figure('reversed.png','Megfordított mozdony')
    if (dest/'detail.png').exists():pictures+=figure('detail.png','Nagyított kerék- és sínillesztés')
    if (source/f'{id}-lights.png').exists():
        shutil.copy2(source/f'{id}-lights.png',dest/'lights.png');pictures+=figure('lights.png','Fényforrások közelről')
    sections.append(f'<section id="{id}"><h2>{escape(name)}</h2><p>{extra}</p><div class="grid">{pictures}</div><p><a href="/scratchpad/models/?rows={id}&zoom=3">Megnyitás a tesztjátékban</a></p></section>')
html='<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Geometria és fényforrások javítása</title><style>body{margin:0;background:#15211e;color:#e9eee9;font:16px/1.55 system-ui}main{max-width:1440px;margin:auto;padding:28px}a{color:#a5dfc5}section{padding:24px 0;border-top:1px solid #526b5c}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;background:#25362f;border-radius:8px;overflow:hidden}img{width:100%;display:block}figcaption{padding:10px 16px}p{max-width:100ch}@media(max-width:760px){.grid{grid-template-columns:1fr}}</style><main><h1>Geometria és fényforrások javítása — öt javított mozdony</h1><p>Az öt mozdony javítása a legutóbbi észrevételeid alapján. A wide sín maradt a választott 25%-kal keskenyebb változat. A referenciafüzet javított változata: v9.</p><p><a href="batch4.html">A teljes előző tízes csomag</a></p>'+''.join(sections)+'</main></html>'
(root/'page/detail-v4.html').write_text(html,encoding='utf-8')
print('Gallery entries:',len(sections))


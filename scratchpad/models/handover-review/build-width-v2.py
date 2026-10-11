from pathlib import Path
from html import escape
import json, shutil
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parent
source=root/'width-v2/after'
local=Path('C:/Users/Zso/terepasztal-local/assets/source/fleet-painted-2026-10-07')
page=root/'page/width-v2';page.mkdir(parents=True,exist_ok=True)
rows={'mav375':(15,'MÁV 375'),'class08':(17,'Class 08'),'sw1':(21,'SW1'),'drg01':(25,'DRG 01'),'m62':(30,'M62')}
installed=json.loads((local/'installed.json').read_text());sections=[]
for id,(row,name) in rows.items():
    if not (source/f'{id}-report.json').exists(): continue
    data=json.loads((source/f'{id}-report.json').read_text())
    assert data['bundleKey']==installed[id]['key']
    dest=page/id;dest.mkdir(exist_ok=True)
    shutil.copy2(local/'reference-v8'/f'drawing1-r{row}-c5.jpeg',dest/'reference.jpeg')
    shutil.copy2(root/'fleet-painted/after'/f'{id}-straight.png',dest/'previous.png')
    for suffix in ['straight','night','reversed']:
        shutil.copy2(source/f'{id}-{suffix}.png',dest/(suffix+'.png'))
    frames=[Image.open(source/f'{id}-{n:03}.png').convert('RGB') for n in range(32)]
    contact=Image.new('RGB',(1440,1920),'#25362f');draw=ImageDraw.Draw(contact)
    for n,im in enumerate(frames):
        thumb=im.copy();thumb.thumbnail((360,240));contact.paste(thumb,(n%4*360,n//4*240));draw.text((n%4*360+5,n//4*240+5),str(n),fill='white')
    contact.save(source/f'{id}-contact.jpg')
    reviewed=source/f'{id}-reviewed.txt'
    if reviewed.exists():
        assert reviewed.read_text().strip()==installed[id]['key']
        frames[0].save(dest/'curve.webp',save_all=True,append_images=frames[1:],duration=133,loop=0,quality=90)
    extra='15%-kal keskenyebb mozdonytest, a normál sínhez igazított kerekek. A hossz, a magasság és a kerékátmérő változatlan.'
    if id=='m62':extra+=' A leegyszerűsített modell helyett ismét az eredeti referenciaképből rekonstruált forma szerepel.'
    def figure(file,label):return f'<figure><img src="width-v2/{id}/{file}?v={installed[id]["key"]}"><figcaption>{label}</figcaption></figure>'
    pictures=figure('reference.jpeg','Referencia az Excelből')+figure('previous.png','Előző tízes csomag — javítás előtt')+figure('straight.png','Szélesség és kerékillesztés javítva')
    if reviewed.exists():pictures+=figure('curve.webp','Kanyar és kerékforgás')
    pictures+=figure('night.png','Éjszakai nézet')+figure('reversed.png','Megfordított mozdony')
    sections.append(f'<section id="{id}"><h2>{escape(name)}</h2><p>{extra}</p><div class="grid">{pictures}</div><p><a href="/scratchpad/models/?rows={id}&zoom=3">Megnyitás a tesztjátékban</a></p></section>')
html='<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Szélesség és kerékillesztés javítása</title><style>body{margin:0;background:#15211e;color:#e9eee9;font:16px/1.55 system-ui}main{max-width:1440px;margin:auto;padding:28px}a{color:#a5dfc5}section{padding:24px 0;border-top:1px solid #526b5c}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;background:#25362f;border-radius:8px;overflow:hidden}img{width:100%;display:block}figcaption{padding:10px 16px}p{max-width:100ch}@media(max-width:760px){.grid{grid-template-columns:1fr}}</style><main><h1>Szélesség és kerékillesztés — öt javított mozdony</h1><p>A normál sín változatlan. A kerekek a normál nyomtávhoz igazodnak, a mozdonytestek keskenyebbek. Az M62 visszakapta a képen látható formáját.</p><p><a href="batch4.html">A teljes előző tízes csomag</a></p>'+''.join(sections)+'</main></html>'
(root/'page/width-v2.html').write_text(html,encoding='utf-8')
print('Gallery entries:',len(sections))

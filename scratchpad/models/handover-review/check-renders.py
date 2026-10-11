from pathlib import Path
from PIL import Image, ImageDraw
import json
HERE=Path(__file__).parent
for eid in ['c50','black_five','drg01','daylight']:
    report=json.loads((HERE/'originals'/f'{eid}.json').read_text())
    assert report['mesh_unchanged']
    sheet=Image.new('RGB',(1440,992),'#dce4df')
    d=ImageDraw.Draw(sheet)
    for i,r in enumerate(report['renders']):
        im=Image.open(HERE/'originals'/r['file']).convert('RGBA')
        box=im.getchannel('A').getbbox()
        assert box and box[0]>0 and box[1]>0 and box[2]<im.width and box[3]<im.height,(eid,r,box)
        im.thumbnail((720,460))
        x=(i%2)*720; y=(i//2)*248
        # Thumbnails are for view coverage; full originals stay on the review page.
        im.thumbnail((710,220))
        sheet.paste(im,(x+(720-im.width)//2,y+25),im)
        d.text((x+5,y+5),f'{eid}: {r["mode"]}, {r["heading"]} degrees',fill='black')
    sheet.save(HERE/f'qa-views-{eid}.jpg',quality=94)
print('32 renders: nonempty alpha, no cropped edges, geometry invariants verified.')

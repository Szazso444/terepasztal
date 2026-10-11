from pathlib import Path
from PIL import Image,ImageDraw
R=Path(__file__).resolve().parent/'detail-v4/after'
ids=['mav375','class08','sw1','drg01','m62']
sheet=Image.new('RGB',(1200,300*len(ids)),'#243329');draw=ImageDraw.Draw(sheet)
for i,id in enumerate(ids):
    for j,name in enumerate(['reversed','night']):
        p=R/f'{id}-{name}.png'
        if not p.exists():continue
        im=Image.open(p);im.thumbnail((600,280));sheet.paste(im,(j*600,i*300+20));draw.text((j*600+5,i*300+3),id+' '+name,fill='white')
sheet.save(R/'stills-review.jpg')

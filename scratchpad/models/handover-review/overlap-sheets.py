from pathlib import Path
from PIL import Image, ImageChops, ImageStat, ImageDraw
HERE=Path(__file__).parent/'overlap'
for eid in ['c50','black_five','drg01','daylight']:
    pairs=[]
    for file in HERE.glob(f'{eid}-before-*.png'):
        flat=HERE/file.name.replace('-before-','-flat-')
        if not flat.exists(): continue
        a=Image.open(file).convert('RGB');b=Image.open(flat).convert('RGB')
        diff=ImageChops.difference(a,b)
        pairs.append((sum(ImageStat.Stat(diff).sum),file,a,b))
    if not pairs: continue
    pairs.sort(key=lambda p:p[0],reverse=True)
    _,file,a,b=pairs[0]
    canvas=Image.new('RGB',(1800,660),'#15211e');d=ImageDraw.Draw(canvas)
    canvas.paste(a,(0,40));canvas.paste(b,(900,40))
    d.text((12,12),file.stem+' / existing warped sprite',fill='white')
    d.text((912,12),'Identical game state / warp disabled',fill='white')
    canvas.save(HERE/f'{eid}-comparison.jpg',quality=95)
    print(eid,file.stem,round(pairs[0][0]))

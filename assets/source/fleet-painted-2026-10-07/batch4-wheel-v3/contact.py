from pathlib import Path
from PIL import Image,ImageDraw
import json,math,sys
R=Path(__file__).resolve().parent
ids=sys.argv[1:]
sheet=Image.new('RGB',(1200,220*len(ids)),(75,85,75));draw=ImageDraw.Draw(sheet)
for i,id in enumerate(ids):
 bundles=list((R/'samples'/id).glob('*/report.json'))
 if not bundles:continue
 bundle=max(bundles,key=lambda p:p.stat().st_mtime).parent
 ref=json.loads((R/'specs'/f'{id}.json').read_text())['reference']['pictures'][0]['path']
 im=Image.open(ref).convert('RGBA');im.thumbnail((250,200));sheet.paste(im,(0,i*220+20),im)
 cal={p['part']:p for p in json.loads((R/'prepared'/id/'calibration.json').read_text())}
 centres={}; bodies=[p for p in cal.values() if '-t' not in p['part']]; total=sum(p['tiles'][0] for p in bodies)*6.235064799811727; done=0
 for b in bodies:
  length=b['tiles'][0]*6.235064799811727;centres[b['part']]=total/2-done-length/2;done+=length
 manifest=json.loads((R/'prepared'/id/'candidate.json').read_text())
 for j,f in enumerate([0,24,48,72]):
  canvas=Image.new('RGBA',(400,300));angle=-f*math.tau/96
  # Orthographic camera: +X projects down-right; rotation around Z follows heading.
  for part in sorted(manifest['parts'],key=lambda p:0 if '-t' in p['name'] else 1):
   name=part['name'];p=bundle/'frames'/f'loco_{id}_{name}_f{f}.png'
   im=Image.open(p).convert('RGBA')
   x=centres[name.split('-t')[0]]+(cal[name]['gear'][0]['centre_m'] if '-t' in name else 0)
   px=64/(6.235064799811727*math.sqrt(2))*2
   dx=x*(math.cos(angle)+math.sin(angle))/math.sqrt(2)*px
   dy=x*(math.cos(angle)-math.sin(angle))/math.sqrt(2)*.5*px
   canvas.alpha_composite(im,(round(200-im.width/2+dx),round(205-im.height/2+dy)))
  box=canvas.getbbox()
  if box:
   im=canvas.crop(box);k=min(230/im.width,190/im.height);im=im.resize((round(im.width*k),round(im.height*k)));sheet.paste(im,(260+j*235,i*220+25),im)
 draw.text((5,i*220+3),id+' / reference and headings 0,24,48,72',fill='white')
sheet.save(R/'sample-contact.jpg')

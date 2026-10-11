from pathlib import Path
from PIL import Image,ImageDraw
import json,math
R=Path(__file__).resolve().parent
sheet=Image.new('RGB',(1400,260*5),'#26382e');d=ImageDraw.Draw(sheet)
for row,id in enumerate(['mav375','class08','sw1','drg01','m62']):
 b=max((R/'samples'/id).glob('*/report.json'),key=lambda p:p.stat().st_mtime).parent
 m=json.loads((R/'prepared'/id/'candidate.json').read_text());p=m['parts'][0];prefix=p['frame_prefix']
 for col,f in enumerate([0,24,48,72]):
  im=Image.open(b/'frames'/f'{prefix}_f{f}.png').convert('RGBA');maskpath=b/'frames'/f'{prefix}_lit_f{f}.png'
  if maskpath.exists():
   mask=Image.open(maskpath).convert('RGBA');im.alpha_composite(mask)
  draw=ImageDraw.Draw(im);a=-f*math.tau/96;px=64/(6.235064799811727*math.sqrt(2))*2
  for x,y,z in p['effects'].get('headlamps',[]):
   xx=x*math.cos(a)-y*math.sin(a);yy=x*math.sin(a)+y*math.cos(a)
   u=im.width/2+(xx+yy)/math.sqrt(2)*px;v=im.height/2+((xx-yy)*.5/math.sqrt(2)-z*math.cos(math.pi/6))*px
   draw.ellipse((u-1,v-1,u+1,v+1),fill='red')
  im=im.crop(im.getbbox());im.thumbnail((330,225));im=im.resize((int(im.width*1.3),int(im.height*1.3)))
  sheet.paste(im,(col*350,row*260+25),im)
 d.text((5,row*260+5),id+' windows + lamp markers',fill='white')
sheet.save(R/'light-review.jpg')

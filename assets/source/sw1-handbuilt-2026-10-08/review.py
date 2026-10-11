from pathlib import Path
from PIL import Image,ImageDraw
import json,math
R=Path(__file__).resolve().parent;m=json.loads((R/'candidate.json').read_text());b=max((R/'verified-samples/sw1').glob('*/report.json'),key=lambda p:p.stat().st_mtime).parent
sheet=Image.new('RGB',(1600,700),'#334039');draw=ImageDraw.Draw(sheet)
ref=Image.open(m['reference']['pictures'][0]['path']).convert('RGBA');ref.thumbnail((500,660));sheet.paste(ref,(5,25),ref)
cal={p['part']:p for p in json.loads((R/'calibration.json').read_text())}
for j,f in enumerate([0,24,48,72]):
 canvas=Image.new('RGBA',(600,500));a=-f*math.tau/96;px=64/(6.235064799811727*math.sqrt(2))*4
 for p in sorted(m['parts'],key=lambda p:0 if '-t' in p['name'] else 1):
  name=p['name'];im=Image.open(b/'frames'/f'loco_sw1_{name}_f{f}.png').convert('RGBA');x=cal[name]['gear'][0]['centre_m'] if '-t' in name else 0
  dx=x*(math.cos(a)+math.sin(a))/math.sqrt(2)*px;dy=x*(math.cos(a)-math.sin(a))*.5/math.sqrt(2)*px
  canvas.alpha_composite(im,(round(300-im.width/2+dx),round(350-im.height/2+dy)))
 im=canvas.crop(canvas.getbbox());im.thumbnail((500,300));sheet.paste(im,(530+j%2*530,35+j//2*330),im)
 draw.text((530+j%2*530,10+j//2*330),f'New handbuilt / facing {f}',fill='white')
sheet.save(R/'reference-comparison.jpg')

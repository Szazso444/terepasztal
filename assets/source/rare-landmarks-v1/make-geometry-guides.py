"""Create new projection diagrams, without modifying any generated artwork."""
from pathlib import Path
import json
from PIL import Image, ImageDraw

root = Path(__file__).parent
assets = json.loads((root / 'prompts-and-manifest.json').read_text())['assets']
(root / 'geometry').mkdir(exist_ok=True)
records = []
for a in assets:
    w, d = a['footprint_tiles']
    height = a['proposed_size_metres'][2] * 10
    scale = min(760 / (32 * (w + d)), 760 / (16 * (w + d) + height))
    origin = [512, 512 + height * scale / 2]
    def p(x, y, z=0):
        return (origin[0] + (x-y)*32*scale, origin[1] + ((x+y)*16-z)*scale)
    x0, x1, y0, y1 = -w/2, w/2, -d/2, d/2
    im = Image.new('RGBA', (1024, 1024))
    draw = ImageDraw.Draw(im)
    def poly(points, color):
        draw.polygon(points, fill=(*color, 255))
        draw.line(points + [points[0]], fill=(48,56,63,255), width=3)
    corners = [p(x0,y0),p(x1,y0),p(x1,y1),p(x0,y1)]
    poly([p(x0,y1),p(x1,y1),p(x1,y1,height),p(x0,y1,height)],(166,181,181))
    poly([p(x1,y0),p(x1,y1),p(x1,y1,height),p(x1,y0,height)],(128,147,155))
    poly([p(x0,y0,height),p(x1,y0,height),p(x1,y1,height),p(x0,y1,height)],(218,224,221))
    poly([p(-.125,y1),p(.125,y1),p(.125,y1,20),p(-.125,y1,20)],(65,80,85))
    for floor in range(30, height, 30):
        draw.line([p(x0,y1,floor),p(x1,y1,floor),p(x1,y0,floor)], fill=(92,112,118,255), width=2)
    im.save(root / 'geometry' / (a['id']+'.png'))
    records.append(dict(id=a['id'], source_size=[1024,1024], origin_pixels=origin, physical_pixels_per_logical_pixel=scale, ground_corners=corners, ground_axis_slopes=[.5,-.5], vertical_pixels_per_metre=10*scale))
(root / 'geometry' / 'guide-metadata.json').write_text(json.dumps(records,indent=2))
print('Created 12 exact 2:1 blockout diagrams; door = 2m, floor = 3m.')

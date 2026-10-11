from pathlib import Path
import shutil,re

root=Path(__file__).parent
section='''<section id="c50-handbuilt"><h2>C-50: rebuilt directly in Blender</h2>
<p>New editable geometry built from the selected illustration: central cab, equal-width hoods, a straight rectangular chassis, circular wheels and clean panels. No reconstructed ComfyUI mesh or projected photo patches.</p>
<div class="grid"><figure><img src="c50-handbuilt/reference.png" alt="Selected painted reference"><figcaption>Reference illustration</figcaption></figure><figure><img src="c50-handbuilt/front.png?v=2" alt="New Blender model"><figcaption>Rebuilt model — three-quarter view</figcaption></figure></div>
<p>The model has clean painted materials and explicit panel, louvre, glazing and lamp geometry. Small fittings and shading are simplified; this is a modeled interpretation, not an exact pixel match. The far side uses the same deliberate construction rather than invented reconstruction details.</p>
<div class="grid">'''
for name,label in [('rear','Opposite side / rear'),('side','Orthographic side'),('front-end','Orthographic front: two separate windows'),('rear-end','Orthographic rear: two separate windows'),('top','Orthographic top: equal hood widths and parallel sides')]:
    section+=f'<figure><img src="c50-handbuilt/{name}.png?v=2" alt="{label}"><figcaption>{label}</figcaption></figure>'
section+='''</div><p>Hood widths: 1.37 / 1.37 model units. Chassis width: 1.9008; cab width: 1.7064 (+8%). Front and rear each have two separately framed windows. Four separate wheel pivots are ready for rotation; these still images do not demonstrate a running-game animation. This review has not replaced the game atlas.</p><p><a href="c50-handbuilt/c50-handbuilt.blend">Editable Blender scene</a> · <a href="c50-handbuilt/c50-handbuilt.glb">GLB model</a> · <a href="c50-handbuilt/README.md">Build notes</a></p></section>'''
for dest in [Path('C:/Users/Zso/terepasztal-playtest/scratchpad/models/handover-review/page'),Path('G:/DEV/Terepasztal/renders/engine-models')]:
    out=dest/'c50-handbuilt';out.mkdir(exist_ok=True)
    for name in ['front.png','rear.png','side.png','front-end.png','rear-end.png','top.png','c50-handbuilt.blend','c50-handbuilt.glb','README.md']:
        shutil.copy2(root/name,out/name)
    shutil.copy2(root.parent/'c50-regenerated-2026-10-07/c50-reference-v2.png',out/'reference.png')
    page=dest/'index.html';html=page.read_text(encoding='utf-8')
    html=re.sub(r'<section id="c50-handbuilt">.*?</section>','',html,flags=re.S)
    at=html.index('<section id="c50-new">');html=html[:at]+section+html[at:]
    if 'href="#c50-handbuilt"' not in html:html=html.replace('<nav>','<nav><a href="#c50-handbuilt">Blender rebuild</a>',1)
    html=html.replace('<h3>New reconstructed model: four views — draft</h3>','<h3>Rejected ComfyUI reconstruction — historical</h3>')
    page.write_text(html,encoding='utf-8')
print('Published hand-built C-50 reference comparison and six views.')

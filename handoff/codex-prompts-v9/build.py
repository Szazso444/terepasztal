import html, re, os

S = os.path.dirname(os.path.abspath(__file__))
V7 = os.path.join(S, '..', 'codex-prompts-v7', 'page.html')
MD = os.path.join(S, '..', 'codex-review-1016', 'redo-prompts.md')
esc = lambda t: html.escape(t, quote=True)

# R8c word for word from redo-prompts.md (blocks there: C4c, its addendum, R8c, R7b, C17b)
blocks = re.findall(r'```text\n(.*?)\n```', open(MD).read(), re.S)
assert len(blocks) == 5
r8c = blocks[2]
r7c1 = open(os.path.join(S, 'src', 'R7c-1.txt')).read().rstrip('\n')
r8d = open(os.path.join(S, 'src', 'R8d.txt')).read().rstrip('\n')
c4d = open(os.path.join(S, 'src', 'C4d.txt')).read().rstrip('\n')
c17c = open(os.path.join(S, 'src', 'C17c.txt')).read().rstrip('\n')

v7 = open(V7).read()
head, _ = v7.split('<div class="wrap">\n', 1)
tail = v7[v7.index('</div>\n<script>'):]

T_R8C = "Fuel Pump r3 relit, r1 and r2 repainted on r0's plan (3 pictures)"
T_R7C1 = "People trial: the lumberjack walking away, repainted whole on the grey pose guides (4 pictures)"
T_R8D = "Fuel Pump r2 painted now, then r3's crane and hose, then its light (r1 accepted)"
T_C17C = "Windmill body without sails, in the game's camera, on the new block-out (1 picture)"
T_C4D = "Coaling stage r1, r3 and r2 at r0's height, on its own taller block-out (3 pictures)"
lead = ('Updated 2026-10-18 (v9). Only what Codex still has to paint is here. Three prompts can be pasted now, two in the buildings lane and one in the people lane; '
        'the others are added here, ready to copy, as soon as the guides they need are on develop.')
nav = ('<nav><a href="#next">Paste next</a>'
       f'<a href="#r8d">R8d &middot; {esc(T_R8D)}</a>'
       f'<a href="#c17c">C17c &middot; {esc(T_C17C)}</a>'
       f'<a href="#r7c1">R7c-1 &middot; {esc(T_R7C1)}</a>'
       '<a href="#coming">Coming next</a></nav>')

nxt = '''<section class="card" id="next">
  <header><h2>Paste next</h2></header>
  <ol>
    <li><b>Buildings lane: R8d</b>, Fuel Pump r2, then r3 in two steps, branch <span class="cid">art/325-fuel-pump</span>, issue #325. Each part commits and pushes on its own; at most three attempts a part.</li>
    <li><b>Buildings lane, after R8d: C17c</b>, the windmill&#x27;s tower without sails, branch <span class="cid">art/461-windmill-sails</span>, issue #461. One picture, at most three attempts.</li>
    <li><b>People lane</b>, in its own Codex window beside the buildings lane: <b>R7c-1</b>, the lumberjack walking away, branch <span class="cid">art/331-people</span>, issue #331. Four pictures, at most twelve calls. The other strips wait for this trial&#x27;s result.</li>
  </ol>
</section>
'''

r8c_card = f'''<section class="card" id="r8c">
  <header><span class="cid">R8c</span><h2>{esc(T_R8C)}</h2><button class="copy" type="button" data-for="p-r8c">Copy prompt</button></header>
  <p class="note"><b>Buildings lane. Branch art/325-fuel-pump (exists, head f3ac1a30 or later).</b> Issue #325. r3 starts as an image edit of attempt 7 that changes only its light, its crane (one post, as r0) and its hose (clear of the wall&#x27;s foot); r1 is repainted at r0&#x27;s height and camera; r2 is repainted on r0&#x27;s plan. The prompt carries its own height, light and camera tests.</p>
  <pre id="p-r8c" tabindex="0">{esc(r8c)}</pre>
</section>
'''


r8d_card = f'''<section class="card" id="r8d">
  <header><span class="cid">R8d</span><h2>{esc(T_R8D)}</h2><button class="copy" type="button" data-for="p-r8d">Copy prompt</button></header>
  <p class="note"><b>Buildings lane. Branch art/325-fuel-pump (exists, head 25ba21e2 or later).</b> Issue #325. Follows R8c, reviewed on 18 October: r1 attempt 12 passes every test and is accepted. r3 attempt 9 got the light right but came back squat with a two-post crane, because one edit was asked to change three things at once. r2 was never painted, because R8c held it back until r3 passed. So R8d paints r2 now, on r0 and the accepted r1, then fixes r3 from attempt 7 in two steps with one change each: the crane and the hose first, with the house locked in pixels, then the light, with attempt 9 as the light reference.</p>
  <pre id="p-r8d" tabindex="0">{esc(r8d)}</pre>
</section>
'''

c4d_card = f'''<section class="card" id="c4d">
  <header><span class="cid">C4d</span><h2>{esc(T_C4D)}</h2><button class="copy" type="button" data-for="p-c4d">Copy prompt</button></header>
  <p class="note"><b>Buildings lane, after R8c. Branch art/325-buildings-v2 (exists, head c25368a or later).</b> Issue #325. The author keeps Codex&#x27;s shorter plan with the chute on the short end, and chose to wait for this round. C4c&#x27;s turned views stood about three quarters of r0&#x27;s height because the shared block-out was only 40 game px high; the coaling stage now has its own 62 px block-outs on develop (PR #487). r0 is finished; r1, r3 and r2 are painted on the new guides, with a height test, a plan test, a camera test and r3 turned, not mirrored.</p>
  <pre id="p-c4d" tabindex="0">{esc(c4d)}</pre>
</section>
'''

c17c_card = f'''<section class="card" id="c17c">
  <header><span class="cid">C17c</span><h2>{esc(T_C17C)}</h2><button class="copy" type="button" data-for="p-c17c">Copy prompt</button></header>
  <p class="note"><b>Buildings lane, after R8d. Branch art/461-windmill-sails (exists, head beed486 or later).</b> Issue #461. The author found the demo&#x27;s windmill wonky and asked for a repaint so it can be animated. The accepted body was seen from 19&deg; down instead of the game&#x27;s 30&deg;, with its door and shaft turned about 27&deg; off, so the sails could not sit on it. C17c paints the tower again, without sails, as an edit of Art&#x27;s block-out in the game&#x27;s own projection (on develop, assets/source/buildings-v2/guides/, PR #490), and records the hub point. The sail cross from C17b is kept. Every number is measured from the foot&#x27;s width: camera, height, shaft slope, hub, door. Near-white pixels alone do not fail a picture; Art caps them at packing.</p>
  <pre id="p-c17c" tabindex="0">{esc(c17c)}</pre>
</section>
'''

r7c1_card = f'''<section class="card" id="r7c1">
  <header><span class="cid">R7c-1</span><h2>{esc(T_R7C1)}</h2><button class="copy" type="button" data-for="p-r7c1">Copy prompt</button></header>
  <p class="note"><b>People lane. Branch art/331-people (exists, head 8005c80 or later).</b> Issue #331. The author chose to repaint whole figures, not only legs. Earlier rounds failed because Codex copies the legs of any painting attached to it, so each pose is now an edit of Art&#x27;s grey pose mannequin (on develop, assets/source/people-v3-guides/, PR #491: the game&#x27;s camera and gait, turned 45 degrees), with only the lumberjack&#x27;s upper body attached for his look. The lumberjack keeps his axe on his shoulder. Every pose is measured: height, soles, the planted foot&#x27;s slide, the turn, and that P1 and P3 differ. If this trial passes, R7c-2 onward repaint the other back strips and the limping front strips the same way.</p>
  <pre id="p-r7c1" tabindex="0">{esc(r7c1)}</pre>
</section>
'''

coming = '''<section class="card" id="coming">
  <header><h2>Coming next (not pasteable yet)</h2></header>
  <ul>
    <li><b>Coaling stage r1 and r3</b>, issue #325: C4d failed again (Codex paints the stage wider than its plinth). The next step waits for the author&#x27;s answer on the board card &quot;Coaling stage turned views&quot;: Art builds them from r0, or another Codex round on a new guide.</li>
  </ul>
</section>
'''

body = ('<div class="wrap">\n  <h1>Codex art prompts</h1>\n'
        f'  <p class="lead">{lead}</p>\n  {nav}\n' + nxt + r8d_card + c17c_card + r7c1_card + coming)
page = head + body + tail
assert page.startswith('<title>')
open(os.path.join(S, 'page.html'), 'w').write(page)
print('page', len(page))

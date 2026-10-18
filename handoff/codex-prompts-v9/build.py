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
c4e = open(os.path.join(S, 'src', 'C4e.txt')).read().rstrip('\n')
c17c = open(os.path.join(S, 'src', 'C17c.txt')).read().rstrip('\n')
c17d = open(os.path.join(S, 'src', 'C17d.txt')).read().rstrip('\n')

v7 = open(V7).read()
head, _ = v7.split('<div class="wrap">\n', 1)
tail = v7[v7.index('</div>\n<script>'):]

T_R8C = "Fuel Pump r3 relit, r1 and r2 repainted on r0's plan (3 pictures)"
T_R7C1 = "People trial: the lumberjack walking away, repainted whole on the grey pose guides (4 pictures)"
T_R8D = "Fuel Pump r2 painted now, then r3's crane and hose, then its light (r1 accepted)"
T_C17C = "Windmill body without sails, in the game's camera, on the new block-out (1 picture)"
T_C17D = "Windmill body without sails, r3, r1 and r2, each on its own guide (3 pictures)"
T_C4E = "Coaling stage r1, r3 and r2 on the oblong guides with pier stubs (3 pictures)"
lead = ('Updated 2026-10-18 (v10). Only what Codex still has to paint is here. Five prompts can be pasted now: four in the buildings lane, in this order '
        '(R8d, C4e, C17c, C17d), and one in the people lane (R7c-1). The windmill&#x27;s turned guides and the coaling stage&#x27;s oblong guides are on the branch '
        'claude/art-guides-windmill-coaling, not merged yet: C17d and C4e tell Codex how to fetch them without committing them to its art branch.')
nav = ('<nav><a href="#next">Paste next</a>'
       f'<a href="#r8d">R8d &middot; {esc(T_R8D)}</a>'
       f'<a href="#c4e">C4e &middot; {esc(T_C4E)}</a>'
       f'<a href="#c17c">C17c &middot; {esc(T_C17C)}</a>'
       f'<a href="#c17d">C17d &middot; {esc(T_C17D)}</a>'
       f'<a href="#r7c1">R7c-1 &middot; {esc(T_R7C1)}</a></nav>')

nxt = '''<section class="card" id="next">
  <header><h2>Paste next</h2></header>
  <ol>
    <li><b>Buildings lane: R8d</b>, Fuel Pump r2, then r3 in two steps, branch <span class="cid">art/325-fuel-pump</span>, issue #325. Each part commits and pushes on its own; at most three attempts a part.</li>
    <li><b>Buildings lane, after R8d: C4e</b>, the coaling stage r1, r3 and r2 on the oblong guides, branch <span class="cid">art/325-buildings-v2</span>, issue #325. Replaces C4d. Nine calls, three attempts a view, r2 included.</li>
    <li><b>Buildings lane, after C4e: C17c</b>, the windmill&#x27;s tower without sails, front view r0, branch <span class="cid">art/461-windmill-sails</span>, issue #461. One picture, at most three attempts.</li>
    <li><b>Buildings lane, after C17c: C17d</b>, the same tower without sails in r3, r1 and r2, same branch and issue. Three pictures, at most three attempts each.</li>
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

c4e_card = f'''<section class="card" id="c4e">
  <header><span class="cid">C4e</span><h2>{esc(T_C4E)}</h2><button class="copy" type="button" data-for="p-c4e">Copy prompt</button></header>
  <p class="note"><b>Buildings lane, after R8d. Branch art/325-buildings-v2 (exists, head b2a45afc or later; art/325-fuel-pump is the Fuel Pump&#x27;s, not the coaling stage&#x27;s).</b> Issue #325. Replaces C4d, which is off the page: all nine of its attempts failed on 18 October. The review measured why: Codex paints the stage 15 to 26 per cent wider than the plinth, and the fit then shrinks it low. The author chose another Codex round, with all nine calls, so r2 is repainted too (r2 attempt 8 is no longer the plan). The guides are new: an oblong block on an oblong plinth with six pier stubs (Art&#x27;s <span class="cid">fuel_stop-oblong-r1</span> to <span class="cid">r3</span>), on the branch claude/art-guides-windmill-coaling, not merged yet; the prompt tells Codex to read them out of that branch into a folder outside its checkout. It carries the width limit (plinth 516 px of the guide, 632 of 1254; painted at most 5 per cent wider, 542 and 663), the walls&#x27; feet ratio, the long side per view, and the r3 winch opening, and measures the pier span before the fit. Nothing is stretched or bent: the angles come from the painting.</p>
  <pre id="p-c4e" tabindex="0">{esc(c4e)}</pre>
</section>
'''

c17c_card = f'''<section class="card" id="c17c">
  <header><span class="cid">C17c</span><h2>{esc(T_C17C)}</h2><button class="copy" type="button" data-for="p-c17c">Copy prompt</button></header>
  <p class="note"><b>Buildings lane, after C4e. Branch art/461-windmill-sails (exists, head beed486 or later).</b> Issue #461. The author found the demo&#x27;s windmill wonky and asked for a repaint so it can be animated. The accepted body was seen from 19&deg; down instead of the game&#x27;s 30&deg;, with its door and shaft turned about 27&deg; off, so the sails could not sit on it. C17c paints the tower again, without sails, as an edit of Art&#x27;s block-out in the game&#x27;s own projection (on develop, assets/source/buildings-v2/guides/, PR #490), and records the hub point. The sail cross from C17b is kept. Every number is measured from the foot&#x27;s width: camera, height, shaft slope, hub, door. Near-white pixels alone do not fail a picture; Art caps them at packing. Decided on 18 October: all four views are painted. C17c paints the front view r0; C17d follows it with r3, r1 and r2.</p>
  <pre id="p-c17c" tabindex="0">{esc(c17c)}</pre>
</section>
'''

c17d_card = f'''<section class="card" id="c17d">
  <header><span class="cid">C17d</span><h2>{esc(T_C17D)}</h2><button class="copy" type="button" data-for="p-c17d">Copy prompt</button></header>
  <p class="note"><b>Buildings lane, after C17c. Branch art/461-windmill-sails (C17c&#x27;s commit or later).</b> Issue #461. The author decided on 18 October that the windmill has four views. C17d paints the tower without sails for r3, r1 and r2, each as an edit of its own guide (canvas 1024, scale 8, anchor 512,832; hub offsets r1 (-16,-50), r2 (16,-50), r3 (16,-34)), in the same lane and with the same tests as C17c. C17b&#x27;s sail cross is turned into each view by an exact transform, so each body must leave the hub exactly at its guide&#x27;s point. In r1 and r2 the cross is seen from behind: no door, no window, and the stub and plate stand behind the tower. The guides are on the branch claude/art-guides-windmill-coaling, not merged yet; the prompt tells Codex to read them out of that branch into a folder outside its checkout, so they are not committed to the art branch. Nothing is mirrored, sheared or stretched: each view is turned by its own camera.</p>
  <pre id="p-c17d" tabindex="0">{esc(c17d)}</pre>
</section>
'''

r7c1_card = f'''<section class="card" id="r7c1">
  <header><span class="cid">R7c-1</span><h2>{esc(T_R7C1)}</h2><button class="copy" type="button" data-for="p-r7c1">Copy prompt</button></header>
  <p class="note"><b>People lane. Branch art/331-people (exists, head 8005c80 or later).</b> Issue #331. The author chose to repaint whole figures, not only legs. Earlier rounds failed because Codex copies the legs of any painting attached to it, so each pose is now an edit of Art&#x27;s grey pose mannequin (on develop, assets/source/people-v3-guides/, PR #491: the game&#x27;s camera and gait, turned 45 degrees), with only the lumberjack&#x27;s upper body attached for his look. The lumberjack keeps his axe on his shoulder. Every pose is measured: height, soles, the planted foot&#x27;s slide, the turn, and that P1 and P3 differ. If this trial passes, R7c-2 onward repaint the other back strips and the limping front strips the same way.</p>
  <pre id="p-r7c1" tabindex="0">{esc(r7c1)}</pre>
</section>
'''

body = ('<div class="wrap">\n  <h1>Codex art prompts</h1>\n'
        f'  <p class="lead">{lead}</p>\n  {nav}\n' + nxt + r8d_card + c4e_card + c17c_card + c17d_card + r7c1_card)
page = head + body + tail
assert page.startswith('<title>')
open(os.path.join(S, 'page.html'), 'w').write(page)
print('page', len(page))

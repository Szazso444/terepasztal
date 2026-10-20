import html, json, os

S = os.path.dirname(os.path.abspath(__file__))
V7 = os.path.join(S, '..', 'codex-prompts-v7', 'page.html')
esc = lambda t: html.escape(t, quote=True)


def prompt(name):
    with open(os.path.join(S, 'src', name + '.txt'), encoding='utf-8') as f:
        return f.read().replace('\r\n', '\n').rstrip('\n')


# The cards and the lanes are data: src/cards.json. The earlier cards ("old") carry their note as
# HTML, word for word; the others have lane, branch, issue and a plain note, escaped here.
with open(os.path.join(S, 'src', 'cards.json'), encoding='utf-8') as f:
    data = json.load(f)
old = data['old']
new = data['cards']
lanes = data['lanes']

with open(V7, encoding='utf-8') as f:
    v7 = f.read().replace('\r\n', '\n')
head, _ = v7.split('<div class="wrap">\n', 1)
tail = v7[v7.index('</div>\n<script>'):]

LANE_CSS = (
    '  .lane { font-family: var(--font-title); font-weight: normal; font-size: 20px; margin: 10px 0 0; color: var(--accent); border-bottom: 1px solid var(--line); padding-bottom: 4px; }\n'
    '  .card h3 { font-family: var(--font-title); font-weight: normal; font-size: 15px; margin: 6px 0 0; color: var(--accent); }\n'
    '  .lanelabel { color: var(--dim); }\n'
    '</style>'
)
head = head.replace('</style>', LANE_CSS, 1)


def entry(key):
    """(label, anchor, title, note html, prompt text, next text or None) of one card."""
    if key in old:
        o = old[key]
        return o['label'], o['anchor'], o['title'], o['note_html'], prompt(o['file']), o.get('next')
    c = new[key]
    lead = f'<b>{esc(c["lane"])}. Branch {esc(c["branch"])}.</b> Issue {esc(c["issue"])}. '
    if c.get('after'):
        lead = '<b>AFTER the house rotations are accepted.</b> ' + lead
    return key, key.lower(), c['title'], lead + esc(c['note']), prompt(c['file']), c.get('next')


def card(label, anchor, title, note, text):
    return f'''<section class="card" id="{anchor}">
  <header><span class="cid">{esc(label)}</span><h2>{esc(title)}</h2><button class="copy" type="button" data-for="p-{anchor}">Copy prompt</button></header>
  <p class="note">{note}</p>
  <pre id="p-{anchor}" tabindex="0">{esc(text)}</pre>
</section>
'''


lead = (
    "Updated 2026-10-19 (v14). The author decided on 19 October that the turned views are no longer painted on grey block-outs: they are painted OVER 3D scaffolds. Core rebuilt each building as a 3D model from its painted r0 and rendered it at the game's exact camera on the guide's canvas (branch claude/art-scaffolds-review-2, head fc07d589, assets/source/buildings-v2/scaffolds/<job>/). Per view there is a lit render (the picture to paint over: shape, camera, layout), a bare clay render and a JSON outline (the silhouette check). Painting stays painting: Codex repaints every surface in the game's painted style, matching r0's materials and details, and paints the invented surfaces (the walls the front view never showed, listed per view in the scaffold README and on each card) anew, plausibly and in the same building's style, never left soft or blurred. "
    "A view is accepted when its silhouette matches the scaffold's outline: overlap (IoU) at least 0.90 after the best uniform scale and shift, and a boundary deviation of at most 3 game px (24 canvas px on the 8 px canvases, 18 on the 6 px ones, 15 on the 5 px power plant). The camera comes from the scaffold, so there is no separate camera, plan or footprint test; the width is a measurement (Art scales a picture uniformly at packing); the height as a proportion, the light and the same building as r0 keep their tests. "
    "Accepted so far, and not painted again: depot a0 r3, attempt 3 (C34a, off the page) and, new today, the house r1, attempt 1 (C33a): the author accepted it on 19 October, it is recorded in handoff/codex-review-1019b.json and removed from that card. "
    "Two cards are two-stage because their building has no r0 to scaffold: C29a (the hydro plant, a new design) and C35a (the narrow depot). Stage 1, the card as it stands: Codex paints r0 only, freely, on its guide, with the camera test strict, and then STOPS. Stage 2, a later card: after Core renders a scaffold from the accepted r0, Codex paints r1 to r3 over it. "
    "C30a and C31a keep the existing r0 (now on a 2 x 2 footprint) and paint r1 to r3; C28a, the Battery, paints r0 over its own scaffold too (the old picture's angle was wrong). C33b still waits for the house rotations, and C17c, C17d and R7c-1 are as they were. "
    "Earlier fixes stay: C21a and C23a (Step 0 restores their farm and quarry pictures from a backup snapshot) and R7c-1 (its highlight test is a report). "
    "Three lanes, each its own Codex window: the buildings lane (the narrow depot r0 and the farm halt first, then the quarry, the coaling stage, the Fuel Pump and the windmill), the rotations lane (the turned views of the old base-v1 pictures on the branch art/535-rotations, "
    "the ones that block gameplay first; each job writes its own measuring script and rebases before it pushes), and the people lane. Every prompt tells Codex how to read the scaffold files out of that branch without committing them to its art branch (git fetch origin claude/art-scaffolds-review-2, then git show origin/claude/art-scaffolds-review-2:<path> into a folder outside its checkout); "
    "at most three attempts a view. "
    "The house biome prompt, C33b, waits for the house rotations to be accepted."
)

nav_rows = ['<nav><a href="#next">Paste next</a></nav>']
nxt = ['<section class="card" id="next">\n  <header><h2>Paste next</h2></header>']
body_cards = []
for lane in lanes:
    links = []
    items = []
    cards_html = [f'<h2 class="lane" id="lane-{lane["id"]}">{esc(lane["title"])}</h2>\n']
    for key in lane['cards']:
        label, anchor, title, note, text, nxt_text = entry(key)
        links.append(f'<a href="#{anchor}">{esc(label)} &middot; {esc(title)}</a>')
        if nxt_text:
            items.append(f'    <li><b>{esc(label)}</b> {esc(nxt_text)}</li>')
        cards_html.append(card(label, anchor, title, note, text))
    nav_rows.append(f'<nav><span class="lanelabel">{esc(lane["title"])}:</span> ' + ''.join(links) + '</nav>')
    nxt.append(f'  <h3>{esc(lane["label"])}</h3>')
    if lane['intro']:
        nxt.append(f'  <p class="note">{esc(lane["intro"])}</p>')
    nxt.append('  <ol>\n' + '\n'.join(items) + '\n  </ol>')
    body_cards.append(''.join(cards_html))
nxt.append('</section>\n')

body = (
    '<div class="wrap">\n  <h1>Codex art prompts</h1>\n'
    f'  <p class="lead">{esc(lead)}</p>\n  ' + '\n  '.join(nav_rows) + '\n'
    + '\n'.join(nxt) + ''.join(body_cards)
)
page = head + body + tail
assert page.startswith('<title>')
with open(os.path.join(S, 'page.html'), 'w', encoding='utf-8', newline='\n') as f:
    f.write(page)
print('page', len(page))

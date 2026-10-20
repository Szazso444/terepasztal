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
    "Updated 2026-10-19 (v13). The author decided on 19 October that the painted WIDTH no longer fails a picture: Art scales a returned picture UNIFORMLY at packing (one factor on both axes, no shear) until its base fits the guide's held width, and a uniform scale distorts nothing. The width is a measurement now. The camera (kept strict: a picture off the game's camera is repainted and never corrected, issue #536), the plan's foot ratio, the height as a proportion of the base width, the light, the same building as r0, and one new test, the base inside the footprint after scaling, decide. "
    "All 51 pictures that Codex painted on 19 October were re-tested on that rule (47 of them had been refused for width only; numbers per attempt in handoff/codex-review-1019b.json). One passes: depot a0 r3, attempt 3 (assets/source/buildings-v2/raw/depot-a0-r3-attempt-3.png on art/325-buildings-v2, sha256 487bdc41..., scaled by 0.806 at packing). It is ACCEPTED and is not painted again, so C34a is off the page. "
    "Every other picture fails the camera (feet too steep or too flat), most also the plan or the footprint, so the cards below are the same jobs with the width gate turned into a measurement, the line that told the painter to paint smaller taken out, and the re-test numbers of each failed view; every card starts with what is accepted (nothing, apart from the depot). "
    "Earlier fixes stay: C21a and C23a (Step 0 restores their farm and quarry pictures from a backup snapshot) and R7c-1 (its highlight test is a report). "
    "Three lanes, each its own Codex window: the buildings lane (the narrow depot and the farm halt first, then the quarry, the coaling stage, the Fuel Pump and the windmill), the rotations lane (the turned views of the old base-v1 pictures on the branch art/535-rotations, "
    "the ones that block gameplay first; each job writes its own measuring script and rebases before it pushes), and the people lane. Every prompt reads the numbers of the review-2 guides "
    "(PR #537, not merged yet: each prompt tells Codex how to read them out of that branch without committing them to its art branch); "
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

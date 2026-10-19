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
    'Updated 2026-10-19 (v11). Review 2 of the building pictures is in, and this page holds what Codex still has to paint. '
    'Three lanes, each its own Codex window: the buildings lane (depots and the farm halt first, then the quarry, the coaling stage, '
    'the Fuel Pump and the windmill), the rotations lane (the turned views of the old base-v1 pictures on the new branch art/535-rotations, '
    'the ones that block gameplay first), and the people lane. Every prompt measures the base width first, against the numbers of the review-2 guides '
    '(PR #537, not merged yet: each prompt tells Codex how to read them out of that branch without committing them to its art branch); '
    "a picture off the game's camera is repainted and never stretched (issue #536); at most three attempts a view. "
    'R8e replaces R8d, which has run. The house biome prompt, C33b, waits for the house rotations to be accepted.'
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

import html, json, os

# Python twin of build.mjs (same output). Everything the page says is data: src/cards.json (groups and cards),
# src/*.txt (the prompts), src/extra.css and src/page.js (the page's own style and script).
S = os.path.dirname(os.path.abspath(__file__))
V7 = os.path.join(S, '..', 'codex-prompts-v7', 'page.html')
esc = lambda t: html.escape(t, quote=True)


def rd(*parts):
    with open(os.path.join(S, *parts), encoding='utf-8', newline='') as f:
        return f.read().replace('\r\n', '\n')


def prompt(name):
    return rd('src', name + '.txt').rstrip('\n')


data = json.loads(rd('src', 'cards.json'))
cards = data['cards']
groups = data['groups']

# the page's head (title and the game panel style) comes from v7; the page's own style and script from src/
v7 = rd('..', 'codex-prompts-v7', 'page.html')
head = v7[:v7.index('<div class="wrap">\n')].replace('</style>', rd('src', 'extra.css').rstrip('\n'), 1)
script = rd('src', 'page.js').rstrip('\n')
tail = '</div>\n<script>\n' + script + '\n</script>\n'

SAME_TIME = 'Can run beside another group only if Codex works each in its own git worktree; in the main checkout run one group at a time.'


def anchor_of(key):
    return key.lower()


def label_of(key):
    return cards[key].get('label') or key


def plural(n):
    return f'{n} prompt' + ('' if n == 1 else 's')


def card(key, pos, total):
    c = cards[key]
    anchor = anchor_of(key)
    return f'''<section class="card" id="{anchor}">
  <header><span class="cid">{esc(label_of(key))}</span><h2>{esc(c["title"])}</h2><span class="pos">{pos} of {total}</span><button class="copy" type="button" data-for="p-{anchor}">Copy prompt</button></header>
  <p class="status"><b>Status.</b> {esc(c["status"])}</p>
  <pre id="p-{anchor}" tabindex="0">{esc(prompt(c["file"]))}</pre>
</section>
'''


toc_rows = []
sections = []
for g in groups:
    n = len(g['cards'])
    ids = ', '.join(label_of(k) for k in g['cards'])
    toc_rows.append(
        f'<tr><td><a href="#g-{g["id"]}">{esc(g["title"])}</a></td><td>{esc(g["branch"])}</td><td class="n">{n}</td><td>{esc(ids)}. {esc(g["status"])}</td></tr>'
    )
    order = '\n'.join(
        f'    <li><a href="#{anchor_of(k)}">{esc(label_of(k))}</a> {esc(cards[k]["status"])}</li>' for k in g['cards']
    )
    pending = '\n'.join(f'    <li>{esc(t)}</li>' for t in g.get('pending', []))
    s = f'''<section class="group" id="g-{g["id"]}">
<h2 class="lane">{esc(g["title"])}</h2>
<div class="card ginfo">
  <p class="note"><b>Branch {esc(g["branch"])}.</b> One Codex conversation, {plural(n)}. {esc(g["status"])}</p>
  <p class="note"><b>Order.</b> {esc(g["run"])}</p>
  <p class="note"><b>Same time.</b> {esc(g["same"])} {esc(SAME_TIME)}</p>
  <ol>
{order}
  </ol>
'''
    if pending:
        s += f'  <p class="note"><b>Not written yet.</b></p>\n  <ul>\n{pending}\n  </ul>\n'
    s += f'''  <button class="copy copyall" type="button" data-group="g-{g["id"]}">Copy whole conversation</button>
</div>
'''
    s += ''.join(card(k, i + 1, n) for i, k in enumerate(g['cards']))
    s += '</section>\n'
    sections.append(s)

toc = '''<section class="card" id="toc">
  <header><h2>Contents</h2></header>
  <table class="toc">
    <thead><tr><th>Group (one conversation)</th><th>Branch</th><th class="n">Prompts</th><th>Prompts in order, status</th></tr></thead>
    <tbody>
''' + '\n'.join(toc_rows) + '''
    </tbody>
  </table>
</section>
'''

body = (
    '<div class="wrap">\n  <h1>Codex art prompts</h1>\n'
    + f'  <div class="lead">\n    <p>Updated {esc(data["updated"])}.</p>\n'
    + ''.join(f'    <p>{esc(p)}</p>\n' for p in data['lead'])
    + '  </div>\n'
    + toc
    + ''.join(sections)
)
page = head + body + tail
assert page.startswith('<title>')
with open(os.path.join(S, 'page.html'), 'w', encoding='utf-8', newline='\n') as f:
    f.write(page)
print('page', len(page))

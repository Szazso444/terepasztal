// Node port of build.py (same output). The lead paragraph is read out of build.py so there is one copy of it.
// Usage: node build.mjs   (writes page.html next to this file)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const S = path.dirname(fileURLToPath(import.meta.url));
const V7 = path.join(S, '..', 'codex-prompts-v7', 'page.html');
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const rd = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const prompt = (name) => rd(path.join(S, 'src', name + '.txt')).replace(/\n+$/, '');

const data = JSON.parse(rd(path.join(S, 'src', 'cards.json')));
const old = data.old;
const cards = data.cards;
const lanes = data.lanes;

const v7 = rd(V7);
const marker = '<div class="wrap">\n';
let head = v7.slice(0, v7.indexOf(marker));
const tail = v7.slice(v7.indexOf('</div>\n<script>'));

const LANE_CSS =
  '  .lane { font-family: var(--font-title); font-weight: normal; font-size: 20px; margin: 10px 0 0; color: var(--accent); border-bottom: 1px solid var(--line); padding-bottom: 4px; }\n' +
  '  .card h3 { font-family: var(--font-title); font-weight: normal; font-size: 15px; margin: 6px 0 0; color: var(--accent); }\n' +
  '  .lanelabel { color: var(--dim); }\n' +
  '</style>';
head = head.replace('</style>', LANE_CSS);

function entry(key) {
  if (key in old) {
    const o = old[key];
    return [o.label, o.anchor, o.title, o.note_html, prompt(o.file), o.next || null];
  }
  const c = cards[key];
  let lead = `<b>${esc(c.lane)}. Branch ${esc(c.branch)}.</b> Issue ${esc(c.issue)}. `;
  if (c.after) lead = '<b>AFTER the house rotations are accepted.</b> ' + lead;
  return [key, key.toLowerCase(), c.title, lead + esc(c.note), prompt(c.file), c.next || null];
}

const card = (label, anchor, title, note, text) => `<section class="card" id="${anchor}">
  <header><span class="cid">${esc(label)}</span><h2>${esc(title)}</h2><button class="copy" type="button" data-for="p-${anchor}">Copy prompt</button></header>
  <p class="note">${note}</p>
  <pre id="p-${anchor}" tabindex="0">${esc(text)}</pre>
</section>
`;

// the lead paragraph: the adjacent string literals of `lead = (...)` in build.py
const py = rd(path.join(S, 'build.py'));
const a = py.indexOf('lead = (');
const b = py.indexOf('\n)\n', a);
const lead = py
  .slice(a + 'lead = ('.length, b)
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.startsWith('"'))
  .map((l) => l.slice(1, l.lastIndexOf('"')))
  .join('');

const navRows = ['<nav><a href="#next">Paste next</a></nav>'];
const nxt = ['<section class="card" id="next">\n  <header><h2>Paste next</h2></header>'];
const bodyCards = [];
for (const lane of lanes) {
  const links = [];
  const items = [];
  const cardsHtml = [`<h2 class="lane" id="lane-${lane.id}">${esc(lane.title)}</h2>\n`];
  for (const key of lane.cards) {
    const [label, anchor, title, note, text, nxtText] = entry(key);
    links.push(`<a href="#${anchor}">${esc(label)} &middot; ${esc(title)}</a>`);
    if (nxtText) items.push(`    <li><b>${esc(label)}</b> ${esc(nxtText)}</li>`);
    cardsHtml.push(card(label, anchor, title, note, text));
  }
  navRows.push(`<nav><span class="lanelabel">${esc(lane.title)}:</span> ` + links.join('') + '</nav>');
  nxt.push(`  <h3>${esc(lane.label)}</h3>`);
  if (lane.intro) nxt.push(`  <p class="note">${esc(lane.intro)}</p>`);
  nxt.push('  <ol>\n' + items.join('\n') + '\n  </ol>');
  bodyCards.push(cardsHtml.join(''));
}
nxt.push('</section>\n');

const body =
  '<div class="wrap">\n  <h1>Codex art prompts</h1>\n' +
  `  <p class="lead">${esc(lead)}</p>\n  ` +
  navRows.join('\n  ') +
  '\n' +
  nxt.join('\n') +
  bodyCards.join('');
const page = head + body + tail;
if (!page.startsWith('<title>')) throw new Error('page does not start with <title>');
fs.writeFileSync(path.join(S, 'page.html'), page, 'utf8');
console.log('page', page.length);

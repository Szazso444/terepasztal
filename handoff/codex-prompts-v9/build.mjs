// Node port of build.py (same output). Everything the page says is data: src/cards.json (groups and cards),
// src/*.txt (the prompts), src/extra.css and src/page.js (the page's own style and script).
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
const cards = data.cards;
const groups = data.groups;

// the page's head (title and the game panel style) comes from v7; the page's own style and script from src/
const v7 = rd(V7);
const marker = '<div class="wrap">\n';
const head = v7.slice(0, v7.indexOf(marker)).replace('</style>', rd(path.join(S, 'src', 'extra.css')).replace(/\n+$/, ''));
const script = rd(path.join(S, 'src', 'page.js')).replace(/\n+$/, '');
const tail = '</div>\n<script>\n' + script + '\n</script>\n';

const SAME_TIME =
  'Can run beside another group only if Codex works each in its own git worktree; in the main checkout run one group at a time.';

const anchorOf = (key) => key.toLowerCase();
const labelOf = (key) => cards[key].label || key;
const plural = (n) => `${n} prompt${n === 1 ? '' : 's'}`;

function card(key, pos, total) {
  const c = cards[key];
  const anchor = anchorOf(key);
  return `<section class="card" id="${anchor}">
  <header><span class="cid">${esc(labelOf(key))}</span><h2>${esc(c.title)}</h2><span class="pos">${pos} of ${total}</span><button class="copy" type="button" data-for="p-${anchor}">Copy prompt</button></header>
  <p class="status"><b>Status.</b> ${esc(c.status)}</p>
  <pre id="p-${anchor}" tabindex="0">${esc(prompt(c.file))}</pre>
</section>
`;
}

const tocRows = [];
const sections = [];
for (const g of groups) {
  const n = g.cards.length;
  const ids = g.cards.map(labelOf).join(', ');
  tocRows.push(
    `<tr><td><a href="#g-${g.id}">${esc(g.title)}</a></td><td>${esc(g.branch)}</td><td class="n">${n}</td><td>${esc(ids)}. ${esc(g.status)}</td></tr>`
  );
  const order = g.cards
    .map((k) => `    <li><a href="#${anchorOf(k)}">${esc(labelOf(k))}</a> ${esc(cards[k].status)}</li>`)
    .join('\n');
  const pending = (g.pending || []).map((t) => `    <li>${esc(t)}</li>`).join('\n');
  sections.push(
    `<section class="group" id="g-${g.id}">
<h2 class="lane">${esc(g.title)}</h2>
<div class="card ginfo">
  <p class="note"><b>Branch ${esc(g.branch)}.</b> One Codex conversation, ${plural(n)}. ${esc(g.status)}</p>
  <p class="note"><b>Order.</b> ${esc(g.run)}</p>
  <p class="note"><b>Same time.</b> ${esc(g.same)} ${esc(SAME_TIME)}</p>
  <ol>
${order}
  </ol>
` +
      (pending ? `  <p class="note"><b>Not written yet.</b></p>\n  <ul>\n${pending}\n  </ul>\n` : '') +
      `  <button class="copy copyall" type="button" data-group="g-${g.id}">Copy whole conversation</button>
</div>
` +
      g.cards.map((k, i) => card(k, i + 1, n)).join('') +
      '</section>\n'
  );
}

// the launcher: one short prompt that makes Codex read the file queue on branch claude/codex-queue itself
const launcher = prompt('launcher');
const launcherCard = `<section class="card" id="launcher">
  <header><span class="cid">Start here</span><h2>Launcher prompt: paste this into Codex</h2><button class="copy" type="button" data-for="p-launcher">Copy prompt</button></header>
  <p class="status"><b>What it does.</b> One conversation: Codex fetches branch claude/codex-queue, reads codex-queue/README.md and queue.json from it, and runs every ready group as a parallel sub-agent, each in its own worktree on G:, then reports the summary. The same text is in the repository as codex-queue/LAUNCH.md.</p>
  <p class="status"><b>The cards below.</b> The per-group cards below are the same prompts, kept for reference and for manual runs. The queue's own copies (codex-queue/prompts/ on that branch) have the same Core review 1 rules and differ in the queue-rules block, the branch and worktree instructions at their start, and each prompt's status in queue.json (done, ready, blocked, superseded).</p>
  <pre id="p-launcher" tabindex="0">${esc(launcher)}</pre>
</section>
`;

const toc = `<section class="card" id="toc">
  <header><h2>Contents</h2></header>
  <table class="toc">
    <thead><tr><th>Group (one conversation)</th><th>Branch</th><th class="n">Prompts</th><th>Prompts in order, status</th></tr></thead>
    <tbody>
${tocRows.join('\n')}
    </tbody>
  </table>
</section>
`;

const body =
  '<div class="wrap">\n  <h1>Codex art prompts</h1>\n' +
  launcherCard +
  `  <div class="lead">\n    <p>Updated ${esc(data.updated)}.</p>\n` +
  data.lead.map((p) => `    <p>${esc(p)}</p>\n`).join('') +
  '  </div>\n' +
  toc +
  sections.join('');
const page = head + body + tail;
if (!page.startsWith('<title>')) throw new Error('page does not start with <title>');
fs.writeFileSync(path.join(S, 'page.html'), page, 'utf8');
console.log('page', page.length);

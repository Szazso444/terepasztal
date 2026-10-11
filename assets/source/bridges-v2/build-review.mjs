import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const folder = fileURLToPath(new URL('.', import.meta.url));
const m = JSON.parse(readFileSync(folder + 'generation-prompts.json', 'utf8'));
const esc = (s) =>
  String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const accepted = m.assets.filter((a) => a.status === 'accepted').length;
const cards = m.assets
  .map((a) => {
    const attempt = a.attempts.find((t) => t.number === a.selectedAttempt) ?? a.attempts.at(-1);
    const source = a.status === 'accepted' ? a.filename : attempt?.normalized;
    const overlay = attempt?.qa?.replace('-report.json', '-overlay.png');
    const image =
      overlay && existsSync(folder + overlay) ? overlay : (source ?? 'guides/' + a.filename);
    const note =
      attempt?.maxDriftPx === undefined
        ? 'Not assessed'
        : `Maximum measured contour distance: ${attempt.maxDriftPx.toFixed(2)} px`;
    return `<article class="${a.status === 'accepted' ? 'accepted' : 'pending'}"><h2>${esc(a.filename)}</h2><p><b>${esc(a.status)}</b> · ${esc(note)}</p><a href="${esc(image)}"><img src="${esc(image)}" loading="lazy" alt="${esc(a.filename)} guide overlay"></a><p><a href="guides/${esc(a.filename)}">Guide</a>${source ? ` · <a href="${esc(source)}">Candidate</a>` : ''}${attempt?.file ? ` · <a href="${esc(attempt.file)}">Untouched original</a>` : ''}${attempt?.qa ? ` · <a href="${esc(attempt.qa)}">Measurements</a>` : ''}</p></article>`;
  })
  .join('\n');
writeFileSync(
  folder + 'index.html',
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Bridge kit v2 guide review</title><style>body{font:15px system-ui;background:#eeeae0;color:#282d2a;margin:32px}header{max-width:1000px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:18px}article{background:#fff;padding:16px;border-top:5px solid #b8832f}article.accepted{border-color:#498052}h2{font-size:18px}img{display:block;width:100%;background:#f3f3f3}a{color:#315d79}p{line-height:1.6}</style><header><h1>Bridge kit v2 — guide review</h1><p>${accepted} of 18 pieces accepted. Each preview overlays the normalized candidate at 50% opacity on its unmodified guide. Click to inspect at native resolution.</p><p><a href="PROMPTS.md">Original brief</a> · <a href="generation-prompts.json">Exact edit prompts and attempt history</a> · <a href="README.md">Validation and integration notes</a></p><p>Raw imagegen originals are preserved in attempts/. The user approved only uniform whole-canvas conversion to 1024 × 1024; no individual object is warped, moved, cropped, or masked to pass. Exact distances are recorded; “about 4 px” uses whole-pixel rounding (less than 4.5 px). Internal openings of timber railings need their specified two-rail/one-post design checked separately from the solid guide.</p></header><main>${cards}</main></html>\n`,
);
console.log(JSON.stringify({ accepted, total: 18, gallery: folder + 'index.html' }));

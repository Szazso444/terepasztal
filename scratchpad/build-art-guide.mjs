import { launch, openGame } from './runtime.mjs';
import { writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const out = new URL('../docs/art-direction/', import.meta.url);
const browser = await launch();
try {
  const page = await openGame(browser, 'after');
  const snapshot = await page.evaluate(async () => {
    const g = window.game;
    g.settings.autosave = false;
    g.clock.setSpeed(0);
    const { spriteDataUrl, frameForItem } = await import('/src/ui/spritePreview.ts');
    const { content } = await import('/src/data/content.ts');
    const { ATLAS_GROUPS } = await import('/src/art/index.ts');
    const entries = [];
    for (const key of g.atlas.keys('')) {
      const f = g.atlas.get(key);
      const group =
        [...g.atlas.images].find(([, image]) => image === f.image)?.[0] ?? key.split('/')[0];
      entries.push({
        key,
        group,
        width: f.w,
        height: f.h,
        anchorX: Math.round(f.anchorX * f.w),
        anchorY: Math.round(f.anchorY * f.h),
        image: spriteDataUrl(g.atlas, key, 1),
      });
    }
    const vehicles = [...content.locomotives, ...content.wagons].map((d) => ({
      key: d.id + ' — ' + d.name,
      group: 'complete-vehicles',
      width: 0,
      height: 0,
      image: spriteDataUrl(g.atlas, frameForItem(d.id), 2),
    }));
    return { entries, vehicles, groups: ATLAS_GROUPS.map((g) => g.name) };
  });
  assert.ok(snapshot.entries.length > 1000);
  assert.ok([...snapshot.entries, ...snapshot.vehicles].every((e) => e.image));
  await writeFile(
    new URL('frame-inventory.json', out),
    JSON.stringify(
      snapshot.entries.map(({ image, ...e }) => e),
      null,
      2,
    ),
  );
  const data = JSON.stringify([...snapshot.vehicles, ...snapshot.entries]).replaceAll(
    '<',
    '\\u003c',
  );
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Existing asset reference</title>
  <style>body{margin:0;background:#182c31;color:#eee8d7;font:16px system-ui}header{padding:24px;background:#233d40}h1{margin:0 0 8px}p{max-width:1000px}input,select,button{font:inherit;padding:10px;margin-right:12px;background:#eee8d7;border:0;border-radius:5px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;padding:24px}.card{background:#2b4448;padding:12px;min-height:175px;border:1px solid #547071}.art{height:130px;display:flex;align-items:center;justify-content:center;background:repeating-conic-gradient(#354c4e 0% 25%,#304749 0% 50%) 0 0/16px 16px}img{image-rendering:pixelated;max-width:100%;max-height:125px;object-fit:contain;transform:none}code{display:block;overflow-wrap:anywhere;font-size:12px;margin-top:10px}small{color:#bdcec8}a{color:#d8bd7e}</style>
  <header><h1>Existing asset reference</h1><p>Current game sprites, not redesign concepts. All ${snapshot.entries.length} atlas frames plus ${snapshot.vehicles.length} complete vehicle previews. Dimensions and anchors are native pixels. Shared frame families can serve multiple definitions. Representative mode is for browsing; All variants exposes every generated frame.</p><p><a href="README.md">Implementation guide</a> · <a href="asset-inventory.md">Definition inventory</a></p><select id="group"><option value="complete-vehicles">Complete vehicles</option>${snapshot.groups.map((g) => `<option>${g}</option>`).join('')}</select><input id="search" placeholder="Search frame or vehicle ID" aria-label="Search"><label><input id="all" type="checkbox">All variants</label><p id="count"></p></header><main></main>
  <script>const data=${data};const group=document.querySelector('#group'),search=document.querySelector('#search'),all=document.querySelector('#all');
  function representative(e){const k=e.key;if(/_f\\d+$/.test(k)&&!/_f0$/.test(k))return false;if(k.includes('/span_'))return /_1_0_3_(deck|rail)$/.test(k);if(k.includes('bridge_detail'))return /_0_2_/.test(k);if(k.includes('semaphore_'))return /m(0|3)_d(0|3)$/.test(k);return true;}
  function render(){const rows=data.filter(e=>e.group===group.value&&e.key.toLowerCase().includes(search.value.toLowerCase())&&(all.checked||representative(e)));document.querySelector('#count').textContent=rows.length+' displayed';document.querySelector('main').replaceChildren(...rows.map(e=>{const card=document.createElement('article');card.className='card';const art=document.createElement('div');art.className='art';const img=new Image();img.onload=()=>{const scale=Math.max(1,Math.min(4,Math.floor(190/img.naturalWidth),Math.floor(120/img.naturalHeight)));img.style.width=img.naturalWidth*scale+'px';};img.src=e.image;img.alt=e.key;art.append(img);const label=document.createElement('code');label.textContent=e.key;const dim=document.createElement('small');dim.textContent=e.width?e.width+' × '+e.height+' px · anchor '+e.anchorX+', '+e.anchorY:'Composed body and running gear';card.append(art,label,dim);return card;}));}for(const el of [group,search,all])el.addEventListener('input',render);render();</script></html>`;
  await writeFile(new URL('asset-catalog.html', out), html);
  await page.setContent(html);
  await page.check('#all');
  for (const group of snapshot.groups) {
    await page.selectOption('#group', group);
    assert.equal(
      await page.locator('.card').count(),
      snapshot.entries.filter((e) => e.group === group).length,
    );
  }
  await page.selectOption('#group', 'props');
  await page.fill('#search', 'birch');
  assert.equal(await page.locator('.card').count(), 3);
  await page.fill('#search', 'no-such-asset');
  assert.equal(await page.locator('.card').count(), 0);
  await page.fill('#search', '');
  await page.uncheck('#all');
  for (const group of [
    'complete-vehicles',
    'terrain',
    'props',
    'structures',
    'track',
    'icons',
    'people',
    'fx',
  ]) {
    await page.selectOption('#group', group);
    await page.evaluate(async () => Promise.all([...document.images].map((i) => i.decode())));
    await page.screenshot({
      path: new URL(`images/current-${group}.png`, out).pathname.replace(/^\/(\w:)/, '$1'),
      fullPage: true,
    });
  }
  const definitions = {};
  for (const table of [
    'biomes',
    'stations',
    'stations_full',
    'buildings',
    'buildings_full',
    'decor',
    'locomotives',
    'wagons',
    'cargo',
    'cargo_full',
    'ages',
  ]) {
    const d = JSON.parse(
      await readFile(new URL(`../src/data/${table}.json`, import.meta.url), 'utf8'),
    );
    definitions[table] = Array.isArray(d) ? d : d.defs;
  }
  const md = [
    '# Existing asset definitions',
    '',
    'Repository snapshot; includes both production-chain modes. IDs are implementation identifiers, not proposed player-facing labels. See the guide for redesign instructions and the catalog for every generated frame.',
    '',
  ];
  for (const [table, rows] of Object.entries(definitions)) {
    md.push(
      `## ${table} (${rows.length})`,
      '',
      '| ID | Name | Art / body | Size / plan / tier |',
      '| --- | --- | --- | --- |',
    );
    for (const d of rows)
      md.push(
        `| ${d.id} | ${d.name ?? d.title ?? d.id} | ${d.art ?? d.body ?? '—'} | ${[d.size, d.plan, d.tier != null ? 'tier ' + d.tier : '', d.type].filter(Boolean).join(' / ') || '—'} |`,
      );
    md.push('');
  }
  md.push('## Generated atlas groups', '', '| Group | Frames |', '| --- | --- |');
  for (const g of snapshot.groups)
    md.push(`| ${g} | ${snapshot.entries.filter((e) => e.group === g).length} |`);
  await writeFile(new URL('asset-inventory.md', out), md.join('\n') + '\n');
  console.log(
    JSON.stringify(
      {
        frames: snapshot.entries.length,
        completeVehicles: snapshot.vehicles.length,
        groups: snapshot.groups,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}

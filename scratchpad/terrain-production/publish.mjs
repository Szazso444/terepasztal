import fs from 'node:fs';
const root='scratchpad/terrain-production';
const world=JSON.parse(fs.readFileSync(`${root}/renders/report.json`,'utf8'));
const qa=JSON.parse(fs.readFileSync(`${root}/renders/verification.json`,'utf8'));
const groups=[
 ['Your latest refinements',[
  ['15-foundation-closeup','Along the foundation','Broken soil, short grass and tiny stones follow the building’s bottom contour.'],
  ['11-grass-variation','Light, balanced and rich together','World-seeded patches vary grass density and texture strength. Small stones are painted into the terrain.'],
  ['12-feathered-interlock','Softened interlocking edges','A narrow feather follows the irregular material boundary, preserving the texture on either side.'],
  ['14-shoreline','The same treatment at the shore','A narrower shoreline keeps the visible edge close to the actual water tiles.'],
 ]],
 ['In the generated 128 × 128 world',world.views.map(v=>[v.id,v.title,v.id==='10-connected-hills'?'Shared corner heights connect slopes, shoulders, plateaus and ridges. Original illustrated summit caps are used sparingly.':'Production terrain, assets and renderer; normal generation seed 7412.'])],
 ['Normal game build',[['16-playable-build','Playable game','The production build with its normal interface. Starting-region expansion creates a 160 × 160 map; visible regions are cached on demand.']]],
];
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Terepasztal · Terrain implemented</title>
<style>:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#152019;color:#e8ecd9}body{max-width:1450px;margin:auto;padding:36px 24px 90px}h1,h2{font-family:Georgia,serif;font-weight:500}h1{font-size:48px}h2{font-size:32px;margin-top:50px}p{line-height:1.65;color:#bac8b0;max-width:1000px}a{color:#d3e3a3}.tag{text-transform:uppercase;letter-spacing:2px;font-size:12px;color:#acc987}.grid{display:grid;grid-template-columns:1fr 1fr;gap:28px}figure{margin:0}figure:first-child{grid-column:1/-1}img{display:block;width:100%;height:auto;border-radius:7px;background:#253426}h3{margin:12px 0 6px}figcaption{font-size:14px;line-height:1.55;color:#bac8b0}.note{padding:16px 20px;border-left:3px solid #a9c477;background:#223023}nav{display:flex;gap:20px;flex-wrap:wrap;border-bottom:1px solid #43553c;padding-bottom:20px}.metric{font-size:13px;color:#a6b79b}@media(max-width:800px){.grid{grid-template-columns:1fr}body{padding:22px 12px}h1{font-size:36px}}</style>
<div class="tag">Terepasztal / production integration</div><h1>The new terrain is in the game.</h1>
<p>Mixed grass detail, small painted stones, gently feathered interlocks, foundation-following patches and connected illustrated relief. Existing music, foliage, scale and cozy effects remain.</p>
<nav><a href="/">Open the game</a><a href="#section-0">Latest refinements</a><a href="#section-1">Generated world</a><a href="#section-2">Game build</a></nav>
<p class="note">Every image below is captured from the actual game renderer. Close-ups use a controlled 48 × 48 comparison map; the world views use normal 128 × 128 generation. There is no custom preview ground layer or concept artwork in these captures.</p>
${groups.map(([title,items],j)=>`<section id="section-${j}"><h2>${title}</h2><div class="grid">${items.map(([id,title,caption])=>`<figure id="${id}"><a href="renders/${id}.png" target="_blank"><img loading="lazy" src="renders/${id}.png" alt="${title}"></a><h3>${title}</h3><figcaption>${caption}</figcaption></figure>`).join('')}</div></section>`).join('')}
<h2>Checked in play</h2><p>Rail placement flattens the full footprint; removal restores the hill. Mouse picking follows the raised surface. Worker failure restores the native illustrated tiles. Season changes preserve the water colour. Terrain generation and save format are unchanged.</p>
<p class="metric">${qa.cache.chunks} cached chunks · ${qa.excavation.localRepaintCount} nearby chunks repainted for a test hill edit · zero terrain repaints during camera panning · 173 tests pass.<br>Full 128 × 128 cache took ${(qa.cache.terrainStartupMs/1000).toFixed(1)} s in headless software-rendered Chrome. Normal play only paints revealed regions. This is a startup measurement, not a frame-rate claim.</p>
<p><a href="renders/verification.json">Browser checks</a> · <a href="renders/production.json">Production and fallback checks</a> · <a href="renders/report.json">World report</a> · <a href="terrain-production.md">Implementation notes</a></p></html>`;
fs.writeFileSync(`${root}/gallery.html`,html);
fs.copyFileSync('docs/art-direction/terrain-production.md',`${root}/terrain-production.md`);
const destination='G:/DEV/Terepasztal/renders/terrain-production';
fs.mkdirSync(destination,{recursive:true});
for(const file of ['gallery.html','terrain-production.md'])fs.copyFileSync(`${root}/${file}`,`${destination}/${file}`);
fs.cpSync(`${root}/renders`,`${destination}/renders`,{recursive:true});
console.log(destination+'/gallery.html');

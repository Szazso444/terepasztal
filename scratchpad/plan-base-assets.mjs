import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const dir = 'assets/source/base-v1';
const readJson = async (path) => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const coverage = await readJson(join(dir, 'coverage.json'));
let previousQueue = { assets: [] };
try { previousQueue = await readJson(join(dir, 'generation-queue.json')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const locomotives = await readJson('src/data/locomotives.json');
const wagons = await readJson('src/data/wagons.json');
const common = 'Use case: stylized-concept. Exactly ONE isolated game source asset, never a contact sheet, for The Willowline pastoral isometric railway game. Match the guide: crisp pixel-art-inspired clustered shading, broad readable masses, three or four shades per material, upper-left light. Palette: forest green #294638, moss #78804C, oat cream #E4D5B5, limestone #BCA98B, slate #626B6C, teal #477B82, copper #A36B42. Restrained detail, strong silhouette. Orthographic 2:1 isometric front/right view. Entire object centered with generous 12% empty margin. REAL RGBA transparent PNG, background alpha zero, solid surfaces opaque. No backdrop, lettering, captions, watermark, border, glow, detached shadow, scenery, extra objects or ground outside the asset. ';
const flat = 'A flat square surface projected as a precise 2:1 diamond, no thickness, block side walls, raised rim, bevel or black outline. Shared edges must tile cleanly. No trees, structures, tracks or props. ';
const props = {
  tree: 'One round broadleaf tree, two or three connected rounded moss-green canopy masses, short visible branching warm-brown trunk. Upright and more compact than oak. No ground tile or soil mound.',
  birch: 'One slender birch, ivory bark with sparse dark breaks, airy uneven small canopy masses, narrow branching trunk. No ground tile or soil mound.',
  pine: 'One pine tree, open tiered blue-green canopy with clearly visible trunk between irregular spreading horizontal groups. Distinct from a dense spruce cone. No ground tile or soil mound.',
  rock: 'One small low limestone rock with three or four broad pale grey facets, compact irregular silhouette. No surrounding ground or plants.',
  cactus: 'One ribbed saguaro cactus with two unequal upward arms and clear column silhouette, restrained moss-green highlights. No soil mound or ground tile.',
  bush: 'One low compact shrub with three connected rounded foliage lobes in moss and forest green, tiny woody base. No flowers, ground tile or soil mound.',
  boulder: 'One larger angular limestone boulder mass, strongly faceted light top and dark right side, sparse moss in one crevice. No surrounding ground or plants.',
  coal: 'One dark stratified coal seam outcrop with low angular block silhouette, charcoal layers and narrow blue-grey seams. Clearly distinct from pale ordinary rock. No surrounding ground.',
  oil: 'One small flat dark petroleum seep with uneven puddle silhouette and restrained slate-teal sheen, slight muted brown crust around its attached edge. No rainbow reflection, no ground tile.',
  palm: 'One oasis palm with a slightly bent warm-brown trunk and small fan of six readable broad green fronds. No coconuts, soil mound or ground tile.',
  deadtree: 'One bare dead tree with weathered grey-brown trunk and irregular tapering broken branches. Strong branching silhouette, no leaves, no ground tile.',
  reeds: 'One small grounded clump of sparse upright green reeds with three restrained brown cattail heads and narrow leaf blades. No water puddle or ground tile.',
  flowers: 'One tiny white wildflower clump with a few ivory petals, ochre centers, short moss-green stems and leaves, quiet simple silhouette. No pot or ground tile.',
};
const terrain = {
  forest: flat + 'Deep forest-green leaf litter, quiet brown moss patches, a few tiny fallen leaves, low contrast.',
  sand: flat + 'Warm oat and muted ochre sand, subtle broad grain clusters, calm even surface without dunes.',
  rock: flat + 'Low exposed limestone bedrock with broad warm grey slabs and restrained shallow fissures, no tall boulders.',
  hillcut: flat + 'Flattened ochre-brown cut earth with quiet compact soil strata and a few tiny pale aggregate specks. Not a hill.',
  plains: flat + 'Open meadow in moss and olive greens, broad quiet patches with only two or three tiny restrained flower dots. No wheat field.',
  taiga: flat + 'Cool desaturated blue-green lichen ground, subtle moss patches and a tiny optional pale frost accent. No conifers.',
  swamp: flat + 'Muted peat-green wet earth with shallow dark teal damp patches. Mostly solid wet ground, distinct from open water. No reeds.',
  desert: flat + 'Subdued oat and ochre desert ground with subtle broad wind-swept sand mottling and two tiny warm stone flecks. No tall dunes.',
  water: flat + 'Quiet deep teal water with a few short muted horizontal glints. No shoreline, island, foam border, bridge or land.',
  hill: 'One low rounded hill rising from a precise 2:1 diamond footprint. Moss-green grassy slopes with one small exposed limestone shoulder, upper-left light, modest elevation. No trees, square block walls or surrounding ground.',
  mountain: 'One unmistakably raised angular mountain on a precise 2:1 diamond footprint, broad slate and limestone rock faces with a few restrained ivory snow accents at its top. No trees, scenery or floating block side walls.',
  void: flat + 'A quiet dark desaturated rocky inaccessible ground surface, subtle charcoal and slate clusters, no magical elements, lights or stars.',
  city: flat + 'Quiet warm limestone urban paving of broad rectangular slabs with restrained seams, no curbs rising above tile, no road markings or street furniture.',
  cursor: 'One thin ivory-white 2:1 diamond outline for an isometric ground cursor, pixel-crisp stepped corners and hollow transparent center. No filled tile, shadows, glow, text or additional outlines.',
};
const other = {
  'stations.full.mine': 'One compact iron mine loading structure, limestone retaining wall, timber hoist and attached dark iron-ore hopper. Single connected installation, no mountain backdrop or landscape.',
  'stations.full.sand_pit': 'One compact sand-pit loading installation, low timber loading hopper with pale oat sand, small attached winch and warm stone retaining wall. Single connected structure, no landscape.',
  'stations.full.copper_mine': 'One compact copper mine loading structure, warm stone supports, copper-tinted ore hopper and timber hoist, readable ore-loading silhouette. Single connected structure, no landscape.',
  'works.full.colliery': 'One small coal colliery with timber and iron headframe, dark coal bins and attached sorting tower, slate-roofed brick machinery hut. Single connected structure, no ground base or smoke.',
  'works.full.ironworks': 'One compact brick ironworks, strong furnace mass, restrained warm orange opening, attached handling bay with neatly staged iron ingots. Single connected structure, no smoke or ground tile.',
  'works.full.oil_derrick': 'One compact triangular iron oil derrick frame with connected pump assembly and small tank, weathered copper and slate metal. Single structure, no surrounding ground.',
  'works.full.diesel_refinery': 'One compact diesel refinery in the existing warm brick, copper and slate family, attached cylindrical tank, distillation column and organized pipe racks. Single structure, no smoke, ground tile or text.',
  'works.full.wire_mill': 'One compact wire mill, warm brick roller hall with slate roof, visible copper wire reels and attached drawbench beneath a side canopy. Single connected structure, no ground tile.',
  'decor.power_line': 'One timber utility pole with simple wooden crossarm, three pale ceramic insulators and very short attached dark wire stubs. Distinguish it from railway catenary. Entire pole visible, no long wires or ground tile.',
  'track.straight': 'One straight single-tile railway track segment aligned along one isometric axis: exactly two parallel steel rails, warm timber sleepers and restrained neutral ballast apron. Rail ends terminate cleanly at opposing tile edges. No ground tile.',
  'track.curve': 'One continuous quarter-circle railway track segment, exactly two parallel steel rails at constant gauge on warm timber sleepers fanning radially over restrained neutral ballast. Correct continuous curve, not an angular corner. No ground tile.',
  'track.switch': 'One simple railway turnout with one straight route and one smoothly diverging route, coherent constant gauge, purposeful point blades and restrained timber sleepers on neutral ballast. No impossible extra branches or ground tile.',
  'track.crossing': 'One railway diamond crossing with two perpendicular routes in world space, coherent interleaved steel railheads and dark timber sleepers on neutral ballast. No switch branch or ground tile.',
  'track.bridge': 'One short legacy railway bridge track segment, two clear parallel steel rails on timber sleepers and a narrow attached structural deck with modest supports. No water, ground or landscape.',
  'track.transition': 'One straight railway class-transition track segment: exactly two constant-gauge steel rails, warm timber sleepers at one end gradually giving way to pale concrete sleepers at the other, restrained ballast. No ground tile.',
  'people.walker': 'One tiny full-body railway worker walking, readable head/body/legs, oat shirt, muted forest-green vest, charcoal trousers and copper-brown bag. Compressed sprite proportions suitable for 6x12 logical pixels, no facial microdetail or ground.',
  'people.path_dirt': flat + 'A quiet worn warm ochre dirt footpath surface, low contrast compact texture, consistent flat edges.',
  'people.road_stone': flat + 'An orderly warm grey cobblestone street surface, broad readable stone clusters and restrained joints, no road paint.',
  'people.crossing_dirt': 'One flat short warm-brown dirt pedestrian crossing panel in 2:1 isometric view, a restrained rectangular packed-earth strip with two narrow parallel clear gaps for running railheads. No rails painted over, no ground outside panel.',
  'people.crossing_stone': 'One flat short limestone pedestrian crossing panel in 2:1 isometric view, broad stone slabs with two narrow parallel clear gaps for running railheads. No rails painted over, no ground outside panel.',
};
const cargo = {
 water:'one simple teal water droplet', wheat:'one tied bundle of three ochre wheat ears', stone:'two connected faceted pale limestone blocks', wood:'one compact bundle of three cut warm-brown logs', coal:'one compact cluster of three charcoal coal lumps', oil:'one squat dark oil can with a short spout and copper cap', iron:'one clean slate-grey iron ingot', passengers:'one travel figure carrying a small ochre suitcase', food:'one recognizable golden bread loaf with two scored cuts', iron_ore:'one rough rust-brown mineral chunk with dark iron inclusions', crude:'one squat dark crude-oil barrel with two restrained copper bands, distinct from an oil can', diesel:'one ochre industrial fuel jerrycan with a handle, distinct from the barrel and oil can', sand:'one small pale oat sand mound', copper_ore:'one rough stone chunk with warm copper mineral inclusions', wire:'one copper wire spool with a clearly visible center hole', power:'one clear ochre lightning bolt silhouette', money:'one simple copper-gold coin with a small plain center embossing and no writing', population:'one small group of three resident head-and-shoulder silhouettes of differing heights'
};
const effects = {
 rain:'A small sparse group of fine diagonal muted blue-grey rain streaks, low contrast and partially transparent. No cloud or surface.',
 fog:'One irregular soft stepped cloud of low-contrast ivory-grey translucent fog, smoothly fading to alpha zero at edges, no opaque center or rectangle.',
 light_tile:'One warm lamp illumination footprint shaped as a 2:1 diamond, very faint warm ivory center fading to transparent edges, no actual lamp or solid ground.',
 glow:'One small warm lamp halo, restrained ivory-ochre translucent center fading to alpha zero, no solid object or opaque background.',
 glow_small:'One tiny dim warm amber lamp halo, simple soft stepped pixel clusters fading to transparent edges, no solid object or opaque background.',
 smoke:'One small drifting smoke puff in soft stepped grey clusters, gently translucent and fading to alpha zero at irregular edges, no chimney or flame.'
};
const queue = [];
for (const entry of Object.values(coverage.categories).flat()) {
  // Existing source images are preserved; this queue tracks the missing base families.
  const previous = previousQueue.assets.find((job) => job.id === entry.id);
  if (entry.generatedBase && !previous) continue;
  const [group, name] = entry.id.split('.');
  let subject = props[name] && group === 'props' ? props[name] : group === 'terrain' ? terrain[name] : other[entry.id];
  let reference = group === 'props' ? '02-nature-objects.png' : group === 'terrain' ? '01-land-biomes.png' : '03-theme-town-growth.png';
  if (group === 'cargo') subject = `One small resource icon: ${cargo[name]}. Strong single readable silhouette suitable for 16x16 pixels, simplified material clusters and selective dark edge. Not a miniature scene.`;
  if (group === 'fx') subject = effects[name] + ' Intentional effect translucency is required; override the solid-surface opacity instruction for this effect. No solid outlined shape.';
  if (group === 'loco') {
    const def = locomotives.find((item) => item.id === name);
    subject = `One ${def.name} locomotive, game body family ${def.body}, ${def.size} size, existing ${def.paint} livery with restrained cream and brass details. Preserve its recognizable silhouette and era: ${def.era} Show a complete rigid locomotive source study including visible running gear${def.tender ? ' and matching attached tender' : ''}. No rails, smoke, ground, scenery, numbering or text. Front faces lower-right; long axis runs upper-left to lower-right. Do not bend the vehicle. This is a base source study, not an animation sheet.`;
    reference = '04-early-ages.png';
  }
  if (group === 'wagon') {
    const def = wagons.find((item) => item.id === name);
    subject = `One ${def.name} railway wagon, ${def.body} body family, ${def.size} size, ${def.paint} materials/livery. Design cue: ${def.era} Complete empty wagon with clear running gear, readable couplers and coherent rigid frame. No locomotive, rails, ground, cargo floating outside, numbering or text. Long axis runs upper-left to lower-right. This is a base source study, not an animation sheet.`;
    reference = '04-early-ages.png';
  }
  if (!subject) throw new Error(`No source description for ${entry.id}`);
  const specialNames = { 'props.tree':'tree-round.png', 'props.birch':'tree-birch.png', 'props.pine':'tree-pine.png' };
  const filename = specialNames[entry.id] ?? entry.id.replaceAll('.', '-').replaceAll('_', '-') + '.png';
  let status = 'pending';
  try { await access(join(dir, previous?.filename ?? filename)); status = 'generatedSource'; } catch {}
  queue.push(previous ? { ...previous, status } : { id:entry.id, filename, reference:`docs/art-direction/images/${reference}`, status, prompt: common + subject });
}
await writeFile(join(dir, 'generation-queue.json'), JSON.stringify({ schema:'base-generation-queue-v1', scope:'Source image library first; runtime integration and frame variants remain separate.', guideCommit:'d01ac5ed7dfa63430fddad5a81586a73dc4625ae', assets:queue }, null, 2) + '\n');
console.log(`Planned ${queue.length} missing base assets`);

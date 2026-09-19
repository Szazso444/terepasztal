import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

const dir = 'assets/source/base-v1';
const readJson = async (path) => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { vehicleSpec, COUPLER_GAP } = await server.ssrLoadModule('/src/sim/body.ts');
  const { vehicleAccess, measure } = await server.ssrLoadModule('/src/sim/compat.ts');
  const { TRACK_CLASSES, classRadius } = await server.ssrLoadModule('/src/world/track.ts');
  const queue = await readJson(`${dir}/generation-queue.json`);
  const roster = [];
  for (const [kind, table] of [['loco', 'locomotives'], ['wagon', 'wagons']]) {
    for (const def of await readJson(`src/data/${table}.json`)) {
      const id = `${kind}.${def.id}`;
      const spec = vehicleSpec(def);
      const layout = spec.drawBogies
        ? spec.segments.map((s) => `${s.part}: ${s.L.toFixed(2)} tile length, ${s.nb} ${s.bogie === 'engine_unit' ? 'pivoting engine units (3 axles each in the current game sprite)' : `bogies of ${s.bogie === 'bogie3' ? 3 : 2} axles each`}, pivot span ${s.W.toFixed(2)} tiles`).join('; ')
        : 'One rigid chassis with 2 fixed axles (4 wheels), baked into the body artwork; no separately swivelling bogie sprites. The solver uses 2 virtual rail supports, not 2 physical bogies.';
      const behavior = spec.plan === 'tender'
        ? 'The engine and tender are separate fixed-length rigid segments and change heading independently on curves; never bend the boiler or fuse the tender to the engine.'
        : spec.plan === 'garratt'
          ? 'Three rigid segments articulate: front engine unit, central cradle, reversed rear engine unit. Keep the joints visible; each segment keeps its own length.'
          : spec.plan === 'meyer'
            ? 'One rigid full-length frame above two independently pivoting powered engine units. The boiler/frame must never bend or acquire a centre hinge.'
            : 'One rigid body remains straight and fixed-length on curves; it spans the rail-support chord and can overhang the track. Never bend or stretch it.';
      const classes = Object.fromEntries(TRACK_CLASSES.map((cls) => [cls, { radiusTiles: classRadius(cls), permitted: vehicleAccess(def, cls) === null, reason: vehicleAccess(def, cls), geometry: measure(spec, cls) }]));
      const record = { id, name: def.name, kind, type: def.type ?? 'unpowered wagon', rarity: def.rarity, tier: def.tier ?? null, body: def.body, paint: def.paint, carries: def.carries ?? null, size: spec.size, lengthTiles: spec.L, plan: spec.plan, drawBogies: spec.drawBogies, segments: spec.segments, layout, behavior, trackClasses: classes, maxLateralPlay: spec.maxLateralPlay, specification: 'Current game mechanics, not a historical wheel-arrangement claim', mechanicalRevision: 1 };
      roster.push(record);
      const job = queue.assets.find((entry) => entry.id === id);
      if (!job) throw new Error(`Missing generation job: ${id}`);
      job.originalArtPrompt ??= job.prompt;
      // The user approved the source art and requested documentation, not regeneration.
      job.prompt = job.originalArtPrompt;
      delete job.mechanicalRevision;
      delete job.mechanicalReview;
      job.integrationSpecification = `railcraft-specifications.json#${id}`;
    }
  }
  const rules = [
    'These specifications are derived from the checked-in roster and executable vehicleSpec/vehicleAccess functions. They describe the game, not certified historical engineering. Content-editor overrides can change the live game and require regenerating this document.',
    'Small/medium/large body lengths are 1/2/3 tiles. Keep a common gauge and comparable widths when comparing images; equal thumbnail boxes are not equal vehicle sizes.',
    'Each bogie follows its own exact arc position and local tangent. Body sockets may slide relative to bogies. Rigid bodies and segments never stretch, bend, or gain an invented hinge. Sideways track-centering and overhang are intentional.',
    'Fixed axles on small stock are baked into the body. Their two solver supports are virtual; do not turn them into two visible bogie trucks. Medium and large stock have separate runtime bogie sprites beneath raised sills. Two axles means four wheels; three axles means six wheels.',
    'Tender: engine 1.25 tiles plus tender 0.75 tiles. Garratt: 0.8 + 1.4 + 0.8 tile rigid segments. Meyer: one 3-tile rigid frame above two pivoting engine units. These are game abstractions, including the Crocodile and Big Boy body plans.',
    'DDA40X and GG1 explicitly use three 3-axle bogies in this game. F7, Taurus and Re460 use two 2-axle bogies. M62, SD40, Deltic and V63 use two 3-axle bogies. Do not silently substitute prototype arrangements.',
    `Separate coupled vehicles use a ${COUPLER_GAP}-tile gap. Reversal preserves the physical trail and reverses its arc indexing; body facing remains coherent. Track switches and curves do not change a vehicle\'s length.`,
    'Track permission is determined by geometry and size, not rarity or cosmetic wheel count. Large vehicles cannot use regular track. A consist uses the intersection of its vehicles\' permissions; high-speed access additionally needs in-cab equipment, and bridge capacity, traction/power and route reservations still apply.',
    'Base PNGs are assembled source studies, not ready-to-use runtime sprites. Runtime delivery must provide independently posed body/engine/tender/cradle/frame and bogie layers, anchors, facings, and variants. A single PNG cannot demonstrate correct curve motion.',
    'Before integration, review every image for exact visible wheel groups, segment count, gauge, proportions, joints and underbody clearance. On straight, entering, mid-curve, leaving and reverse travel, verify rigid lengths, bogie rail positions/tangents, coupler continuity, permitted classes and intentional overhang. Automated alpha checks do not certify visual mechanical correctness.',
  ];
  await writeFile(`${dir}/railcraft-specifications.json`, `${JSON.stringify({ schema: 'railcraft-source-specifications-v1', sources: ['src/data/locomotives.json', 'src/data/wagons.json', 'src/sim/body.ts', 'src/sim/compat.ts', 'src/art/rolling.ts', 'docs/bogie-model.md'], rules, vehicles: roster }, null, 2)}\n`);
  const rows = roster.map((r) => `| ${r.id} | ${r.type}; ${r.body}; ${r.rarity}${r.tier === null ? '' : ` / tier ${r.tier}`} | ${r.size}, ${r.lengthTiles} tiles; ${r.plan} | ${r.layout} | ${Object.entries(r.trackClasses).map(([c,v]) => `${c}: ${v.permitted ? 'allowed' : 'blocked'}`).join('; ')} |`);
  await writeFile(`${dir}/RAILCRAFT.md`, `# Railcraft artwork and track behavior\n\nThe user approved the existing source artwork and requested integration documentation only. Keep those images unchanged. This document records what the runtime conversion must support for every locomotive and wagon, including images generated before this document. It does not certify that a complete PNG already has independently movable parts.\n\n${rules.map((r,i) => `${i+1}. ${r}`).join('\n\n')}\n\n## Per-vehicle requirements\n\n| Vehicle | Class and build | Size and plan | Running gear | Vehicle track access |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\nExact segment lengths, pivot spans, compatibility measurements and blocking reasons are in [railcraft-specifications.json](railcraft-specifications.json). Generation prompts are in [generation-queue.json](generation-queue.json); completed prompt history is in [generation-prompts.json](generation-prompts.json). Existing images remain unchanged. Any necessary separation of bodies and bogies, wheel-count adaptation, scale normalization and mechanical verification belongs to future runtime integration.\n`);
  await writeFile(`${dir}/generation-queue.json`, `${JSON.stringify(queue, null, 2)}\n`);
  console.log(`Prepared ${roster.length} railcraft specifications and prompts, including existing images.`);
} finally { await server.close(); }

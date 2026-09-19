import { readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const inputDir = resolve(process.argv[2] ?? 'assets/source/base-v1');
const coveragePath = join(inputDir, 'coverage.json');
const coverage = JSON.parse(await readFile(coveragePath, 'utf8'));

const aliases = {
  'terrain-grass.png': 'terrain.grass',
  'bridge-stone.png': 'works.bridge_stone',
  'bridge-wood.png': 'works.bridge_wood',
  'coaling-stage.png': 'decor.fuel_stop',
  'depot.png': 'stations.depot',
  'farm.png': 'stations.farm',
  'grinder.png': 'works.grinder',
  'house-cottage.png': 'decor.townhouse',
  'hydro-plant.png': 'works.hydro_plant',
  'kiln.png': 'works.kiln',
  'lumber.png': 'stations.lumber',
  'power-plant.png': 'works.power_plant',
  'pump.png': 'stations.pump',
  'quarry.png': 'stations.quarry',
  'refinery.png': 'works.refinery',
  'signal.png': 'decor.signal',
  'station.png': 'stations.station',
  'substation.png': 'works.substation',
  'townhouse-civic.png': 'stations.town',
  'tree-oak.png': 'props.oak',
  'tree-spruce.png': 'props.spruce',
  'warehouse.png': 'stations.warehouse',
  'water-tower.png': 'decor.water_tower',
  'windmill.png': 'works.windmill',
};

const files = (await readdir(inputDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.png')
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b));
const entries = Object.values(coverage.categories).flat();
try {
  const queue = JSON.parse(await readFile(join(inputDir, 'generation-queue.json'), 'utf8'));
  for (const job of queue.assets) aliases[job.filename] = job.id;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const byId = new Map(entries.map((entry) => [entry.id, entry]));

for (const entry of entries) {
  delete entry.generated;
  entry.generatedBase = false;
  entry.variantsPending = true;
  entry.integration = false;
  entry.status = 'pending';
}
const unmapped = [];
for (const file of files) {
  const id = aliases[file];
  if (!id) {
    unmapped.push(file);
    continue;
  }
  const entry = byId.get(id);
  if (!entry) {
    unmapped.push(file);
    continue;
  }
  entry.generated = [...(entry.generated ?? []), file];
  entry.generatedBase = true;
  entry.status = 'generatedBase';
}

coverage.generatedFiles = files;
coverage.integratedFiles = [];
coverage.unmappedGeneratedFiles = unmapped;
coverage.summary = {
  categories: Object.keys(coverage.categories).length,
  requiredEntries: entries.length,
  generatedSourceFiles: files.length,
  integratedSourceFiles: 0,
  statusCounts: {
    generatedBase: entries.filter((entry) => entry.status === 'generatedBase').length,
    pending: entries.filter((entry) => entry.status === 'pending').length,
  },
  notes: 'Generated files cover a base family image only; required level, rotation, palette, and frame variants remain pending. Runtime atlas integration remains false for every entry.',
};
// Match the actual generator rather than the early hand-written variant notes.
for (const entry of coverage.categories.terrain) {
  if (['grass', 'forest', 'rock', 'hillcut', 'sand', 'plains', 'taiga', 'swamp', 'desert'].some((name) => entry.id === `terrain.${name}`)) entry.variants = 'v0-v3';
  if (entry.id === 'terrain.water') entry.variants = 'v0-v2; f0-f3 animation';
}
await writeFile(coveragePath, `${JSON.stringify(coverage, null, 2)}\n`);
console.log(JSON.stringify({ inputDir, generatedFiles: files.length, mapped: files.length - unmapped.length, unmapped, summary: coverage.summary }, null, 2));

import { access, copyFile, mkdir, readFile, rename, writeFile, constants } from 'node:fs/promises';
import { basename, join } from 'node:path';

// Run after generation/import batches finish, with visually reviewed correction names.
const names = process.argv.slice(2);
if (!names.length) throw new Error('Provide reviewed correction filenames, e.g. terrain-hillcut-v2.png');
const dir = 'assets/source/base-v1';
const readJson = async (name) => JSON.parse((await readFile(join(dir, name), 'utf8')).replace(/^\uFEFF/, ''));
const queue = await readJson('generation-queue.json');
const prompts = await readJson('generation-prompts.json');
const review = await readJson('design-review.json');
await mkdir(join(dir, 'drafts'), { recursive: true });
for (const name of names) {
  if (basename(name) !== name || !name.endsWith('.png')) throw new Error(`Invalid correction filename: ${name}`);
  const record = await readJson(`corrections/${name.replace(/\.png$/, '.prompt.json')}`);
  const job = queue.assets.find((entry) => entry.id === record.id);
  if (!job) throw new Error(`Unknown correction ID: ${record.id}`);
  const previous = job.filename;
  const draft = join(dir, 'drafts', previous);
  try { await access(draft); throw new Error(`Draft already exists: ${draft}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await access(join(dir, previous));
  await copyFile(join(dir, 'corrections', name), join(dir, name), constants.COPYFILE_EXCL);
  await rename(join(dir, previous), draft);
  job.filename = name;
  job.prompt = record.prompt;
  job.status = 'generatedSource';
  prompts.assets.push({ ...record, filename: name, status: 'visually-reviewed', supersedes: previous });
  for (const issue of review.issues.filter((entry) => entry.id === job.id)) {
    issue.status = 'resolved';
    issue.correction = name;
  }
  // Checkpoint each promotion so an interrupted run can resume without losing metadata.
  await writeFile(join(dir, 'generation-queue.json'), `${JSON.stringify(queue, null, 2)}\n`);
  await writeFile(join(dir, 'generation-prompts.json'), `${JSON.stringify(prompts, null, 2)}\n`);
  await writeFile(join(dir, 'design-review.json'), `${JSON.stringify(review, null, 2)}\n`);
  console.log(`Promoted ${name}; preserved original in drafts/${previous}`);
}

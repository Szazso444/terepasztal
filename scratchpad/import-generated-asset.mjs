import { copyFile, readFile, writeFile, access, constants } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const [id, source] = process.argv.slice(2);
if (!id || !source) throw new Error('Usage: node scratchpad/import-generated-asset.mjs <coverage-id> <generated-png>');
const directory = resolve('assets/source/base-v1');
const queue = JSON.parse(await readFile(join(directory, 'generation-queue.json'), 'utf8'));
const job = queue.assets.find((entry) => entry.id === id);
if (!job) throw new Error(`Unknown asset ${id}`);
const destination = join(directory, job.filename);
await copyFile(resolve(source), destination, constants.COPYFILE_EXCL);
const promptPath = join(directory, 'generation-prompts.json');
const prompts = JSON.parse((await readFile(promptPath, 'utf8')).replace(/^\uFEFF/, ''));
prompts.assets.push({ id, filename: job.filename, path: resolve(source), method: 'built-in image generation', reference: job.reference, prompt: job.prompt });
await writeFile(promptPath, `${JSON.stringify(prompts, null, 2)}\n`);
for (const entry of queue.assets) {
  try { await access(join(directory, entry.filename)); entry.status = 'generatedSource'; }
  catch { entry.status = 'pending'; }
}
await writeFile(join(directory, 'generation-queue.json'), `${JSON.stringify(queue, null, 2)}\n`);
console.log(`Saved ${job.filename}`);

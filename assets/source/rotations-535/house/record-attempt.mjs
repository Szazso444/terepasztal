import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { measure } from './measure-house.mjs';
const [attempt, promptFile] = process.argv.slice(2);
const root = new URL('./', import.meta.url);
const file = new URL('prompts.json', root);
const data = JSON.parse(fs.readFileSync(file));
const raw = `raw/townhouse-r1-attempt-${attempt}.png`;
const measured = measure(fileURLToPath(new URL(raw, root)), 1);
data.attempts.push({
  view: 'r1',
  attempt: Number(attempt),
  file: raw,
  prompt: fs.readFileSync(promptFile, 'utf8'),
  references: [
    '../guides-535/townhouse-r1.png',
    'docs/art-direction/images/03-theme-town-growth.png',
    'assets/source/base-v1/house-cottage.png',
  ],
  returned: measured.size,
  measured,
  kept: false,
});
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');

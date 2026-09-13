import { launch, openGame } from './runtime.mjs';
import { writeFile } from 'node:fs/promises';
const browser = await launch();
try {
  const page = await openGame(browser, 'rigid-after');
  page.on('console', (m) => {
    if (m.text().startsWith('Bogie sweep:')) console.log(m.text());
  });
  const report = await page.evaluate(async () =>
    (await import('/scratchpad/bogie-motion.js')).checkBogies(),
  );
  await writeFile('scratchpad/bogie-motion-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ samples: report.samples, models: report.rows.length }));
} finally {
  await browser.close();
}

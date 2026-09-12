import { launch, openGame } from './runtime.mjs';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const label = process.argv[2] ?? 'after';
const browser = await launch();
const page = await openGame(browser, label);
page.on('console', (m) => {
  if (m.text().startsWith('GPU checked')) console.log(m.text());
});
try {
  if (process.argv[3] !== 'controls') {
    const result = await page.evaluate(async (label) => {
      const m = await import('/scratchpad/gpu-masks.js');
      return label === 'before'
        ? m.gpuMasks(['dda40x', 'gg1', 'big_boy', 'crocodile', 'gmam', 'sd40'], 0.05)
        : m.gpuMasks();
    }, label);
    await writeFile(`scratchpad/mask-${label}.json`, JSON.stringify(result, null, 2));
    assert.ok(result.nonempty > 0, 'The bogie extraction must contain visible pixels');
    if (label === 'before') assert.ok(result.outside > 0, 'Baseline must reproduce the defect');
    else assert.equal(result.outside, 0, 'Bogie alpha must be contained by body alpha');
    console.log({ samples: result.samples, outside: result.outside, nonempty: result.nonempty });
  }
  if (label === 'after') {
    const negative = await page.evaluate(async () => {
      const m = await import('/scratchpad/gpu-masks.js');
      return m.gpuMasks(['sd40', 'gmam', 'big_boy'], 0.2, true);
    });
    console.log({ negative });
    assert.ok(negative.outside > 0, 'Removing production masks must fail the check');
    const zooms = [];
    for (const resolution of [0.5, 2, 4]) {
      const result = await page.evaluate(async (resolution) => {
        const m = await import('/scratchpad/gpu-masks.js');
        return m.gpuMasks(['dda40x', 'sd40', 'gmam'], 0.2, false, resolution);
      }, resolution);
      zooms.push(result);
      assert.equal(result.outside, 0, `Containment at ${resolution}x`);
    }
    await writeFile('scratchpad/mask-controls.json', JSON.stringify({ negative, zooms }, null, 2));
  }
} finally {
  await browser.close();
}

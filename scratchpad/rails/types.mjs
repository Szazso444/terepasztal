// The track toolbar as the player sees it in a new game: each type open in turn, and the keys.
//   BASE_URL=http://127.0.0.1:5176 node scratchpad/rails/types.mjs
import { launch, openGame } from '../runtime.mjs';
import { writeFileSync } from 'node:fs';
const out = 'scratchpad/rails/out';
const browser = await launch();
try {
  const page = await openGame(browser, 'after');
  const tool = () =>
    page.evaluate(() => {
      const b = window.game.build;
      const t = b.tool;
      return t.kind === 'track'
        ? `${t.item.kind}/${t.item.cls}${t.item.cls2 ? '+' + t.item.cls2 : ''} r${b.rot}`
        : t.kind === 'building'
          ? `building/${t.defId}`
          : t.kind === 'reclass'
            ? `reclass/${t.target}`
            : t.kind;
    });
  const types = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.tb-type')].map(
        (b) => `${b.textContent}${b.classList.contains('active') ? '*' : ''}`,
      ),
    );
  const items = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.tb-item')].map(
        (b) =>
          `${b.querySelector('.tb-key').textContent}:${b.querySelector('.tb-name').textContent}`,
      ),
    );
  const clip = { x: 0, y: 700, width: 990, height: 300 };
  const log = [];
  const step = async (what, keys = []) => {
    for (const k of keys) {
      await page.keyboard.press(k);
      await page.waitForTimeout(120);
    }
    log.push({ what, tool: await tool(), types: await types(), items: await items() });
  };
  await page
    .locator('button', { hasText: /^track$/i })
    .first()
    .click();
  await page.mouse.move(700, 400);
  await page.waitForTimeout(500);
  await step('track opened');
  await page.screenshot({ path: `${out}/types-0-narrow.png`, clip });
  await step('2: curve; R twice', ['2', 'r', 'r']);
  await step('E: the wide curve, same turn', ['e']);
  await page.screenshot({ path: `${out}/types-1-wide.png`, clip });
  await step('E: the high-speed curve, same turn', ['e']);
  await page.screenshot({ path: `${out}/types-2-high-speed.png`, clip });
  await step('5: crossing with wide', ['5']);
  await step('E: bridges have no fifth piece: the first', ['e']);
  await page.screenshot({ path: `${out}/types-3-bridges.png`, clip });
  await step('E: round to narrow', ['e']);
  await step('Q: back to bridges', ['q']);
  await step('Q Q: wide', ['q', 'q']);
  await step('3: switch', ['3']);
  await step('Tab x3: on through the pieces into the next type', ['Tab', 'Tab', 'Tab']);
  writeFileSync(`${out}/types-report.json`, JSON.stringify(log, null, 1));
  for (const l of log)
    console.log(`${l.what.padEnd(48)} ${l.tool.padEnd(34)} ${l.types.join(' ')}`);
  for (const i of [0, 2, 3]) console.log(log[i].items.join(' | '));
} finally {
  await browser.close();
}

import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
const candidates = [
  process.env.PLAYWRIGHT_MODULE,
  'playwright',
  '/opt/node22/lib/node_modules/playwright/index.mjs',
  new URL('../../terepasztal-scratch/node_modules/playwright/index.mjs', import.meta.url).href,
].filter(Boolean);
let playwright;
for (const candidate of candidates) {
  try {
    playwright = await import(
      candidate.startsWith('/') || /^[A-Z]:/i.test(candidate)
        ? pathToFileURL(candidate).href
        : candidate
    );
    break;
  } catch {
    /* Try the next installed test runtime. */
  }
}
if (!playwright) throw new Error('Set PLAYWRIGHT_MODULE to an installed Playwright module.');
export async function launch() {
  const chrome =
    process.env.BROWSER_EXECUTABLE ??
    (process.platform === 'win32'
      ? `${process.env.ProgramFiles}/Google/Chrome/Application/chrome.exe`
      : undefined);
  return playwright.chromium.launch({
    executablePath: chrome && existsSync(chrome) ? chrome : undefined,
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
}
export function baseURL(label) {
  return process.env.BASE_URL ?? `http://127.0.0.1:${label === 'before' ? 5174 : 5173}`;
}
export async function openGame(browser, label, height = 1000) {
  const page = await browser.newPage({ viewport: { width: 1440, height } });
  page.on('pageerror', (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  await page.goto(`${baseURL(label)}/#seed=4242&new`);
  await page.waitForFunction(() => window.game?.fleet);
  await page.waitForTimeout(7000);
  return page;
}

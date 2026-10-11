// Like ../runtime.mjs, but on the machine's real GPU (ANGLE D3D11) instead of SwiftShader, with WebGPU allowed.
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', new URL('../../../terepasztal-scratch/node_modules/playwright/index.mjs', import.meta.url).href].filter(Boolean);
let playwright;
for (const c of candidates) {
  try { playwright = await import(c.startsWith('/') || /^[A-Z]:/i.test(c) ? pathToFileURL(c).href : c); break; } catch { /* next */ }
}
if (!playwright) throw new Error('no playwright');
export async function launchGpu(extra = []) {
  const chrome = `${process.env.ProgramFiles}/Google/Chrome/Application/chrome.exe`;
  return playwright.chromium.launch({
    executablePath: existsSync(chrome) ? chrome : undefined,
    headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--disable-gpu-vsync', '--disable-frame-rate-limit', ...extra],
  });
}

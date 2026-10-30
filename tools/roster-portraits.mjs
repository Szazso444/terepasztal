#!/usr/bin/env node
/**
 * Builds the Roster's vehicle portraits, `public/assets/portraits/<vehicle id>.png`, from the
 * model images: the 1536x1024 isometric pictures that the locomotive table
 * (`locomotive-wheels-bogies-v9.xlsx`, column "Picture (model image)") shows, and the pictures
 * Codex painted in the same camera and style for all the wagons and the engines the table lacks
 * (`specs/codex-roster-portraits.txt`).
 *
 *   node tools/roster-portraits.mjs --from <project folder>   writes public/assets/portraits/
 *
 * The sources live outside the repository (about 130 MB), in the author's project folder;
 * SOURCES below names each vehicle's file under it. Vehicles with no model image yet are left
 * out: the Roster falls back to the atlas sprite for them (src/ui/rosterPortraits.ts lists the
 * shipped ids). Uses pngjs and the quantiser of tools/loading-pictures.mjs; no new dependency.
 *
 * Transparent sources (the narrow-gauge and Codex pictures) are laid over black first.
 *
 * Each picture, in this order (the numbers are constants below):
 *   1. The vehicle's bounds: on a transparent background the opaque pixels, otherwise the pixels
 *      brighter than BODY_LUMA (the dark background and most of its glow are darker).
 *   2. A 3:2 window around them, MARGIN of the larger side on every edge, taken from the source
 *      itself so the glow fades out naturally. A window larger than the canvas shrinks to it, and
 *      one that runs off an edge slides back inside.
 *   3. Box-filtered down to SIZE, quantised to 256 colours, written as an 8-bit indexed PNG.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPng, quantise, encodeIndexed } from './loading-pictures.mjs';
import { isMain } from './is-main.mjs';

export const OUTPUT_DIR = 'public/assets/portraits';
export const SIZE = { width: 240, height: 160 };
export const BODY_LUMA = 70;
export const MARGIN = 0.04;

/** Vehicle id -> model image under the project folder. */
export const SOURCES = {
  // locomotives: the "Picture (model image)" column of the table, front view where there are two
  rocket: "Images/organized/locomotives/0,5/Stephenson's rocket/loco-rocket--d33ad296.png",
  bm50: 'Images/organized/locomotives/0,5/BM-50/loco-bm50.png', // the front view, transparent; -front.png is keyed magenta
  muki: 'Images/organized/locomotives/0,5/Muki (P2)/loco-muki.png',
  c50: 'Images/organized/locomotives/1/Narrow/C-50/loco-c50.png',
  mav490: 'Images/organized/locomotives/1/Narrow/MÁV 490/loco-mav490.png',
  mk48: 'Images/organized/locomotives/1/Narrow/MK48/loco-mk48.png',
  adler: 'Images/organized/locomotives/1/Regular/loco-adler--d56583f9.png',
  john_bull: 'Images/organized/locomotives/1/Regular/loco-john-bull--e3f00229.png',
  mav375: 'Images/organized/locomotives/1/Regular/loco-mav375--d3ead191.png',
  j94: 'Images/organized/locomotives/1/Regular/loco-j94--90002845.png',
  class08: 'Images/organized/locomotives/1/Regular/loco-class08--00ceee17.png',
  general: 'Images/organized/locomotives/2/loco-general--0fa5acae.png',
  jupiter: 'Images/organized/locomotives/2/loco-jupiter--20205b97.png',
  kando_v40: 'Images/organized/locomotives/2/loco-kando-v40--48f28f8e.png',
  sw1: 'Images/organized/locomotives/2/loco-sw1--40207aeb.png',
  black_five: 'Images/organized/locomotives/3/loco-black-five--1f98926d.png',
  crocodile: 'Images/organized/locomotives/3/loco-crocodile--e82cdd82.png',
  deltic: 'Images/organized/locomotives/3/loco-deltic--92f91c65.png',
  drg01: 'Images/organized/locomotives/3/loco-drg01--4313f6d2.png',
  f7: 'Images/organized/locomotives/3/loco-f7--72b0a730.png',
  flying_scotsman: 'Images/organized/locomotives/3/loco-flying-scotsman--1f1a3230.png',
  ice1: 'Images/organized/locomotives/3/loco-ice1--ee9c2584.png',
  k4s: 'Images/organized/locomotives/3/loco-k4s--ba2d9f48.png',
  m62: 'Images/organized/locomotives/3/loco-m62--c14ba4cc.png',
  mallard: 'Images/organized/locomotives/3/loco-mallard--927360fc.png',
  re460: 'Images/organized/locomotives/3/loco-re460--4e975304.png',
  taurus: 'Images/organized/locomotives/3/loco-taurus--5620dea3.png',
  tgv: 'Images/organized/locomotives/3/loco-tgv--5499a9f1.png',
  v63: 'Images/organized/locomotives/3/loco-v63--1cb60403.png',
  daylight: 'Images/organized/locomotives/4/loco-daylight--cfc231ed.png',
  dda40x: 'Images/organized/locomotives/4/loco-dda40x--5db242da.png',
  gg1: 'Images/organized/locomotives/4/loco-gg1--aee16678.png',
  mav424: 'Images/organized/locomotives/4/loco-mav424--9e670d54.png',
  nine_f: 'Images/organized/locomotives/4/loco-nine-f--8ae80382.png',
  sd40: 'Images/organized/locomotives/4/loco-sd40--6cbe0e61.png',
  big_boy: 'Images/organized/locomotives/5/loco-big-boy--7946d185.png',
  // Codex's pictures: the two engines the table lacks, and every wagon
  orenstein_koppel: 'renders/roster-portraits/orenstein_koppel.png',
  gmam: 'renders/roster-portraits/gmam.png',
  water_cart: 'renders/roster-portraits/water_cart.png',
  wood_hopper: 'renders/roster-portraits/wood_hopper.png',
  flatbed: 'renders/roster-portraits/flatbed.png',
  riveted_tank: 'renders/roster-portraits/riveted_tank.png',
  steel_hopper: 'renders/roster-portraits/steel_hopper.png',
  bolster_flat: 'renders/roster-portraits/bolster_flat.png',
  welded_tank: 'renders/roster-portraits/welded_tank.png',
  bathtub: 'renders/roster-portraits/bathtub.png',
  bulkhead_flat: 'renders/roster-portraits/bulkhead_flat.png',
  pressure_tank: 'renders/roster-portraits/pressure_tank.png',
  dump_hopper: 'renders/roster-portraits/dump_hopper.png',
  heavy_flat: 'renders/roster-portraits/heavy_flat.png',
  wooden_coach: 'renders/roster-portraits/wooden_coach.png',
  steel_coach: 'renders/roster-portraits/steel_coach.png',
  pullman: 'renders/roster-portraits/pullman.png',
  brake_van: 'renders/roster-portraits/brake_van.png',
  boxcar: 'renders/roster-portraits/boxcar.png',
  coal_cart: 'renders/roster-portraits/coal_cart.png',
  fuel_cart: 'renders/roster-portraits/fuel_cart.png',
  battery_cart: 'renders/roster-portraits/battery_cart.png',
  mine_tub: 'renders/roster-portraits/mine_tub.png',
  narrow_tank: 'renders/roster-portraits/narrow_tank.png',
  narrow_box: 'renders/roster-portraits/narrow_box.png',
  narrow_coach: 'renders/roster-portraits/narrow_coach.png',
};

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Bounds { x0, y0, x1, y1 } (x1, y1 exclusive) of the pixels brighter than BODY_LUMA. */
export function bodyBounds(rgb, width, height) {
  let x0 = width;
  let y0 = height;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      if (luma(rgb[i], rgb[i + 1], rgb[i + 2]) <= BODY_LUMA) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x + 1 > x1) x1 = x + 1;
      if (y + 1 > y1) y1 = y + 1;
    }
  if (x1 <= x0) return { x0: 0, y0: 0, x1: width, y1: height };
  return { x0, y0, x1, y1 };
}

/** Bounds of the opaque pixels of a decoded PNG, or null when its background is not transparent. */
export function opaqueBounds(png) {
  if (png.data[3] >= 128) return null;
  let x0 = png.width;
  let y0 = png.height;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      if (png.data[(y * png.width + x) * 4 + 3] < 128) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x + 1 > x1) x1 = x + 1;
      if (y + 1 > y1) y1 = y + 1;
    }
  return x1 > x0 ? { x0, y0, x1, y1 } : null;
}

/**
 * The SIZE-shaped window { x, y, w, h } around `bounds`, with MARGIN on every side, kept inside
 * a `width` x `height` canvas.
 */
export function portraitWindow(bounds, width, height) {
  const bw = bounds.x1 - bounds.x0;
  const bh = bounds.y1 - bounds.y0;
  const pad = MARGIN * Math.max(bw, bh);
  const aspect = SIZE.width / SIZE.height;
  let w = bw + 2 * pad;
  let h = bh + 2 * pad;
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  const fit = Math.min(1, width / w, height / h);
  w *= fit;
  h *= fit;
  const clamp = (v, max) => Math.min(Math.max(v, 0), max);
  const x = clamp((bounds.x0 + bounds.x1) / 2 - w / 2, width - w);
  const y = clamp((bounds.y0 + bounds.y1) / 2 - h / 2, height - h);
  return { x, y, w, h };
}

/** Box-filter the window (inside the canvas) of `rgb` down to SIZE. */
export function resample(rgb, width, height, win) {
  const out = new Uint8Array(SIZE.width * SIZE.height * 3);
  const sx = win.w / SIZE.width;
  const sy = win.h / SIZE.height;
  for (let oy = 0; oy < SIZE.height; oy++) {
    const ya = Math.floor(win.y + oy * sy);
    const yb = Math.max(ya + 1, Math.floor(win.y + (oy + 1) * sy));
    for (let ox = 0; ox < SIZE.width; ox++) {
      const xa = Math.floor(win.x + ox * sx);
      const xb = Math.max(xa + 1, Math.floor(win.x + (ox + 1) * sx));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = ya; y < Math.min(yb, height); y++)
        for (let x = xa; x < Math.min(xb, width); x++) {
          const i = (y * width + x) * 3;
          r += rgb[i];
          g += rgb[i + 1];
          b += rgb[i + 2];
          n++;
        }
      const o = (oy * SIZE.width + ox) * 3;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
    }
  }
  return out;
}

/** The RGB bytes of a decoded PNG laid over black. */
export function overBlack(png) {
  const out = new Uint8Array(png.width * png.height * 3);
  for (let i = 0, j = 0; i < png.data.length; i += 4, j += 3) {
    const a = png.data[i + 3] / 255;
    out[j] = Math.round(png.data[i] * a);
    out[j + 1] = Math.round(png.data[i + 1] * a);
    out[j + 2] = Math.round(png.data[i + 2] * a);
  }
  return out;
}

/** One portrait from a decoded source PNG: { rgb, png } at SIZE. */
export function buildPortrait(source) {
  const rgb = overBlack(source);
  const { width, height } = source;
  const bounds = opaqueBounds(source) ?? bodyBounds(rgb, width, height);
  const win = portraitWindow(bounds, width, height);
  const small = resample(rgb, width, height, win);
  const { palette, indices } = quantise(small);
  return { rgb: small, png: encodeIndexed(SIZE.width, SIZE.height, palette, indices) };
}

function main(argv) {
  const at = argv.indexOf('--from');
  const from = at >= 0 ? argv[at + 1] : undefined;
  if (!from) {
    console.error('usage: node tools/roster-portraits.mjs --from <project folder>');
    return 1;
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const [id, file] of Object.entries(SOURCES)) {
    const { png } = buildPortrait(readPng(join(from, file)));
    writeFileSync(join(OUTPUT_DIR, `${id}.png`), png);
    console.log(`${id}: ${Math.round(png.length / 1024)} KB`);
  }
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));

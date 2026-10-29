import { el } from './dom';

/**
 * Vehicles with a shipped portrait, `public/assets/portraits/<id>.png`, built by
 * tools/roster-portraits.mjs from the model images. The rest show their atlas sprite.
 */
export const PORTRAIT_IDS: ReadonlySet<string> = new Set([
  'rocket',
  'bm50',
  'muki',
  'c50',
  'mav490',
  'mk48',
  'adler',
  'john_bull',
  'mav375',
  'j94',
  'class08',
  'general',
  'jupiter',
  'kando_v40',
  'sw1',
  'black_five',
  'crocodile',
  'deltic',
  'drg01',
  'f7',
  'flying_scotsman',
  'ice1',
  'k4s',
  'm62',
  'mallard',
  're460',
  'taurus',
  'tgv',
  'v63',
  'daylight',
  'dda40x',
  'gg1',
  'mav424',
  'nine_f',
  'sd40',
  'big_boy',
  'water_cart',
  'wood_hopper',
  'flatbed',
  'riveted_tank',
  'steel_hopper',
  'bolster_flat',
  'welded_tank',
  'bathtub',
  'bulkhead_flat',
  'pressure_tank',
  'dump_hopper',
  'heavy_flat',
  'wooden_coach',
  'steel_coach',
  'pullman',
  'brake_van',
  'boxcar',
  'coal_cart',
  'fuel_cart',
  'battery_cart',
]);

/** URL of a vehicle's portrait, or null when it has none yet. */
export function portraitUrl(defId: string, base: string = import.meta.env.BASE_URL): string | null {
  return PORTRAIT_IDS.has(defId) ? `${base}assets/portraits/${defId}.png` : null;
}

/** <img> of a vehicle's portrait, or null when it has none yet. */
export function portraitImg(defId: string, cls: string): HTMLElement | null {
  const src = portraitUrl(defId);
  if (!src) return null;
  const img = el('img', { class: cls, src, alt: '' });
  img.draggable = false;
  return img;
}

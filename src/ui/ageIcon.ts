/**
 * The icon of each age, and the helper that puts it beside an age's name wherever the game prints
 * one. Tabler outline icons (MIT, Paweł Kuna), drawn in `currentColor`.
 */
import { STR } from '../strings';
import { el } from './dom';

/** The inside of each age's icon, on a 24 px grid. */
export const AGE_ICON: Record<string, string> = {
  steam:
    'M12 12c2 -2.96 0 -7 -1 -8c0 3.038 -1.773 4.741 -3 6c-1.226 1.26 -2 3.24 -2 5a6 6 0 1 0 12 0c0 -1.532 -1.056 -3.94 -2 -5c-1.786 3 -2.791 3 -4 2z',
  diesel:
    'M7.502 19.423c2.602 2.105 6.395 2.105 8.996 0c2.602 -2.105 3.262 -5.708 1.566 -8.546l-4.89 -7.26c-.42 -.625 -1.287 -.803 -1.936 -.397a1.376 1.376 0 0 0 -.41 .397l-4.893 7.26c-1.695 2.838 -1.035 6.441 1.567 8.546z',
  electric: 'M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11',
  nuclear:
    'M12 12v.01M19.071 4.929c-1.562 -1.562 -6 .337 -9.9 4.243c-3.905 3.905 -5.804 8.337 -4.242 9.9c1.562 1.561 6 -.338 9.9 -4.244c3.905 -3.905 5.804 -8.337 4.242 -9.9M4.929 4.929c-1.562 1.562 .337 6 4.243 9.9c3.905 3.905 8.337 5.804 9.9 4.242c1.561 -1.562 -.338 -6 -4.244 -9.9c-3.905 -3.905 -8.337 -5.804 -9.9 -4.242',
  magnetic:
    'M4 13v-8a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v8a2 2 0 0 0 6 0v-8a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v8a8 8 0 0 1 -16 0M4 8l5 0M15 8l4 0',
  hyper:
    'M4 13a8 8 0 0 1 7 7a6 6 0 0 0 3 -5a9 9 0 0 0 6 -8a3 3 0 0 0 -3 -3a9 9 0 0 0 -8 6a6 6 0 0 0 -5 3M7 14a6 6 0 0 0 -3 6a6 6 0 0 0 6 -3M15 9m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
};

/** An age's icon as SVG markup; DOM-free so it runs under Node. */
export function ageIconSvg(id: string, size: number): string {
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<path d="${AGE_ICON[id] ?? ''}"/></svg>`
  );
}

/** An age's icon to stand in a line of text. */
export function ageIcon(id: string): HTMLElement {
  const s = el('span', { class: 'age-icon' });
  s.innerHTML = ageIconSvg(id, 14);
  return s;
}

/** Where a text names an age first: the index, and the age. */
function firstAge(text: string): { at: number; id: string; name: string } | null {
  let best: { at: number; id: string; name: string } | null = null;
  for (const [id, name] of Object.entries(STR.ages.name)) {
    const at = text.indexOf(name);
    if (at >= 0 && (!best || at < best.at)) best = { at, id, name };
  }
  return best;
}

/** A text cut at the ages it names: its plain pieces, and each age as its id and name. */
export function ageParts(text: string): (string | { id: string; name: string })[] {
  const out: (string | { id: string; name: string })[] = [];
  let rest = text;
  for (let hit = firstAge(rest); hit; hit = firstAge(rest)) {
    if (hit.at > 0) out.push(rest.slice(0, hit.at));
    out.push({ id: hit.id, name: hit.name });
    rest = rest.slice(hit.at + hit.name.length);
  }
  if (rest) out.push(rest);
  return out;
}

/** A text with the icon of every age it names put before the name. */
export function withAgeIcons(text: string): (Node | string)[] {
  return ageParts(text).flatMap((p) => (typeof p === 'string' ? [p] : [ageIcon(p.id), p.name]));
}

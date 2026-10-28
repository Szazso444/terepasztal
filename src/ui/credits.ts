import creditsJson from '../data/credits.json';

/** A licence a credited asset is used under; `required` means the licence asks for the credit. */
export interface CreditLicence {
  name: string;
  url: string;
  required: boolean;
}

/**
 * One third-party asset the game uses: what it is (`kind`), the game vehicles it became (ids in
 * `locomotives.json` / `wagons.json`), its title and author as the source gives them, the page it
 * came from, and its licence (a key of `licences`).
 */
export interface Credit {
  kind: string;
  vehicles: string[];
  title: string;
  author: string;
  url: string;
  licence: string;
}

export interface CreditsData {
  licences: Record<string, CreditLicence>;
  credits: Credit[];
}

export const CREDITS: CreditsData = creditsJson;

/** The licence of a credit; an unknown key counts as one that asks for the credit. */
export function licenceOf(data: CreditsData, c: Credit): CreditLicence {
  return data.licences[c.licence] ?? { name: c.licence, url: '', required: true };
}

/** The credits whose licence asks for them, in the file's order. */
export function requiredCredits(data: CreditsData): Credit[] {
  return data.credits.filter((c) => licenceOf(data, c).required);
}

/** The other credits, one group per author (sorted by name), each in the file's order. */
export function thanksByAuthor(data: CreditsData): { author: string; credits: Credit[] }[] {
  const groups = new Map<string, Credit[]>();
  for (const c of data.credits) {
    if (licenceOf(data, c).required) continue;
    const list = groups.get(c.author) ?? [];
    list.push(c);
    groups.set(c.author, list);
  }
  return [...groups]
    .map(([author, credits]) => ({ author, credits }))
    .sort((a, b) => a.author.localeCompare(b.author, 'en', { sensitivity: 'base' }));
}

/** The game names of a credit's vehicles that the game has, in the credit's order. */
export function vehicleNames(c: Credit, nameOf: (id: string) => string | undefined): string[] {
  return c.vehicles.map(nameOf).filter((n): n is string => !!n);
}

/** What a credit's file says is wrong with it, one line each; empty when it is sound. */
export function creditProblems(data: CreditsData): string[] {
  const out: string[] = [];
  for (const [key, l] of Object.entries(data.licences))
    if (!l.name || !/^https:\/\//.test(l.url))
      out.push(`licence ${key}: needs a name and an https url`);
  data.credits.forEach((c, i) => {
    const at = `credit ${i} (${c.title || '?'})`;
    if (!data.licences[c.licence]) out.push(`${at}: unknown licence "${c.licence}"`);
    if (!c.title || !c.author || !c.kind) out.push(`${at}: needs a kind, a title and an author`);
    if (!/^https:\/\//.test(c.url)) out.push(`${at}: needs an https url`);
    if (!c.vehicles.length) out.push(`${at}: names no game vehicle`);
  });
  return out;
}

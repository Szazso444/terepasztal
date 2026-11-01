import { STR } from '../strings';
import {
  CONTENT_KEYS,
  withoutTicketFields,
  type ContentBundle,
  type ContentKey,
} from '../data/content';
import type { TabDef } from './kit';

/** What the Content editor decides apart from its forms: pure, so it is tested under Node. */

/** The tab that holds the text box: the whole bundle, out and in. */
export const TRANSFER = 'transfer';
export type ContentTab = ContentKey | typeof TRANSFER;

/**
 * The strip: a tab for each table, the ones that run on a stored edit marked, then Transfer for
 * the bundle as text.
 */
export function contentTabs(custom: readonly ContentKey[]): TabDef[] {
  return [
    ...CONTENT_KEYS.map((k) => ({
      id: k,
      label: STR.content.tabs[k] ?? k,
      mark: custom.includes(k) ? STR.content.customTab : null,
    })),
    { id: TRANSFER, label: STR.content.transfer },
  ];
}

/**
 * What the text box brought: the tables it replaced in the draft and the ones left out for their
 * shape, or that it was no JSON object.
 */
export type ImportResult =
  { ok: true; tables: ContentKey[]; skipped: ContentKey[] } | { ok: false };

/** Does `value` have the shape of the table `like`: a list for a list, an object for an object. */
function sameShape(value: unknown, like: unknown): boolean {
  if (Array.isArray(like)) return Array.isArray(value);
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Put the tables a bundle text holds into `draft`, each in place of its own; a key the bundle
 * does not have keeps the draft's table, and so does one that is not in the table's shape (a list
 * where an object stands, a number for a list), which the editor could not draw. Text that is not a
 * JSON object changes nothing. A bundle exported while contracts paid tickets comes in without
 * their fields, so an unedited contracts table is the shipped table again.
 */
export function importBundle(draft: ContentBundle, text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false };
  const j = parsed as Partial<Record<ContentKey, unknown>>;
  const tables: ContentKey[] = [];
  const skipped: ContentKey[] = [];
  for (const k of CONTENT_KEYS)
    if (j[k] !== undefined) {
      if (!sameShape(j[k], draft[k])) skipped.push(k);
      else {
        const table = k === 'contracts' ? withoutTicketFields(j[k]) : j[k];
        (draft as unknown as Record<string, unknown>)[k] = table;
        tables.push(k);
      }
    }
  return { ok: true, tables, skipped };
}

/**
 * What the footer says: Apply waits while a box holds a value the form refused (the draft has
 * none of it, so Apply would not do what the screen shows) and while the draft has problems, and
 * the note says which.
 */
export function applyState(
  problems: readonly string[],
  summary: (p: string[]) => string,
  refused = 0,
): { disabled: boolean; note: string } {
  if (refused > 0) return { disabled: true, note: STR.content.refusedValues(refused) };
  return problems.length
    ? { disabled: true, note: summary([...problems]) }
    : { disabled: false, note: STR.content.applyNote };
}

/** The name of an entry in a list: its id, else its name, else its place. */
export function entryName(row: Record<string, unknown>, index: number): string {
  return String(row.id ?? row.name ?? index);
}

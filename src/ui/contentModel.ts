import { STR } from '../strings';
import { CONTENT_KEYS, type ContentBundle, type ContentKey } from '../data/content';
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

/** What the text box brought: the tables it replaced in the draft, or that it was no JSON object. */
export type ImportResult = { ok: true; tables: ContentKey[] } | { ok: false };

/**
 * Put the tables a bundle text holds into `draft`, each in place of its own; a key the bundle
 * does not have keeps the draft's table. Text that is not a JSON object changes nothing.
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
  for (const k of CONTENT_KEYS)
    if (j[k] !== undefined) {
      (draft as unknown as Record<string, unknown>)[k] = j[k];
      tables.push(k);
    }
  return { ok: true, tables };
}

/** What the footer says: Apply waits while the draft has problems, and the note says which. */
export function applyState(
  problems: readonly string[],
  summary: (p: string[]) => string,
): { disabled: boolean; note: string } {
  return problems.length
    ? { disabled: true, note: summary([...problems]) }
    : { disabled: false, note: STR.content.applyNote };
}

/** The name of an entry in a list: its id, else its name, else its place. */
export function entryName(row: Record<string, unknown>, index: number): string {
  return String(row.id ?? row.name ?? index);
}

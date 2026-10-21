/**
 * What a tooltip says, as plain data: the builders of src/ui/tooltipContent.ts, biomeTooltip.ts and
 * tileTooltip.ts make a `TipDoc` from a snapshot of the game, and `renderTip` (tooltipRender.ts)
 * dresses it in the DOM helpers of src/ui/tooltip.ts. Keeping the document DOM-free is what lets
 * Node tests read a tooltip's rows, tones and terms.
 */
import { cargoName } from '../sim/cargo';
import { NO_CHANGE, signedPercent } from './tooltipFormat';

/** A number token, shown whole in bold (its sign, % and × belong to it). */
export interface NumPart {
  readonly num: string;
}
/** A resource: its icon, then its name in lower case, underlined. */
export interface ResPart {
  /** the cargo id, which names the icon `icons/<cargo>` */
  readonly res: string;
  readonly name: string;
}
/** A word that opens a nested tooltip with `tip`'s document. */
export interface TermPart {
  readonly term: string;
  readonly tip: () => TipDoc;
}
/** A few words in the dim colour, inside a line or a row whatever its tone. */
export interface DimPart {
  readonly dim: string;
}
/** A piece of a line: plain text, or one of the four above. */
export type Inline = string | NumPart | ResPart | TermPart | DimPart;
export type Parts = readonly Inline[];

export type Tone = 'good' | 'bad';

export type Block =
  | { readonly kind: 'title'; readonly parts: Parts }
  | {
      readonly kind: 'text' | 'dim' | 'hint';
      readonly parts: Parts;
      /** a line of text green (good) or red (bad) */
      readonly tone?: Tone;
    }
  | {
      readonly kind: 'row';
      readonly label: Parts;
      readonly value: Parts;
      /** the whole row green (good) or red (bad) */
      readonly tone?: Tone;
      /** a total: a rule above it */
      readonly total?: boolean;
    };
/** A tooltip: its title first, then its lines and rows. */
export type TipDoc = readonly Block[];

// ---------------------------------------------------------------- pieces

/** A number token in bold. */
export function num(token: string | number): NumPart {
  return { num: String(token) };
}
/** A resource by cargo id, named as the game names it. */
export function res(cargo: string): ResPart {
  return { res: cargo, name: cargoName(cargo) };
}
export function term(label: string, tip: () => TipDoc): TermPart {
  return { term: label, tip };
}
/** Words in the dim colour. */
export function quiet(words: string): DimPart {
  return { dim: words };
}
/** A multiplier as a signed percent in bold; exactly 1 is a plain dash. */
export function percent(m: number): Inline {
  return m === 1 ? NO_CHANGE : num(signedPercent(m));
}

export function title(...parts: Inline[]): Block {
  return { kind: 'title', parts };
}
export function text(...parts: Inline[]): Block {
  return { kind: 'text', parts };
}
/** A line of text in red: why something cannot be done. */
export function bad(...parts: Inline[]): Block {
  return { kind: 'text', parts, tone: 'bad' };
}
export function dim(...parts: Inline[]): Block {
  return { kind: 'dim', parts };
}
export function hint(...parts: Inline[]): Block {
  return { kind: 'hint', parts };
}
export function row(
  label: Inline | Parts,
  value: Inline | Parts,
  look: { tone?: Tone; total?: boolean } = {},
): Block {
  return { kind: 'row', label: asParts(label), value: asParts(value), ...look };
}
function asParts(p: Inline | Parts): Parts {
  return Array.isArray(p) ? (p as Parts) : [p as Inline];
}

// ---------------------------------------------------------------- numbers in text

/**
 * A number token in a sentence: an optional sign, $, ×, then digits with thousands commas and a
 * decimal part, then an optional % or ×. Not after a letter or a digit, so "Mk2" is a name. The
 * words around it (the "h" of "9 h", the "u" of "12u") stay out.
 */
const NUMBER = /(?<![\p{L}\d])[+−]?\$?×?\d+(?:,\d{3})*(?:\.\d+)?[%×]?/gu;

/** Plain text with each number token made a bold one. */
export function richText(s: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const m of s.matchAll(NUMBER)) {
    if (m.index > at) out.push(s.slice(at, m.index));
    out.push(num(m[0]));
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push(s.slice(at));
  return out;
}

/**
 * A template from `src/strings.ts` with its `{name}` slots filled. The words around the slots go
 * through `richText`; a slot is put in as given (a name is plain text and stays plain). A slot with
 * no value keeps its braces, so a missing one shows rather than breaks the tooltip.
 */
export function fill(template: string, slots: Record<string, Inline | Parts>): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    out.push(...richText(template.slice(at, m.index)));
    const v = slots[m[1]];
    if (v === undefined) out.push(m[0]);
    else out.push(...asParts(v));
    at = m.index + m[0].length;
  }
  out.push(...richText(template.slice(at)));
  return out;
}

// ---------------------------------------------------------------- reading a document

/** What the parts read as, without formatting: numbers as their tokens, a resource as its name. */
export function plain(parts: Parts): string {
  return parts
    .map((p) =>
      typeof p === 'string'
        ? p
        : 'num' in p
          ? p.num
          : 'res' in p
            ? p.name.toLowerCase()
            : 'dim' in p
              ? p.dim
              : p.term,
    )
    .join('');
}

/** A block as one line of plain text: a row is its label, a colon and its value. */
export function blockText(b: Block): string {
  return b.kind === 'row' ? `${plain(b.label)}: ${plain(b.value)}` : plain(b.parts);
}

/** Every term of a document's parts, in order. */
export function termsOf(doc: TipDoc): TermPart[] {
  const parts = doc.flatMap((b) => (b.kind === 'row' ? [...b.label, ...b.value] : b.parts));
  return parts.filter((p): p is TermPart => typeof p !== 'string' && 'term' in p);
}

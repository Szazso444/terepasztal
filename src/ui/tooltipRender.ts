import type { AtlasRegistry } from '../engine/atlas';
import { itemDef } from '../gacha/items';
import { ageIconSvg, withAgeIcons } from './ageIcon';
import { el } from './dom';
import { vehicleArt } from './economyParts';
import { lineIcon, spriteSlot } from './kit';
import { vehicleLabels } from './labels';
import {
  ttDim,
  ttHint,
  ttIcon,
  ttQuiet,
  ttNum,
  ttRes,
  ttRow,
  ttTerm,
  ttText,
  ttTitle,
  type TipBuild,
  type TipContent,
} from './tooltip';
import type { Block, Inline, Parts, TipDoc } from './tooltipDoc';

/**
 * A tooltip document (tooltipDoc.ts) as the nodes the tooltip stack shows. A term's nested
 * tooltip is made when it opens, from the document its term holds.
 */
export function renderTip(doc: TipDoc, atlas: AtlasRegistry): TipContent {
  const out: TipContent = [];
  let cards: HTMLElement | null = null;
  let card: HTMLElement | null = null;
  for (const b of doc) {
    if (b.kind === 'picture') {
      if (!cards) out.push((cards = el('div', { class: 'tt-cards' })));
      card = el('div', { class: 'tt-card-b' });
      cards.append(el('div', { class: 'tt-card' }, agePicture(b.age, b.src), card));
      continue;
    }
    if (b.kind === 'hint') card = null;
    const node = renderBlock(b, atlas);
    if (card) card.append(node);
    else out.push(node);
  }
  return out;
}

/** An age's picture, or its icon where it has none. */
export function agePicture(age: string, src: string | null, iconSize = 30): HTMLElement {
  const box = el('span', { class: 'tt-pic' });
  if (src) {
    const img = el('img', { src, alt: '' });
    img.draggable = false;
    box.append(img);
    // fixed markup from ageIcon.ts, never from data
  } else box.innerHTML = ageIconSvg(age, iconSize);
  return box;
}

/** What the stack's `hover` and `update` take: the content made from a fresh document. */
export function tipBuild(atlas: AtlasRegistry, make: () => TipDoc): TipBuild {
  return () => renderTip(make(), atlas);
}

function renderBlock(b: Exclude<Block, { kind: 'picture' }>, atlas: AtlasRegistry): HTMLElement {
  switch (b.kind) {
    case 'title':
      return ttTitle(...renderParts(b.parts, atlas));
    case 'text': {
      const line = ttText(...renderParts(b.parts, atlas));
      if (b.tone) line.classList.add(`tt-${b.tone}`);
      return line;
    }
    case 'dim':
      return ttDim(...renderParts(b.parts, atlas));
    case 'hint':
      return ttHint(...renderParts(b.parts, atlas));
    case 'row':
      return ttRow(renderParts(b.label, atlas), renderParts(b.value, atlas), {
        tone: b.tone,
        total: b.total,
        indent: b.indent,
      });
    case 'vehicle':
      return el(
        'div',
        { class: 'tt-vehicle' },
        spriteSlot(vehicleArt(atlas, b.defId)),
        vehicleLabels(itemDef(b.defId)),
      );
  }
}

export function renderParts(parts: Parts, atlas: AtlasRegistry): (Node | string)[] {
  return parts.map((p) => renderInline(p, atlas));
}

function renderInline(p: Inline, atlas: AtlasRegistry): Node | string {
  if (typeof p === 'string') {
    const parts = withAgeIcons(p);
    return parts.length === 1 ? parts[0] : el('span', {}, ...parts);
  }
  if ('num' in p) return ttNum(p.num);
  if ('res' in p) return ttRes(atlas, p.res, p.name);
  if ('icon' in p) return ttIcon(atlas, p.icon);
  if ('glyph' in p) return lineIcon(p.glyph);
  if ('dim' in p) return ttQuiet(p.dim);
  return ttTerm(p.term, () => renderTip(p.tip(), atlas));
}

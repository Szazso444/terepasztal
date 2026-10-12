import type { AtlasRegistry } from '../engine/atlas';
import {
  ttDim,
  ttHint,
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
  return doc.map((b) => renderBlock(b, atlas));
}

/** What the stack's `hover` and `update` take: the content made from a fresh document. */
export function tipBuild(atlas: AtlasRegistry, make: () => TipDoc): TipBuild {
  return () => renderTip(make(), atlas);
}

function renderBlock(b: Block, atlas: AtlasRegistry): HTMLElement {
  switch (b.kind) {
    case 'title':
      return ttTitle(...renderParts(b.parts, atlas));
    case 'text':
      return ttText(...renderParts(b.parts, atlas));
    case 'dim':
      return ttDim(...renderParts(b.parts, atlas));
    case 'hint':
      return ttHint(...renderParts(b.parts, atlas));
    case 'row':
      return ttRow(renderParts(b.label, atlas), renderParts(b.value, atlas), {
        tone: b.tone,
        total: b.total,
      });
  }
}

function renderParts(parts: Parts, atlas: AtlasRegistry): (Node | string)[] {
  return parts.map((p) => renderInline(p, atlas));
}

function renderInline(p: Inline, atlas: AtlasRegistry): Node | string {
  if (typeof p === 'string') return p;
  if ('num' in p) return ttNum(p.num);
  if ('res' in p) return ttRes(atlas, p.res, p.name);
  return ttTerm(p.term, () => renderTip(p.tip(), atlas));
}

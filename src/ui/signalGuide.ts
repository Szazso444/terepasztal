import { el, btn } from './dom';
import { STR } from '../strings';

export function showSignalGuide() {
  const S = STR.signals;
  const root = el('div', { class: 'vehicle-preview-overlay' });
  const close = () => root.remove();
  root.append(
    el(
      'div',
      { class: 'panel vehicle-preview-panel' },
      el('div', { class: 'panel-title' }, S.guideTitle, btn('×', close, 'small')),
      el(
        'div',
        { class: 'panel-body' },
        el('p', { text: S.guidePlace }),
        el('pre', { class: 'signal-diagram', text: S.guideDiagram }),
        el('p', { text: S.guideAspects }),
        el('p', { text: S.guideFence }),
        el('p', { text: S.guideJunction }),
        el('p', { text: S.guideSingleLine }),
      ),
    ),
  );
  root.onmousedown = (e) => {
    if (e.target === root) close();
  };
  document.body.append(root);
}

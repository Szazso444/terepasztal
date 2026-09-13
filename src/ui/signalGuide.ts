import { el, btn } from './dom';

export function showSignalGuide() {
  const root = el('div', { class: 'vehicle-preview-overlay' });
  const close = () => root.remove();
  root.append(
    el(
      'div',
      { class: 'panel vehicle-preview-panel' },
      el('div', { class: 'panel-title' }, 'Semaphores and track blocks', btn('×', close, 'small')),
      el(
        'div',
        { class: 'panel-body' },
        el('p', {
          text: 'Place semaphores on the rails from Utility. Press R before placement, or use Rotate direction after selecting a post. The direction shown in the selection panel is the direction of travel it governs.',
        }),
        el('pre', {
          class: 'signal-diagram',
          text: '→ A  ═════ protected block ═════  → B  ═════ next block ═════  → C\n       one train at a time                  another train may follow',
        }),
        el('p', {
          text: 'Red / horizontal arm: stop before entering the protected block. Yellow: this block is clear, but the next is occupied. Green / raised arm: both are clear. A block ends at the next signal facing the same travel direction.',
        }),
        el('p', {
          text: 'Fence a stretch by putting posts at its entry and exit. Leave at least your longest train plus one tile between posts. Select a signal to highlight its protected stretch. Posts work in Automatic mode as soon as you place them; unsignalled track still uses traffic reservations.',
        }),
        el('p', {
          text: 'Before a junction, put the entry signal on its approach and exit signals beyond each branch, leaving room for a complete train. Junction reservations still require a clear exit, so a green signal alone cannot force a train into a blocked crossing.',
        }),
        el('p', {
          text: 'On a two-way single line, put signals on both approaches to a passing loop, facing into the shared line. Keep the loop long enough for the entire train. Token working in Settings allows one train per shared plain section. Signals regulate entry; they cannot create a missing siding.',
        }),
      ),
    ),
  );
  root.onmousedown = (e) => {
    if (e.target === root) close();
  };
  document.body.append(root);
}

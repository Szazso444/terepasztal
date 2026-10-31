import { el } from './dom';

/**
 * Turn `host` into a text field holding `value`, for a name edited where it stands. Enter or leaving
 * the field says `done` with what was typed, Escape with null; `done` is called once, and draws
 * `host` again. While it is open no key reaches the game.
 */
export function renameField(
  host: HTMLElement,
  value: string,
  max: number,
  done: (name: string | null) => void,
) {
  const input = el('input', { class: 'text small rename-field' });
  input.value = value;
  input.maxLength = max;
  let over = false;
  const finish = (name: string | null) => {
    if (over) return;
    over = true;
    done(name);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(input.value);
    if (e.key === 'Escape') finish(null);
  });
  input.addEventListener('blur', () => finish(input.value));
  for (const type of ['click', 'dblclick', 'pointerdown'])
    input.addEventListener(type, (e) => e.stopPropagation());
  host.replaceChildren(input);
  input.focus();
  input.select();
}

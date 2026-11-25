/**
 * The keys of a number field in a panel the game runs on behind. Typing in it is the player's own
 * doing, and no key of it reaches the game; but the pan keys do not step it, as an edit nobody asked
 * for would be saved when the field lets go. Enter and Escape hand the keys back to the game.
 */
export function guardNumberField(field: EventTarget & { blur(): void }) {
  field.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const { key } = e as KeyboardEvent;
    if (key === 'ArrowUp' || key === 'ArrowDown') e.preventDefault();
    if (key === 'Enter' || key === 'Escape') field.blur();
  });
}
